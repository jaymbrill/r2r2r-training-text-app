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
    updatePlan: {
      type: 'boolean',
      description: 'True if upcoming workouts should be regenerated because of this message',
    },
  },
  required: ['reply', 'constraints', 'updatePlan'],
  additionalProperties: false,
};

const CHAT_SYSTEM_PROMPT = `You are the athlete's R2R2R (Grand Canyon Rim to Rim to Rim) training coach,
texting over SMS. The athlete texts you feedback about how they feel, questions about their plan, or
limitations (injuries, fatigue, travel, schedule changes).

Rules:
- Reply like a coach who knows them: warm, brief (SMS-length), specific to their situation.
- When the message implies a training limitation, capture it as a structured constraint with dates
  when they can be inferred (an injury is open-ended: null endDate; "traveling Thu-Fri" has dates).
- Set updatePlan=true when the message should change upcoming workouts (injury, deep fatigue,
  travel, missed key session). Set it false for simple questions, general chat, or good news.
- When updatePlan is true, tell them their plan is being updated and they'll see it in the app
  and in tonight's text.
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

function upcomingWorkouts(userId, days = 7) {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return db
    .prepare(`SELECT date, workout_type, description, status FROM planned_workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date`)
    .all(userId, today, end);
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
 * constraints, regenerate the plan when needed. Returns the reply text
 * (recorded as an outbound message by the caller or webhook).
 */
async function handleInboundSms(phone, body) {
  const user = findUserByPhone(phone);
  if (!user) return null; // unknown sender: no reply

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

  if (result.updatePlan) {
    // Regenerate in the background; the reply already tells the athlete
    generatePlan(user.id).catch((err) => console.error('Plan regen after SMS failed:', err.message));
  }

  db.prepare(`INSERT INTO messages (user_id, direction, body) VALUES (?, 'outbound', ?)`).run(user.id, result.reply);
  return result.reply;
}

module.exports = { handleInboundSms, findUserByPhone };
