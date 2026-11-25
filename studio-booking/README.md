# HY FLIP 셀프스튜디오 예약 웹앱

**학교 구글 계정이 있으면 누구나**(교수·강사·직원·학과/개인 조교) 셀프스튜디오 10곳을 웹에서 직접 예약하고, 중복 차단·QR 체크인·노쇼 제재·메일 안내·이용 통계가 자동으로 처리되는 **Google Apps Script 웹앱**입니다.
(기능정의서 v0.1 모듈 B)

- **이용**: @hanyang.ac.kr 계정 누구나 (플립러닝 미신청 교수 포함). 예약 시 이용자 구분 선택, 조교는 ‘교수님 대신 예약’ 가능
- **우선권**: 플립러닝 개발 선정 교수(‘선정교수’ 탭)는 8주, 그 외 4주 앞까지. 조교가 선정 교수 대신 예약하면 교수님 기준 8주
- **설치·소유**: HY FLIP 부서 공동계정 (시트·캘린더·메일 발신만 이 계정 소유 — 예약자를 제한하지 않음) · 외부 DB 없음
- 저장: 구글 시트 / 일정: 스튜디오별 구글 캘린더(유일한 기준) / 발송: 메일

| 화면 | 주소 |
| --- | --- |
| 예약하기 | `웹앱주소` |
| 내 예약 | `웹앱주소?p=my` |
| QR 체크인 | `웹앱주소?p=checkin&st=ST01&k=…` (QR로 접속) |
| 담당자 | `웹앱주소?p=admin` |

## 바로가기
- 설치: [docs/배포가이드.md](docs/배포가이드.md)
- 운영: [docs/운영매뉴얼.md](docs/운영매뉴얼.md)
- 정의서 검토: [docs/기능정의서_검토의견.md](docs/기능정의서_검토의견.md)
- 이용수칙 샘플(화면·게시용): [docs/이용수칙_샘플.md](docs/이용수칙_샘플.md)
- 화면 캡처: [docs/screenshots](docs/screenshots)

## 폴더 구조

```
src/                 ← Apps Script로 올라가는 코드 (clasp rootDir)
  Rules.js           예약 규칙(순수 함수) — 테스트 대상
  Db.js              시트 읽기·쓰기, 설정, 공휴일
  Booking.js         예약·변경·취소·QR 체크인 (이용자 API)
  Admin.js           담당자 API
  Jobs.js            시간 트리거: 노쇼, 리마인더, 통계, 보관기간 삭제
  Mail.js            자동 메일 문구
  Setup.js           최초 설치(setup)
  Code.js            웹앱 진입점(doGet)
  ui/*.html          화면
test/                ← 규칙 단위 테스트 + 가짜 시트·캘린더 위 통합 테스트
preview/             ← 로컬 미리보기 서버, 화면 자동 점검(Playwright)
```

## 개발자 명령

```bash
npm install
```

```bash
npm test
```

```bash
npm run preview
```
→ http://localhost:8787/?p=book (실제 서버 코드를 가짜 시트·캘린더로 실행, 메일은 `/__outbox`에서 확인)

```bash
npm run shots
```
→ 예약·체크인·담당자 화면을 자동으로 클릭해 보고 `docs/screenshots`에 캡처
