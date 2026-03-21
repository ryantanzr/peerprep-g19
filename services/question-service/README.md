# PeerPrep — Question Service

A FastAPI microservice for managing interview practice questions, backed by MongoDB Atlas. All reads and writes go directly to MongoDB; requests are validated and executed synchronously.

---

## Architecture

```
Client
  │
  ▼ HTTP
┌─────────────────┐
│   api container │
│   (FastAPI)     │
└────────┬────────┘
         │ reads / writes
┌────────▼────────┐
│  MongoDB Atlas  │
│   (external)   │
└─────────────────┘
```

- **`api`** — validates requests and performs MongoDB reads/writes directly, returning results synchronously.
- Writes on `/create` and `/update` use **optimistic locking** via a `version` field to prevent concurrent write conflicts.

---

## Local Setup

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Compose v2)
- A [MongoDB Atlas](https://www.mongodb.com/atlas) cluster with a database user and network access allowed from your IP (or `0.0.0.0/0` for local testing)

### 1. Clone and configure environment

Create a `.env` file in the project root (same directory as `compose.yaml`):

```bash
# .env
MONGO_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
```

**Never commit `.env` to version control.** Add it to `.gitignore`:

```bash
echo ".env" >> .gitignore
```

### 2. Build and start the service

```bash
docker compose up --build
```

| Container | Exposed port | Purpose  |
|-----------|-------------|----------|
| `api`     | 8000        | REST API |

### 3. Verify everything is running

```bash
docker compose ps
```

The `api` service should show `running (healthy)`.

---

## API Reference

All write endpoints require a Bearer token (mocked in local dev — any non-empty string works).

### Health check

```bash
curl http://localhost:8000/health
# {"status": "ok"}
```

### Create a question (`POST /create`)

```bash
curl -X POST http://localhost:8000/create \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Two Sum",
    "description": "Given an array of integers, return indices of the two numbers that add up to a target.",
    "topics": ["Arrays", "HashMaps"],
    "difficulty": "Easy",
    "hints": ["Try using a hash map for O(n) time."],
    "model_answer_code": "def twoSum(nums, target): ...",
    "model_answer_lang": "py"
  }'

# {"status": "created", "title": "Two Sum", "id": "<ObjectId>", "version": 1}
```

Returns `409 Conflict` if a question with the same title already exists.

### Update a question (`PUT /update/{id}`)

The `version` field is required and must match the document's current version (optimistic locking). On a conflict the response includes the current server-side version so you can re-fetch and retry.

```bash
curl -X PUT http://localhost:8000/update/<id> \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Two Sum",
    "description": "Updated description.",
    "topics": ["Arrays", "HashMaps"],
    "difficulty": "Easy",
    "hints": ["Try using a hash map for O(n) time."],
    "model_answer_code": "def twoSum(nums, target): ...",
    "model_answer_lang": "py",
    "version": 1
  }'

# {"status": "updated", "id": "<id>", "title": "Two Sum", "version": 2}
```

Returns `409 Conflict` if the version doesn't match or another question already holds the new title. Returns `404` if the ID doesn't exist.

### Delete a question (`DELETE /delete`)

```bash
curl -X DELETE http://localhost:8000/delete \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"title": "Two Sum"}'

# {"status": "deleted", "title": "Two Sum"}
```

### Fetch a random matching question (`GET /fetch`)

```bash
curl "http://localhost:8000/fetch?topics=Arrays,HashMaps&difficulty=Easy"
```

`topics` is a comma-separated list. Returns a single randomly selected question matching any of the provided topics and the given difficulty.

### List all questions (`GET /questions`)

```bash
curl "http://localhost:8000/questions?skip=0&limit=20"

# {"data": [...], "total": 42, "skip": 0, "limit": 20, "hasMore": true}
```

`limit` must be between 1 and 100. `skip` must be ≥ 0.

### Get a question by ID (`GET /questions/{id}`)

```bash
curl "http://localhost:8000/questions/<ObjectId>"
```

Returns `404` if not found, `400` if the ID format is invalid.

### Interactive API docs

Open [http://localhost:8000/docs](http://localhost:8000/docs) for the auto-generated Swagger UI.

---

## Running Tests

Install dependencies:

```bash
pip install -r requirements.txt pytest pytest-asyncio httpx anyio
```

Run the test suite:

```bash
pytest test_main.py -v
```

Useful flags:
- `-k "TestCreate"` — run only a specific test class
- `-x` — stop on first failure
- `--tb=short` — shorter tracebacks

---

## Environment Variables

| Variable    | Required | Default                       | Description                     |
|-------------|----------|-------------------------------|---------------------------------|
| `MONGO_URL` | Yes      | `mongodb://localhost:27017`   | MongoDB connection string        |

---

## Deploying to AWS (ECR + ECS)

### What changes

| Local (Compose)  | AWS equivalent                             |
|------------------|--------------------------------------------|
| `docker compose up` | ECS task definition / ECS service       |
| `.env` file      | AWS Secrets Manager or SSM Parameter Store |
| Docker bridge network | VPC with private subnets             |

### Step-by-step

#### 1. Push image to ECR

```bash
# Authenticate
aws ecr get-login-password --region <region> | \
  docker login --username AWS --password-stdin <account_id>.dkr.ecr.<region>.amazonaws.com

# Create a repository (once)
aws ecr create-repository --repository-name peerprep-question-service

# Build, tag, and push
docker build -t peerprep-question-service .
docker tag peerprep-question-service:latest \
  <account_id>.dkr.ecr.<region>.amazonaws.com/peerprep-question-service:latest
docker push \
  <account_id>.dkr.ecr.<region>.amazonaws.com/peerprep-question-service:latest
```

#### 2. Store secrets

```bash
aws secretsmanager create-secret \
  --name peerprep/MONGO_URL \
  --secret-string "mongodb+srv://..."
```

Reference this secret in your ECS task definition under `secrets` — ECS will inject it as an environment variable at runtime.

#### 3. Create an ECS task definition

| Service | Command override                                                  |
|---------|-------------------------------------------------------------------|
| `api`   | `python -m uvicorn main:app --host 0.0.0.0 --port 8000`         |

#### 4. Create an ECS service

Place the `api` service behind an Application Load Balancer. Scale desired count based on HTTP traffic via a CloudWatch alarm or target tracking policy.

#### 5. Networking

- Deploy the ECS service into a **VPC with private subnets**.
- Allow outbound access from the `api` security group to MongoDB Atlas on port `27017`.