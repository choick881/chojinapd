/**
 * 구글 시트 저장소 도우미 + 설정·시간 유틸
 * 모든 시트는 1행 = 머리글, 2행부터 데이터. 열 순서가 바뀌어도 머리글 이름으로 찾습니다.
 */
var TZ = 'Asia/Seoul';

var SHEETS = {
  STUDIO: '스튜디오',
  BOOKING: '예약',
  SANCTION: '노쇼제재',
  ADMIN: '관리자',
  SELECTED: '선정교수',
  HOLIDAY: '공휴일',
  SEMESTER: '학기',
  CONFIG: '설정',
  STATS: '통계',
  TYPE_STATS: '이용자구분통계',
  PURGE: '삭제대장',
};

var HEADERS = {};
HEADERS[SHEETS.STUDIO] = ['코드', '소속', '위치', '주요장비', '내선', '사용', '캘린더ID', 'QR키'];
HEADERS[SHEETS.BOOKING] = ['예약번호', '생성일시', '스튜디오', '날짜', '시작', '종료', '이메일', '성명', '소속',
  '촬영유형', '용도', '촬영지원', '동의일시', '상태', '이벤트ID', '체크인일시', '처리자', '처리메모', '수정일시', '삭제예정일',
  '이용자구분', '대리대상이메일'];
HEADERS[SHEETS.SANCTION] = ['이메일', '학기', '노쇼횟수', '제재시작', '제재종료', '근거예약번호', '상태', '처리메모', '기록일시'];
HEADERS[SHEETS.ADMIN] = ['이메일', '성명', '비고'];
HEADERS[SHEETS.SELECTED] = ['이메일', '학기', '과목명', '비고'];
HEADERS[SHEETS.HOLIDAY] = ['날짜', '명칭'];
HEADERS[SHEETS.SEMESTER] = ['학기', '시작일', '종료일'];
HEADERS[SHEETS.CONFIG] = ['항목', '값', '설명'];
HEADERS[SHEETS.STATS] = ['월', '스튜디오', '운영가능(시간)', '예약(시간)', '실이용(시간)', '이용률', '예약률',
  '예약건수', '지원요청', '지원요청비율', '노쇼', '노쇼율', '갱신일시'];
HEADERS[SHEETS.TYPE_STATS] = ['월', '이용자구분', '예약건수', '예약(시간)', '대리예약', '노쇼', '갱신일시'];
HEADERS[SHEETS.PURGE] = ['삭제일', '구분', '대상 번호', '건수'];

var Db = (function () {
  var _ss = null;
  var _cache = {};

  function ss() {
    if (_ss) return _ss;
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('관리 시트가 아직 없습니다. 담당자가 setup()을 먼저 실행해 주세요.');
    _ss = SpreadsheetApp.openById(id);
    return _ss;
  }

  function sheet(name) {
    var sh = ss().getSheetByName(name);
    if (!sh) throw new Error('시트 탭 "' + name + '"이(가) 없습니다. setup()을 다시 실행해 주세요.');
    return sh;
  }

  function norm(header, v) {
    if (v instanceof Date) {
      if (header === '시작' || header === '종료') return Utilities.formatDate(v, TZ, 'HH:mm');
      if (header.indexOf('일시') !== -1) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm');
      return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    }
    return v === null || v === undefined ? '' : v;
  }

  /** 시트 전체를 객체 배열로 읽음. 각 객체에 _row(시트 행 번호) 포함 */
  function rows(name) {
    if (_cache[name]) return _cache[name];
    var sh = sheet(name);
    var values = sh.getDataRange().getValues();
    var head = values[0].map(String);
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      if (r.join('') === '') continue;
      var o = { _row: i + 1 };
      for (var j = 0; j < head.length; j++) if (head[j]) o[head[j]] = norm(head[j], r[j]);
      out.push(o);
    }
    _cache[name] = out;
    return out;
  }

  function headerOf(name) {
    var sh = sheet(name);
    return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  }

  function append(name, obj) {
    var head = headerOf(name);
    var row = head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
    var sh = sheet(name);
    sh.appendRow(row);
    delete _cache[name];
    return sh.getLastRow();
  }

  /** 지정한 열만 수정 */
  function update(name, rowNum, patch) {
    var head = headerOf(name);
    var sh = sheet(name);
    var range = sh.getRange(rowNum, 1, 1, head.length);
    var cur = range.getValues()[0];
    var changed = false;
    for (var j = 0; j < head.length; j++) {
      if (Object.prototype.hasOwnProperty.call(patch, head[j])) { cur[j] = patch[head[j]]; changed = true; }
    }
    if (changed) range.setValues([cur]);
    delete _cache[name];
  }

  function removeRows(name, rowNums) {
    var sh = sheet(name);
    rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
    delete _cache[name];
  }

  function clearCache() { _cache = {}; }

  return { ss: ss, sheet: sheet, rows: rows, append: append, update: update, removeRows: removeRows, clearCache: clearCache };
})();

/* ---------- 시간 ---------- */

function nowKst() {
  var d = new Date();
  return {
    date: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'),
    min: Number(Utilities.formatDate(d, TZ, 'H')) * 60 + Number(Utilities.formatDate(d, TZ, 'm')),
    stamp: Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm'),
  };
}

/** 'YYYY-MM-DD' + 분 → Date (한국은 서머타임 없음) */
function kstDate(date, min) {
  return new Date(date + 'T' + Rules.fmtMin(min) + ':00+09:00');
}

function koDate(date) {
  var w = ['일', '월', '화', '수', '목', '금', '토'][Rules.weekday(date)];
  var p = date.split('-');
  return Number(p[0]) + '년 ' + Number(p[1]) + '월 ' + Number(p[2]) + '일(' + w + ')';
}

/* ---------- 설정 ---------- */

/** '설정' 탭 항목 이름 → 규칙 필드 */
var CONFIG_KEYS = [
  ['운영 시작', 'openMin', 'time', '09:00', '예약 가능한 가장 이른 시각'],
  ['운영 종료', 'closeMin', 'time', '22:00', '예약 가능한 가장 늦은 종료 시각'],
  ['1인 1일 최대(시간)', 'dailyMaxMin', 'hours', '8', '한 사람이 하루에 예약할 수 있는 합계 시간'],
  ['본인 취소·수정 마감(이용 전날)', 'deadlineMin', 'time', '18:00', '이 시각 이후에는 담당자만 변경'],
  ['촬영 지원 시작', 'supportStartMin', 'time', '08:30', '담당자 근무 시작'],
  ['촬영 지원 종료', 'supportEndMin', 'time', '17:30', '담당자 근무 종료'],
  ['체크인 유예(분)', 'noShowGraceMin', 'number', '60', '시작 후 이 시간 안에 체크인하지 않으면 노쇼'],
  ['체크인 허용(시작 전 분)', 'checkinEarlyMin', 'number', '10', '시작 몇 분 전부터 체크인 가능'],
  ['노쇼 제재 기준(학기 누적 회)', 'sanctionThreshold', 'number', '2', '이 횟수에 도달하면 예약 제한'],
  ['제재 기간(일)', 'sanctionDays', 'number', '30', '예약 제한 일수'],
  ['최대 예약 가능 일수', 'maxAdvanceDays', 'number', '28', '일반 이용자: 오늘부터 며칠 앞까지 예약 가능(28 = 4주). 비우면 제한 없음'],
  ['선정 교수 예약 가능 일수', 'selectedAdvanceDays', 'number', '56', "예약 우선권: '선정교수' 탭에 있는 교수는 이 일수까지(56 = 8주)"],
];
var CONFIG_TEXT = [
  ['학교 도메인', 'domain', 'hanyang.ac.kr', '이 도메인 계정이면 교수·강사·직원·조교 누구나 예약 가능. 비워 두면 배포 설정(도메인 제한)만 사용'],
  ['발신 이름', 'senderName', 'HY FLIP 에듀테크혁신팀', '메일 발신자 표시 이름'],
  ['담당자 연락처', 'contact', '교육혁신처 에듀테크혁신팀 HY FLIP 담당 (02-2220-1406)', '메일·화면에 표시'],
  ['담당자 알림 메일', 'staffEmail', '', '촬영 지원 요청이 오면 알림 받을 주소(쉼표로 여러 개)'],
  ['웹앱 주소', 'webUrl', '', '배포 후 /exec 로 끝나는 주소를 붙여 넣으세요(메일·QR 링크에 사용)'],
  ['전날 리마인더 메일(Y/N)', 'reminder', 'Y', '이용 전날 15시에 안내 메일 발송'],
  ['촬영 유형', 'shootTypes', '일반 강의, 태블릿 판서 강의, 기타', '쉼표로 구분'],
  ['용도', 'purposes', '플립러닝 개발, 일반 강의, 직무·기타', '쉼표로 구분'],
  ['이용자 구분', 'userTypes', '교수, 강사·비전임 교원, 직원, 조교(학과·개인), 기타', '예약 화면 필수 선택지(쉼표로 구분). 통계에 구분별로 집계'],
];

function loadConfig() {
  var map = {};
  try { Db.rows(SHEETS.CONFIG).forEach(function (r) { map[String(r['항목']).trim()] = String(r['값']).trim(); }); } catch (e) { /* setup 전 */ }
  var c = {};
  for (var k in Rules.DEFAULTS) c[k] = Rules.DEFAULTS[k];
  CONFIG_KEYS.forEach(function (d) {
    var v = map[d[0]];
    if (v === undefined) return;
    if (v === '') { if (d[1] === 'maxAdvanceDays' || d[1] === 'selectedAdvanceDays') c[d[1]] = null; return; }
    if (d[2] === 'time') c[d[1]] = Rules.toMin(v);
    else if (d[2] === 'hours') c[d[1]] = Math.round(Number(v) * 60);
    else c[d[1]] = Number(v);
  });
  CONFIG_TEXT.forEach(function (d) { c[d[1]] = map[d[0]] !== undefined ? map[d[0]] : d[2]; });
  c.shootTypes = splitList(c.shootTypes);
  c.purposes = splitList(c.purposes);
  c.userTypes = splitList(c.userTypes);
  return c;
}

function splitList(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(String);
}

function loadSemesters() {
  return Db.rows(SHEETS.SEMESTER).map(function (r) {
    return { name: String(r['학기']), start: String(r['시작일']), end: String(r['종료일']) };
  }).filter(function (s) { return s.start && s.end; });
}

/** 공휴일 = '공휴일' 탭 + 구글 대한민국 공휴일 캘린더(가능할 때) */
function loadHolidays(fromDate, toDate) {
  var set = {};
  Db.rows(SHEETS.HOLIDAY).forEach(function (r) { if (r['날짜']) set[String(r['날짜'])] = true; });
  var key = 'kr-holidays-' + fromDate + '-' + toDate;
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) {
    JSON.parse(hit).forEach(function (d) { set[d] = true; });
  } else {
    var list = [];
    try {
      var cal = CalendarApp.getCalendarById('ko.south_korea#holiday@group.v.calendar.google.com');
      if (cal) {
        cal.getEvents(kstDate(fromDate, 0), kstDate(Rules.addDays(toDate, 1), 0)).forEach(function (ev) {
          if (ev.isAllDayEvent()) list.push(Utilities.formatDate(ev.getAllDayStartDate(), TZ, 'yyyy-MM-dd'));
        });
      }
    } catch (e) { /* 공휴일 캘린더 접근 불가 시 탭만 사용 */ }
    cache.put(key, JSON.stringify(list), 21600);
    list.forEach(function (d) { set[d] = true; });
  }
  return Object.keys(set).filter(function (d) { return d >= fromDate && d <= toDate; }).sort();
}

/** 웹앱 주소: '설정' 탭 값 우선(트리거에서 보낸 메일이 /dev 주소를 쓰지 않도록), 없으면 현재 배포 주소 */
function webAppUrl() {
  var fixed = String(loadConfig().webUrl || '').trim();
  return fixed || ScriptApp.getService().getUrl() || '';
}
