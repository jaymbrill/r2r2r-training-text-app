const express = require('express');
const db = require('../db');

const router = express.Router();

/**
 * Simple password gate for the admin dashboard. Not a full auth system —
 * appropriate for a single-operator personal project, not multi-admin use.
 * Set ADMIN_PASSWORD in the environment; without it, admin routes are
 * disabled entirely (fail closed, not open).
 */
function requireAdmin(req, res, next) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) {
    return res.status(503).json({ errors: ['Admin dashboard is not configured (set ADMIN_PASSWORD)'] });
  }
  const provided = req.headers['x-admin-password'] || req.query.password;
  if (provided !== configured) {
    return res.status(401).json({ errors: ['Invalid admin password'] });
  }
  next();
}

router.use(requireAdmin);

// Summary stats + recent users
router.get('/stats', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const stravaConnected = db.prepare('SELECT COUNT(*) AS n FROM strava_accounts').get().n;
  const phoneVerified = db.prepare('SELECT COUNT(*) AS n FROM users WHERE phone_verified = 1').get().n;

  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const signupsLast7d = db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE date(created_at) >= ?`)
    .get(since7d).n;

  const totalActivities = db.prepare('SELECT COUNT(*) AS n FROM activities').get().n;
  const totalPlans = db.prepare('SELECT COUNT(*) AS n FROM training_plans').get().n;
  const messagesByDirection = db
    .prepare(`SELECT direction, COUNT(*) AS n FROM messages GROUP BY direction`)
    .all();
  const messages = Object.fromEntries(messagesByDirection.map((r) => [r.direction, r.n]));

  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.phone_verified, u.experience_level,
              u.goal_date, u.timezone, u.send_time, u.created_at,
              CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END AS strava_connected,
              (SELECT COUNT(*) FROM planned_workouts pw WHERE pw.user_id = u.id) AS workout_count,
              (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) AS message_count
       FROM users u
       LEFT JOIN strava_accounts s ON s.user_id = u.id
       ORDER BY u.created_at DESC`
    )
    .all()
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      phoneVerified: !!u.phone_verified,
      experienceLevel: u.experience_level,
      goalDate: u.goal_date,
      timezone: u.timezone,
      sendTime: u.send_time,
      createdAt: u.created_at,
      stravaConnected: !!u.strava_connected,
      workoutCount: u.workout_count,
      messageCount: u.message_count,
    }));

  res.json({
    totalUsers,
    stravaConnected,
    phoneVerified,
    signupsLast7d,
    totalActivities,
    totalPlans,
    messages: { inbound: messages.inbound || 0, outbound: messages.outbound || 0 },
    users,
  });
});

module.exports = router;
