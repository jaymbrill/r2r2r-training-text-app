const express = require('express');
const usersRouter = require('./users');
const stravaRouter = require('./strava');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.use('/users', usersRouter);
router.use('/strava', stravaRouter);
router.use('/plans', require('./plans'));
router.use('/sms', require('./sms'));
router.use('/chat', require('./chat'));

module.exports = router;
