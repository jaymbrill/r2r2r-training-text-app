# R2R2R Training Text App — Product & Architecture Plan

An app that coaches users training for Rim to Rim to Rim (R2R2R) with an adaptive,
AI-generated training plan delivered and adjusted over SMS.

## Core Features

### 1. Nightly training-plan text (Twilio)
- Every evening at a user-configurable time (default 8:00 PM local), the app texts each
  user their recommended training plan for the next day.
- Delivered via Twilio Programmable Messaging.
- A scheduled job (cron) runs per user timezone, generates the plan, and sends the SMS.

### 2. Dynamic plan generation (Strava + Claude)
- The plan is not static: it is regenerated as a function of
  - **Current training load** — pulled from the Strava API (recent activities, distance,
    elevation gain, duration, heart rate if available) via OAuth per user.
  - **Claude-proposed plan** — the Anthropic API (model `claude-opus-4-8`) takes the
    user's profile (goal date, fitness baseline, constraints), recent Strava load, and
    recent user feedback, and produces the next-day recommendation plus a rolling
    multi-week outlook.
- Training-load metrics to compute: acute vs. chronic load (e.g., 7-day vs 28-day),
  ramp rate, elevation-specific volume (key for R2R2R), back-to-back long-effort days.

### 3. Agentic SMS chat (Twilio inbound + Claude)
- Users can reply to any text conversationally: "feeling wiped today", "traveling
  Thu–Fri", "knee is sore".
- Inbound messages hit a Twilio webhook; Claude interprets the message in the context
  of the user's plan and history (multi-turn conversation stored per user).
- Feedback updates structured constraints (fatigue, injuries, availability) that feed
  the next plan generation — so "my knee hurts" tonight changes tomorrow's plan.

### 4. Compliance feedback & encouragement
- After each planned workout day, the app compares the plan against actual Strava
  activity.
- Sends a short SMS with compliance feedback and encouragement (streaks, progress
  toward goal, positive reinforcement when adapting around injuries/fatigue).
- Weekly summary message: adherence %, load trend, days to goal.

### 5. Web UI — registration portal + calendar
- **Registration**: users sign up, enter profile (name, phone, goal date, experience,
  weekly availability), verify their phone (Twilio Verify), and connect Strava (OAuth).
- **Calendar view**: the Claude-proposed plan rendered in calendar format (month/week),
  showing planned workouts, completed activities, and compliance status.
- **Adjustments**: users can drag/edit/skip workouts in the calendar; manual edits are
  stored as constraints and respected by subsequent Claude regenerations.

## Architecture

```
client/  (React + Vite)
  Registration & onboarding flow (profile, phone verify, Strava connect)
  Calendar view of training plan (view + edit)

server/  (Node/Express)
  routes/
    auth.js       — signup/login, session management
    users.js      — profile CRUD
    strava.js     — OAuth connect + activity sync (webhook or polling)
    plans.js      — plan CRUD, calendar data, manual adjustments
    sms.js        — Twilio inbound webhook (agentic chat)
  services/
    stravaService.js   — token refresh, activity fetch, training-load calc
    claudeService.js   — plan generation + SMS conversation (Anthropic SDK)
    twilioService.js   — outbound SMS, phone verification
    schedulerService.js — nightly plan send, compliance checks (node-cron)
  db/ — persistence (start with SQLite for dev; Postgres for production)
```

### Data model (initial)

- **User** — id, name, phone (verified), email, timezone, goal date, experience level,
  weekly availability, send time preference
- **StravaAccount** — user id, athlete id, access/refresh tokens, last sync
- **Activity** — synced Strava activities (type, distance, elevation, duration, date)
- **TrainingPlan** — generated plan versions; **PlannedWorkout** — per-day entries
  (date, type, distance/vert/duration targets, status: planned/completed/skipped/modified)
- **Conversation / Message** — SMS chat history per user (for Claude context)
- **Constraint** — structured feedback (injury, fatigue, travel, manual edit) with
  effective date range

### Key integrations

| Integration | Purpose | Notes |
|---|---|---|
| Twilio | Outbound SMS, inbound webhook, phone verify | Programmable Messaging + Verify; A2P 10DLC registration required for US SMS |
| Strava | Activity data / training load | OAuth 2.0 per user; webhook subscription for near-real-time activity sync |
| Anthropic (Claude) | Plan generation + agentic chat | `claude-opus-4-8` via official SDK; tool use for reading load data and writing plan updates |

### Environment variables

```
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
DATABASE_URL=
APP_BASE_URL=          # for OAuth callbacks + Twilio webhooks
```

## Build Phases

1. **Phase 1 — Foundation**: data model + DB, user registration UI, profile CRUD.
2. **Phase 2 — Strava**: OAuth connect, activity sync, training-load calculation.
3. **Phase 3 — Plan engine**: Claude plan generation, calendar UI (view), nightly SMS
   send via Twilio + scheduler.
4. **Phase 4 — Agentic chat**: inbound SMS webhook, conversational feedback loop,
   constraints feeding regeneration.
5. **Phase 5 — Compliance & polish**: compliance scoring, encouragement messages,
   calendar editing, weekly summaries.

## Open questions

- Hosting target (a `render.yaml` pattern was used in a prior repo — Render is a
  reasonable default; needs a public URL for Twilio/Strava webhooks).
- Single-coach assumptions vs. multi-user scaling (start single-tenant simple).
- SMS cost controls (max messages/day per user).
