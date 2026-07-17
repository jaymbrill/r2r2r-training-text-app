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

function start() {
  cron.schedule('* * * * *', tick); // check every minute
  console.log('Nightly text scheduler started');
}

module.exports = { start, tick, sendNightlyText };
