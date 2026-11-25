#!/usr/bin/env bash
# HY FLIP 신청 모듈 배포 스크립트
# 1) 자동 테스트 → 2) clasp push (코드 올리기) → 3) 기존 배포를 새 버전으로 갱신 (URL 유지)
# 사용법:  HYFLIP_DEPLOYMENT_ID=AKfy... npm run deploy -- "v1.0.2 설명"
set -euo pipefail
cd "$(dirname "$0")/.."

DESC="${1:-HY FLIP $(node -p "require('./package.json').version")}"

if [ ! -f .clasp.json ]; then
  echo "❌ .clasp.json이 없습니다. .clasp.json.example을 복사해 scriptId를 넣으세요." >&2; exit 1
fi
if [ -z "${HYFLIP_DEPLOYMENT_ID:-}" ]; then
  echo "❌ HYFLIP_DEPLOYMENT_ID가 비어 있습니다. 'npx clasp deployments'로 웹 앱 배포 ID를 확인하세요." >&2; exit 1
fi

echo "▶ 1/3 자동 테스트"
node scripts/check-syntax.js
node --test test/*.test.js

echo "▶ 2/3 Apps Script에 코드 올리기 (clasp push)"
read -r -p "  구글 Apps Script 프로젝트의 코드를 이 폴더 내용으로 덮어씁니다. 계속할까요? [y/N] " ok
[ "$ok" = "y" ] || { echo "중단했습니다."; exit 0; }
npx clasp push --force

echo "▶ 3/3 웹 앱 새 버전 배포 (URL 그대로)"
read -r -p "  '$DESC'(으)로 실제 웹 앱을 갱신합니다. 계속할까요? [y/N] " ok
[ "$ok" = "y" ] || { echo "코드만 올리고 배포는 하지 않았습니다."; exit 0; }
npx clasp deploy --deploymentId "$HYFLIP_DEPLOYMENT_ID" --description "$DESC"

echo "✅ 완료. Apps Script 편집기에서 setup을 한 번 실행해 열·메일문구 점검을 통과하는지 확인하세요."
