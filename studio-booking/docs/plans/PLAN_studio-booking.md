# PLAN — HY FLIP 셀프스튜디오 예약 (모듈 B)

**Last Updated:** 2026-11-25 · **Status:** Phase 1–5 완료, Phase 6(부서 계정 배포)은 담당자 진행

**CRITICAL INSTRUCTIONS**: 각 Phase 완료 후 ① 체크박스 갱신 ② 품질 게이트 명령 실행 ③ 모두 통과 시에만 다음 Phase로.

## 아키텍처 결정

| 결정 | 이유 |
| --- | --- |
| Google Apps Script 웹앱 (executeAs 배포자, access 도메인) | 기능정의서 2장: 학교 구글 계정 안에서만, 외부 DB·SSO 미사용 |
| 시트 = 기록, 캘린더 = 유일한 기준 일정 | 정의서 5장. 겹침 확인은 항상 캘린더 실시간 조회 |
| 규칙 엔진 `Rules.js` 순수 함수 분리 | GAS·Node 양쪽에서 실행 → 단위 테스트 가능 |
| 가짜 GAS 환경(`test/gas-mock.js`)으로 실제 서버 코드 통합 테스트 | 학교 계정 없이도 전체 흐름 검증 |
| homepage-builder-kr 스킬은 절차만 차용 | 스킬 기본 스택(Next.js+Supabase+Vercel)이 정의서 제약과 충돌 |

## Phase 1 — 규칙 엔진 (TDD)
- [x] RED: `test/rules.test.js` 18개 (30분 단위, 운영시간, 8시간, 전날 18:00, 지원 근무시간·공휴일, 노쇼 창, 제재, 보관기간, 통계)
- [x] GREEN: `src/Rules.js`
- [x] 게이트: `npm test` 통과

## Phase 2 — 서버(GAS)
- [x] `Db.js`(시트·설정·공휴일) `Booking.js`(예약·변경·취소·체크인, LockService) `Mail.js` `Admin.js` `Jobs.js`(노쇼·리마인더·통계·보관기간) `Setup.js` `Code.js`
- [x] 게이트: `test/flow.test.js` 17개 통합 테스트 통과

## Phase 3 — 화면
- [x] 예약(모바일 우선), 내 예약, QR 체크인, 담당자(지원 요청·예약 현황·노쇼·통계·QR 인쇄)
- [x] 게이트: `npm run shots` — 375/768/1440 캡처, 가로 스크롤·JS 오류 없음, 필수 항목 안내 확인

## Phase 4 — 배포 준비
- [x] `appsscript.json`(웹앱·권한), clasp 2.4.2 고정, `npm run create`(매니페스트 보호)
- [x] 비밀정보 점검: `.clasp.json`·`.clasprc.json` gitignore, 코드에 키·토큰 없음

## Phase 5 — 문서
- [x] 배포가이드 · 운영매뉴얼 · 기능정의서 검토의견

## Phase 5.5 — 결정 반영 (11/25)
- [x] 선정 교수 우선권(8주) / 일반 4주 제한 / 촬영 유형 3종 / 이용수칙 샘플 / 제재 시 기존 예약 유지
- [x] 게이트: `npm test` 38개 통과, `npm run shots` 통과

## Phase 6 — 부서 계정 배포·시범 운영 (담당자)
- [ ] `docs/배포가이드.md` 1~5단계
- [ ] 6단계 시범 운영 점검표

## 위험

| 위험 | 확률 | 영향 | 대응 |
| --- | --- | --- | --- |
| 학교 Workspace가 clasp/외부 앱 승인을 막음 | 중 | 중 | 편집기 직접 붙여넣기 대안 문서화 |
| 트리거 메일에 /dev 주소 | 중 | 중 | 설정 ‘웹앱 주소’ 우선 사용 |
| 고정 QR 사진 공유 | 중 | 낮 | 시간 창·본인·키 확인, `rotateQrKeys` |
| 캘린더 일정 수동 삭제로 시트 불일치 | 낮 | 중 | 운영매뉴얼에 금지 명시, 취소는 담당자 화면 |

## 롤백
- 코드: 편집기 ‘배포 관리’에서 이전 버전으로 되돌리기
- 데이터: 관리 시트 ‘버전 기록’에서 복원

## Notes
- 실제 학교 계정 환경(Session.getActiveUser, 도메인 배포)은 모의 환경으로만 검증 → Phase 6 점검표로 확인 필요.
