const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { computeTrainingLoad } = require('./stravaService');

const MODEL = 'claude-opus-4-8';
const DEFAULT_PLAN_DAYS = 14;
const MAX_PLAN_DAYS = 182; // cap ~26 weeks so generation stays bounded

/** Days from the start date through the goal date (inclusive), bounded. */
function planLength(user, startDate) {
  if (!user.goal_date) return DEFAULT_PLAN_DAYS;
  const start = new Date(`${startDate}T00:00:00Z`);
  const goal = new Date(`${user.goal_date}T00:00:00Z`);
  const days = Math.round((goal - start) / (24 * 3600 * 1000)) + 1;
  if (!Number.isFinite(days) || days < 1) return DEFAULT_PLAN_DAYS;
  return Math.min(days, MAX_PLAN_DAYS);
}

const planSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Two or three sentences on the plan focus and periodization through race day',
    },
    workouts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          workoutType: {
            type: 'string',
            enum: ['run', 'long_run', 'hike', 'vert', 'peak_climb', 'back_to_back', 'cross_train', 'strength', 'rest'],
          },
          description: { type: 'string', description: 'One or two sentences the athlete reads' },
          targetDistanceMi: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'miles' },
          targetElevationFt: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'vertical feet' },
          targetDurationMin: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['date', 'workoutType', 'description', 'targetDistanceMi', 'targetElevationFt', 'targetDurationMin'],
        additionalProperties: false,
      },
    },
    smsForTomorrow: {
      type: 'string',
      description: 'The evening text message for tomorrow, friendly and under 300 characters',
    },
  },
  required: ['summary', 'workouts', 'smsForTomorrow'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are an experienced ultra-endurance coach building training plans for the
Grand Canyon Rim to Rim to Rim (R2R2R): roughly 42-48 miles with ~11,000 ft of climbing and descending
in a single day, often with big temperature swings and long sustained downhills.

Principles:
- Elevation (vert) and time-on-feet matter more than flat speed. Prioritize climbing/descending volume.
- Respect the athlete's weekly availability, experience level, and current training load.
- Keep the acute:chronic ramp ratio sustainable (roughly 0.8-1.3); back off when it runs hot,
  and build gradually when there is room.
- You are building the FULL plan through race day. Periodize it: progressive base building,
  a peak block ~3-5 weeks out, then a taper in the final 1-2 weeks. Insert recovery/down weeks
  (roughly every 4th week) with reduced volume.
- Schedule back-to-back long efforts on adjacent available days as the goal date approaches.
- Big-mountain days are the best specific preparation for R2R2R. Use the "peak_climb" workout type
  for 14ers and other large mountain objectives — big sustained climbs and long descents that
  mimic the Canyon. If the athlete has named specific peaks or dates in their constraints or
  messages, schedule those on the requested dates; otherwise place peak_climb days on their
  longest available days during the peak block. Give each a realistic mileage and vertical-foot
  target (a 14er is often 8-14 miles and 3,000-5,500 ft of gain).
- Honor all listed constraints (injuries, fatigue, travel, manual edits, planned events). Never
  schedule hard efforts on days the athlete said they are unavailable.
- Include genuine rest days. Descending strength (quads) and hiking with poles are fair game.
- The SMS should be encouraging and specific, like a coach texting an athlete they know.
- Use US units everywhere the athlete will read: miles for distance, feet for elevation gain.`;

function buildContext(userId, startDate) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const load = computeTrainingLoad(userId);
  const constraints = db
    .prepare(
      `SELECT kind, description, start_date, end_date FROM constraints
       WHERE user_id = ? AND active = 1
       AND (end_date IS NULL OR end_date >= ?)
       ORDER BY created_at DESC LIMIT 25`
    )
    .all(userId, startDate);
  const recentMessages = db
    .prepare(
      `SELECT direction, body, created_at FROM messages
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
    )
    .all(userId)
    .reverse();

  return { user, load, constraints, recentMessages };
}

function datesForPlan(startDate, days) {
  const dates = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

async function generateWithClaude(context, startDate, planDays) {
  const client = new Anthropic();
  const { user, load, constraints, recentMessages } = context;

  const input = {
    today: new Date().toISOString().slice(0, 10),
    planStartDate: startDate,
    planDays,
    raceDate: user.goal_date,
    athlete: {
      name: user.name,
      experienceLevel: user.experience_level,
      goalDate: user.goal_date,
      weeklyAvailabilityHours: JSON.parse(user.weekly_availability),
      timezone: user.timezone,
    },
    trainingLoad: load,
    activeConstraints: constraints,
    recentSmsConversation: recentMessages,
  };

  // Stream to avoid HTTP timeouts on longer generations; a full plan to race
  // day can be many months of daily entries.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: planSchema } },
    messages: [
      {
        role: 'user',
        content: `Build the complete ${planDays}-day training plan starting ${startDate} and running through race day ${user.goal_date}. Exactly one entry per day (use type "rest" for rest days). Periodize across the whole block and place peak_climb / big-mountain days as described. Athlete data:\n${JSON.stringify(input, null, 2)}`,
      },
    ],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    const err = new Error('Plan generation was refused');
    err.status = 502;
    throw err;
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    const err = new Error('Claude returned no plan content');
    err.status = 502;
    throw err;
  }
  return { plan: JSON.parse(text), model: MODEL };
}

/**
 * Deterministic fallback used when ANTHROPIC_API_KEY is not configured, so the
 * app is fully testable in development. Marked model: "fallback" in the DB.
 */
function generateFallback(context, startDate, planDays) {
  const { user } = context;
  const availability = JSON.parse(user.weekly_availability);
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const workouts = datesForPlan(startDate, planDays).map((date) => {
    const dow = dayKeys[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const hours = availability[dow] || 0;
    if (!hours) {
      return { date, workoutType: 'rest', description: 'Rest day. Recover well.', targetDistanceMi: null, targetElevationFt: null, targetDurationMin: null };
    }
    const long = hours >= 3;
    return {
      date,
      workoutType: long ? 'long_run' : 'run',
      description: long
        ? `Long effort on hilly trails, about ${hours} hours. Hike the climbs, run the flats.`
        : `Easy run with some hills, about ${Math.round(hours * 60)} minutes.`,
      targetDistanceMi: long ? +(hours * 4.5).toFixed(1) : +(hours * 5.5).toFixed(1),
      targetElevationFt: long ? Math.round(hours * 1000) : Math.round(hours * 500),
      targetDurationMin: Math.round(hours * 60),
    };
  });
  const firstDay = workouts[0];
  return {
    plan: {
      summary: 'Placeholder plan generated without Claude (no API key configured). Structured around your weekly availability.',
      workouts,
      smsForTomorrow: `Tomorrow: ${firstDay.description}`,
    },
    model: 'fallback',
  };
}

/**
 * Generate and persist a new current plan for the user, starting tomorrow
 * (or the given start date). Past/completed workouts are preserved; future
 * planned ones are replaced.
 */
async function generatePlan(userId, { startDate } = {}) {
  const start = startDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const context = buildContext(userId, start);
  const planDays = planLength(context.user, start);

  const { plan, model } = process.env.ANTHROPIC_API_KEY
    ? await generateWithClaude(context, start, planDays)
    : generateFallback(context, start, planDays);

  const insertPlan = db.transaction(() => {
    db.prepare('UPDATE training_plans SET is_current = 0 WHERE user_id = ?').run(userId);
    const planRow = db
      .prepare('INSERT INTO training_plans (user_id, model, summary, is_current) VALUES (?, ?, ?, 1)')
      .run(userId, model, plan.summary);
    const planId = planRow.lastInsertRowid;

    // Replace future workouts that weren't completed/skipped. Manual edits are
    // preserved as constraints, which the new plan already accounts for.
    db.prepare(
      `DELETE FROM planned_workouts WHERE user_id = ? AND date >= ? AND status IN ('planned', 'modified')`
    ).run(userId, start);

    const insertWorkout = db.prepare(
      `INSERT INTO planned_workouts (plan_id, user_id, date, workout_type, description, target_distance_m, target_elevation_m, target_duration_s)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const w of plan.workouts) {
      insertWorkout.run(
        planId,
        userId,
        w.date,
        w.workoutType,
        w.description,
        w.targetDistanceMi != null ? w.targetDistanceMi * 1609.344 : null,
        w.targetElevationFt != null ? w.targetElevationFt / 3.28084 : null,
        w.targetDurationMin != null ? w.targetDurationMin * 60 : null
      );
    }
    return planId;
  });

  const planId = insertPlan();
  return { planId, model, summary: plan.summary, smsForTomorrow: plan.smsForTomorrow };
}

module.exports = { generatePlan, buildContext };
