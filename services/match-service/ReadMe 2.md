# PeerPrep — Matching Service

Real-time peer matching for technical interview practice.
Built with Node.js, TypeScript, Express, Redis, and Server-Sent Events.

---

## Architecture
```
┌─────────────┐        SSE         ┌───────────────┐
│   Client    │ ◄────────────────► │ Queue Service │
│  (browser)  │                    │  (port 3001)  │
└─────────────┘                    └───────┬───────┘
                                           │ pub/sub + sorted sets
                                    ┌──────▼──────┐
                                    │    Redis    │
                                    └──────┬──────┘
                                           │ pub/sub + sorted sets
                                    ┌──────▼──────┐
                                    │Match Worker │
                                    │ (no HTTP)   │
                                    └─────────────┘
```

**Queue Service** — HTTP + SSE server. Handles all client connections,
queue joins/leaves, and streams real-time updates over SSE.

**Match Worker** — Background process. Polls Redis queues every 1.5s,
atomically pairs users, publishes match events.

**Redis** — Shared state. Stores queues as sorted sets (score = join
timestamp for FCFS ordering). Pub/Sub carries queue-change and match
events between services.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js v20+](https://nodejs.org/) — only needed for local dev without Docker

---

## Quickstart (Docker)
```bash
# 1. Clone and enter the repo
git clone <your-repo-url>
cd matching-service

# 2. Build and start all three services
docker compose up --build

# 3. Verify everything is running
curl http://localhost:3001/health
# → {"status":"ok"}
```

To stop everything:
```bash
docker compose down
```

To stop and wipe Redis data:
```bash
docker compose down -v
```

---

## Local Development (without Docker)

Run each piece in a separate terminal.

**Terminal 1 — Redis:**
```bash
docker run -p 6379:6379 redis:7-alpine
```

**Terminal 2 — Queue service:**
```bash
cd queue-service
npm install
npm run dev
# → Queue service running on port 3001
```

**Terminal 3 — Match worker:**
```bash
cd match-worker
npm install
npm run dev
# → Match worker started
```

---

## Project Structure
```
matching-service/
├── shared/
│   └── types.ts              # Shared TypeScript types
│
├── queue-service/
│   ├── src/
│   │   ├── config/index.ts
│   │   ├── middleware/auth.ts
│   │   ├── routes/queue.ts
│   │   ├── services/
│   │   │   ├── redis.ts
│   │   │   ├── sse.ts
│   │   │   └── broadcaster.ts
│   │   ├── types/index.ts
│   │   ├── app.ts
│   │   └── server.ts
│   ├── Dockerfile
│   └── package.json
│
├── match-worker/
│   ├── src/
│   │   ├── config/index.ts
│   │   ├── services/
│   │   │   ├── redis.ts
│   │   │   └── matcher.ts
│   │   ├── types/index.ts
│   │   └── worker.ts
│   ├── Dockerfile
│   └── package.json
│
└── docker-compose.yml
```

---

## Environment Variables

### Queue Service

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `MATCHING_TIMEOUT_MS` | `60000` | Max queue wait time (ms) |

### Match Worker

| Variable | Default | Description |
|---|---|---|
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `POLL_INTERVAL_MS` | `1500` | How often to scan queues (ms) |

---

## API Reference

### Authentication

All endpoints require a `Bearer` token in the `Authorization` header.
```
Authorization: Bearer user@example.com
```

> **Note:** Authentication is currently stubbed. The Bearer token value
> is used directly as the user's identifier. Firebase Auth will be
> integrated in a future update.

---

### `GET /health`

Health check. No auth required.

**Response:**
```json
{ "status": "ok" }
```

---

### `GET /queue/join`

Joins the matching queue and opens a persistent SSE stream. All queue
updates arrive over this connection — no separate polling needed.

If the user is already present in a Redis queue (e.g. they refreshed the
tab), the session is resumed automatically without re-queuing.

The connection doubles as the queue membership — closing the tab or
dropping the network connection automatically removes the user from
the queue.

**Query params:**

| Param | Required | Values | Description |
|---|---|---|---|
| `topic` | Yes* | any string | Topic to match on e.g. `arrays` |
| `difficulty` | Yes* | `easy` `medium` `hard` | Difficulty level |

*Not required if resuming an existing session.

**Headers:**
```
Authorization: Bearer user@example.com
```

**Example request:**
```bash
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=medium" \
  -H "Authorization: Bearer user@example.com"
```

**SSE stream — event types:**

The response is a stream of `data:` events. Each event is a JSON object
with a `type` field.

---

#### `QUEUE_UPDATE`

Sent immediately on connect, then again whenever the queue changes
(someone joins, leaves, or is matched).
```json
{
  "type": "QUEUE_UPDATE",
  "position": 2,
  "top5": ["first@example.com", "user@example.com"],
  "queueLength": 2
}
```

| Field | Type | Description |
|---|---|---|
| `position` | `number` | Your 1-based position in the queue |
| `top5` | `string[]` | Up to 5 users at the front of the queue |
| `queueLength` | `number` | Total users currently in the queue |

---

#### `MATCH_FOUND`

Sent when the match worker pairs this user with another.
```json
{
  "type": "MATCH_FOUND",
  "peer": "other-user@example.com"
}
```

| Field | Type | Description |
|---|---|---|
| `peer` | `string` | Email of the matched peer |

After this event the SSE connection is closed server-side and both users
are removed from the queue.

---

#### `TIMEOUT`

Sent when the user has waited longer than `MATCHING_TIMEOUT_MS` without
being matched.
```json
{
  "type": "TIMEOUT"
}
```

After this event the SSE connection is closed and the user is removed
from the queue. The user can re-enter the queue by opening a new
connection to `/queue/join`.

---

### `POST /queue/leave`

Explicitly leaves the queue. Useful for a "Cancel" button. Triggers the
same cleanup as closing the tab.

**Headers:**
```
Authorization: Bearer user@example.com
Content-Type: application/json
```

**Response:**
```json
{ "message": "Left queue" }
```

---

## Testing

### Manual testing with curl

Open separate terminal windows for each user.

**Step 1 — Check the service is up:**
```bash
curl http://localhost:3001/health
```

**Step 2 — User A joins and keeps the stream open:**
```bash
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=medium" \
  -H "Authorization: Bearer alice@example.com"
```

Expected output:
```
data: {"type":"QUEUE_UPDATE","position":1,"top5":["alice@example.com"],"queueLength":1}
```

**Step 3 — User B joins in a new terminal:**
```bash
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=medium" \
  -H "Authorization: Bearer bob@example.com"
```

Expected output for User B:
```
data: {"type":"QUEUE_UPDATE","position":2,"top5":["alice@example.com","bob@example.com"],"queueLength":2}
```

Expected update on User A's stream (queue changed when B joined):
```
data: {"type":"QUEUE_UPDATE","position":1,"top5":["alice@example.com","bob@example.com"],"queueLength":2}
```

**Step 4 — Wait ~1.5 seconds for the match worker:**

Both streams receive:
```
# Alice's stream
data: {"type":"MATCH_FOUND","peer":"bob@example.com"}

# Bob's stream
data: {"type":"MATCH_FOUND","peer":"alice@example.com"}
```

Both connections are then closed by the server.

---

### Testing tab close / disconnect cleanup
```bash
# Start User A in the background, then kill after 5 seconds
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=medium" \
  -H "Authorization: Bearer alice@example.com" &
CURL_PID=$!
sleep 5
kill $CURL_PID

# Verify Alice was removed from Redis
docker exec -it $(docker ps -q --filter name=redis) redis-cli \
  ZRANGE queue:arrays:medium 0 -1
# → (empty array)
```

---

### Testing explicit leave
```bash
# Terminal 1 — Alice joins
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=medium" \
  -H "Authorization: Bearer alice@example.com"

# Terminal 2 — Alice leaves explicitly
curl -X POST http://localhost:3001/queue/leave \
  -H "Authorization: Bearer alice@example.com"
```

---

### Testing topic/difficulty isolation

Users on different topics or difficulties should never be matched:
```bash
# Alice on arrays/medium
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=medium" \
  -H "Authorization: Bearer alice@example.com" &

# Bob on trees/medium — different topic, should NOT match with Alice
curl -N "http://localhost:3001/queue/join?topic=trees&difficulty=medium" \
  -H "Authorization: Bearer bob@example.com" &

# Carol on arrays/hard — different difficulty, should NOT match with Alice
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=hard" \
  -H "Authorization: Bearer carol@example.com" &

# Dave on arrays/medium — same as Alice, SHOULD match
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=medium" \
  -H "Authorization: Bearer dave@example.com"
```

Alice and Dave should match. Bob and Carol stay in their queues.

---

### Testing timeout

Set a short timeout to observe the behaviour:
```bash
# Restart queue-service with a 10 second timeout
MATCHING_TIMEOUT_MS=10000 npm run dev

# Join — after 10 seconds you should see the TIMEOUT event
curl -N "http://localhost:3001/queue/join?topic=arrays&difficulty=medium" \
  -H "Authorization: Bearer alice@example.com"
```

Expected after 10 seconds:
```
data: {"type":"TIMEOUT"}
```

---

### Inspecting Redis directly
```bash
# Open a Redis CLI session inside the container
docker exec -it $(docker ps -q --filter name=redis) redis-cli

# List all queue keys
KEYS queue:*

# See who is in a specific queue (with join timestamps as scores)
ZRANGE queue:arrays:medium 0 -1 WITHSCORES

# Check a user's metadata
HGETALL user:meta:alice@example.com

# Monitor all Redis commands in real time
MONITOR
```
```

---

Now your final folder should look like:
```
matching-service/
├── shared/types.ts
├── queue-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   └── ...
├── match-worker/
│   ├── Dockerfile
│   ├── .dockerignore
│   └── ...
├── docker-compose.yml
└── README.md