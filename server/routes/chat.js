const express = require('express');
const db = require('../db');
const { coachTurn } = require('../services/chatService');

const router = express.Router();

function requireUser(req, res) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) {
    res.status(404).json({ errors: ['User not found'] });
    return null;
  }
  return user;
}

// Conversation history (shared thread with SMS)
router.get('/:userId/messages', (req, res) => {
  if (!requireUser(req, res)) return;
  const rows = db
    .prepare(
      `SELECT id, direction, body, created_at FROM messages
       WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`
    )
    .all(req.params.userId)
    .reverse();
  res.json(rows.map((m) => ({ id: m.id, direction: m.direction, body: m.body, createdAt: m.created_at })));
});

// Send a message to the coach from the web app
router.post('/:userId/messages', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ errors: ['message is required'] });
    if (message.length > 1000) return res.status(400).json({ errors: ['message is too long (max 1000 chars)'] });

    const result = await coachTurn(user, message, 'web');
    // Record the coach's reply (SMS path records via sendSms; web records here)
    db.prepare(`INSERT INTO messages (user_id, direction, body) VALUES (?, 'outbound', ?)`).run(
      user.id,
      result.reply
    );
    res.json({
      reply: result.reply,
      planChanged: result.adjustmentsApplied > 0,
      planRegenerating: result.planRegenerating,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
