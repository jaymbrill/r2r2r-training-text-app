const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { generatePlan } = require('./claudeService');
const { computeTrainingLoad } = require('./stravaService');

const MODEL = 'claude-opus-4-8';

const replySchema = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'SMS reply to the athlete. Warm, specific, under 300 characters.',
    },
    constraints: {
      type: 'array',
      description: 'New constraints implied by the message (empty if none)',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['injury', 'fatigue', 'travel', 'other'] },
          description: { type: 'string' },
          startDate: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'YYYY-MM-DD or null' },
          endDate: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'YYYY-MM-DD or null' },
        },
        required: ['kind', 'description', 'startDate', 'endDate'],
        additionalProperties: false,
      },
    },
    adjustments: {
      type: 'array',
      description: 'Direct edits to specific upcoming workouts (empty if none)',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD of the workout to adjust' },
          action: { type: 'string', enum: ['skip', 'move', 'modify'] },
          newDate: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'YYYY-MM-DD, required for move' },
          description: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'New workout description, for modify',
          },
        },
        required: ['date', 'action', 'newDate', 'description'],
        additionalProperties: false,
      },
    },
    updatePlan: {
      type: 'boolean',
      description: 'True if upcoming workouts should be fully regenerated because of this message',
    },
  },
  required: ['reply', 'constraints', 'adjustments', 'updatePlan'],
  additionalProperties: false,
};

const CHAT_SYSTEM_PROMPT = `You are the athlete's R2R2R (Grand Canyon Rim to Rim to Rim) training coach,
texting over SMS. The athlete texts you feedback about how they feel, questions about their plan, or
limitations (injuries, fatigue, travel, schedule changes).

You can do four things with each message:
1. ANSWER questions about the plan — you have their upcoming workouts (dates, types, targets),
   training load, and goal date in context. Answer concretely from that data.
2. RECORD constraints — when the message implies a training limitation, capture it as a structured
   constraint with dates when they can be inferred (an injury is open-ended: null endDate;
   "traveling Thu-Fri" has dates).
3. ADJUST specific workouts directly — when they ask for a targeted change ("move Saturday's long
   run to Sunday", "make tomorrow easier", "skip Tuesday"), use the adjustments array:
   - skip: cancels that day's workout
   - move: moves it to newDate (pick a sensible day if they gave a weekday name)
   - modify: rewrites the description (keep it consistent with their goal)
   Only adjust workouts that exist in the upcoming list, and confirm what you changed in the reply.
4. REGENERATE — set updatePlan=true only when the situation calls for rebuilding the whole
   upcoming plan (new injury, deep fatigue, multi-day travel, missed key sessions). Prefer small
   direct adjustments over regeneration when the athlete asked for a specific change. Never both
   adjust and regenerate in the same reply.

Rules:
- Reply like a coach who knows them: warm, brief (SMS-length), specific to their situation.
- Use US units in replies: miles for distance, feet for elevation gain.
- When updatePlan is true, tell them their plan is being updated and they'll see it in the app
  and in tonight's text. When you made direct adjustments, restate them plainly.
- Never give medical advice beyond common training sense; suggest seeing a professional for pain
  that is sharp, worsening, or changes their gait.`;

function findUserByPhone(phone) {
  const digits = String(phone).replace(/\D/g, '').slice(-10);
  if (digits.length < 7) return null;
  // Normalize in JS: stored phone formats vary (+1 (555) 123-4567 etc.)
  return db
    .prepare('SELECT * FROM users')
    .all()
    .find((u) => u.phone.replace(/\D/g, '').slice(-10) === digits) || null;
}

function recentConversation(userId, limit = 12) {
  return db
    .prepare(`SELECT direction, body FROM messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(userId, limit)
    .reverse();
}

function upcomingWorkouts(userId, days = 14) {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT date, workout_type, description, status,
              ROUND(target_distance_m / 1609.344, 1) AS target_miles,
              ROUND(target_elevation_m * 3.28084) AS target_vert_ft,
              target_duration_s / 60 AS target_min
       FROM planned_workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date`
    )
    .all(userId, today, end);
}

/**
 * Apply the coach's direct workout adjustments. Each applied change is also
 * recorded as a constraint so later regenerations respect it.
 */
function applyAdjustments(userId, adjustments) {
  const insertConstraint = db.prepare(
    `INSERT INTO constraints (user_id, kind, description, start_date, end_date, source) VALUES (?, 'manual_edit', ?, ?, ?, 'sms')`
  );
  let applied = 0;
  for (const adj of adjustments || []) {
    const workout = db
      .prepare(`SELECT * FROM planned_workouts WHERE user_id = ? AND date = ? AND status IN ('planned', 'modified')`)
      .get(userId, adj.date);
    if (!workout) continue;

    if (adj.action === 'skip') {
      db.prepare(`UPDATE planned_workouts SET status = 'skipped' WHERE id = ?`).run(workout.id);
      insertConstraint.run(userId, `Athlete skipped the ${adj.date} workout via text`, adj.date, adj.date);
      applied += 1;
    } else if (adj.action === 'move' && adj.newDate && /^\d{4}-\d{2}-\d{2}$/.test(adj.newDate)) {
      db.prepare(`UPDATE planned_workouts SET date = ?, status = 'modified' WHERE id = ?`).run(adj.newDate, workout.id);
      insertConstraint.run(
        userId,
        `Athlete moved the ${adj.date} workout to ${adj.newDate} via text`,
        adj.date,
        adj.newDate
      );
      applied += 1;
    } else if (adj.action === 'modify' && adj.description) {
      db.prepare(`UPDATE planned_workouts SET description = ?, status = 'modified' WHERE id = ?`).run(
        adj.description,
        workout.id
      );
      insertConstraint.run(
        userId,
        `Athlete adjusted the ${adj.date} workout via text: ${adj.description}`,
        adj.date,
        adj.date
      );
      applied += 1;
    }
  }
  return applied;
}

async function chatWithClaude(user, inboundBody) {
  const client = new Anthropic();
  const context = {
    today: new Date().toISOString().slice(0, 10),
    athlete: {
      name: user.name,
      experienceLevel: user.experience_level,
      goalDate: user.goal_date,
      timezone: user.timezone,
    },
    trainingLoad: computeTrainingLoad(user.id),
    upcomingWorkouts: upcomingWorkouts(user.id),
    conversation: recentConversation(user.id),
  };

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    system: CHAT_SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: replySchema } },
    messages: [
      {
        role: 'user',
        content: `Context:\n${JSON.stringify(context, null, 2)}\n\nThe athlete just texted:\n"${inboundBody}"`,
      },
    ],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    return { reply: "Got it — I've noted that. It'll be factored into your plan.", constraints: [], updatePlan: false };
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  return JSON.parse(text);
}

/** Dev fallback when ANTHROPIC_API_KEY is not configured. */
function chatFallback(inboundBody) {
  return {
    reply: `Got it — noted: "${inboundBody.slice(0, 120)}". I'll factor this into tomorrow's plan. (Dev mode: set ANTHROPIC_API_KEY for real coaching replies.)`,
    constraints: [{ kind: 'other', description: inboundBody.slice(0, 300), startDate: null, endDate: null }],
    updatePlan: true,
  };
}

/**
 * Handle an inbound SMS: record it, get the coach's reply, apply any
 * constraints/adjustments, regenerate the plan when needed.
 * Returns { userId, reply } — the caller is responsible for delivering
 * (and thereby recording) the outbound reply, e.g. via twilioService.sendSms.
 */
async function handleInboundSms(phone, body) {
  const user = findUserByPhone(phone);
  if (!user) return null; // unknown sender: caller decides what to do

  db.prepare(`INSERT INTO messages (user_id, direction, body) VALUES (?, 'inbound', ?)`).run(user.id, body);

  const result = process.env.ANTHROPIC_API_KEY
    ? await chatWithClaude(user, body)
    : chatFallback(body);

  const insertConstraint = db.prepare(
    `INSERT INTO constraints (user_id, kind, description, start_date, end_date, source) VALUES (?, ?, ?, ?, ?, 'sms')`
  );
  for (const c of result.constraints || []) {
    insertConstraint.run(user.id, c.kind, c.description, c.startDate || null, c.endDate || null);
  }

  applyAdjustments(user.id, result.adjustments);

  if (result.updatePlan) {
    // Regenerate in the background; the reply already tells the athlete
    generatePlan(user.id).catch((err) => console.error('Plan regen after SMS failed:', err.message));
  }

  return { userId: user.id, reply: result.reply };
}

module.exports = { handleInboundSms, findUserByPhone, applyAdjustments };
