const express = require('express');
const usersRouter = require('./users');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.use('/users', usersRouter);

module.exports = router;
