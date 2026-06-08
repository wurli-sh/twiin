#!/usr/bin/env bash
set -euo pipefail

HOST="127.0.0.1"
PORT="3015"
BASE="http://${HOST}:${PORT}"

echo "==> GET /health"
curl -sS "${BASE}/health" | (command -v jq >/dev/null && jq . || cat)

PAYLOAD=$(printf '%s' 'Format an executive brief. Prior: onchain-lens found 12 avg txs/block.' | xxd -p | tr -d '\n')
REQ_ID="0x$(printf 'ab%.0s' {1..32})"

echo "==> POST /execute"
curl -sS -X POST "${BASE}/execute" \
  -H 'content-type: application/json' \
  -d "{\"taskId\":\"99\",\"stepIdx\":5,\"payload\":\"${PAYLOAD}\",\"reqId\":\"${REQ_ID}\"}" \
  | (command -v jq >/dev/null && jq . || cat)
