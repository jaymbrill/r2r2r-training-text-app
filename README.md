# R2R2R Training Text App

React frontend (Vite) with a Node.js/Express backend.

## Structure

```
client/   React app (Vite)
server/   Express API server
```

## Getting started

```bash
npm run install:all   # install root, server, and client dependencies
npm run dev           # run server (port 3001) and client (port 5173) together
```

Open http://localhost:5173 in your browser. API requests to `/api/*` are proxied to the Express server.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run client and server in development mode |
| `npm run build` | Build the client for production |
| `npm start` | Run the production server (serves built client) |
