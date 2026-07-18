const express = require('express');
const db = require('../db');
const { generatePlan } = require('../services/claudeService');
const { sendNightlyText } = require('../services/schedulerService');

const router = express.Router();

function serializeWorkout(row) {
  return {
    id: row.id,
    planId: row.plan_id,
    date: row.date,
    workoutType: row.workout_type,
    description: row.description,
    targetDistanceKm: row.target_distance_m != null ? +(row.target_distance_m / 1000).toFixed(1) : null,
    targetElevationM: row.target_elevation_m,
    targetDurationMin: row.target_duration_s != null ? Math.round(row.target_duration_s / 60) : null,
    status: row.status,
  };
}

// Generate (or regenerate) the current plan
router.post('/generate/:userId', async (req, res, next) => {
  try {
    const result = await generatePlan(Number(req.params.userId));
    res.status(201).json(result);
  } catch (err) {
    // Surface Anthropic/Strava failures as a clear, actionable message
    // (status + request_id) instead of a generic 500.
    if (err.status && err.status !== 500) {
      console.error('Plan generation failed:', err.status, err.message, err.request_id || '');
      return res.status(err.status).json({ errors: [`Plan generation failed: ${err.message}`] });
    }
    next(err);
  }
});

// Current plan metadata
router.get('/current/:userId', (req, res) => {
  const plan = db
    .prepare('SELECT * FROM training_plans WHERE user_id = ? AND is_current = 1')
    .get(req.params.userId);
  if (!plan) return res.status(404).json({ errors: ['No plan generated yet'] });
  res.json({ id: plan.id, generatedAt: plan.generated_at, model: plan.model, summary: plan.summary });
});

// Workouts in a date range (for the calendar)
router.get('/workouts/:userId', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ errors: ['from and to query params are required (YYYY-MM-DD)'] });
  const rows = db
    .prepare(`SELECT * FROM planned_workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date`)
    .all(req.params.userId, from, to);
  res.json(rows.map(serializeWorkout));
});

// Adjust a workout (status and/or details). Manual edits are recorded as
// constraints so future Claude regenerations respect them.
router.patch('/workouts/:id', (req, res) => {
  const workout = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(req.params.id);
  if (!workout) return res.status(404).json({ errors: ['Workout not found'] });

  const { status, description, targetDistanceKm, targetElevationM, targetDurationMin, date } = req.body;
  if (status && !['planned', 'completed', 'skipped', 'modified'].includes(status)) {
    return res.status(400).json({ errors: ['Invalid status'] });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ errors: ['date must be YYYY-MM-DD'] });
  }

  const detailsChanged =
    description !== undefined || targetDistanceKm !== undefined || targetElevationM !== undefined ||
    targetDurationMin !== undefined || date !== undefined;

  db.prepare(
    `UPDATE planned_workouts SET
       status = COALESCE(?, status),
       description = COALESCE(?, description),
       target_distance_m = COALESCE(?, target_distance_m),
       target_elevation_m = COALESCE(?, target_elevation_m),
       target_duration_s = COALESCE(?, target_duration_s),
       date = COALESCE(?, date)
     WHERE id = ?`
  ).run(
    detailsChanged && !status ? 'modified' : status ?? null,
    description ?? null,
    targetDistanceKm != null ? targetDistanceKm * 1000 : null,
    targetElevationM ?? null,
    targetDurationMin != null ? targetDurationMin * 60 : null,
    date ?? null,
    req.params.id
  );

  if (detailsChanged) {
    db.prepare(
      `INSERT INTO constraints (user_id, kind, description, start_date, end_date, source)
       VALUES (?, 'manual_edit', ?, ?, ?, 'web')`
    ).run(
      workout.user_id,
      `Athlete manually adjusted the ${workout.date} workout${date ? ` (moved to ${date})` : ''}: ${description || 'changed targets'}`,
      date || workout.date,
      date || workout.date
    );
  }

  const updated = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(req.params.id);
  res.json(serializeWorkout(updated));
});

// Adherence stats for the UI (trailing window, default 28 days)
router.get('/compliance/:userId', (req, res) => {
  const { computeCompliance } = require('../services/complianceService');
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 28));
  res.json(computeCompliance(Number(req.params.userId), days));
});

// Trigger tonight's text now (dev/testing convenience)
router.post('/send-nightly/:userId', async (req, res, next) => {
  try {
    const result = await sendNightlyText(Number(req.params.userId));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
