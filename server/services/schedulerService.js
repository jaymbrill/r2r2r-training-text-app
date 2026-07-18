const cron = require('node-cron');
const db = require('../db');
const { generatePlan } = require('./claudeService');
const { sendSms } = require('./twilioService');

/** Current HH:MM and YYYY-MM-DD in the user's timezone. */
function localNow(timezone) {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  return { time, date };
}

/**
 * Regenerate the user's plan (so it reflects the latest Strava load and
 * constraints) and text them tomorrow's workout.
 */
async function sendNightlyText(userId) {
  const result = await generatePlan(userId);
  await sendSms(userId, result.smsForTomorrow);
  db.prepare(`UPDATE users SET last_nightly_sent = ? WHERE id = ?`).run(
    new Date().toISOString().slice(0, 10),
    userId
  );
  return result;
}

/** One scheduler tick: send to every user whose local time matches their send_time. */
async function tick() {
  const users = db.prepare('SELECT id, timezone, send_time, last_nightly_sent FROM users').all();
  for (const user of users) {
    try {
      const { time, date } = localNow(user.timezone);
      if (time !== user.send_time) continue;
      if (user.last_nightly_sent === date) continue; // already sent today
      console.log(`[scheduler] nightly text for user ${user.id}`);
      await sendNightlyText(user.id);
    } catch (err) {
      console.error(`[scheduler] user ${user.id} failed:`, err.message);
    }
  }
}

/**
 * Hourly: sync Strava for connected users, match activities to planned
 * workouts, and send post-workout encouragement texts.
 */
async function complianceTick() {
  const { syncActivities } = require('./stravaService');
  const { matchAndEncourage } = require('./complianceService');
  const users = db.prepare('SELECT user_id FROM strava_accounts').all();
  for (const { user_id } of users) {
    try {
      await syncActivities(user_id, { daysBack: 7 });
      const { matched } = await matchAndEncourage(user_id);
      if (matched) console.log(`[scheduler] user ${user_id}: ${matched} workout(s) completed`);
    } catch (err) {
      console.error(`[scheduler] compliance for user ${user_id} failed:`, err.message);
    }
  }
}

function start() {
  cron.schedule('* * * * *', tick); // nightly-text check every minute
  cron.schedule('10 * * * *', complianceTick); // compliance + encouragement hourly
  console.log('Schedulers started (nightly texts + hourly compliance)');
}

module.exports = { start, tick, sendNightlyText, complianceTick };
