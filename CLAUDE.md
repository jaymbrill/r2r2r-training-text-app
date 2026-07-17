# R2R2R Training Text App

An adaptive Rim-to-Rim-to-Rim training coach: nightly SMS training plans (Twilio),
dynamic plan generation from Strava training load + Claude, agentic SMS feedback chat,
and a web portal with registration and a calendar plan view. See `PLAN.md` for the
full feature and architecture plan.

React (Vite) frontend in `client/`, Express backend in `server/`.

## Commands

- `npm run install:all` — install all dependencies (root, server, client)
- `npm run dev` — run both server (port 3001) and client (port 5173)
- `npm run build` — production build of the client
- `npm start` — production server, serves `client/dist`

## Architecture

- `server/server.js` — Express entry point; mounts routes from `server/routes/api.js` under `/api`
- `client/src/App.jsx` — React root component
- Vite dev server proxies `/api/*` to `http://localhost:3001` (see `client/vite.config.js`)
- Environment variables go in `server/.env` (copy from `server/.env.example`)
