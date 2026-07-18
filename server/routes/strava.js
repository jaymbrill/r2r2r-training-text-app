const express = require('express');
const db = require('../db');
const strava = require('../services/stravaService');

const router = express.Router();

// In production the client is served by this server, so the Render URL works
// for both. Locally the Vite dev server runs on 5173.
const CLIENT_URL =
  process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173';

function requireUser(req, res) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) {
    res.status(404).json({ errors: ['User not found'] });
    return null;
  }
  return user;
}

// Kick off OAuth: browser navigates here, we redirect to Strava
router.get('/connect/:userId', (req, res, next) => {
  try {
    if (!requireUser(req, res)) return;
    res.redirect(strava.authorizeUrl(req.params.userId));
  } catch (err) {
    next(err);
  }
});

// OAuth callback from Strava
router.get('/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error || !code || !userId) {
    return res.redirect(`${CLIENT_URL}?strava=denied`);
  }
  try {
    await strava.exchangeCode(Number(userId), code);
    // Initial sync so the user sees data right away; ignore failures here
    strava
      .syncActivities(Number(userId))
      .then(() => require('../services/complianceService').matchAndEncourage(Number(userId)))
      .catch((err) => {
        console.error('Initial Strava sync failed:', err.message);
      });
    res.redirect(`${CLIENT_URL}?strava=connected`);
  } catch (err) {
    console.error('Strava OAuth exchange failed:', err.message);
    res.redirect(`${CLIENT_URL}?strava=error`);
  }
});

// Connection status
router.get('/status/:userId', (req, res) => {
  if (!requireUser(req, res)) return;
  res.json(strava.connectionStatus(Number(req.params.userId)));
});

// Manual activity sync (also matches workouts + sends encouragement)
router.post('/sync/:userId', async (req, res, next) => {
  try {
    if (!requireUser(req, res)) return;
    const result = await strava.syncActivities(Number(req.params.userId));
    const { matchAndEncourage } = require('../services/complianceService');
    const { matched } = await matchAndEncourage(Number(req.params.userId));
    res.json({ ...result, workoutsCompleted: matched });
  } catch (err) {
    next(err);
  }
});

// Training load summary
router.get('/load/:userId', (req, res) => {
  if (!requireUser(req, res)) return;
  res.json(strava.computeTrainingLoad(Number(req.params.userId)));
});

// Strava webhook validation handshake (GET with hub.challenge)
router.get('/webhook', (req, res) => {
  const verifyToken = process.env.STRAVA_VERIFY_TOKEN || 'r2r2r-verify';
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) {
    return res.json({ 'hub.challenge': req.query['hub.challenge'] });
  }
  res.status(403).json({ errors: ['Verification failed'] });
});

// Strava webhook events: new/updated activities trigger instant sync,
// workout matching, and encouragement texts
router.post('/webhook', (req, res) => {
  res.status(200).send('ok'); // Strava requires a fast 200; process async

  const event = req.body || {};
  if (event.object_type !== 'activity') return;
  if (!['create', 'update'].includes(event.aspect_type)) return;

  const userId = strava.findUserIdByAthleteId(event.owner_id);
  if (!userId) return;

  (async () => {
    try {
      await strava.fetchAndStoreActivity(userId, event.object_id);
      const { matched } = await require('../services/complianceService').matchAndEncourage(userId);
      console.log(`[strava:webhook] user ${userId} activity ${event.object_id} (${matched} workout(s) matched)`);
    } catch (err) {
      console.error(`[strava:webhook] user ${userId} failed:`, err.message);
    }
  })();
});

// Disconnect Strava
router.delete('/connection/:userId', (req, res) => {
  if (!requireUser(req, res)) return;
  strava.disconnect(Number(req.params.userId));
  res.status(204).end();
});

module.exports = router;
