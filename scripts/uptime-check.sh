#!/usr/bin/env bash
set -euo pipefail

WEB_URL="${WEB_URL:-http://127.0.0.1:3000}"
API_URL="${API_URL:-http://127.0.0.1:3001}"
WORKER_URL="${WORKER_URL:-http://127.0.0.1:3002}"

echo "Checking Web (${WEB_URL})..."
curl -fsS --max-time 5 "${WEB_URL}/" >/dev/null

echo "Checking API readiness (${API_URL}/api/health/ready)..."
curl -fsS --max-time 5 "${API_URL}/api/health/ready" | grep -q '"status":"ok"'

echo "Checking Worker (${WORKER_URL}/healthz)..."
curl -fsS --max-time 5 "${WORKER_URL}/healthz" >/dev/null

echo "All Ledgerwise services are healthy."
