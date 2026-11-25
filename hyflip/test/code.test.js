/**
 * Code.gs 자동 테스트 (12/4 내부 테스트 체크리스트 중 자동화 가능한 항목 + v1.0.1/1.0.2 변경점)
 * 실행: cd hyflip && npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, defaultSheets, fullData } = require('./fake-gas');

const PROF_A = 'prof.a@hanyang.ac.kr';
const STAFF = 'staff@hanyang.ac.kr';

/* ── 변경 3: 학기 값이 날짜로 바뀌어도 동작 ── */

test('[변경3] semKey_: 날짜로 바뀐 학기를 2027-1로 되돌린다', () => {
  const { g, D } = load();
  assert.equal(g.semKey_(D('2027-01-01T00:00:00+09:00')), '2027-1');
  assert.equal(g.semKey_(D('2027-02-01T00:00:00+09:00')), '2027-2');
  assert.equal(g.semKey_(' 2027-1 '), '2027-1');
  assert.equal(g.semKey_(null), '');
});

test('[체크리스트] 개설과목 학기 열이 날짜여도 과목 검색이 된다', () => {
  const sheets = defaultSheets();
  sheets['설정'][1][1] = new Date('2027-01-01T00:00:00+09:00');     // 모집학기도 날짜로 바뀐 경우
  sheets['개설과목'].push([new Date('2027-01-01T00:00:00+09:00'), 'EDU1001', '01', '교육공학', 'Educational Technology', '교육공학과', 3, 2, '홍길동']);
  sheets['개설과목'].push(['2026-2', 'EDU9999', '01', '교육공학 특강', 'Old', '교육공학과', 3, 2, '홍길동']);
  const { g } = load({ sheets });
  const r = g.searchCourses('교육공학');
  assert.equal(r.length, 1, '2027-1 과목 1건만 나와야 함');
  assert.equal(r[0].courseCode, 'EDU1001');
  assert.equal(g.getInitData().semester, '2027-1');
});

test('[체크리스트] 제출 후 신청목록 학기 칸이 날짜가 아닌 텍스트 2027-1이다', () => {
  const env = load();
  const r = env.g.submitApp({ id: '', data: fullData() });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const rec = env.sheet('신청목록').records()[0];
  assert.equal(rec['학기'], '2027-1');
  assert.equal(typeof rec['학기'], 'string');
  assert.equal(rec['접수번호'], 'FL-2027-1-001');
});

/* ── 변경 2 서버 측: 임시저장 번호를 재사용하면 행이 늘지 않는다 ── */

test('[변경2] 같은 TMP 번호로 다시 저장하면 신청상세 행이 하나다', () => {
  const env = load();
  const first = env.g.saveDraft({ id: null, step: 0, data: fullData() });
  assert.match(first.id, /^TMP-/);
  env.g.saveDraft({ id: first.id, step: 1, data: fullData() });
  env.g.saveDraft({ id: first.id, step: 2, data: fullData() });
  assert.equal(env.sheet('신청상세').records().length, 1);
  assert.equal(env.sheet('신청상세').records()[0]['마지막단계'], 2);
});

test('[변경2] 임시저장을 제출하면 같은 행이 접수번호로 바뀌고 TMP 행이 남지 않는다', () => {
  const env = load();
  const d = env.g.saveDraft({ id: null, step: 1, data: fullData() });
  const r = env.g.submitApp({ id: d.id, data: fullData() });
  assert.equal(r.ok, true);
  const rows = env.sheet('신청상세').records();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['접수번호'], 'FL-2027-1-001');
  assert.equal(rows[0]['저장구분'], '제출');
});

/* ── v1.0.2: 대리신청 삭제, 본인만 열람 ── */

test('[v1.0.2] 다른 학교 계정은 교수 A의 신청서를 목록에서 볼 수도, 열 수도 없다', () => {
  const env = load();
  const r = env.g.submitApp({ id: '', data: fullData() });
  env.setUser(STAFF);
  assert.equal(env.g.getInitData().apps.length, 0);
  assert.throws(() => env.g.loadApp(r.id), /책임교수 본인/);
  assert.throws(() => env.g.saveDraft({ id: r.id, step: 1, data: fullData() }), /책임교수 본인/);
  assert.throws(() => env.g.submitApp({ id: r.id, data: fullData() }), /책임교수 본인/);
});

test('[v1.0.2] 남의 임시저장 번호로 제출할 수 없다 (작성자 확인)', () => {
  const env = load();
  const d = env.g.saveDraft({ id: null, step: 1, data: fullData() });
  env.setUser(STAFF);
  assert.throws(() => env.g.submitApp({ id: d.id, data: fullData() }), /책임교수 본인/);
});

test('[체크리스트] 접수 안내 메일은 교수 본인에게만 가고 대리신청자이메일은 비어 있다', () => {
  const env = load();
  const r = env.g.submitApp({ id: '', data: fullData({ proxy: true, profEmail: 'x@hanyang.ac.kr' }) });
  assert.equal(r.ok, true);
  assert.equal(env.state.mails.length, 1);
  assert.equal(env.state.mails[0].to, PROF_A);
  assert.equal(env.state.mails[0].opt.cc, undefined);
  const rec = env.sheet('신청목록').records()[0];
  assert.equal(rec['대리신청자이메일'], '');
  assert.equal(rec['이메일'], PROF_A);
  const saved = JSON.parse(env.sheet('신청상세').records()[0]['데이터(JSON)']);
  assert.equal(saved.proxy, undefined, 'v1.0 대리신청 흔적이 지워져야 함');
});

test('[v1.0.2] v1.0 대리신청서는 지정된 책임교수만 열 수 있고, 다시 제출하면 본인 신청서가 된다', () => {
  const env = load();
  const data = fullData({ proxy: true, profEmail: PROF_A });
  env.sheet('신청상세').appendRow(['TMP-legacy01', STAFF, '임시저장', new Date(), 1, JSON.stringify(data)]);
  env.setUser(STAFF);
  assert.throws(() => env.g.loadApp('TMP-legacy01'), /책임교수 본인/);
  env.setUser(PROF_A);
  assert.equal(env.g.loadApp('TMP-legacy01').id, 'TMP-legacy01');
  const r = env.g.submitApp({ id: 'TMP-legacy01', data });
  assert.equal(r.ok, true);
  assert.equal(env.sheet('신청상세').records()[0]['이메일'], PROF_A);
});

/* ── 기존 체크리스트: 검증·수정·선정상태 메일 ── */

test('[체크리스트] 평가 비율 합계가 100%가 아니면 제출이 막힌다', () => {
  const env = load();
  const d = fullData();
  d.strategy.evalItems[0].pct = 20;
  const r = env.g.submitApp({ id: '', data: d });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('100%')));
});

test('[체크리스트] Smart-F 8주, Smart-B 4주 미만이면 제출이 막힌다', () => {
  const env = load();
  const f = fullData(); f.basic.videoWeeks = 7;
  assert.equal(env.g.submitApp({ id: '', data: f }).ok, false);
  const b = fullData(); b.basic.classType = 'Smart-B'; b.basic.videoWeeks = 4;
  assert.equal(env.g.submitApp({ id: '', data: b }).ok, true);
});

test('[체크리스트] 마감 전 수정 후 다시 제출하면 PDF가 바뀌고 이전 PDF는 휴지통으로 간다', () => {
  const env = load();
  const r1 = env.g.submitApp({ id: '', data: fullData() });
  const r2 = env.g.submitApp({ id: r1.id, data: fullData() });
  assert.equal(r2.ok, true);
  assert.equal(r2.isNew, false);
  assert.notEqual(r2.pdf, r1.pdf);
  assert.equal(env.state.trashed.length, 1);
  assert.equal(env.state.mails.length, 1, '수정 제출 때는 접수 안내 메일을 다시 보내지 않음');
  assert.equal(env.sheet('신청목록').records().length, 1);
});

function editStatus(env, value) {
  const list = env.sheet('신청목록');
  const col = list.rows[0].indexOf('선정상태') + 1;
  list._set(2, col, value);
  env.g.onStatusEdit({ range: list.getRange(2, col), value });
  return { list, col };
}

test('[체크리스트] 선정상태 변경: 심의중은 메일 없음, 미선정은 사유 필요, 선정은 메일 발송', () => {
  const env = load();
  env.g.submitApp({ id: '', data: fullData() });
  env.state.mails.length = 0;

  editStatus(env, '심의중');
  assert.equal(env.state.mails.length, 0);

  let { list, col } = editStatus(env, '미선정');
  assert.equal(env.state.mails.length, 0);
  assert.match(list.notes['2,' + col], /메일 미발송: 미선정사유/);

  list._set(2, list.rows[0].indexOf('미선정사유') + 1, '예산 초과');
  editStatus(env, '미선정');
  assert.equal(env.state.mails.length, 1);
  assert.equal(env.state.mails[0].body, '예산 초과');

  editStatus(env, '선정');
  assert.equal(env.state.mails.length, 2);
  assert.equal(env.state.mails[1].to, PROF_A);
});

test('[체크리스트] 보완요청 후 교수가 다시 제출하면 상태가 접수로 돌아간다', () => {
  const env = load();
  const r = env.g.submitApp({ id: '', data: fullData() });
  const list = env.sheet('신청목록');
  const h = list.rows[0];
  list._set(2, h.indexOf('보완내용') + 1, '주차 보완');
  list._set(2, h.indexOf('보완기한') + 1, new Date(Date.now() + 7 * 86400000));
  editStatus(env, '보완요청');
  assert.equal(env.state.mails.at(-1).subject, '[HY FLIP] 보완요청');
  const r2 = env.g.submitApp({ id: r.id, data: fullData() });
  assert.equal(r2.ok, true);
  assert.equal(list.records()[0]['선정상태'], '접수');
});

/* ── 변경 4: 미제출 임시저장 2년 후 삭제 ── */

test('[변경4] 2년 지난 TMP 행만 지우고 삭제대장에 남긴다 (신청목록이 비어 있어도)', () => {
  const env = load();
  const detail = env.sheet('신청상세');
  const old = new Date(); old.setFullYear(old.getFullYear() - 2); old.setDate(old.getDate() - 1);
  const recent = new Date(); recent.setFullYear(recent.getFullYear() - 1);
  detail.appendRow(['TMP-old00001', PROF_A, '임시저장', old, 1, '{}']);
  detail.appendRow(['TMP-new00001', PROF_A, '임시저장', recent, 1, '{}']);
  detail.appendRow(['FL-2025-1-001', PROF_A, '제출', old, 5, '{}']);
  env.g.monthlyCleanup();
  assert.deepEqual(detail.records().map(r => r['접수번호']), ['TMP-new00001', 'FL-2025-1-001']);
  const log = env.sheet('삭제대장').records();
  assert.equal(log.length, 1);
  assert.equal(log[0]['구분'], '미제출 임시저장 삭제(2년)');
  assert.equal(log[0]['대상'], 'TMP-old00001');
});

/* ── 변경 5: setup 점검 강화 ── */

test('[변경5] setup: 정상 시트면 트리거 2개를 만들고, 다시 실행해도 중복으로 만들지 않는다', () => {
  const env = load();
  env.g.setup();
  env.g.setup();
  assert.deepEqual(env.state.triggers.sort(), ['monthlyCleanup', 'onStatusEdit']);
});

test('[체크리스트] 메일문구에서 한 줄을 지우고 setup을 실행하면 빠진 구분을 알려준다', () => {
  const sheets = defaultSheets();
  sheets['메일문구'] = sheets['메일문구'].filter(r => r[0] !== '보완요청');
  const env = load({ sheets });
  assert.throws(() => env.g.setup(), /메일문구 탭에 다음 구분이 없습니다: 보완요청/);
});

test('[변경5] setup: 신청목록에 필요한 열이 없으면 열 이름을 알려준다', () => {
  for (const col of ['상태변경일시', '보완기한', '개인정보삭제완료']) {
    const sheets = defaultSheets();
    const i = sheets['신청목록'][0].indexOf(col);
    sheets['신청목록'][0][i] = col + '_바뀜';
    const env = load({ sheets });
    assert.throws(() => env.g.setup(), new RegExp('신청목록 탭에 "' + col + '" 열이 없습니다'));
  }
});

test('[v1.0.2] setup: 대리신청자이메일 열을 지워도 통과하고, 제출도 된다', () => {
  const sheets = defaultSheets();
  const h = sheets['신청목록'][0];
  h.splice(h.indexOf('대리신청자이메일'), 1);
  const env = load({ sheets });
  env.g.setup();
  assert.equal(env.g.submitApp({ id: '', data: fullData() }).ok, true);
});

test('[체크리스트] 학교 계정이 아니면 접근 권한 화면이 나온다', () => {
  const env = load({ user: 'someone@gmail.com' });
  const out = env.g.doGet();
  assert.match(out.html, /접근 권한이 없습니다/);
  assert.throws(() => env.g.getInitData(), /한양대학교 계정/);
});
