# PeerPrep — Question Service

A FastAPI microservice for managing interview practice questions, backed by MongoDB Atlas and RabbitMQ. Writes are decoupled via a companion worker that consumes from a message queue; reads hit MongoDB directly.

---

## Architecture

```
Client
  │
  ▼ HTTP
┌─────────────────┐        ┌──────────────────────┐
│   api container │──────▶ │  rabbitmq container  │
│   (FastAPI)     │        │  question_tasks queue │
└─────────────────┘        └──────────┬───────────┘
                                       │ consumes
                           ┌───────────▼───────────┐
                           │   worker container    │
                           └───────────┬───────────┘
                                       │ reads / writes
                           ┌───────────▼───────────┐
                           │    MongoDB Atlas       │
                           │    (external)         │
                           └───────────────────────┘
```

- **`api`** — validates requests, publishes to RabbitMQ, returns `202 Accepted` immediately. Reads (`GET /fetch`) bypass the queue and go direct to MongoDB.
- **`worker`** — long-running consumer loop; performs the actual MongoDB writes with optimistic concurrency (version-guarded upserts).
- **`rabbitmq`** — managed locally via Docker; replaced by Amazon MQ in production.

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

> `RABBITMQ_URL` is intentionally omitted — it defaults to the local broker
> spun up by Compose (`amqp://guest:guest@rabbitmq/`).

**Never commit `.env` to version control.** Add it to `.gitignore`:

```bash
echo ".env" >> .gitignore
```

### 2. Build and start all services

```bash
docker compose up --build
```

This starts three containers in dependency order:

| Container  | Exposed port | Purpose                        |
|------------|-------------|--------------------------------|
| `rabbitmq` | 5672, 15672 | Message broker                 |
| `api`      | 8000        | REST API                       |
| `worker`   | —           | Queue consumer (no public port)|

The `api` and `worker` containers will wait for RabbitMQ's healthcheck to pass before starting.

### 3. Verify everything is running

```bash
docker compose ps
```

All three services should show `running (healthy)` or `running`.

---

## Testing

### Interactive API docs

Open [http://localhost:8000/docs](http://localhost:8000/docs) in your browser for the auto-generated Swagger UI.

### Health check

```bash
curl http://localhost:8000/health
# {"status": "ok"}
```

### Create / update a question (`POST /upsert`)

The endpoint requires a Bearer token (mocked in local dev — any non-empty string works):

```bash
curl -X POST http://localhost:8000/upsert \
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

# Expected: {"status": "Request queued", "initiated_by": "admin@cloud-idp.com"}
```

The response is immediate (`202`). The worker processes the write asynchronously — check worker logs to confirm:

```bash
docker compose logs worker --follow
```

### Fetch a question (`GET /fetch`)

```bash
curl "http://localhost:8000/fetch?topic=Arrays&difficulty=Easy"
```

### Monitor the RabbitMQ queue

Open [http://localhost:15672](http://localhost:15672) (login: `guest` / `guest`).
Navigate to **Queues** → `question_tasks` to see message rates and depth in real time.

### Scale workers horizontally

```bash
docker compose up --scale worker=3
```

Three worker containers will compete to consume from the same queue — useful for testing concurrent write load.

### Tear down

```bash
docker compose down          # stops containers, keeps RabbitMQ volume
docker compose down -v       # also deletes the RabbitMQ data volume
```

---

## Environment Variables

| Variable                  | Required | Default                              | Description                          |
|---------------------------|----------|--------------------------------------|--------------------------------------|
| `MONGO_URL`               | Yes      | —                                    | MongoDB Atlas connection string      |
| `RABBITMQ_URL`            | No       | `amqp://guest:guest@rabbitmq/`       | RabbitMQ connection string           |
| `WORKER_PREFETCH`         | No       | `10`                                 | Messages prefetched per worker       |
| `RECONNECT_DELAY_SECONDS` | No       | `5`                                  | Worker RabbitMQ reconnect delay (s)  |

---

## Deploying to AWS (ECR + ECS)

When moving to AWS, the local Compose setup is replaced by managed AWS services. The application code and Dockerfile require **no changes**.

### What changes

| Local (Compose)              | AWS equivalent                              |
|------------------------------|---------------------------------------------|
| `rabbitmq` container         | Amazon MQ (RabbitMQ broker)                 |
| `docker compose up`          | ECS task definitions / ECS service          |
| `.env` file                  | AWS Secrets Manager or SSM Parameter Store  |
| Docker bridge network        | VPC with private subnets                    |
| `--scale worker=3`           | ECS service desired count                   |

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

Store both connection strings in AWS Secrets Manager (not as plaintext environment variables):

```bash
aws secretsmanager create-secret \
  --name peerprep/MONGO_URL \
  --secret-string "mongodb+srv://..."

aws secretsmanager create-secret \
  --name peerprep/RABBITMQ_URL \
  --secret-string "amqps://user:pass@<amazon-mq-endpoint>:5671/"
```

Reference these secrets in your ECS task definitions under `secrets` — ECS will inject them as environment variables at runtime.

#### 3. Create two ECS task definitions

Use the **same ECR image** for both, but with different `command` overrides (mirroring the Compose setup):

| Service | Command override                                                                 |
|---------|---------------------------------------------------------------------------------|
| `api`   | `python -m uvicorn main:app --host 0.0.0.0 --port 8000`                        |
| `worker`| `python worker.py`                                                              |

#### 4. Create two ECS services

- **api service**: place behind an Application Load Balancer; desired count scales with HTTP traffic.
- **worker service**: no load balancer needed; scale desired count based on queue depth (set up a CloudWatch alarm on Amazon MQ queue depth to trigger auto-scaling).

#### 5. Networking

- Deploy both ECS services and the Amazon MQ broker into the **same VPC and private subnets**.
- The `api` service's security group needs outbound access to Amazon MQ on port `5671`.
- The `worker` service's security group needs the same.
- Neither service should have the RabbitMQ management port (15672) open in production.

#### 6. Remove the `rabbitmq` service from compose.yaml (production builds)

For production deployments you can remove or comment out the `rabbitmq` service block entirely — it is only needed for local development. The `api` and `worker` services will connect to Amazon MQ via the `RABBITMQ_URL` secret instead.