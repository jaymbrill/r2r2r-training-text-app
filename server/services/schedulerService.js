const cron = require('node-cron');
const db = require('../db');
const { generatePlan } = require('./claudeService');
const { sendSms } = require('./twilioService');

/** Current HH:MM, YYYY-MM-DD, and weekday in the user's timezone. */
function localNow(timezone) {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);
  return { time, date, weekday };
}

/** Sunday-evening recap: adherence, volume, ramp, days to goal. */
function weeklySummaryText(userId) {
  const { computeCompliance } = require('./complianceService');
  const { computeTrainingLoad } = require('./stravaService');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const c = computeCompliance(userId, 7);
  const load = computeTrainingLoad(userId);

  const parts = [];
  if (c.totalWorkouts > 0) {
    parts.push(`Week recap: ${c.completed}/${c.totalWorkouts} workouts done${c.adherencePct != null ? ` (${c.adherencePct}%)` : ''}.`);
  } else {
    parts.push('Week recap:');
  }
  parts.push(`${load.acute7d.hours}h, ${load.acute7d.distanceMi} mi, ${load.acute7d.elevationFt} ft vert.`);
  if (c.streak >= 3) parts.push(`${c.streak} workouts in a row — keep the chain going!`);
  if (load.rampRatio != null) {
    parts.push(
      load.rampRatio > 1.5
        ? `Ramp ${load.rampRatio} is hot — this week we absorb it.`
        : load.rampRatio < 0.8
          ? `Ramp ${load.rampRatio} — room to build this week.`
          : `Ramp ${load.rampRatio} — right in the sweet spot.`
    );
  }
  if (user.goal_date) {
    const daysToGo = Math.max(0, Math.round((new Date(user.goal_date) - Date.now()) / (24 * 3600 * 1000)));
    parts.push(`${daysToGo} days to the Canyon.`);
  }
  parts.push('Reply anytime to shape next week.');
  return parts.join(' ');
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
  const users = db
    .prepare('SELECT id, timezone, send_time, last_nightly_sent, last_weekly_sent FROM users')
    .all();
  for (const user of users) {
    try {
      const { time, date, weekday } = localNow(user.timezone);
      if (time !== user.send_time) continue;

      // Sunday: weekly recap goes out first, then the nightly plan text
      if (weekday === 'Sun' && user.last_weekly_sent !== date) {
        console.log(`[scheduler] weekly summary for user ${user.id}`);
        await sendSms(user.id, weeklySummaryText(user.id));
        db.prepare('UPDATE users SET last_weekly_sent = ? WHERE id = ?').run(date, user.id);
      }

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

module.exports = { start, tick, sendNightlyText, complianceTick, weeklySummaryText };
