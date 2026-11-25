// 전체 흐름 통합 테스트 — 실제 서버 코드를 가짜 시트·캘린더·메일 위에서 실행
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasEnv } = require('./gas-mock.js');

const OWNER = 'hyflip@school.ac.kr';
const A = 'prof.a@school.ac.kr';
const B = 'prof.b@school.ac.kr';
const STAFF = 'staff@school.ac.kr';
const kst = (s) => s + ':00+09:00';

function form(o) {
  return Object.assign({
    studioId: 'ST01', date: '2026-12-02', startMin: 600, endMin: 660, support: false,
    name: '김교수', org: '경영대학', shootType: 'PIP(화면+강의자)', purpose: '플립러닝 개발',
    agreedPrivacy: true, agreedRules: true,
  }, o);
}

function fresh() {
  const env = createGasEnv({ owner: OWNER, now: kst('2026-11-30T10:00') });
  env.call('setup');
  env.setConfig('담당자 알림 메일', STAFF);
  env.setConfig('학교 도메인', 'school.ac.kr');
  return env;
}

const studioCal = (env, code) => {
  const id = env.sheetRows('스튜디오').find((r) => r['코드'] === code)['캘린더ID'];
  return env.state.calendars[id];
};
const bookingRow = (env, id) => env.sheetRows('예약').find((r) => r['예약번호'] === id);
const mailsTo = (env, to) => env.state.outbox.filter((m) => m.to === to);

test('setup: 시트 탭·스튜디오 10곳·캘린더·관리자·트리거', () => {
  const env = fresh();
  const studios = env.sheetRows('스튜디오');
  assert.equal(studios.length, 10);
  assert.ok(studios.every((s) => s['캘린더ID'] && s['QR키']));
  assert.equal(Object.keys(env.state.calendars).length, 10);
  assert.equal(env.sheetRows('관리자')[0]['이메일'], OWNER);
  assert.deepEqual(env.state.triggers.map((t) => t.fn).sort(), ['jobNoShows', 'jobReminders', 'jobRetention', 'jobStats']);
  // 다시 실행해도 중복 생성 없음
  env.call('setup');
  assert.equal(Object.keys(env.state.calendars).length, 10);
  assert.equal(env.sheetRows('스튜디오').length, 10);
  assert.equal(env.state.triggers.length, 4);
});

test('도메인 밖 계정·비로그인은 차단', () => {
  const env = fresh();
  env.as('someone@gmail.com');
  assert.throws(() => env.call('apiBootstrap'), /학교 계정/);
  env.as('');
  assert.throws(() => env.call('apiBootstrap'), /로그인/);
});

test('예약 확정 → 캘린더 등록·확정 메일, 같은 시간 중복은 차단', () => {
  const env = fresh();
  env.as(A);
  const boot = env.call('apiBootstrap');
  assert.equal(boot.studios.length, 10);
  assert.equal(boot.isAdmin, false);
  const r = env.call('apiCreateBooking', form());
  assert.equal(r.status, '확정');
  assert.match(r.id, /^SB-2026-00001$/);
  const cal = studioCal(env, 'ST01');
  assert.equal(cal.events.length, 1);
  assert.match(cal.events[0].title, /^\[확정\] 김교수/);
  assert.match(mailsTo(env, A)[0].subject, /예약이 확정/);
  const row = bookingRow(env, r.id);
  assert.equal(row['이메일'], A);
  assert.equal(row['삭제예정일'], '2029-02-28'); // 2026-2학기 종료 + 2년
  assert.ok(row['동의일시']);

  env.as(B);
  assert.throws(() => env.call('apiCreateBooking', form({ startMin: 630, endMin: 690, name: '이교수' })), /이미 예약/);
  // 다른 스튜디오는 가능
  assert.equal(env.call('apiCreateBooking', form({ studioId: 'ST02', name: '이교수' })).status, '확정');
});

test('캘린더에 담당자가 직접 넣은 종일 일정(점검)도 예약을 막음', () => {
  const env = fresh();
  studioCal(env, 'ST03').createAllDayEvent('장비 점검', new Date(kst('2026-12-02T00:00')));
  env.as(A);
  const a = env.call('apiAvailability', 'ST03', '2026-12-02');
  assert.equal(a.busy[0].allDay, true);
  assert.throws(() => env.call('apiCreateBooking', form({ studioId: 'ST03' })), /이미 예약/);
});

test('빈 시간 조회는 다른 사람 이름을 내보내지 않음', () => {
  const env = fresh();
  env.as(A); env.call('apiCreateBooking', form());
  env.as(B);
  const a = env.call('apiAvailability', 'ST01', '2026-12-02');
  assert.equal(JSON.stringify(a.busy), JSON.stringify([{ startMin: 600, endMin: 660, pending: false, allDay: false }]));
  assert.equal(JSON.stringify(a).includes('김교수'), false);
});

test('1인 1일 8시간 한도는 스튜디오가 달라도 합산', () => {
  const env = fresh();
  env.as(A);
  env.call('apiCreateBooking', form({ startMin: 540, endMin: 900 })); // 6시간
  assert.throws(() => env.call('apiCreateBooking', form({ studioId: 'ST02', startMin: 900, endMin: 1050 })), /최대 8시간/);
  assert.equal(env.call('apiCreateBooking', form({ studioId: 'ST02', startMin: 900, endMin: 1020 })).status, '확정');
});

test('촬영 지원 요청 → 임시 점유·담당자 알림 → 담당자가 시간 조정 후 확정', () => {
  const env = fresh();
  env.as(B);
  const r = env.call('apiCreateBooking', form({ support: true, name: '이교수', startMin: 660, endMin: 720 }));
  assert.equal(r.status, '담당자 확인 중');
  assert.match(studioCal(env, 'ST01').events[0].title, /^\[확인중\]/);
  assert.equal(mailsTo(env, STAFF).length, 1);
  assert.match(mailsTo(env, B)[0].subject, /지원 요청이 접수/);
  // 지원은 근무시간 밖 불가
  assert.throws(() => env.call('apiCreateBooking', form({ support: true, startMin: 1020, endMin: 1110 })), /근무시간/);

  env.as(A);
  assert.throws(() => env.call('apiAdminData'), /권한/);
  env.as(OWNER);
  const d = env.call('apiAdminData');
  assert.equal(d.pending.length, 1);
  env.call('apiAdminConfirm', r.id, { date: '2026-12-02', startMin: 780, endMin: 840, memo: '담당자 일정' });
  const row = bookingRow(env, r.id);
  assert.equal(row['상태'], '확정');
  assert.equal(row['시작'], '13:00');
  const evs = studioCal(env, 'ST01').events;
  assert.equal(evs.length, 1);
  assert.match(evs[0].title, /^\[확정\]/);
  assert.match(mailsTo(env, B).pop().subject, /촬영 지원 예약이 확정/);
});

test('지원 요청 반려 → 일정 삭제·사유 메일, 사유 없으면 거부', () => {
  const env = fresh();
  env.as(B);
  const r = env.call('apiCreateBooking', form({ support: true }));
  env.as(OWNER);
  assert.throws(() => env.call('apiAdminReject', r.id, ''), /사유/);
  env.call('apiAdminReject', r.id, '해당 일 담당자 출장');
  assert.equal(bookingRow(env, r.id)['상태'], '반려');
  assert.equal(studioCal(env, 'ST01').events.length, 0);
  assert.match(mailsTo(env, B).pop().body, /담당자 출장/);
});

test('본인 취소: 전날 18:00까지 가능, 이후 불가', () => {
  const env = fresh();
  env.as(A);
  const r1 = env.call('apiCreateBooking', form());
  const r2 = env.call('apiCreateBooking', form({ startMin: 720, endMin: 780 }));
  env.at(kst('2026-12-01T18:00'));
  env.call('apiCancelBooking', r1.id);
  assert.equal(bookingRow(env, r1.id)['상태'], '취소');
  env.at(kst('2026-12-01T18:01'));
  assert.throws(() => env.call('apiCancelBooking', r2.id), /직접 취소할 수 없습니다/);
  assert.equal(env.call('apiMyBookings').upcoming[0].canModify, false);
  env.as(B);
  assert.throws(() => env.call('apiCancelBooking', r2.id), /본인/);
});

test('예약 변경(replace): 새 시간 확정 후 기존 예약 자동 취소, 자기 시간과 겹쳐도 가능', () => {
  const env = fresh();
  env.as(A);
  const r1 = env.call('apiCreateBooking', form());
  const r2 = env.call('apiCreateBooking', form({ startMin: 630, endMin: 720, replaceId: r1.id }));
  assert.equal(bookingRow(env, r1.id)['상태'], '취소');
  assert.equal(bookingRow(env, r2.id)['상태'], '확정');
  const evs = studioCal(env, 'ST01').events;
  assert.equal(evs.length, 1);
  assert.equal(evs[0].start.toISOString(), new Date(kst('2026-12-02T10:30')).toISOString());
});

test('QR 체크인: 키 검증·시간창·본인 예약만', () => {
  const env = fresh();
  env.as(A);
  const r = env.call('apiCreateBooking', form());
  const st = env.sheetRows('스튜디오').find((s) => s['코드'] === 'ST01');
  env.at(kst('2026-12-02T09:45'));
  assert.equal(env.call('apiCheckinPreview', 'ST01', st['QR키']).canCheckin, false);
  env.at(kst('2026-12-02T10:20'));
  assert.throws(() => env.call('apiCheckinPreview', 'ST01', 'wrong'), /QR/);
  env.as(B);
  assert.equal(env.call('apiCheckinPreview', 'ST01', st['QR키']).canCheckin, false);
  env.as(A);
  assert.equal(env.call('apiCheckinPreview', 'ST01', st['QR키']).canCheckin, true);
  const done = env.call('apiCheckin', 'ST01', st['QR키']);
  assert.equal(done.status, '체크인');
  assert.equal(bookingRow(env, r.id)['체크인일시'], '2026-12-02 10:20');
  assert.match(studioCal(env, 'ST01').events[0].title, /^\[체크인\]/);
  // 체크인한 예약은 노쇼 처리 안 됨
  env.at(kst('2026-12-02T12:00'));
  env.call('jobNoShows');
  assert.equal(bookingRow(env, r.id)['상태'], '체크인');
});

test('노쇼 2회 → 30일 예약 제한 → 노쇼 해제 시 제한도 해제', () => {
  const env = fresh();
  env.as(B);
  const n1 = env.call('apiCreateBooking', form({ name: '이교수' }));
  const n2 = env.call('apiCreateBooking', form({ name: '이교수', date: '2026-12-09' }));
  env.at(kst('2026-12-02T10:59'));
  env.call('jobNoShows');
  assert.equal(bookingRow(env, n1.id)['상태'], '확정');
  env.at(kst('2026-12-02T11:00'));
  env.call('jobNoShows');
  assert.equal(bookingRow(env, n1.id)['상태'], '노쇼');
  assert.equal(studioCal(env, 'ST01').events.filter((e) => e.title.includes('이교수')).length, 1); // 노쇼된 일정은 비움
  assert.match(mailsTo(env, B).pop().body, /이번 학기 노쇼 1회/);
  assert.equal(env.sheetRows('노쇼제재').length, 0);

  env.at(kst('2026-12-09T11:10'));
  env.call('jobNoShows');
  const sanctions = env.sheetRows('노쇼제재');
  assert.equal(sanctions.length, 1);
  assert.equal(sanctions[0]['제재종료'], '2027-01-08');
  assert.match(mailsTo(env, B).pop().subject, /예약 제한/);
  env.as(B);
  assert.throws(() => env.call('apiCreateBooking', form({ date: '2026-12-20' })), /2027-01-08까지 예약이 제한/);
  assert.equal(env.call('apiBootstrap').sanctionUntil, '2027-01-08');

  env.as(OWNER);
  const res = env.call('apiAdminExcuse', n2.id, '사전 연락 확인');
  assert.equal(res.liftedSanction, true);
  assert.equal(bookingRow(env, n2.id)['상태'], '노쇼 해제');
  env.as(B);
  assert.equal(env.call('apiCreateBooking', form({ date: '2026-12-20' })).status, '확정');
});

test('담당자 취소(노쇼) / 취소(예외)', () => {
  const env = fresh();
  env.as(A);
  const r1 = env.call('apiCreateBooking', form());
  const r2 = env.call('apiCreateBooking', form({ startMin: 720, endMin: 780 }));
  env.at(kst('2026-12-01T20:00'));
  env.as(OWNER);
  env.call('apiAdminCancel', r1.id, 'noshow', '당일 전화 취소');
  env.call('apiAdminCancel', r2.id, 'excused', '병가');
  assert.equal(bookingRow(env, r1.id)['상태'], '노쇼');
  assert.equal(bookingRow(env, r2.id)['상태'], '취소');
  assert.equal(studioCal(env, 'ST01').events.length, 0);
});

test('미확정 지원 요청은 시작 시각에 자동 취소', () => {
  const env = fresh();
  env.as(B);
  const r = env.call('apiCreateBooking', form({ support: true }));
  env.at(kst('2026-12-02T10:00'));
  env.call('jobNoShows');
  assert.equal(bookingRow(env, r.id)['상태'], '취소');
  assert.match(mailsTo(env, B).pop().body, /자동 취소/);
});

test('리마인더: 내일 예약에만 발송', () => {
  const env = fresh();
  env.as(A);
  env.call('apiCreateBooking', form({ date: '2026-12-01' }));
  env.call('apiCreateBooking', form({ date: '2026-12-02' }));
  env.state.outbox = [];
  env.call('jobReminders');
  assert.equal(env.state.outbox.length, 1);
  assert.match(env.state.outbox[0].subject, /내일/);
  env.setConfig('전날 리마인더 메일(Y/N)', 'N');
  env.state.outbox = [];
  env.call('jobReminders');
  assert.equal(env.state.outbox.length, 0);
});

test('통계 탭 갱신과 보관기간 삭제(삭제대장에는 개인정보 없음)', () => {
  const env = fresh();
  env.as(A);
  const r = env.call('apiCreateBooking', form());
  env.at(kst('2026-12-02T10:10'));
  const st = env.sheetRows('스튜디오').find((s) => s['코드'] === 'ST01');
  env.call('apiCheckin', 'ST01', st['QR키']);
  env.call('jobStats');
  const stats = env.sheetRows('통계').filter((x) => x['월'] === '2026-12');
  assert.equal(stats.find((x) => x['스튜디오'] === 'ST01')['실이용(시간)'], 1);
  env.call('jobStats'); // 다시 실행해도 중복 없음
  assert.equal(env.sheetRows('통계').filter((x) => x['월'] === '2026-12').length, 11);

  env.at(kst('2029-02-27T03:00'));
  env.call('jobRetention');
  assert.equal(env.sheetRows('예약').length, 1);
  env.at(kst('2029-03-01T03:00'));
  env.call('jobRetention');
  assert.equal(env.sheetRows('예약').length, 0);
  const purge = env.sheetRows('삭제대장');
  assert.equal(purge.length, 1);
  assert.equal(purge[0]['대상 번호'], r.id);
  assert.equal(JSON.stringify(purge).includes('@'), false);
  assert.ok(env.sheetRows('통계').length > 0); // 통계는 보관
});

test('웹앱 화면 렌더링(모든 페이지)', () => {
  const env = fresh();
  env.as(A);
  for (const p of ['book', 'my', 'checkin', 'admin', 'zzz']) {
    const out = env.ctx.doGet({ parameter: { p, st: 'ST01', k: '<x>' } });
    const html = out.getContent();
    assert.equal(html.includes('<?'), false, p);
    assert.match(html, /var BOOT = \{/);
    assert.equal(html.includes('<x>'), false, 'BOOT 값 이스케이프');
  }
});
