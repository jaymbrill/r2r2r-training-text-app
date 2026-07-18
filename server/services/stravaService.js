const db = require('../db');

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API = 'https://www.strava.com/api/v3';

function config() {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, APP_BASE_URL } = process.env;
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    const err = new Error('Strava is not configured: set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET');
    err.status = 503;
    throw err;
  }
  return {
    clientId: STRAVA_CLIENT_ID,
    clientSecret: STRAVA_CLIENT_SECRET,
    baseUrl: APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001',
  };
}

function authorizeUrl(userId) {
  const { clientId, baseUrl } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl}/api/strava/callback`,
    response_type: 'code',
    scope: 'read,activity:read_all',
    state: String(userId),
    approval_prompt: 'auto',
  });
  return `${STRAVA_AUTH_URL}?${params}`;
}

async function tokenRequest(body) {
  const { clientId, clientSecret } = config();
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Strava token request failed (${res.status}): ${text}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

async function exchangeCode(userId, code) {
  const token = await tokenRequest({ code, grant_type: 'authorization_code' });
  db.prepare(
    `INSERT INTO strava_accounts (user_id, athlete_id, access_token, refresh_token, token_expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       athlete_id = excluded.athlete_id,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       token_expires_at = excluded.token_expires_at`
  ).run(
    userId,
    String(token.athlete?.id ?? ''),
    token.access_token,
    token.refresh_token,
    new Date(token.expires_at * 1000).toISOString()
  );
}

async function getFreshAccessToken(userId) {
  const account = db.prepare('SELECT * FROM strava_accounts WHERE user_id = ?').get(userId);
  if (!account) {
    const err = new Error('User has not connected Strava');
    err.status = 404;
    throw err;
  }
  // Refresh if the token expires within 5 minutes
  if (new Date(account.token_expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
    return account.access_token;
  }
  const token = await tokenRequest({ refresh_token: account.refresh_token, grant_type: 'refresh_token' });
  db.prepare(
    `UPDATE strava_accounts SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE user_id = ?`
  ).run(token.access_token, token.refresh_token, new Date(token.expires_at * 1000).toISOString(), userId);
  return token.access_token;
}

async function syncActivities(userId, { daysBack = 60 } = {}) {
  const accessToken = await getFreshAccessToken(userId);
  const after = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000);

  const upsert = db.prepare(
    `INSERT INTO activities (user_id, strava_activity_id, type, start_date, distance_m, elevation_gain_m, moving_time_s, average_heartrate, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(strava_activity_id) DO UPDATE SET
       type = excluded.type,
       start_date = excluded.start_date,
       distance_m = excluded.distance_m,
       elevation_gain_m = excluded.elevation_gain_m,
       moving_time_s = excluded.moving_time_s,
       average_heartrate = excluded.average_heartrate,
       raw_json = excluded.raw_json`
  );

  let page = 1;
  let synced = 0;
  while (page <= 10) {
    const params = new URLSearchParams({ after: String(after), per_page: '100', page: String(page) });
    const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = new Error(`Strava activities fetch failed (${res.status})`);
      err.status = 502;
      throw err;
    }
    const activities = await res.json();
    if (!activities.length) break;
    for (const a of activities) {
      upsert.run(
        userId,
        String(a.id),
        a.type || 'Unknown',
        a.start_date,
        a.distance || 0,
        a.total_elevation_gain || 0,
        a.moving_time || 0,
        a.average_heartrate ?? null,
        JSON.stringify({ name: a.name, sport_type: a.sport_type })
      );
      synced += 1;
    }
    page += 1;
  }

  db.prepare(`UPDATE strava_accounts SET last_sync_at = datetime('now') WHERE user_id = ?`).run(userId);
  return { synced };
}

function sumWindow(userId, days, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(distance_m), 0) AS distance_m,
              COALESCE(SUM(elevation_gain_m), 0) AS elevation_m,
              COALESCE(SUM(moving_time_s), 0) AS moving_time_s
       FROM activities WHERE user_id = ? AND start_date >= ?`
    )
    .get(userId, since);
}

/**
 * Training load summary for plan generation.
 * - acute: last 7 days; chronic: last 28 days (weekly average)
 * - ramp (ACWR): acute load / chronic weekly average, by moving time.
 *   ~0.8–1.3 is generally sustainable; >1.5 signals ramping too fast.
 */
function computeTrainingLoad(userId, now = new Date()) {
  const acute = sumWindow(userId, 7, now);
  const chronic = sumWindow(userId, 28, now);
  const chronicWeeklyTime = chronic.moving_time_s / 4;
  const ramp = chronicWeeklyTime > 0 ? acute.moving_time_s / chronicWeeklyTime : null;

  const longest = db
    .prepare(
      `SELECT MAX(moving_time_s) AS moving_time_s, MAX(distance_m) AS distance_m, MAX(elevation_gain_m) AS elevation_m
       FROM activities WHERE user_id = ? AND start_date >= ?`
    )
    .get(userId, new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString());

  return {
    acute7d: {
      activities: acute.count,
      distanceKm: +(acute.distance_m / 1000).toFixed(1),
      elevationM: Math.round(acute.elevation_m),
      hours: +(acute.moving_time_s / 3600).toFixed(1),
    },
    chronic28d: {
      activities: chronic.count,
      distanceKm: +(chronic.distance_m / 1000).toFixed(1),
      elevationM: Math.round(chronic.elevation_m),
      hours: +(chronic.moving_time_s / 3600).toFixed(1),
      weeklyAvgHours: +(chronicWeeklyTime / 3600).toFixed(1),
    },
    rampRatio: ramp === null ? null : +ramp.toFixed(2),
    biggest28d: {
      longestHours: +((longest.moving_time_s || 0) / 3600).toFixed(1),
      longestKm: +((longest.distance_m || 0) / 1000).toFixed(1),
      mostElevationM: Math.round(longest.elevation_m || 0),
    },
  };
}

/** Fetch one activity by id and upsert it (used by webhook events). */
async function fetchAndStoreActivity(userId, activityId) {
  const accessToken = await getFreshAccessToken(userId);
  const res = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = new Error(`Strava activity fetch failed (${res.status})`);
    err.status = 502;
    throw err;
  }
  const a = await res.json();
  db.prepare(
    `INSERT INTO activities (user_id, strava_activity_id, type, start_date, distance_m, elevation_gain_m, moving_time_s, average_heartrate, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(strava_activity_id) DO UPDATE SET
       type = excluded.type,
       start_date = excluded.start_date,
       distance_m = excluded.distance_m,
       elevation_gain_m = excluded.elevation_gain_m,
       moving_time_s = excluded.moving_time_s,
       average_heartrate = excluded.average_heartrate,
       raw_json = excluded.raw_json`
  ).run(
    userId,
    String(a.id),
    a.type || 'Unknown',
    a.start_date,
    a.distance || 0,
    a.total_elevation_gain || 0,
    a.moving_time || 0,
    a.average_heartrate ?? null,
    JSON.stringify({ name: a.name, sport_type: a.sport_type })
  );
}

function findUserIdByAthleteId(athleteId) {
  const row = db
    .prepare('SELECT user_id FROM strava_accounts WHERE athlete_id = ?')
    .get(String(athleteId));
  return row ? row.user_id : null;
}

/**
 * Create the Strava push subscription for instant activity events, if one
 * doesn't already exist for our callback URL. Requires a public HTTPS URL
 * (i.e. on Render) — silently skipped in local dev.
 */
async function ensureWebhookSubscription() {
  const { clientId, clientSecret, baseUrl } = config();
  if (!baseUrl.startsWith('https://')) {
    console.log('[strava] webhook subscription skipped (no public https URL)');
    return;
  }
  const callbackUrl = `${baseUrl}/api/strava/webhook`;
  const verifyToken = process.env.STRAVA_VERIFY_TOKEN || 'r2r2r-verify';

  const listRes = await fetch(
    `${STRAVA_API}/push_subscriptions?client_id=${clientId}&client_secret=${clientSecret}`
  );
  if (!listRes.ok) throw new Error(`Strava subscription list failed (${listRes.status})`);
  const existing = await listRes.json();
  if (existing.some((s) => s.callback_url === callbackUrl)) {
    console.log('[strava] webhook subscription already active');
    return;
  }

  const createRes = await fetch(`${STRAVA_API}/push_subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      callback_url: callbackUrl,
      verify_token: verifyToken,
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Strava subscription create failed (${createRes.status}): ${text}`);
  }
  console.log('[strava] webhook subscription created for', callbackUrl);
}

function connectionStatus(userId) {
  const account = db
    .prepare('SELECT athlete_id, last_sync_at FROM strava_accounts WHERE user_id = ?')
    .get(userId);
  if (!account) return { connected: false };
  const activityCount = db
    .prepare('SELECT COUNT(*) AS n FROM activities WHERE user_id = ?')
    .get(userId).n;
  return {
    connected: true,
    athleteId: account.athlete_id,
    lastSyncAt: account.last_sync_at,
    activityCount,
  };
}

function disconnect(userId) {
  db.prepare('DELETE FROM strava_accounts WHERE user_id = ?').run(userId);
}

module.exports = {
  authorizeUrl,
  exchangeCode,
  syncActivities,
  computeTrainingLoad,
  connectionStatus,
  disconnect,
  fetchAndStoreActivity,
  findUserIdByAthleteId,
  ensureWebhookSubscription,
};
