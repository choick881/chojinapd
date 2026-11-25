/**
 * 예약 규칙 엔진 (순수 함수 — 시트·캘린더에 접근하지 않음)
 * Apps Script와 Node(테스트) 양쪽에서 같은 파일을 사용합니다.
 *
 * 시간 표현 규칙: 날짜 = 'YYYY-MM-DD' 문자열, 시각 = 자정부터의 분(정수).
 *   예) 09:30 → 570. 시간대(Asia/Seoul) 변환은 호출하는 쪽에서 처리합니다.
 */
var Rules = (function () {
  var STATUS = {
    CONFIRMED: '확정',
    PENDING: '담당자 확인 중',
    CHECKED_IN: '체크인',
    NO_SHOW: '노쇼',
    CANCELLED: '취소',
    EXCUSED: '노쇼 해제',
    REJECTED: '반려',
  };
  /** 스튜디오 시간을 점유하는 상태 */
  var OCCUPYING = [STATUS.CONFIRMED, STATUS.PENDING, STATUS.CHECKED_IN];

  /** 기본 정책값 (시트 '설정' 탭 값이 있으면 덮어씀) */
  var DEFAULTS = {
    openMin: 9 * 60,            // 운영 시작 09:00
    closeMin: 22 * 60,          // 운영 종료 22:00
    slotMin: 30,                // 예약 단위 30분
    dailyMaxMin: 8 * 60,        // 1인 1일 최대 8시간
    deadlineMin: 18 * 60,       // 이용 전날 18:00까지 본인 취소·수정
    supportStartMin: 8 * 60 + 30, // 촬영 지원 08:30
    supportEndMin: 17 * 60 + 30,  // 촬영 지원 17:30
    noShowGraceMin: 60,         // 시작 후 60분 안에 체크인
    checkinEarlyMin: 10,        // 시작 10분 전부터 체크인
    sanctionThreshold: 2,       // 학기 노쇼 2회
    sanctionDays: 30,           // 1개월(30일) 예약 제한
    maxAdvanceDays: null,       // 예약 가능 기간(일). null = 제한 없음
    personalYears: 2,           // 개인정보 보관
    historyYears: 10,           // 업무 이력 보관
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toMin(hhmm) {
    var p = String(hhmm).split(':');
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }
  function fmtMin(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  function parseDate(d) {
    var p = String(d).split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function fmtDate(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function addDays(d, n) { return fmtDate(parseDate(d) + n * 86400000); }
  function addYears(d, n) {
    var p = String(d).split('-');
    var y = Number(p[0]) + n, m = Number(p[1]), day = Number(p[2]);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 윤년 2/29 보정
    return y + '-' + pad(m) + '-' + pad(Math.min(day, last));
  }
  function weekday(d) { return new Date(parseDate(d)).getUTCDay(); } // 0=일
  function daysInMonth(ym) {
    var p = String(ym).split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]), 0)).getUTCDate();
  }
  /** now({date,min})가 (date, min) 시점 이전인지 */
  function before(now, date, min) {
    return now.date < date || (now.date === date && now.min < min);
  }
  function overlaps(a, b) { return a.startMin < b.endMin && b.startMin < a.endMin; }
  function isHoliday(date, holidays) { return (holidays || []).indexOf(date) !== -1; }
  function isWorkday(date, holidays) {
    var w = weekday(date);
    return w !== 0 && w !== 6 && !isHoliday(date, holidays);
  }

  /**
   * 예약 요청 검증
   * @param req {studioId,date,startMin,endMin,support,agreedPrivacy,agreedRules}
   * @param ctx {now:{date,min}, config, holidays[], busy[], sameDayBookings[], sanctionUntil}
   *   busy: 해당 스튜디오·날짜의 점유 구간(캘린더 기준), sameDayBookings: 본인의 같은 날 점유 예약
   * @return {ok:boolean, errors:string[]}
   */
  function validateRequest(req, ctx) {
    var c = ctx.config || DEFAULTS;
    var e = [];
    var s = Number(req.startMin), en = Number(req.endMin);

    if (!req.studioId) e.push('스튜디오를 선택해 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.date || ''))) e.push('날짜를 선택해 주세요.');
    if (isNaN(s) || isNaN(en)) e.push('시작·종료 시각을 선택해 주세요.');
    if (e.length) return { ok: false, errors: e };

    if (s % c.slotMin !== 0 || en % c.slotMin !== 0) e.push(c.slotMin + '분 단위로만 예약할 수 있습니다.');
    if (en <= s) e.push('종료 시각은 시작 시각보다 늦어야 합니다.');
    if (s < c.openMin || en > c.closeMin) {
      e.push('운영시간(' + fmtMin(c.openMin) + '~' + fmtMin(c.closeMin) + ') 안에서만 예약할 수 있습니다.');
    }
    if (!before(ctx.now, req.date, s)) e.push('이미 지난 시간은 예약할 수 없습니다.');
    if (c.maxAdvanceDays && req.date > addDays(ctx.now.date, c.maxAdvanceDays)) {
      e.push('오늘부터 ' + c.maxAdvanceDays + '일 이내만 예약할 수 있습니다.');
    }
    if (ctx.sanctionUntil && ctx.now.date <= ctx.sanctionUntil) {
      e.push('노쇼 누적으로 ' + ctx.sanctionUntil + '까지 예약이 제한됩니다. 담당자에게 문의해 주세요.');
    }

    var mine = ctx.sameDayBookings || [];
    var used = 0;
    for (var i = 0; i < mine.length; i++) {
      used += mine[i].endMin - mine[i].startMin;
      if (overlaps(mine[i], { startMin: s, endMin: en })) {
        e.push('같은 시간에 이미 다른 예약이 있습니다.');
        break;
      }
    }
    if (used + (en - s) > c.dailyMaxMin) {
      e.push('1인 1일 최대 ' + c.dailyMaxMin / 60 + '시간까지 예약할 수 있습니다. (이미 ' + used / 60 + '시간 예약)');
    }

    var busy = ctx.busy || [];
    for (var j = 0; j < busy.length; j++) {
      if (overlaps(busy[j], { startMin: s, endMin: en })) {
        e.push('선택한 시간에 이미 예약이 있습니다. 다른 시간을 골라 주세요.');
        break;
      }
    }

    if (req.support) {
      if (!isWorkday(req.date, ctx.holidays)) e.push('촬영 지원은 평일(공휴일 제외)에만 신청할 수 있습니다.');
      if (s < c.supportStartMin || en > c.supportEndMin) {
        e.push('촬영 지원은 담당자 근무시간(' + fmtMin(c.supportStartMin) + '~' + fmtMin(c.supportEndMin) + ') 안에서만 신청할 수 있습니다.');
      }
    }
    if (!req.agreedPrivacy) e.push('개인정보 수집·이용에 동의해 주세요.');
    if (!req.agreedRules) e.push('이용 수칙·야간 이용 책임에 동의해 주세요.');

    return { ok: e.length === 0, errors: e };
  }

  /** 본인 취소·수정 마감 = 이용 전날 deadlineMin (해당 분 포함) */
  function canUserModify(b, now, c) {
    c = c || DEFAULTS;
    return before(now, addDays(b.date, -1), c.deadlineMin + 1);
  }

  function noShowDeadlineMin(b, c) {
    c = c || DEFAULTS;
    return Math.min(b.startMin + c.noShowGraceMin, b.endMin);
  }

  function isNoShowDue(b, now, c) {
    if (b.status !== STATUS.CONFIRMED) return false;
    return !before(now, b.date, noShowDeadlineMin(b, c));
  }

  function canCheckin(b, now, c) {
    c = c || DEFAULTS;
    if (b.status === STATUS.CHECKED_IN) return { ok: false, reason: '이미 체크인한 예약입니다.' };
    if (b.status !== STATUS.CONFIRMED) return { ok: false, reason: '확정된 예약만 체크인할 수 있습니다. (현재: ' + b.status + ')' };
    if (before(now, b.date, b.startMin - c.checkinEarlyMin)) {
      return { ok: false, reason: '체크인은 시작 ' + c.checkinEarlyMin + '분 전부터 가능합니다.' };
    }
    if (!before(now, b.date, noShowDeadlineMin(b, c))) {
      return { ok: false, reason: '체크인 가능 시간이 지났습니다. 담당자에게 문의해 주세요.' };
    }
    return { ok: true };
  }

  /** semesters: [{name,start,end}] */
  function semesterOf(date, semesters) {
    for (var i = 0; i < (semesters || []).length; i++) {
      var s = semesters[i];
      if (s.start <= date && date <= s.end) return s;
    }
    return null;
  }

  /**
   * 새 노쇼가 기록된 뒤 제재 여부 판정
   * @param userBookings 해당 이용자의 예약 목록(새 노쇼 포함)
   * @return {from,until,count} | null
   */
  function sanctionAfterNoShow(userBookings, noShowDate, semesters, c) {
    c = c || DEFAULTS;
    var sem = semesterOf(noShowDate, semesters);
    var count = 0;
    for (var i = 0; i < userBookings.length; i++) {
      var b = userBookings[i];
      if (b.status !== STATUS.NO_SHOW) continue;
      if (sem ? (b.date >= sem.start && b.date <= sem.end) : b.date.slice(0, 4) === noShowDate.slice(0, 4)) count++;
    }
    if (count < c.sanctionThreshold) return null;
    return { from: noShowDate, until: addDays(noShowDate, c.sanctionDays), count: count };
  }

  /** 보관기간: 해당 학기 종료일(미등록 시 그해 12-31) + 2년 / + 10년 */
  function retentionDates(date, semesters, c) {
    c = c || DEFAULTS;
    var sem = semesterOf(date, semesters);
    var base = sem ? sem.end : date.slice(0, 4) + '-12-31';
    return { personal: addYears(base, c.personalYears), history: addYears(base, c.historyYears) };
  }

  /** 스튜디오별 월 통계 (+ '전체' 행) */
  function monthlyStats(bookings, studios, ym, c) {
    c = c || DEFAULTS;
    var avail = daysInMonth(ym) * (c.closeMin - c.openMin);
    var map = {};
    var order = [];
    function row(code) {
      if (!map[code]) {
        map[code] = { month: ym, studio: code, availableMin: 0, bookings: 0, reservedMin: 0, usedMin: 0,
          supportRequests: 0, noShows: 0, checkedIn: 0 };
        order.push(code);
      }
      return map[code];
    }
    for (var i = 0; i < studios.length; i++) row(studios[i].code).availableMin = avail;
    var counted = [STATUS.CONFIRMED, STATUS.PENDING, STATUS.CHECKED_IN, STATUS.NO_SHOW];
    for (var j = 0; j < bookings.length; j++) {
      var b = bookings[j];
      if (String(b.date).slice(0, 7) !== ym || counted.indexOf(b.status) === -1) continue;
      var r = row(b.studioId);
      var d = b.endMin - b.startMin;
      r.bookings++;
      r.reservedMin += d;
      if (b.support) r.supportRequests++;
      if (b.status === STATUS.CHECKED_IN) { r.usedMin += d; r.checkedIn++; }
      if (b.status === STATUS.NO_SHOW) r.noShows++;
    }
    var total = { month: ym, studio: '전체', availableMin: 0, bookings: 0, reservedMin: 0, usedMin: 0,
      supportRequests: 0, noShows: 0, checkedIn: 0 };
    var out = [];
    for (var k = 0; k < order.length; k++) {
      var x = map[order[k]];
      ['availableMin', 'bookings', 'reservedMin', 'usedMin', 'supportRequests', 'noShows', 'checkedIn']
        .forEach(function (f) { total[f] += x[f]; });
      out.push(x);
    }
    out.push(total);
    out.forEach(function (x) {
      x.utilization = x.availableMin ? x.usedMin / x.availableMin : 0;
      x.reservationRate = x.availableMin ? x.reservedMin / x.availableMin : 0;
      x.supportRatio = x.bookings ? x.supportRequests / x.bookings : 0;
      var judged = x.checkedIn + x.noShows;
      x.noShowRate = judged ? x.noShows / judged : 0;
    });
    return out;
  }

  return {
    STATUS: STATUS, OCCUPYING: OCCUPYING, DEFAULTS: DEFAULTS,
    toMin: toMin, fmtMin: fmtMin, addDays: addDays, addYears: addYears, weekday: weekday,
    daysInMonth: daysInMonth, overlaps: overlaps, isHoliday: isHoliday, isWorkday: isWorkday,
    validateRequest: validateRequest, canUserModify: canUserModify,
    noShowDeadlineMin: noShowDeadlineMin, isNoShowDue: isNoShowDue, canCheckin: canCheckin,
    semesterOf: semesterOf, sanctionAfterNoShow: sanctionAfterNoShow,
    retentionDates: retentionDates, monthlyStats: monthlyStats,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
