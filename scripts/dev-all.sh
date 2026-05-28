#!/usr/bin/env bash

set -e

echo "LifePass AI 개발 서버를 시작합니다..."

if [ ! -f ".env" ]; then
  echo ".env 파일이 없습니다. 프로젝트 루트에 .env 파일을 먼저 만들어주세요."
  exit 1
fi

cleanup() {
  echo ""
  echo "실행 중인 LifePass 프로세스를 종료합니다..."
  kill 0
}

trap cleanup INT TERM EXIT

echo "1) 백엔드 서버 실행: npm run server"
npm run server &

sleep 2

echo "2) 정책 자동 수집 스케줄러 실행: npm run ingest:schedule"
npm run ingest:schedule &

sleep 2

echo "3) 프론트엔드 개발 서버 실행: npm run dev"
npm run dev