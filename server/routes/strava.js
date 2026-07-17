const express = require('express');
const db = require('../db');
const strava = require('../services/stravaService');

const router = express.Router();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

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
    strava.syncActivities(Number(userId)).catch((err) => {
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

// Manual activity sync
router.post('/sync/:userId', async (req, res, next) => {
  try {
    if (!requireUser(req, res)) return;
    const result = await strava.syncActivities(Number(req.params.userId));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Training load summary
router.get('/load/:userId', (req, res) => {
  if (!requireUser(req, res)) return;
  res.json(strava.computeTrainingLoad(Number(req.params.userId)));
});

// Disconnect Strava
router.delete('/connection/:userId', (req, res) => {
  if (!requireUser(req, res)) return;
  strava.disconnect(Number(req.params.userId));
  res.status(204).end();
});

module.exports = router;
