const express = require('express');
const db = require('../db');

const router = express.Router();

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    phoneVerified: !!row.phone_verified,
    timezone: row.timezone,
    goalDate: row.goal_date,
    experienceLevel: row.experience_level,
    weeklyAvailability: JSON.parse(row.weekly_availability),
    sendTime: row.send_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateProfile(body, { partial = false } = {}) {
  const errors = [];
  const check = (field, ok, message) => {
    if (body[field] === undefined) {
      if (!partial) errors.push(`${field} is required`);
      return;
    }
    if (!ok(body[field])) errors.push(message);
  };

  check('name', (v) => typeof v === 'string' && v.trim().length > 0, 'name must be a non-empty string');
  check('email', (v) => typeof v === 'string' && /^\S+@\S+\.\S+$/.test(v), 'email is invalid');
  check('phone', (v) => typeof v === 'string' && /^\+?[\d\s()-]{7,20}$/.test(v), 'phone is invalid');
  check('goalDate', (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v), 'goalDate must be YYYY-MM-DD');
  check(
    'experienceLevel',
    (v) => ['beginner', 'intermediate', 'advanced'].includes(v),
    'experienceLevel must be beginner, intermediate, or advanced'
  );
  check(
    'weeklyAvailability',
    (v) => typeof v === 'object' && v !== null && Object.keys(v).every((k) => DAYS.includes(k)),
    'weeklyAvailability must be an object keyed by mon..sun'
  );
  check('sendTime', (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'sendTime must be HH:MM');
  check('timezone', (v) => typeof v === 'string' && v.length > 0, 'timezone must be a string');

  return errors;
}

// Register a new user
router.post('/', (req, res) => {
  const errors = validateProfile(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const { name, email, phone, timezone, goalDate, experienceLevel, weeklyAvailability, sendTime } = req.body;
  try {
    const result = db
      .prepare(
        `INSERT INTO users (name, email, phone, timezone, goal_date, experience_level, weekly_availability, send_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name.trim(), email.toLowerCase(), phone, timezone, goalDate, experienceLevel, JSON.stringify(weeklyAvailability), sendTime);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(serializeUser(user));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ errors: ['A user with that email already exists'] });
    }
    throw err;
  }
});

// Get a user profile
router.get('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ errors: ['User not found'] });
  res.json(serializeUser(user));
});

// Update a user profile
router.patch('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ errors: ['User not found'] });

  const errors = validateProfile(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ errors });

  const columnFor = {
    name: 'name',
    email: 'email',
    phone: 'phone',
    timezone: 'timezone',
    goalDate: 'goal_date',
    experienceLevel: 'experience_level',
    weeklyAvailability: 'weekly_availability',
    sendTime: 'send_time',
  };

  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(columnFor)) {
    if (req.body[field] === undefined) continue;
    let value = req.body[field];
    if (field === 'weeklyAvailability') value = JSON.stringify(value);
    if (field === 'email') value = value.toLowerCase();
    if (field === 'phone' && value !== user.phone) {
      sets.push('phone_verified = 0');
    }
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (!sets.length) return res.json(serializeUser(user));

  sets.push(`updated_at = datetime('now')`);
  try {
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ errors: ['A user with that email already exists'] });
    }
    throw err;
  }
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json(serializeUser(updated));
});

// Delete a user
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ errors: ['User not found'] });
  res.status(204).end();
});

module.exports = router;
