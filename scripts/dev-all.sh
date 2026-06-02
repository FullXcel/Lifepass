#!/usr/bin/env bash

set -euo pipefail

echo "LifePass AI 개발 서버를 시작합니다..."

if [ ! -f ".env" ]; then
  echo ".env 파일이 없습니다. 프로젝트 루트에 .env 파일을 먼저 만들어주세요."
  exit 1
fi

PIDS=()
cleanup() {
  echo ""
  echo "실행 중인 LifePass 프로세스를 종료합니다..."
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup INT TERM EXIT

wait_for_api() {
  local url="${1:-http://localhost:8787/api/health}"
  local max_attempts="${2:-20}"
  for ((i=1; i<=max_attempts; i+=1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

echo "1) 백엔드 서버 실행: npm run server"
npm run server &
PIDS+=("$!")

if wait_for_api "http://localhost:${LIFEPASS_API_PORT:-8787}/api/health" 24; then
  echo "   백엔드 health check 통과"
else
  echo "   경고: 백엔드 health check가 아직 통과하지 않았습니다. 수집 스케줄러는 계속 시작합니다."
fi

echo "2) 정책·법령 자동 수집 스케줄러 실행: npm run ingest:schedule"
echo "   스케줄러는 시작 직후 1회 수집하고, 이후 POLICY_SCHEDULER_INTERVAL_MS 간격으로 반복합니다."
npm run ingest:schedule &
PIDS+=("$!")

sleep 1

echo "3) 프론트엔드 개발 서버 실행: npm run dev"
npm run dev &
PIDS+=("$!")

wait "${PIDS[@]}"
