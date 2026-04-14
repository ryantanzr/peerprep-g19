# AI Service

AI-assisted code explanation service for PeerPrep.

## What It Does

- Authenticates users via Firebase token
- Applies per-user rate limiting
- Fetches question context from question-service
- Sends peer code + question context to Google Gemini
- Returns a structured, human-readable explanation

## Run Locally

```sh
npm install
npm run dev
```

Default port: `5000`

Health check:

```sh
GET /health
```

## Environment Variables

- `PORT` (optional, default: `5000`)
- `QUESTION_SERVICE_URL` (optional, default: `http://localhost:8000`)
- `QUESTION_FETCH_TIMEOUT_MS` (optional, default: `5000`)
- `MAX_CODE_CHARS` (optional, default: `20000`)
- `GOOGLE_GEMINI_API_KEY` (required)
- `GOOGLE_GEMINI_MODEL` (optional, default: `gemini-2.5-flash`)
- `GOOGLE_GEMINI_TEMPERATURE` (optional, default: `0.2`)
- `GOOGLE_GEMINI_MAX_TOKENS` (optional, default: `700`)
- `FIREBASE_SERVICE_ACCOUNT_PATH` (optional if JSON var provided)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (optional if path provided)

### Firebase Service Account Setup

If your key currently exists in `services/user-service/config/service_key.json`, copy it into `services/ai-service/config/service_key.json`.

Then keep this value in your `.env`:

```dotenv
FIREBASE_SERVICE_ACCOUNT_PATH=./config/service_key.json
```

## API

### Explain Peer Code

```text
POST /api/ai/explain
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

Request body:

```json
{
  "questionTitle": "Two Sum",
  "code": "function twoSum(nums, target) { ... }",
  "language": "javascript",
  "focus": "time complexity"
}
```

Notes:

- `questionTitle` is recommended.
- `questionId` or `questionid` are accepted as aliases and treated as question title.

Response shape:

```json
{
  "questionTitle": "Two Sum",
  "explanation": {
    "summary": "...",
    "stepByStep": ["..."],
    "keyConcepts": ["..."],
    "potentialIssues": ["..."],
    "confidence": "medium"
  }
}
```
