const db = require('../db');
const { sendSms } = require('./twilioService');

const MIN_MATCH_MINUTES = 20; // ignore tiny activities when matching workouts

function encouragementText(user, workout, activity) {
  const miles = (activity.distance_m / 1609.344).toFixed(1);
  const vertFt = Math.round(activity.elevation_gain_m * 3.28084);
  const hours = (activity.moving_time_s / 3600).toFixed(1);
  const firstName = user.name.split(' ')[0];

  const openers = [
    `Nice work, ${firstName}!`,
    `Strong one, ${firstName}!`,
    `That's how it's done, ${firstName}!`,
    `Great job getting it in, ${firstName}!`,
  ];
  const opener = openers[workout.id % openers.length];

  const stats = `${miles} mi, ${vertFt} ft of vert in ${hours}h`;
  const daysToGo = user.goal_date
    ? Math.max(0, Math.round((new Date(user.goal_date) - Date.now()) / (24 * 3600 * 1000)))
    : null;
  const goalBit = daysToGo != null ? ` ${daysToGo} days to the Canyon — every one of these counts.` : '';

  return `${opener} Logged your ${workout.workout_type.replace('_', ' ')}: ${stats}.${goalBit} How did it feel? Text me back and I'll factor it into tomorrow's plan.`;
}

/**
 * Match synced Strava activities against planned workouts: any planned,
 * non-rest workout on a day with a real activity gets marked completed and
 * earns an encouragement text (which invites the athlete to text back).
 */
async function matchAndEncourage(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { matched: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const candidates = db
    .prepare(
      `SELECT w.id AS workout_id, w.date, w.workout_type, a.id AS activity_id,
              a.distance_m, a.elevation_gain_m, a.moving_time_s
       FROM planned_workouts w
       JOIN activities a
         ON a.user_id = w.user_id
        AND substr(a.start_date, 1, 10) = w.date
        AND a.moving_time_s >= ?
       WHERE w.user_id = ? AND w.status = 'planned' AND w.workout_type != 'rest' AND w.date <= ?
       GROUP BY w.id`
    )
    .all(MIN_MATCH_MINUTES * 60, userId, today);

  let matched = 0;
  for (const row of candidates) {
    db.prepare(`UPDATE planned_workouts SET status = 'completed', completed_activity_id = ? WHERE id = ?`).run(
      row.activity_id,
      row.workout_id
    );
    matched += 1;
    // Encourage only for today's/yesterday's efforts, not backfilled history
    const ageDays = Math.round((new Date(today) - new Date(row.date)) / (24 * 3600 * 1000));
    if (ageDays <= 1) {
      const workout = { id: row.workout_id, workout_type: row.workout_type };
      const activity = {
        distance_m: row.distance_m,
        elevation_gain_m: row.elevation_gain_m,
        moving_time_s: row.moving_time_s,
      };
      try {
        await sendSms(userId, encouragementText(user, workout, activity));
      } catch (err) {
        console.error(`Encouragement SMS for user ${userId} failed:`, err.message);
      }
    }
  }
  return { matched };
}

/**
 * Adherence stats over the trailing window (default 28 days, through today).
 * Rest days don't count toward adherence.
 */
function computeCompliance(userId, days = 28) {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM planned_workouts
       WHERE user_id = ? AND date BETWEEN ? AND ? AND workout_type != 'rest'
       GROUP BY status`
    )
    .all(userId, since, today);
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const completed = byStatus.completed || 0;
  const skipped = byStatus.skipped || 0;
  const planned = byStatus.planned || 0; // scheduled but no matching activity (yet)
  const modified = byStatus.modified || 0;
  const total = completed + skipped + planned + modified;

  // Current streak: consecutive non-rest workout days completed, walking
  // backwards from yesterday (today may legitimately still be pending)
  const past = db
    .prepare(
      `SELECT date, status FROM planned_workouts
       WHERE user_id = ? AND date < ? AND workout_type != 'rest'
       ORDER BY date DESC LIMIT 60`
    )
    .all(userId, today);
  let streak = 0;
  for (const w of past) {
    if (w.status === 'completed') streak += 1;
    else break;
  }

  return {
    windowDays: days,
    totalWorkouts: total,
    completed,
    skipped,
    pending: planned,
    adherencePct: total ? Math.round((completed / total) * 100) : null,
    streak,
  };
}

module.exports = { matchAndEncourage, computeCompliance, encouragementText };
