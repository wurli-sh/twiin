#!/usr/bin/env bash
set -euo pipefail

HOST="127.0.0.1"
PORT="3013"
BASE="http://${HOST}:${PORT}"

echo "==> GET /health"
curl -sS "${BASE}/health" | (command -v jq >/dev/null && jq . || cat)

PAYLOAD=$(printf '%s' '{"blockWindow":5}' | xxd -p | tr -d '\n')
REQ_ID="0x$(printf 'ab%.0s' {1..32})"

echo "==> POST /execute (blockWindow=5)"
curl -sS -X POST "${BASE}/execute" \
  -H 'content-type: application/json' \
  -d "{\"taskId\":\"99\",\"stepIdx\":0,\"payload\":\"${PAYLOAD}\",\"reqId\":\"${REQ_ID}\"}" \
  | (command -v jq >/dev/null && jq . || cat)

PAYLOAD2=$(printf '%s' '{"lookbackHours":24,"minTransferStt":1000}' | xxd -p | tr -d '\n')
REQ_ID2="0x$(printf 'cd%.0s' {1..32})"

echo "==> POST /execute (chain-activity template payload)"
curl -sS -X POST "${BASE}/execute" \
  -H 'content-type: application/json' \
  -d "{\"taskId\":\"100\",\"stepIdx\":0,\"payload\":\"${PAYLOAD2}\",\"reqId\":\"${REQ_ID2}\"}" \
  | (command -v jq >/dev/null && jq . || cat)
