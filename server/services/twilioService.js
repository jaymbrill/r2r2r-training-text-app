const db = require('../db');

function twilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  // Lazy require so the app runs without the credentials in dev
  const twilio = require('twilio');
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/**
 * Send an SMS to a user and record it in the messages table.
 * Without Twilio credentials (dev), the message is logged and stored
 * with a null twilio_sid so the rest of the pipeline is testable.
 */
/** Daily cost cap: max app-initiated texts per user per day. */
function underDailyCap(userId) {
  const cap = Number(process.env.MAX_SMS_PER_DAY || 6);
  const sentToday = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE user_id = ? AND direction = 'outbound' AND date(created_at) = date('now')`
    )
    .get(userId).n;
  return sentToday < cap;
}

async function sendSms(userId, body) {
  const user = db.prepare('SELECT phone FROM users WHERE id = ?').get(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (!underDailyCap(userId)) {
    console.log(`[sms:cap] user ${userId} hit the daily SMS cap; message not sent`);
    return { sid: null, delivered: false, capped: true };
  }

  const client = twilioClient();
  let sid = null;
  if (client) {
    const message = await client.messages.create({
      to: user.phone,
      from: process.env.TWILIO_PHONE_NUMBER,
      body,
    });
    sid = message.sid;
  } else {
    console.log(`[sms:dev] to ${user.phone}: ${body}`);
  }

  db.prepare(`INSERT INTO messages (user_id, direction, body, twilio_sid) VALUES (?, 'outbound', ?, ?)`).run(
    userId,
    body,
    sid
  );
  return { sid, delivered: !!client };
}

module.exports = { sendSms };
