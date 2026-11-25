#!/usr/bin/env bash
# HY FLIP 신청 모듈 배포 스크립트
#   1) 문법 검사 + 자동 테스트  2) clasp push (코드 올리기)  3) 기존 웹 앱을 새 버전으로 갱신 (URL 유지)
#
# 사용법
#   npm run deploy:test -- "설명"     # 테스트용 시트 사본에 배포 (.env.test)
#   npm run deploy:prod -- "설명"     # 실제 신청 페이지에 배포 (.env.prod)
#   --yes 를 붙이면 확인 질문 없이 진행합니다 (GitHub Actions용).
#
# .env.test / .env.prod 형식 (GitHub에 올라가지 않음):
#   HYFLIP_SCRIPT_ID=1AbC...        # Apps Script > 프로젝트 설정 > 스크립트 ID
#   HYFLIP_DEPLOYMENT_ID=AKfy...    # npx clasp deployments 의 웹 앱 배포 ID
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"; shift || true
YES=0; DESC=""
for a in "$@"; do
  if [ "$a" = "--yes" ]; then YES=1; else DESC="$a"; fi
done
[ -n "$DESC" ] || DESC="HY FLIP $(node -p "require('./package.json').version")"

case "$TARGET" in
  test) LABEL="테스트용 사본" ;;
  prod) LABEL="★실제 신청 페이지★" ;;
  *) echo "사용법: scripts/deploy.sh test|prod [\"설명\"] [--yes]" >&2; exit 1 ;;
esac

# 환경변수가 이미 있으면(GitHub Actions) 그대로 쓰고, 없으면 .env.<대상> 파일에서 읽습니다.
if [ -z "${HYFLIP_SCRIPT_ID:-}" ] && [ -f ".env.$TARGET" ]; then
  set -a; . "./.env.$TARGET"; set +a
fi
: "${HYFLIP_SCRIPT_ID:?❌ HYFLIP_SCRIPT_ID가 없습니다. .env.$TARGET 파일을 만드세요 (docs/배포자동화.md)}"
: "${HYFLIP_DEPLOYMENT_ID:?❌ HYFLIP_DEPLOYMENT_ID가 없습니다. .env.$TARGET 파일을 만드세요 (docs/배포자동화.md)}"

confirm() {
  [ "$YES" = 1 ] && return 0
  local want="$2" ok
  read -r -p "  $1 [$want 입력 시 진행] " ok
  [ "$ok" = "$want" ]
}
# 실제 페이지는 실수 방지를 위해 '배포'를 직접 입력해야 진행합니다.
WORD=y; [ "$TARGET" = prod ] && WORD=배포

echo "▶ 대상: $LABEL  (스크립트 ${HYFLIP_SCRIPT_ID:0:8}…)"
echo "▶ 1/3 문법 검사 + 자동 테스트"
node scripts/check-syntax.js
node --test --test-reporter=spec test/*.test.js

printf '{\n  "scriptId": "%s",\n  "rootDir": "src"\n}\n' "$HYFLIP_SCRIPT_ID" > .clasp.json

echo "▶ 2/3 Apps Script에 코드 올리기 (clasp push)"
confirm "$LABEL 의 Apps Script 코드를 이 폴더 내용으로 덮어씁니다." "$WORD" || { echo "중단했습니다."; exit 0; }
npx clasp push --force

echo "▶ 3/3 웹 앱 새 버전 배포 (URL 그대로)"
confirm "'$DESC'(으)로 $LABEL 웹 앱을 갱신합니다." "$WORD" || { echo "코드만 올리고 배포는 하지 않았습니다."; exit 0; }
npx clasp deploy --deploymentId "$HYFLIP_DEPLOYMENT_ID" --description "$DESC"

echo "✅ 완료. Apps Script 편집기에서 setup을 한 번 실행해 열·메일문구 점검을 통과하는지 확인하세요."
