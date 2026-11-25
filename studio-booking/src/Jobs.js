/**
 * 시간 트리거 작업 (setup()이 자동 설치)
 *  - jobNoShows      : 10분마다 — 미체크인 노쇼 판정·제재, 미확정 지원요청 자동 취소
 *  - jobReminders    : 매일 15시 — 내일 예약 리마인더
 *  - jobStats        : 매일 02시 — '통계'·'이용자구분통계' 탭 갱신(이번 달·지난달)
 *  - jobRetention    : 매월 1일 03시 — 보관기간 지난 개인정보·예약 기록 삭제
 */

/** 노쇼 기록 + 제재 판정 (잠금 안에서 호출) */
function recordNoShow(b, studio, now, handler, memo) {
  var cfg = loadConfig();
  Db.update(SHEETS.BOOKING, b.row, { '상태': Rules.STATUS.NO_SHOW, '수정일시': now.stamp, '처리자': handler, '처리메모': memo });
  b.status = Rules.STATUS.NO_SHOW;
  var semesters = loadSemesters();
  var mine = allBookings().filter(function (x) { return x.email === b.email; });
  var sanction = Rules.sanctionAfterNoShow(mine, b.date, semesters, cfg);
  var sem = Rules.semesterOf(b.date, semesters);
  var count = sanction ? sanction.count : mine.filter(function (x) {
    return x.status === Rules.STATUS.NO_SHOW && (!sem || (x.date >= sem.start && x.date <= sem.end));
  }).length;
  if (sanction) {
    // 제재 시작은 판정일(오늘) 기준으로 계산
    sanction = { from: now.date, until: Rules.addDays(now.date, cfg.sanctionDays), count: count };
    Db.append(SHEETS.SANCTION, {
      '이메일': b.email, '학기': sem ? sem.name : '', '노쇼횟수': count, '제재시작': sanction.from, '제재종료': sanction.until,
      '근거예약번호': b.id, '상태': '적용', '처리메모': '', '기록일시': now.stamp,
    });
  }
  return { b: b, studio: studio, count: count, sanction: sanction };
}

function jobNoShows() {
  var cfg = loadConfig();
  var mails = [];
  withLock(function () {
    var now = nowKst();
    var studios = {};
    loadStudios(true).forEach(function (s) { studios[s.code] = s; });
    allBookings().forEach(function (b) {
      var studio = studios[b.studioId];
      if (!studio || b.date > now.date) return;
      if (Rules.isNoShowDue(b, now, cfg)) {
        deleteEvent(studio, b.eventId); // 남은 시간을 다른 이용자에게 개방
        mails.push({ type: 'noshow', r: recordNoShow(b, studio, now, 'system', '체크인 기록 없음') });
      } else if (b.status === Rules.STATUS.PENDING && (b.date < now.date || now.min >= b.startMin)) {
        deleteEvent(studio, b.eventId);
        Db.update(SHEETS.BOOKING, b.row, { '상태': Rules.STATUS.CANCELLED, '수정일시': now.stamp, '처리자': 'system', '처리메모': '담당자 미확정 자동 취소' });
        mails.push({ type: 'cancel', b: b, studio: studio });
      }
    });
  });
  mails.forEach(function (m) {
    try {
      if (m.type === 'noshow') Mail.noShow(m.r.b, m.r.studio, cfg, m.r.count, m.r.sanction);
      else Mail.cancelled(m.b, m.studio, cfg, '시작 시각까지 촬영 지원 일정이 확정되지 않아 자동 취소되었습니다. 담당자에게 문의해 주세요.');
    } catch (e) { console.error('메일 실패', e); }
  });
}

function jobReminders() {
  var cfg = loadConfig();
  if (String(cfg.reminder).toUpperCase() !== 'Y') return;
  var tomorrow = Rules.addDays(nowKst().date, 1);
  var studios = {};
  loadStudios(true).forEach(function (s) { studios[s.code] = s; });
  allBookings().forEach(function (b) {
    if (b.date !== tomorrow || !isOccupying(b) || !studios[b.studioId]) return;
    try { Mail.reminder(b, studios[b.studioId], cfg); } catch (e) { console.error(e); }
  });
}

function jobStats() {
  var cfg = loadConfig();
  var now = nowKst();
  var ym = now.date.slice(0, 7);
  var prevYm = Rules.addDays(ym + '-01', -1).slice(0, 7);
  var studios = loadStudios(true);
  var all = allBookings();
  var months = [prevYm, ym];
  withLock(function () {
    var sh = Db.sheet(SHEETS.STATS);
    var drop = Db.rows(SHEETS.STATS).filter(function (r) { return months.indexOf(String(r['월'])) !== -1; }).map(function (r) { return r._row; });
    Db.removeRows(SHEETS.STATS, drop);
    var h = function (m) { return Math.round(m / 6) / 10; };
    var pct = function (x) { return Math.round(x * 1000) / 10 + '%'; };
    var out = [];
    months.forEach(function (m) {
      Rules.monthlyStats(all, studios, m, cfg).forEach(function (r) {
        out.push([r.month, r.studio, h(r.availableMin), h(r.reservedMin), h(r.usedMin), pct(r.utilization), pct(r.reservationRate),
          r.bookings, r.supportRequests, pct(r.supportRatio), r.noShows, pct(r.noShowRate), now.stamp]);
      });
    });
    if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);

    // 이용자 구분별 (교수·강사·직원·조교 등)
    var ts = Db.sheet(SHEETS.TYPE_STATS);
    Db.removeRows(SHEETS.TYPE_STATS, Db.rows(SHEETS.TYPE_STATS).filter(function (r) {
      return months.indexOf(String(r['월'])) !== -1;
    }).map(function (r) { return r._row; }));
    var tout = [];
    months.forEach(function (m) {
      Rules.userTypeStats(all, m, cfg.userTypes).forEach(function (r) {
        tout.push([r.month, r.userType, r.bookings, h(r.reservedMin), r.proxy, r.noShows, now.stamp]);
      });
    });
    if (tout.length) ts.getRange(ts.getLastRow() + 1, 1, tout.length, tout[0].length).setValues(tout);
  });
}

/**
 * 보관기간 처리 (기능정의서 2장)
 * - 예약: 삭제예정일(해당 학기 종료일 + 2년) 경과 → 행 삭제
 * - 노쇼제재: 제재종료 + 2년 경과 → 행 삭제
 * - '삭제대장'에는 날짜·구분·번호·건수만 기록(개인정보 없음)
 * - '통계' 탭은 개인정보가 없어 이력으로 계속 보관
 */
function jobRetention() {
  withLock(function () {
    var now = nowKst();
    var oldBookings = Db.rows(SHEETS.BOOKING).filter(function (r) { return r['삭제예정일'] && String(r['삭제예정일']) <= now.date; });
    if (oldBookings.length) {
      var ids = oldBookings.map(function (r) { return r['예약번호']; });
      Db.removeRows(SHEETS.BOOKING, oldBookings.map(function (r) { return r._row; }));
      Db.append(SHEETS.PURGE, { '삭제일': now.date, '구분': '예약 기록(2년 경과)', '대상 번호': ids.join(', '), '건수': ids.length });
    }
    var oldSanctions = Db.rows(SHEETS.SANCTION).filter(function (r) {
      return r['제재종료'] && Rules.addYears(String(r['제재종료']), 2) <= now.date;
    });
    if (oldSanctions.length) {
      Db.removeRows(SHEETS.SANCTION, oldSanctions.map(function (r) { return r._row; }));
      Db.append(SHEETS.PURGE, { '삭제일': now.date, '구분': '노쇼·제재 기록(2년 경과)',
        '대상 번호': oldSanctions.map(function (r) { return r['근거예약번호']; }).join(', '), '건수': oldSanctions.length });
    }
  });
}
