/**
 * 담당자 화면 API — '관리자' 탭에 등록된 이메일만 호출할 수 있습니다.
 */

function adminView(b, studios, selected, cfg) {
  var s = summarize(b, studios[b.studioId], cfg);
  s.email = b.email;
  s.selected = !!selected[b.email] || (!!b.onBehalf && !!selected[b.onBehalf]);
  s.createdAt = b.createdAt;
  s.handler = b.handler || '';
  return s;
}

function apiAdminData() {
  requireAdmin();
  var cfg = loadConfig();
  var now = nowKst();
  var studios = {};
  var studioList = loadStudios(true);
  studioList.forEach(function (s) { studios[s.code] = s; });
  var selected = selectedProfessors();

  var all = allBookings();
  var sem = Rules.semesterOf(now.date, loadSemesters());
  var horizon = Rules.addDays(now.date, 14);
  var byTime = function (a, b) { return (a.date + a.start) < (b.date + b.start) ? -1 : 1; };
  var view = function (b) { return adminView(b, studios, selected, cfg); };

  var sanctions = Db.rows(SHEETS.SANCTION).filter(function (r) {
    return r['상태'] === '적용' && String(r['제재종료']) >= now.date;
  }).map(function (r) {
    return { email: r['이메일'], from: r['제재시작'], until: r['제재종료'], count: r['노쇼횟수'], bookingId: r['근거예약번호'] };
  });

  var ym = now.date.slice(0, 7);
  var prevYm = Rules.addDays(ym + '-01', -1).slice(0, 7);
  var webUrl = webAppUrl();

  return {
    now: now,
    semester: sem ? sem.name : '(학기 미등록)',
    pending: all.filter(function (b) { return b.status === Rules.STATUS.PENDING; }).sort(byTime).map(view),
    upcoming: all.filter(function (b) {
      return b.date >= now.date && b.date <= horizon && isOccupying(b);
    }).sort(byTime).map(view),
    noShows: all.filter(function (b) {
      return b.status === Rules.STATUS.NO_SHOW && (!sem || (b.date >= sem.start && b.date <= sem.end));
    }).sort(byTime).reverse().map(view),
    sanctions: sanctions,
    stats: Rules.monthlyStats(all, studioList, ym, cfg).concat(Rules.monthlyStats(all, studioList, prevYm, cfg)),
    typeStats: Rules.userTypeStats(all, ym, cfg.userTypes).concat(Rules.userTypeStats(all, prevYm, cfg.userTypes)),
    studios: studioList.map(function (s) {
      var p = publicStudio(s);
      p.active = s.active;
      p.checkinUrl = webUrl ? webUrl + '?p=checkin&st=' + encodeURIComponent(s.code) + '&k=' + encodeURIComponent(s.qrKey) : '';
      return p;
    }),
    config: { openMin: cfg.openMin, closeMin: cfg.closeMin, slotMin: cfg.slotMin },
    spreadsheetUrl: Db.ss().getUrl(),
  };
}

/** 담당자 일정 변경 공통: change = {studioId,date,startMin,endMin} */
function moveBooking(b, change, now) {
  var cfg = loadConfig();
  var studio = findStudio(change.studioId || b.studioId);
  var nb = {};
  for (var k in b) nb[k] = b[k];
  nb.studioId = studio.code;
  nb.date = change.date || b.date;
  nb.startMin = change.startMin !== undefined && change.startMin !== '' ? Number(change.startMin) : b.startMin;
  nb.endMin = change.endMin !== undefined && change.endMin !== '' ? Number(change.endMin) : b.endMin;
  if (nb.startMin % cfg.slotMin || nb.endMin % cfg.slotMin || nb.endMin <= nb.startMin ||
      nb.startMin < cfg.openMin || nb.endMin > cfg.closeMin) {
    throw new Error('운영시간(' + Rules.fmtMin(cfg.openMin) + '~' + Rules.fmtMin(cfg.closeMin) + ') 안의 ' + cfg.slotMin + '분 단위로 지정해 주세요.');
  }
  var exclude = studio.code === b.studioId ? b.eventId : null;
  var clash = calendarBusy(studio, nb.date, exclude).some(function (x) { return Rules.overlaps(x, nb); });
  if (clash) throw new Error('변경하려는 시간에 이미 다른 일정이 있습니다.');
  deleteEvent(findStudio(b.studioId), b.eventId);
  nb.eventId = createEvent(studio, nb);
  return { booking: nb, studio: studio, changed: nb.studioId !== b.studioId || nb.date !== b.date || nb.startMin !== b.startMin || nb.endMin !== b.endMin };
}

function bookingPatch(nb, now, admin, memo) {
  return {
    '스튜디오': nb.studioId, '날짜': nb.date, '시작': Rules.fmtMin(nb.startMin), '종료': Rules.fmtMin(nb.endMin),
    '상태': nb.status, '이벤트ID': nb.eventId, '수정일시': now.stamp, '처리자': admin,
    '처리메모': memo || '',
  };
}

/** 촬영 지원 요청 확정(필요하면 시간·스튜디오 변경 후 확정) */
function apiAdminConfirm(id, change) {
  var admin = requireAdmin();
  var cfg = loadConfig();
  var res = withLock(function () {
    var b = findBooking(id);
    if (b.status !== Rules.STATUS.PENDING) throw new Error('담당자 확인 중인 예약만 확정할 수 있습니다.');
    var now = nowKst();
    b.status = Rules.STATUS.CONFIRMED;
    var moved = moveBooking(b, change || {}, now);
    Db.update(SHEETS.BOOKING, b.row, bookingPatch(moved.booking, now, admin, (change && change.memo) || '촬영 지원 확정'));
    return moved;
  });
  try { Mail.adminResult(res.booking, res.studio, cfg, res.changed); } catch (e) { console.error(e); }
  return { ok: true };
}

/** 확정된 예약의 시간 변경(마감 이후 변경 포함) */
function apiAdminModify(id, change) {
  var admin = requireAdmin();
  var cfg = loadConfig();
  var res = withLock(function () {
    var b = findBooking(id);
    if (!isOccupying(b)) throw new Error('진행 중인 예약만 변경할 수 있습니다.');
    var now = nowKst();
    var moved = moveBooking(b, change || {}, now);
    Db.update(SHEETS.BOOKING, b.row, bookingPatch(moved.booking, now, admin, change && change.memo));
    return moved;
  });
  try { Mail.adminModified(res.booking, res.studio, cfg, change && change.memo); } catch (e) { console.error(e); }
  return { ok: true };
}

function apiAdminReject(id, reason) {
  var admin = requireAdmin();
  if (!String(reason || '').trim()) throw new Error('반려 사유를 입력해 주세요. (메일에 포함됩니다)');
  var cfg = loadConfig();
  var res = withLock(function () {
    var b = findBooking(id);
    if (b.status !== Rules.STATUS.PENDING) throw new Error('담당자 확인 중인 예약만 반려할 수 있습니다.');
    var studio = findStudio(b.studioId);
    deleteEvent(studio, b.eventId);
    Db.update(SHEETS.BOOKING, b.row, { '상태': Rules.STATUS.REJECTED, '수정일시': nowKst().stamp, '처리자': admin, '처리메모': reason });
    return { b: b, studio: studio };
  });
  try { Mail.rejected(res.b, res.studio, cfg, reason); } catch (e) { console.error(e); }
  return { ok: true };
}

/**
 * 담당자 취소. mode = 'noshow'(마감 후 취소 → 노쇼) | 'excused'(사전 연락 등 예외 → 단순 취소)
 */
function apiAdminCancel(id, mode, memo) {
  var admin = requireAdmin();
  var cfg = loadConfig();
  var res = withLock(function () {
    var b = findBooking(id);
    if (!isOccupying(b)) throw new Error('진행 중인 예약만 취소할 수 있습니다.');
    var studio = findStudio(b.studioId);
    deleteEvent(studio, b.eventId);
    var now = nowKst();
    if (mode === 'noshow') {
      return { kind: 'noshow', r: recordNoShow(b, studio, now, admin, memo || '마감 후 취소(노쇼)') };
    }
    Db.update(SHEETS.BOOKING, b.row, { '상태': Rules.STATUS.CANCELLED, '수정일시': now.stamp, '처리자': admin, '처리메모': memo || '담당자 취소(예외)' });
    b.status = Rules.STATUS.CANCELLED;
    return { kind: 'cancel', b: b, studio: studio };
  });
  try {
    if (res.kind === 'noshow') Mail.noShow(res.r.b, res.r.studio, cfg, res.r.count, res.r.sanction);
    else Mail.cancelled(res.b, res.studio, cfg, '담당자가 취소했습니다.' + (memo ? ' (' + memo + ')' : ''));
  } catch (e) { console.error(e); }
  return { ok: true };
}

/** 노쇼 해제(사전 연락 확인 등). 이 노쇼로 걸린 제재가 있으면 함께 해제 */
function apiAdminExcuse(id, memo) {
  var admin = requireAdmin();
  var cfg = loadConfig();
  var lifted = withLock(function () {
    var b = findBooking(id);
    if (b.status !== Rules.STATUS.NO_SHOW) throw new Error('노쇼 상태인 예약만 해제할 수 있습니다.');
    var now = nowKst();
    Db.update(SHEETS.BOOKING, b.row, { '상태': Rules.STATUS.EXCUSED, '수정일시': now.stamp, '처리자': admin, '처리메모': memo || '노쇼 해제' });
    var any = false;
    Db.rows(SHEETS.SANCTION).forEach(function (r) {
      if (r['상태'] === '적용' && String(r['근거예약번호']) === b.id) {
        Db.update(SHEETS.SANCTION, r._row, { '상태': '해제', '처리메모': '노쇼 해제로 함께 해제 (' + admin + ')' });
        any = true;
      }
    });
    return any ? b.email : null;
  });
  if (lifted) try { Mail.sanctionLifted(lifted, cfg); } catch (e) { console.error(e); }
  return { ok: true, liftedSanction: !!lifted };
}

function apiAdminLiftSanction(email, memo) {
  var admin = requireAdmin();
  var cfg = loadConfig();
  email = String(email).toLowerCase();
  withLock(function () {
    Db.rows(SHEETS.SANCTION).forEach(function (r) {
      if (String(r['이메일']).toLowerCase() === email && r['상태'] === '적용') {
        Db.update(SHEETS.SANCTION, r._row, { '상태': '해제', '처리메모': (memo || '담당자 해제') + ' (' + admin + ')' });
      }
    });
  });
  try { Mail.sanctionLifted(email, cfg); } catch (e) { console.error(e); }
  return { ok: true };
}

/** 담당자가 특정 스튜디오·날짜 빈 시간을 볼 때 사용(이름 포함) */
function apiAdminDay(studioCode, date) {
  requireAdmin();
  return calendarBusy(findStudio(studioCode), date, null);
}
