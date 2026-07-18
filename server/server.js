const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);

// JSON error handler (honors err.status set by services)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ errors: [err.message || 'Internal server error'] });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.DISABLE_SCHEDULER !== 'true') {
    require('./services/schedulerService').start();
  }
  // Subscribe to Strava push events for instant activity detection
  if (process.env.STRAVA_CLIENT_ID) {
    require('./services/stravaService')
      .ensureWebhookSubscription()
      .catch((err) => console.error('[strava] webhook subscription failed:', err.message));
  }
});
