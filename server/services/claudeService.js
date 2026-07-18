const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { computeTrainingLoad } = require('./stravaService');

const MODEL = 'claude-opus-4-8';
const PLAN_DAYS = 14;

const planSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Two or three sentences on the plan focus for the next two weeks',
    },
    workouts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          workoutType: {
            type: 'string',
            enum: ['run', 'long_run', 'hike', 'vert', 'back_to_back', 'cross_train', 'strength', 'rest'],
          },
          description: { type: 'string', description: 'One or two sentences the athlete reads' },
          targetDistanceKm: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          targetElevationM: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          targetDurationMin: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['date', 'workoutType', 'description', 'targetDistanceKm', 'targetElevationM', 'targetDurationMin'],
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
- Schedule back-to-back long efforts on adjacent available days as the goal date approaches.
- Honor all listed constraints (injuries, fatigue, travel, manual edits). Never schedule hard
  efforts on days the athlete said they are unavailable.
- Include genuine rest days. Descending strength (quads) and hiking with poles are fair game.
- The SMS should be encouraging and specific, like a coach texting an athlete they know.`;

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

function datesForPlan(startDate) {
  const dates = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < PLAN_DAYS; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

async function generateWithClaude(context, startDate) {
  const client = new Anthropic();
  const { user, load, constraints, recentMessages } = context;

  const input = {
    today: new Date().toISOString().slice(0, 10),
    planStartDate: startDate,
    planDays: PLAN_DAYS,
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

  // Stream to avoid HTTP timeouts on longer generations.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: planSchema } },
    messages: [
      {
        role: 'user',
        content: `Build the next ${PLAN_DAYS}-day training plan starting ${startDate}. One entry per day (use type "rest" for rest days). Athlete data:\n${JSON.stringify(input, null, 2)}`,
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
function generateFallback(context, startDate) {
  const { user } = context;
  const availability = JSON.parse(user.weekly_availability);
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const workouts = datesForPlan(startDate).map((date) => {
    const dow = dayKeys[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const hours = availability[dow] || 0;
    if (!hours) {
      return { date, workoutType: 'rest', description: 'Rest day. Recover well.', targetDistanceKm: null, targetElevationM: null, targetDurationMin: null };
    }
    const long = hours >= 3;
    return {
      date,
      workoutType: long ? 'long_run' : 'run',
      description: long
        ? `Long effort on hilly trails, about ${hours} hours. Hike the climbs, run the flats.`
        : `Easy run with some hills, about ${Math.round(hours * 60)} minutes.`,
      targetDistanceKm: long ? hours * 7 : hours * 9,
      targetElevationM: long ? hours * 300 : hours * 150,
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

  const { plan, model } = process.env.ANTHROPIC_API_KEY
    ? await generateWithClaude(context, start)
    : generateFallback(context, start);

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
        w.targetDistanceKm != null ? w.targetDistanceKm * 1000 : null,
        w.targetElevationM,
        w.targetDurationMin != null ? w.targetDurationMin * 60 : null
      );
    }
    return planId;
  });

  const planId = insertPlan();
  return { planId, model, summary: plan.summary, smsForTomorrow: plan.smsForTomorrow };
}

module.exports = { generatePlan, buildContext };
