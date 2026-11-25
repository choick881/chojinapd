// 예약 규칙 단위 테스트 — 실행: npm test  (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/Rules.js');

const C = R.DEFAULTS;
const at = (date, hhmm) => ({ date, min: R.toMin(hhmm) });
const req = (o) => Object.assign({
  studioId: 'ST01', date: '2026-12-02', startMin: R.toMin('10:00'), endMin: R.toMin('11:00'),
  support: false, agreedPrivacy: true, agreedRules: true,
}, o);
const ctx = (o) => Object.assign({
  now: at('2026-11-30', '12:00'), config: C, holidays: [], busy: [], sameDayBookings: [], sanctionUntil: null,
}, o);
const errs = (r, c) => R.validateRequest(r, c).errors;

test('시간 변환', () => {
  assert.equal(R.toMin('09:30'), 570);
  assert.equal(R.fmtMin(570), '09:30');
  assert.equal(R.fmtMin(1320), '22:00');
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(R.weekday('2026-11-28'), 6); // 토요일
  assert.equal(R.daysInMonth('2028-02'), 29);
});

test('정상 예약은 통과', () => {
  const r = R.validateRequest(req(), ctx());
  assert.equal(r.ok, true, r.errors.join());
});

test('30분 단위·운영시간 09:00~22:00', () => {
  assert.ok(errs(req({ startMin: R.toMin('10:15') }), ctx()).length);
  assert.ok(errs(req({ startMin: R.toMin('08:30'), endMin: R.toMin('09:30') }), ctx()).length);
  assert.ok(errs(req({ startMin: R.toMin('21:30'), endMin: R.toMin('22:30') }), ctx()).length);
  assert.equal(errs(req({ startMin: R.toMin('21:30'), endMin: R.toMin('22:00') }), ctx()).length, 0);
  assert.ok(errs(req({ startMin: R.toMin('11:00'), endMin: R.toMin('11:00') }), ctx()).length);
});

test('지난 시간은 예약 불가, 당일 이후 시간은 가능', () => {
  assert.ok(errs(req({ date: '2026-11-29' }), ctx()).length);
  assert.ok(errs(req({ date: '2026-11-30', startMin: R.toMin('11:30'), endMin: R.toMin('13:00') }), ctx()).length);
  assert.equal(errs(req({ date: '2026-11-30', startMin: R.toMin('13:00'), endMin: R.toMin('14:00') }), ctx()).length, 0);
});

test('1인 1일 합계 8시간', () => {
  const same = [{ startMin: R.toMin('09:00'), endMin: R.toMin('16:00') }]; // 7시간
  assert.equal(errs(req({ startMin: R.toMin('16:00'), endMin: R.toMin('17:00') }), ctx({ sameDayBookings: same })).length, 0);
  assert.ok(errs(req({ startMin: R.toMin('16:00'), endMin: R.toMin('17:30') }), ctx({ sameDayBookings: same })).length);
  assert.ok(errs(req({ startMin: R.toMin('09:00'), endMin: R.toMin('17:30') }), ctx()).length);
});

test('같은 시간대에 본인 다른 예약이 있으면 불가', () => {
  const same = [{ startMin: R.toMin('10:30'), endMin: R.toMin('11:30') }];
  assert.ok(errs(req(), ctx({ sameDayBookings: same })).length);
});

test('스튜디오 시간 겹침 차단(끝과 시작이 맞닿는 건 허용)', () => {
  const busy = [{ startMin: R.toMin('10:30'), endMin: R.toMin('12:00') }];
  assert.ok(errs(req(), ctx({ busy })).length);
  const touch = [{ startMin: R.toMin('11:00'), endMin: R.toMin('12:00') }];
  assert.equal(errs(req(), ctx({ busy: touch })).length, 0);
});

test('필수 동의 2개', () => {
  assert.ok(errs(req({ agreedRules: false }), ctx()).length);
  assert.ok(errs(req({ agreedPrivacy: false }), ctx()).length);
});

test('촬영 지원: 평일 08:30~17:30, 공휴일 제외', () => {
  assert.equal(errs(req({ support: true, startMin: R.toMin('10:00'), endMin: R.toMin('17:30') }), ctx()).length, 0);
  assert.ok(errs(req({ support: true, startMin: R.toMin('17:00'), endMin: R.toMin('18:00') }), ctx()).length);
  assert.ok(errs(req({ support: true, date: '2026-12-05' }), ctx()).length); // 토요일
  assert.ok(errs(req({ support: true, date: '2026-12-25' }), ctx({ holidays: ['2026-12-25'] })).length);
  // 지원 불필요면 주말·야간도 가능
  assert.equal(errs(req({ date: '2026-12-05', startMin: R.toMin('20:00'), endMin: R.toMin('22:00') }), ctx()).length, 0);
});

test('노쇼 제재 중에는 예약 불가', () => {
  assert.ok(errs(req(), ctx({ sanctionUntil: '2026-12-10' })).length);
  assert.equal(errs(req(), ctx({ sanctionUntil: '2026-11-29' })).length, 0);
});

test('최대 예약 가능 일수(설정 시에만)', () => {
  const cfg = Object.assign({}, C, { maxAdvanceDays: 7 });
  assert.equal(errs(req({ date: '2026-12-07' }), ctx({ config: cfg })).length, 0);
  assert.ok(errs(req({ date: '2026-12-08' }), ctx({ config: cfg })).length);
  assert.equal(errs(req({ date: '2027-06-30' }), ctx()).length, 0); // 기본값: 제한 없음
});

test('본인 취소·수정은 이용 전날 18:00까지', () => {
  const b = { date: '2026-12-02', startMin: R.toMin('10:00'), endMin: R.toMin('11:00') };
  assert.equal(R.canUserModify(b, at('2026-12-01', '17:59'), C), true);
  assert.equal(R.canUserModify(b, at('2026-12-01', '18:00'), C), true);
  assert.equal(R.canUserModify(b, at('2026-12-01', '18:01'), C), false);
  assert.equal(R.canUserModify(b, at('2026-12-02', '08:00'), C), false);
  assert.equal(R.canUserModify(b, at('2026-11-20', '23:00'), C), true);
});

test('노쇼 판정 시각 = min(시작+60분, 종료)', () => {
  assert.equal(R.noShowDeadlineMin({ startMin: 600, endMin: 720 }, C), 660);
  assert.equal(R.noShowDeadlineMin({ startMin: 600, endMin: 630 }, C), 630);
  const b = { date: '2026-12-02', startMin: 600, endMin: 720, status: R.STATUS.CONFIRMED };
  assert.equal(R.isNoShowDue(b, at('2026-12-02', '10:59'), C), false);
  assert.equal(R.isNoShowDue(b, at('2026-12-02', '11:00'), C), true);
  assert.equal(R.isNoShowDue(b, at('2026-12-03', '00:10'), C), true);
  assert.equal(R.isNoShowDue(Object.assign({}, b, { status: R.STATUS.CHECKED_IN }), at('2026-12-03', '00:10'), C), false);
});

test('QR 체크인 가능 시간: 시작 10분 전 ~ 노쇼 판정 전', () => {
  const b = { date: '2026-12-02', startMin: 600, endMin: 720, status: R.STATUS.CONFIRMED };
  assert.equal(R.canCheckin(b, at('2026-12-02', '09:49'), C).ok, false);
  assert.equal(R.canCheckin(b, at('2026-12-02', '09:50'), C).ok, true);
  assert.equal(R.canCheckin(b, at('2026-12-02', '10:59'), C).ok, true);
  assert.equal(R.canCheckin(b, at('2026-12-02', '11:00'), C).ok, false);
  assert.equal(R.canCheckin(Object.assign({}, b, { status: R.STATUS.PENDING }), at('2026-12-02', '10:00'), C).ok, false);
});

const SEM = [
  { name: '2026-2학기', start: '2026-09-01', end: '2027-02-28' },
  { name: '2027-1학기', start: '2027-03-01', end: '2027-08-31' },
];

test('학기 찾기', () => {
  assert.equal(R.semesterOf('2026-12-02', SEM).name, '2026-2학기');
  assert.equal(R.semesterOf('2027-03-01', SEM).name, '2027-1학기');
  assert.equal(R.semesterOf('2025-01-01', SEM), null);
});

test('학기 2회 노쇼 → 30일 예약 제한', () => {
  const ns = (date) => ({ date, status: R.STATUS.NO_SHOW });
  const list1 = [ns('2026-12-01')];
  assert.equal(R.sanctionAfterNoShow(list1, '2026-12-01', SEM, C), null);
  const list2 = [ns('2026-12-01'), ns('2026-12-09'), { date: '2026-12-03', status: R.STATUS.NO_SHOW + 'x' }];
  assert.deepEqual(R.sanctionAfterNoShow(list2, '2026-12-09', SEM, C), { from: '2026-12-09', until: '2027-01-08', count: 2 });
  // 학기가 바뀌면 다시 0부터
  const list3 = [ns('2027-02-20'), ns('2027-03-05')];
  assert.equal(R.sanctionAfterNoShow(list3, '2027-03-05', SEM, C), null);
});

test('보관기간: 학기 종료일 + 2년 / +10년', () => {
  assert.deepEqual(R.retentionDates('2026-12-02', SEM), { personal: '2029-02-28', history: '2037-02-28' });
  // 학기 미등록이면 해당 연도 말 기준
  assert.deepEqual(R.retentionDates('2025-05-01', SEM), { personal: '2027-12-31', history: '2035-12-31' });
});

test('월별 통계: 이용률·지원요청 비율·노쇼율', () => {
  const S = R.STATUS;
  const bk = (id, studioId, date, s, e, status, support) => ({ id, studioId, date, startMin: R.toMin(s), endMin: R.toMin(e), status, support });
  const rows = R.monthlyStats([
    bk(1, 'ST01', '2026-12-01', '10:00', '12:00', S.CHECKED_IN, true),
    bk(2, 'ST01', '2026-12-02', '10:00', '11:00', S.NO_SHOW, false),
    bk(3, 'ST01', '2026-12-03', '10:00', '11:00', S.CANCELLED, false),
    bk(4, 'ST01', '2026-12-04', '10:00', '11:00', S.CONFIRMED, false),
    bk(5, 'ST02', '2026-11-30', '10:00', '11:00', S.CHECKED_IN, false),
  ], [{ code: 'ST01' }, { code: 'ST02' }], '2026-12', C);
  const st1 = rows.find((r) => r.studio === 'ST01');
  assert.equal(st1.availableMin, 31 * 13 * 60);
  assert.equal(st1.bookings, 3);
  assert.equal(st1.reservedMin, 240);
  assert.equal(st1.usedMin, 120);
  assert.equal(st1.supportRequests, 1);
  assert.equal(st1.noShows, 1);
  assert.equal(st1.noShowRate, 0.5);
  const st2 = rows.find((r) => r.studio === 'ST02');
  assert.equal(st2.bookings, 0);
  assert.equal(st2.noShowRate, 0);
  const total = rows.find((r) => r.studio === '전체');
  assert.equal(total.bookings, 3);
});
