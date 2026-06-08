#!/usr/bin/env bash
set -euo pipefail

HOST="127.0.0.1"
PORT="8790"
BASE="http://${HOST}:${PORT}"

echo "==> GET /health"
curl -sS "${BASE}/health" | (command -v jq >/dev/null && jq . || cat)

echo "==> POST /execute (verification challenge)"
curl -sS -X POST "${BASE}/execute" \
  -H 'content-type: application/json' \
  -d '{"taskId":"0","stepIdx":0,"payload":"","reqId":"0x'$(printf '00%.0s' {1..32})'"}' \
  | (command -v jq >/dev/null && jq . || cat)

PAYLOAD=$(printf '%s' 'Summarize Somnia agent fees' | xxd -p | tr -d '\n')
REQ_ID="0x$(printf 'ab%.0s' {1..32})"

echo "==> POST /execute"
curl -sS -X POST "${BASE}/execute" \
  -H 'content-type: application/json' \
  -d "{\"taskId\":\"99\",\"stepIdx\":0,\"payload\":\"${PAYLOAD}\",\"reqId\":\"${REQ_ID}\"}" \
  | (command -v jq >/dev/null && jq . || cat)
