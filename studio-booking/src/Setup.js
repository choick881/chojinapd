/**
 * 최초 설치 — Apps Script 편집기에서 setup()을 한 번 실행하세요. (여러 번 실행해도 안전)
 *  1) 관리 스프레드시트 생성 + 탭·머리글·기본값
 *  2) 셀프스튜디오 10곳 등록 + 스튜디오별 구글 캘린더 생성 + QR키 발급
 *  3) 실행한 계정을 '관리자'에 등록
 *  4) 시간 트리거 설치
 */

var STUDIO_SEED = [
  ['ST01', '경영대학', '경영관 307호', '카메라(23.1 교체), 공기청정기', '2438'],
  ['ST02', '자연과학대학', '자연과학관 721호', '카메라(23.1 교체), 공기청정기', '0887'],
  ['ST03', '사범대학', '사범대학 본관 314호', 'PTZ 카메라, 공기청정기', '1094'],
  ['ST04', '의과대학', '의과대학 본관 616호', 'AREC 녹화기, PTZ 카메라, 공기청정기', '0590'],
  ['ST05', '인문과학대학', '인문관 101호', '카메라(23.1 교체)', '0770'],
  ['ST06', '경제금융대학', '경제금융관 508호', '일반 카메라, 공기청정기', '1406'],
  ['ST07', '예술체육대학', '예술체육대학 232-1호', 'AREC 녹화기, PTZ 카메라, 공기청정기', '1316'],
  ['ST08', '사회과학대학', '사회과학대 107호', 'PTZ 카메라, 공기청정기', '0840'],
  ['ST09', '융합교육관', '융합교육관 205호', 'AREC 녹화기, PTZ 카메라, 공기청정기', '0830'],
  ['ST10', '공과대학', '공업센터본관 314호(정상진 S/W 스페이스)', 'PTZ 카메라, 공기청정기', '2663'],
];

// 학기 경계: 방학은 직전 학기에 포함(노쇼 누적·보관기간 계산용). 학사일정에 맞게 '학기' 탭에서 고치세요.
var SEMESTER_SEED = [
  ['2026-2학기', '2026-09-01', '2027-02-28'],
  ['2027-1학기', '2027-03-01', '2027-08-31'],
  ['2027-2학기', '2027-09-01', '2028-02-29'],
];

// 날짜 고정 공휴일만 미리 입력. 설·추석·부처님오신날·대체공휴일은 구글 공휴일 캘린더로 자동 반영되며,
// 반영이 안 되면 '공휴일' 탭에 직접 추가하세요. 학교 휴무일(개교기념일 등)도 이 탭에 추가합니다.
var HOLIDAY_SEED = [
  ['2026-12-25', '성탄절'], ['2027-01-01', '신정'], ['2027-03-01', '삼일절'], ['2027-05-05', '어린이날'],
  ['2027-06-06', '현충일'], ['2027-08-15', '광복절'], ['2027-10-03', '개천절'], ['2027-10-09', '한글날'],
  ['2027-12-25', '성탄절'],
];

function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss;
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('HY FLIP 셀프스튜디오 예약 관리');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(HEADERS).forEach(function (name) { ensureSheet(ss, name, HEADERS[name]); });
  var first = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  Db.clearCache();

  seedIfEmpty(SHEETS.CONFIG, CONFIG_KEYS.map(function (d) { return [d[0], d[3], d[4]]; })
    .concat(CONFIG_TEXT.map(function (d) { return [d[0], d[2], d[3]]; })));
  addMissingConfigRows();
  seedIfEmpty(SHEETS.SEMESTER, SEMESTER_SEED);
  seedIfEmpty(SHEETS.HOLIDAY, HOLIDAY_SEED);
  seedIfEmpty(SHEETS.STUDIO, STUDIO_SEED.map(function (s) { return s.concat(['Y', '', '']); }));

  var me = String(Session.getEffectiveUser().getEmail()).toLowerCase();
  if (me && !Db.rows(SHEETS.ADMIN).some(function (r) { return String(r['이메일']).toLowerCase() === me; })) {
    Db.append(SHEETS.ADMIN, { '이메일': me, '성명': 'HY FLIP 공동계정', '비고': 'setup 자동 등록' });
  }

  ensureStudioCalendars();
  installTriggers();

  var url = webAppUrl();
  console.log('관리 시트: ' + ss.getUrl());
  console.log('웹앱 주소: ' + (url || '(아직 배포 전 — 배포 후 다시 확인)'));
  return ss.getUrl();
}

function ensureSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var cur = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (cur.join('') === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // 새 버전에서 추가된 열이 있으면 오른쪽 끝에 덧붙임
    headers.forEach(function (h) {
      if (cur.indexOf(h) === -1) { sh.getRange(1, sh.getLastColumn() + 1).setValue(h); cur.push(h); }
    });
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#eceae4');
  // 날짜·시각이 자동 변환되지 않도록 전체를 일반 텍스트로
  sh.getRange(1, 1, sh.getMaxRows(), sh.getLastColumn()).setNumberFormat('@');
  return sh;
}

function seedIfEmpty(name, rows) {
  var sh = Db.sheet(name);
  if (sh.getLastRow() > 1 || !rows.length) return;
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  Db.clearCache();
}

function addMissingConfigRows() {
  var have = {};
  Db.rows(SHEETS.CONFIG).forEach(function (r) { have[r['항목']] = true; });
  CONFIG_KEYS.forEach(function (d) { if (!have[d[0]]) Db.append(SHEETS.CONFIG, { '항목': d[0], '값': d[3], '설명': d[4] }); });
  CONFIG_TEXT.forEach(function (d) { if (!have[d[0]]) Db.append(SHEETS.CONFIG, { '항목': d[0], '값': d[2], '설명': d[3] }); });
}

/** 캘린더ID가 비어 있는 스튜디오에 캘린더를 만들고, QR키가 없으면 발급 */
function ensureStudioCalendars() {
  Db.rows(SHEETS.STUDIO).forEach(function (r) {
    var patch = {};
    var calId = String(r['캘린더ID'] || '');
    if (!calId || !CalendarApp.getCalendarById(calId)) {
      var cal = CalendarApp.createCalendar('HY FLIP 셀프스튜디오 ' + r['코드'] + ' ' + r['위치'], {
        timeZone: TZ, summary: r['소속'] + ' / 장비: ' + r['주요장비'] + ' / 내선 ' + r['내선'],
      });
      patch['캘린더ID'] = cal.getId();
      Utilities.sleep(800); // 캘린더 생성 속도 제한 회피
    }
    if (!r['QR키']) patch['QR키'] = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    if (Object.keys(patch).length) Db.update(SHEETS.STUDIO, r._row, patch);
  });
}

/** 스튜디오 QR을 다시 발급(QR 사진 유출 등). 새 QR을 인쇄해 다시 붙여야 합니다. */
function rotateQrKeys() {
  Db.rows(SHEETS.STUDIO).forEach(function (r) {
    Db.update(SHEETS.STUDIO, r._row, { 'QR키': Utilities.getUuid().replace(/-/g, '').slice(0, 10) });
  });
}

function installTriggers() {
  var ours = ['jobNoShows', 'jobReminders', 'jobStats', 'jobRetention'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (ours.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('jobNoShows').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('jobReminders').timeBased().everyDays(1).atHour(15).inTimezone(TZ).create();
  ScriptApp.newTrigger('jobStats').timeBased().everyDays(1).atHour(2).inTimezone(TZ).create();
  ScriptApp.newTrigger('jobRetention').timeBased().onMonthDay(1).atHour(3).inTimezone(TZ).create();
}
