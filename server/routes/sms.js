const express = require('express');
const { handleInboundSms } = require('../services/chatService');

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

/** Validate X-Twilio-Signature when credentials are configured. */
function validSignature(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true; // dev mode: no validation possible
  const twilio = require('twilio');
  const base = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  const url = `${base}/api/sms/webhook`;
  return twilio.validateRequest(authToken, req.headers['x-twilio-signature'] || '', url, req.body);
}

// Twilio inbound SMS webhook. Configure in the Twilio console:
//   Phone number -> Messaging -> "A message comes in" -> POST
//   https://<your-app>.onrender.com/api/sms/webhook
router.post('/webhook', async (req, res) => {
  if (!validSignature(req)) return res.status(403).send('invalid signature');

  const { From: from, Body: body } = req.body || {};
  res.type('text/xml');
  if (!from || !body) return res.send('<Response></Response>');

  try {
    const reply = await handleInboundSms(from, body.trim());
    if (!reply) return res.send('<Response></Response>'); // unknown number
    res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  } catch (err) {
    console.error('Inbound SMS handling failed:', err.message);
    res.send(
      `<Response><Message>Sorry, I hit a snag reading that. Please try again in a bit.</Message></Response>`
    );
  }
});

module.exports = router;
