const express = require('express');
const { handleInboundSms, findUserByPhone } = require('../services/chatService');
const { sendSms } = require('../services/twilioService');

const router = express.Router();

// Twilio posts form-encoded bodies
router.use(express.urlencoded({ extended: false }));

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validate X-Twilio-Signature when credentials are configured. Twilio signs
 * the exact URL configured in its console, so we check both the configured
 * base URL and the URL reconstructed from the request itself (covers proxy
 * and configuration drift), and log a loud diagnostic on failure.
 */
function validSignature(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true; // dev mode: no validation possible
  const twilio = require('twilio');
  const signature = req.headers['x-twilio-signature'] || '';

  const candidates = new Set();
  const base = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (base) candidates.add(`${base.replace(/\/$/, '')}/api/sms/webhook`);
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) candidates.add(`${proto}://${host}${req.originalUrl}`);

  for (const url of candidates) {
    if (twilio.validateRequest(authToken, signature, url, req.body)) return true;
  }
  console.error(
    `[sms] signature validation FAILED. Tried URLs: ${[...candidates].join(', ')} — ` +
      `check that the Twilio console webhook URL matches exactly (https, host, path, no trailing slash).`
  );
  return false;
}

// Twilio inbound SMS webhook. Configure in the Twilio console:
//   Phone number -> Messaging -> "A message comes in" -> POST
//   https://<your-app>.onrender.com/api/sms/webhook
//
// We acknowledge immediately (Twilio times out webhooks at 15s; the Claude
// call can take longer) and deliver the coach's reply via the REST API.
router.post('/webhook', (req, res) => {
  if (!validSignature(req)) return res.status(403).send('invalid signature');

  const { From: from, Body: body } = req.body || {};
  res.type('text/xml');

  if (!from || !body) {
    console.log('[sms] webhook hit without From/Body');
    return res.send('<Response></Response>');
  }

  const user = findUserByPhone(from);
  if (!user) {
    console.log(`[sms] inbound from unregistered number ${from}`);
    // Cheap static TwiML reply — no Claude call, no REST send
    return res.send(
      `<Response><Message>${escapeXml(
        "This number isn't linked to an R2R2R training profile. Register (or update your phone) in the app first."
      )}</Message></Response>`
    );
  }

  console.log(`[sms] inbound from user ${user.id}: "${String(body).slice(0, 80)}"`);
  res.send('<Response></Response>'); // ack now; reply arrives via REST API

  (async () => {
    try {
      const result = await handleInboundSms(from, String(body).trim());
      if (result?.reply) {
        await sendSms(result.userId, result.reply, { bypassCap: true });
        console.log(`[sms] replied to user ${result.userId}`);
      }
    } catch (err) {
      console.error('[sms] inbound handling failed:', err.message);
      try {
        await sendSms(user.id, 'Sorry, I hit a snag reading that. Please try again in a bit.', {
          bypassCap: true,
        });
      } catch (sendErr) {
        console.error('[sms] error-reply send failed:', sendErr.message);
      }
    }
  })();
});

module.exports = router;
