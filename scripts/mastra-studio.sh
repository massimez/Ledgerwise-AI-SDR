#!/usr/bin/env bash
set -euo pipefail

# Launch Mastra Studio + dev server on port 4111 (avoiding .env PORT=3001 used by apps/api).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}/packages/ai-core"

export PORT="${MASTRA_STUDIO_PORT:-4111}"
exec bun --env-file="${ROOT_DIR}/.env" x mastra dev "$@"
