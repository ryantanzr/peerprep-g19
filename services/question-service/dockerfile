# -----------------------------------------------------------------------------
# Build stage — install dependencies in isolation
# -----------------------------------------------------------------------------
FROM python:3.13-slim AS builder

WORKDIR /build

# Install build tools needed for C-extensions (e.g. pymongo, wheels)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# -----------------------------------------------------------------------------
# Runtime stage — lean final image, no build toolchain
# -----------------------------------------------------------------------------
FROM python:3.13-slim AS runtime

# If you later want to trial the free-threaded build, swap the FROM lines above
# to use python:3.13t-slim and set ENV PYTHON_GIL=0 here.

# Create a non-root user so the process doesn't run as root inside the container
RUN groupadd --system appgroup && useradd --system --gid appgroup appuser

WORKDIR /app

# Pull only the installed packages from the builder stage
COPY --from=builder /install /usr/local

# Copy application source
COPY main.py ./

# Ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

# Document the port (informational; actual binding is set in compose)
EXPOSE 8000

# Default command — overridden per-service in compose
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]