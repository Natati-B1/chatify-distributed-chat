# chatify-distributed-chat

Chatify is a real-time chat application built with distributed system architecture, supporting multi-node communication, fault tolerance, scalability, and persistent message storage.

## Requirements

- **Node.js**: >= 18
- **MongoDB**: running locally **or** via Docker
- **Redis**: recommended (required for multi-node / horizontal scaling)

## Quick start (local dev)

1) Install dependencies:

```bash
npm install
```

1) Create your env file:

```bash
copy .env.example .env
```

1) Start MongoDB + Redis (easy option: Docker):

```bash
docker compose up -d mongo redis
```

1) Run the server:

```bash
npm run dev
```

Open:

- `http://localhost:3000`

## Run the full stack with Docker (3 server nodes + nginx)

This runs:

- `mongo` (MongoDB)
- `redis` (Redis)
- `chat-server-1/2/3` (3 replicas of the Node server)
- `nginx` as a reverse proxy / load balancer

Start:

```bash
npm run docker:up
```

Open:

- **Nginx (load-balanced)**: `http://localhost:8080`
- **Direct nodes**: `http://localhost:5001` / `http://localhost:5002` / `http://localhost:5003`

Stop:

```bash
npm run docker:down
```

Logs:

```bash
npm run docker:logs
```

## Environment variables

Copy `.env.example` to `.env` and adjust as needed:

- **`PORT`**: server port (default `3000`)
- **`HOST`**: bind host (default `0.0.0.0`)
- **`NODE_ENV`**: `development` / `production`
- **`SESSION_SECRET`**: session signing secret (**change in production**)
- **`MONGODB_URI`**: Mongo connection string (default `mongodb://127.0.0.1:27017/chatify`)
- **`REDIS_URL`**: Redis connection string (example `redis://127.0.0.1:6379`)
- **`PUBLIC_ORIGIN`**: comma-separated allowed origins for CORS + Socket.io (leave empty to allow all)
- **`COOKIE_SECURE`**: `true` only when serving over **HTTPS** (otherwise auth may loop on HTTP)

## API (server)

Base URL: same origin as the server (served from `/`).

- `GET /api/health` → `{ ok: true }`
- `POST /api/register` body: `{ email, password, displayName }`
- `POST /api/login` body: `{ email, password }`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/contacts`
- `GET /api/messages/:peerId` (last ~200 messages, oldest→newest)

Auth is cookie/session based (see `chatify.sid` cookie).

## Socket.io events

Client must be authenticated (session cookie present).

- **Client → Server**
  - `message:send` payload: `{ toUserId, body }`
- **Server → Client**
  - `message:new` payload: `{ id, body, fromUserId, toUserId, fromName, createdAt, readAt }`
  - `presence:update` payload: `{ userId, online }`

## Troubleshooting

- **Mongo connection errors**
  - Ensure MongoDB is running, or start it via: `docker compose up -d mongo`
- **Multi-node / Nginx works but messages/presence don’t sync**
  - Make sure **`REDIS_URL`** is set and Redis is running (required for Socket.io Redis adapter + presence counters).
- **Login/auth loops on HTTP**
  - Set `COOKIE_SECURE=false` for local HTTP. Use `COOKIE_SECURE=true` only behind HTTPS.
