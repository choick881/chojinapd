/**
 * 예약 생성·변경·취소·체크인 (이용자용)
 * 구글 캘린더가 유일한 기준 일정: 겹침 확인은 항상 캘린더를 실시간 조회합니다.
 */

/* ---------- 이용자 ---------- */

function currentUser() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('학교 구글 계정으로 로그인한 뒤 다시 열어 주세요.');
  var domain = String(loadConfig().domain || '').toLowerCase();
  if (domain && email.split('@')[1] !== domain) throw new Error('학교 계정(@' + domain + ')으로만 이용할 수 있습니다.');
  return email;
}

function isAdmin(email) {
  return Db.rows(SHEETS.ADMIN).some(function (r) { return String(r['이메일']).toLowerCase().trim() === email; });
}

function requireAdmin() {
  var email = currentUser();
  if (!isAdmin(email)) throw new Error('담당자 권한이 없습니다.');
  return email;
}

/* ---------- 스튜디오 ---------- */

function loadStudios(includeInactive) {
  return Db.rows(SHEETS.STUDIO).map(function (r) {
    return {
      code: String(r['코드']), org: r['소속'], location: r['위치'], equipment: r['주요장비'], ext: String(r['내선']),
      active: String(r['사용']).toUpperCase() !== 'N', calendarId: r['캘린더ID'], qrKey: String(r['QR키']),
    };
  }).filter(function (s) { return s.code && (includeInactive || s.active); });
}

function findStudio(code) {
  var s = loadStudios(true).filter(function (x) { return x.code === code; })[0];
  if (!s) throw new Error('스튜디오 정보를 찾을 수 없습니다: ' + code);
  return s;
}

function studioCalendar(studio) {
  var cal = studio.calendarId && CalendarApp.getCalendarById(studio.calendarId);
  if (!cal) throw new Error(studio.code + ' 캘린더가 연결되지 않았습니다. 담당자가 setup()을 실행해 주세요.');
  return cal;
}

function publicStudio(s) {
  return { code: s.code, org: s.org, location: s.location, equipment: s.equipment, ext: s.ext };
}

/* ---------- 예약 레코드 ---------- */

function toBooking(r) {
  return {
    row: r._row, id: String(r['예약번호']), createdAt: r['생성일시'], studioId: String(r['스튜디오']),
    date: String(r['날짜']), startMin: Rules.toMin(r['시작']), endMin: Rules.toMin(r['종료']),
    start: String(r['시작']), end: String(r['종료']),
    email: String(r['이메일']).toLowerCase(), name: r['성명'], org: r['소속'], shootType: r['촬영유형'],
    purpose: r['용도'], support: String(r['촬영지원']) === 'Y', status: String(r['상태']), eventId: r['이벤트ID'],
    checkinAt: r['체크인일시'], handler: r['처리자'], memo: r['처리메모'],
  };
}

function allBookings() { return Db.rows(SHEETS.BOOKING).map(toBooking); }

function findBooking(id) {
  var b = allBookings().filter(function (x) { return x.id === id; })[0];
  if (!b) throw new Error('예약을 찾을 수 없습니다: ' + id);
  return b;
}

function isOccupying(b) { return Rules.OCCUPYING.indexOf(b.status) !== -1; }

function nextBookingId() {
  var props = PropertiesService.getScriptProperties();
  var year = nowKst().date.slice(0, 4);
  var key = 'SEQ_' + year;
  var n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return 'SB-' + year + '-' + ('0000' + n).slice(-5);
}

/** 해당 스튜디오·날짜 점유 구간(캘린더 기준). 종일 일정은 하루 전체 점유(점검·행사 차단용) */
function calendarBusy(studio, date, excludeEventId) {
  var cal = studioCalendar(studio);
  var from = kstDate(date, 0), to = kstDate(Rules.addDays(date, 1), 0);
  return cal.getEvents(from, to).filter(function (ev) {
    return !excludeEventId || ev.getId() !== excludeEventId;
  }).map(function (ev) {
    if (ev.isAllDayEvent()) return { startMin: 0, endMin: 24 * 60, allDay: true, title: ev.getTitle() };
    var s = Math.max(0, Math.round((ev.getStartTime().getTime() - from.getTime()) / 60000));
    var e = Math.min(24 * 60, Math.round((ev.getEndTime().getTime() - from.getTime()) / 60000));
    return { startMin: s, endMin: e, eventId: ev.getId(), pending: ev.getTitle().indexOf('[확인중]') === 0 };
  });
}

function eventTitle(b) {
  var tag = { '확정': '[확정]', '담당자 확인 중': '[확인중]', '체크인': '[체크인]' }[b.status] || '[' + b.status + ']';
  return tag + ' ' + b.name + '(' + b.org + ')' + (b.support ? ' · 촬영지원' : '');
}

function eventDescription(b) {
  return ['예약번호: ' + b.id, '이용자: ' + b.name + ' / ' + b.org, '촬영유형: ' + b.shootType,
    '용도: ' + b.purpose, '촬영 지원: ' + (b.support ? '필요' : '불필요')].join('\n');
}

function createEvent(studio, b) {
  var ev = studioCalendar(studio).createEvent(eventTitle(b), kstDate(b.date, b.startMin), kstDate(b.date, b.endMin),
    { description: eventDescription(b), location: studio.location });
  if (b.status === Rules.STATUS.PENDING) ev.setColor(CalendarApp.EventColor.YELLOW);
  return ev.getId();
}

function deleteEvent(studio, eventId) {
  if (!eventId) return;
  try {
    var ev = studioCalendar(studio).getEventById(eventId);
    if (ev) ev.deleteEvent();
  } catch (e) { console.warn('캘린더 일정 삭제 실패', eventId, e); }
}

function retitleEvent(studio, b) {
  try {
    var ev = b.eventId && studioCalendar(studio).getEventById(b.eventId);
    if (ev) { ev.setTitle(eventTitle(b)); ev.setColor(b.status === Rules.STATUS.PENDING ? CalendarApp.EventColor.YELLOW : ''); }
  } catch (e) { console.warn('캘린더 제목 변경 실패', e); }
}

function activeSanctionUntil(email, today) {
  var until = null;
  Db.rows(SHEETS.SANCTION).forEach(function (r) {
    if (String(r['이메일']).toLowerCase() !== email || r['상태'] !== '적용') return;
    var end = String(r['제재종료']);
    if (end >= today && (!until || end > until)) until = end;
  });
  return until;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('지금 이용자가 많습니다. 잠시 후 다시 시도해 주세요.');
  try { Db.clearCache(); return fn(); } finally { lock.releaseLock(); }
}

/* ---------- 이용자 API (google.script.run) ---------- */

function apiBootstrap() {
  var email = currentUser();
  var cfg = loadConfig();
  var now = nowKst();
  var mine = allBookings().filter(function (b) { return b.email === email; });
  var last = mine[mine.length - 1];
  var horizon = Rules.addDays(now.date, cfg.maxAdvanceDays || 180);
  return {
    email: email,
    name: last ? last.name : '',
    org: last ? last.org : '',
    isAdmin: isAdmin(email),
    studios: loadStudios(false).map(publicStudio),
    config: {
      openMin: cfg.openMin, closeMin: cfg.closeMin, slotMin: cfg.slotMin, dailyMaxMin: cfg.dailyMaxMin,
      supportStartMin: cfg.supportStartMin, supportEndMin: cfg.supportEndMin, maxAdvanceDays: cfg.maxAdvanceDays,
      deadlineMin: cfg.deadlineMin, noShowGraceMin: cfg.noShowGraceMin, checkinEarlyMin: cfg.checkinEarlyMin,
      sanctionThreshold: cfg.sanctionThreshold, sanctionDays: cfg.sanctionDays,
    },
    shootTypes: cfg.shootTypes,
    purposes: cfg.purposes,
    contact: cfg.contact,
    now: now,
    sanctionUntil: activeSanctionUntil(email, now.date),
    holidays: loadHolidays(now.date, horizon),
  };
}

/** 선택한 스튜디오·날짜의 빈 시간 조회 (다른 사람 이름은 내보내지 않음) */
function apiAvailability(studioCode, date, replaceId) {
  var email = currentUser();
  var studio = findStudio(studioCode);
  var replace = replaceId ? findBooking(replaceId) : null;
  var exclude = replace && replace.email === email && replace.studioId === studioCode ? replace.eventId : null;
  var busy = calendarBusy(studio, date, exclude).map(function (x) {
    return { startMin: x.startMin, endMin: x.endMin, pending: !!x.pending, allDay: !!x.allDay };
  });
  var mine = allBookings().filter(function (b) {
    return b.email === email && b.date === date && isOccupying(b) && (!replace || b.id !== replace.id);
  });
  return {
    busy: busy,
    myBusy: mine.map(function (b) { return { startMin: b.startMin, endMin: b.endMin, studioId: b.studioId }; }),
    myUsedMin: mine.reduce(function (a, b) { return a + b.endMin - b.startMin; }, 0),
  };
}

/**
 * 예약 생성. replaceId가 있으면 기존 예약을 새 내용으로 변경(새 예약 등록 후 기존 취소)
 * form: {studioId,date,startMin,endMin,support,name,org,shootType,purpose,agreedPrivacy,agreedRules,replaceId}
 */
function apiCreateBooking(form) {
  var email = currentUser();
  var cfg = loadConfig();
  var result = withLock(function () {
    var now = nowKst();
    var studio = findStudio(form.studioId);
    if (!studio.active) throw new Error('현재 예약을 받지 않는 스튜디오입니다.');
    var name = String(form.name || '').trim(), org = String(form.org || '').trim();
    if (!name || !org) throw new Error('성명과 소속을 입력해 주세요.');
    if (cfg.shootTypes.indexOf(form.shootType) === -1) throw new Error('촬영 유형을 선택해 주세요.');
    if (cfg.purposes.indexOf(form.purpose) === -1) throw new Error('용도를 선택해 주세요.');

    var old = null;
    if (form.replaceId) {
      old = findBooking(form.replaceId);
      if (old.email !== email) throw new Error('본인 예약만 변경할 수 있습니다.');
      if (!isOccupying(old) || old.status === Rules.STATUS.CHECKED_IN) throw new Error('변경할 수 없는 예약입니다.');
      if (!Rules.canUserModify(old, now, cfg)) throw new Error('이용 전날 ' + Rules.fmtMin(cfg.deadlineMin) + ' 이후에는 담당자에게 변경을 요청해 주세요.');
    }

    var req = {
      studioId: studio.code, date: form.date, startMin: Number(form.startMin), endMin: Number(form.endMin),
      support: !!form.support, agreedPrivacy: !!form.agreedPrivacy, agreedRules: !!form.agreedRules,
    };
    var excludeEvent = old && old.studioId === studio.code ? old.eventId : null;
    var check = Rules.validateRequest(req, {
      now: now, config: cfg,
      holidays: req.support ? loadHolidays(req.date, req.date) : [],
      busy: /^\d{4}-\d{2}-\d{2}$/.test(String(req.date)) ? calendarBusy(studio, req.date, excludeEvent) : [],
      sameDayBookings: allBookings().filter(function (b) {
        return b.email === email && b.date === req.date && isOccupying(b) && (!old || b.id !== old.id);
      }),
      sanctionUntil: activeSanctionUntil(email, now.date),
    });
    if (!check.ok) throw new Error(check.errors.join('\n'));

    var b = {
      id: nextBookingId(), studioId: studio.code, date: req.date, startMin: req.startMin, endMin: req.endMin,
      email: email, name: name, org: org, shootType: form.shootType, purpose: form.purpose, support: req.support,
      status: req.support ? Rules.STATUS.PENDING : Rules.STATUS.CONFIRMED,
    };
    b.eventId = createEvent(studio, b);
    var ret = Rules.retentionDates(b.date, loadSemesters(), cfg);
    Db.append(SHEETS.BOOKING, {
      '예약번호': b.id, '생성일시': now.stamp, '스튜디오': b.studioId, '날짜': b.date,
      '시작': Rules.fmtMin(b.startMin), '종료': Rules.fmtMin(b.endMin), '이메일': email, '성명': name, '소속': org,
      '촬영유형': b.shootType, '용도': b.purpose, '촬영지원': b.support ? 'Y' : '', '동의일시': now.stamp,
      '상태': b.status, '이벤트ID': b.eventId, '처리메모': old ? old.id + '에서 변경' : '', '삭제예정일': ret.personal,
    });
    if (old) {
      deleteEvent(findStudio(old.studioId), old.eventId);
      Db.update(SHEETS.BOOKING, old.row, { '상태': Rules.STATUS.CANCELLED, '처리메모': b.id + '(으)로 변경', '수정일시': now.stamp, '처리자': email });
    }
    return { booking: b, studio: studio, replaced: old };
  });

  try {
    var b = result.booking;
    if (b.status === Rules.STATUS.PENDING) {
      Mail.pending(b, result.studio, cfg);
      Mail.staffSupportRequest(b, result.studio, cfg);
    } else {
      Mail.confirmed(b, result.studio, cfg, result.replaced ? '기존 예약(' + result.replaced.id + ')이 이 내용으로 변경되었습니다.' : '');
    }
  } catch (e) { console.error('메일 발송 실패', e); }
  return summarize(result.booking, result.studio, loadConfig());
}

function summarize(b, studio, cfg) {
  return {
    id: b.id, studioId: b.studioId, location: studio ? studio.location : '', org: studio ? studio.org : '',
    ext: studio ? studio.ext : '', date: b.date, dateLabel: koDate(b.date),
    start: Rules.fmtMin(b.startMin), end: Rules.fmtMin(b.endMin), startMin: b.startMin, endMin: b.endMin,
    status: b.status, support: b.support, shootType: b.shootType, purpose: b.purpose, name: b.name, orgName: b.org,
    canModify: (b.status === Rules.STATUS.CONFIRMED || b.status === Rules.STATUS.PENDING) && Rules.canUserModify(b, nowKst(), cfg),
    checkinAt: b.checkinAt || '', memo: b.memo || '',
  };
}

function apiMyBookings() {
  var email = currentUser();
  var cfg = loadConfig();
  var today = nowKst().date;
  var studios = {};
  loadStudios(true).forEach(function (s) { studios[s.code] = s; });
  var mine = allBookings().filter(function (b) { return b.email === email; });
  mine.sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? -1 : 1; });
  var upcoming = mine.filter(function (b) { return b.date >= today && isOccupying(b); });
  var past = mine.filter(function (b) { return upcoming.indexOf(b) === -1; }).reverse().slice(0, 20);
  return {
    upcoming: upcoming.map(function (b) { return summarize(b, studios[b.studioId], cfg); }),
    past: past.map(function (b) { return summarize(b, studios[b.studioId], cfg); }),
    sanctionUntil: activeSanctionUntil(email, today),
    deadline: Rules.fmtMin(cfg.deadlineMin),
    contact: cfg.contact,
  };
}

function apiCancelBooking(id) {
  var email = currentUser();
  var cfg = loadConfig();
  var res = withLock(function () {
    var b = findBooking(id);
    if (b.email !== email) throw new Error('본인 예약만 취소할 수 있습니다.');
    if (b.status !== Rules.STATUS.CONFIRMED && b.status !== Rules.STATUS.PENDING) throw new Error('취소할 수 없는 예약입니다. (현재: ' + b.status + ')');
    var now = nowKst();
    if (!Rules.canUserModify(b, now, cfg)) {
      throw new Error('이용 전날 ' + Rules.fmtMin(cfg.deadlineMin) + ' 이후에는 직접 취소할 수 없습니다.\n담당자에게 연락해 주세요. (마감 후 취소는 노쇼로 처리됩니다)');
    }
    var studio = findStudio(b.studioId);
    deleteEvent(studio, b.eventId);
    Db.update(SHEETS.BOOKING, b.row, { '상태': Rules.STATUS.CANCELLED, '수정일시': now.stamp, '처리자': email, '처리메모': '본인 취소' });
    b.status = Rules.STATUS.CANCELLED;
    return { b: b, studio: studio };
  });
  try { Mail.cancelled(res.b, res.studio, cfg, '본인 요청으로 취소되었습니다.'); } catch (e) { console.error(e); }
  return { ok: true };
}

/* ---------- QR 체크인 ---------- */

function findCheckinTarget(email, studio, now, cfg) {
  var todays = allBookings().filter(function (b) {
    return b.email === email && b.studioId === studio.code && b.date === now.date && isOccupying(b);
  }).sort(function (a, b) { return a.startMin - b.startMin; });
  for (var i = 0; i < todays.length; i++) {
    if (Rules.canCheckin(todays[i], now, cfg).ok) return { booking: todays[i] };
  }
  if (!todays.length) return { reason: '오늘 이 스튜디오에 예약이 없습니다. 예약한 스튜디오가 맞는지 확인해 주세요.' };
  var b = todays.filter(function (x) { return x.status !== Rules.STATUS.CHECKED_IN; })[0] || todays[0];
  return { booking: b, reason: Rules.canCheckin(b, now, cfg).reason };
}

function apiCheckinPreview(studioCode, key) {
  var email = currentUser();
  var cfg = loadConfig();
  var studio = findStudio(studioCode);
  if (!key || key !== studio.qrKey) throw new Error('QR 코드가 올바르지 않습니다. 스튜디오에 부착된 QR을 다시 찍어 주세요.');
  var t = findCheckinTarget(email, studio, nowKst(), cfg);
  return {
    studio: publicStudio(studio), email: email,
    booking: t.booking ? summarize(t.booking, studio, cfg) : null,
    canCheckin: !t.reason, reason: t.reason || '',
  };
}

function apiCheckin(studioCode, key) {
  var email = currentUser();
  var cfg = loadConfig();
  return withLock(function () {
    var studio = findStudio(studioCode);
    if (!key || key !== studio.qrKey) throw new Error('QR 코드가 올바르지 않습니다.');
    var now = nowKst();
    var t = findCheckinTarget(email, studio, now, cfg);
    if (t.reason) throw new Error(t.reason);
    var b = t.booking;
    Db.update(SHEETS.BOOKING, b.row, { '상태': Rules.STATUS.CHECKED_IN, '체크인일시': now.stamp, '수정일시': now.stamp });
    b.status = Rules.STATUS.CHECKED_IN;
    b.checkinAt = now.stamp;
    retitleEvent(studio, b);
    return summarize(b, studio, cfg);
  });
}
