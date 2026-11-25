/**
 * 지난 학기 실제 신청서 4건(비식별, 2027-1로 변환)을 실제 분량 그대로 제출해 봅니다.
 * 원본 PDF는 저장소에 없습니다. 샘플 설명: test/fixtures/samples-2027-1.json 의 note
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, defaultSheets } = require('./fake-gas');
const samples = require('./fixtures/samples-2027-1.json');

const copy = o => JSON.parse(JSON.stringify(o));
const EXPECT = { '샘플A_문화산업회계': true, '샘플B_아동건강간호': false, '샘플C_지속가능경영시스템': true, '샘플D_고급표현학습(대학원)': true };

test('[샘플] 비식별 확인: 샘플에 테스트용 이름·번호만 들어 있다', () => {
  const text = JSON.stringify(samples);
  assert.doesNotMatch(text, /@/, '이메일이 들어 있으면 안 됨');
  const phones = text.match(/01[016789]-\d{3,4}-\d{4}/g) || [];
  phones.forEach(p => assert.match(p, /^010-0000-000\d$/, '테스트 번호가 아님: ' + p));
  samples.forEach(s => assert.match(s.data.basic.prof, /^테스트교수[A-Z]$/));
});

test('[샘플] 개설과목 검색으로 4개 과목을 모두 찾는다', () => {
  const sheets = defaultSheets();
  samples.forEach(s => sheets['개설과목'].push(s.courseRow));
  const env = load({ sheets });
  samples.forEach(s => {
    const r = env.g.searchCourses(s.data.basic.nameKo);
    assert.equal(r.length, 1, s.label);
    assert.equal(r[0].courseCode, s.data.basic.courseCode);
  });
});

test('[샘플] 실제 분량 4건 제출: A·C·D는 접수되고, 영상 4주인 B는 막힌다', () => {
  const env = load();
  const ids = [];
  samples.forEach((s, i) => {
    env.setUser('test.prof.' + 'abcd'[i] + '@hanyang.ac.kr');
    const r = env.g.submitApp({ id: '', data: copy(s.data) });
    assert.equal(r.ok, EXPECT[s.label], s.label + ': ' + JSON.stringify(r.errors));
    if (r.ok) ids.push(r.id);
    else assert.ok(r.errors.some(e => e.includes('8주 이상')), s.label);
  });
  assert.deepEqual(ids, ['FL-2027-1-001', 'FL-2027-1-002', 'FL-2027-1-003']);
  const list = env.sheet('신청목록').records();
  assert.equal(list.length, 3);
  list.forEach(r => assert.equal(r['학기'], '2027-1'));
  assert.equal(env.state.mails.length, 3);
});

test('[샘플] 임시저장 → 다시 열기 하면 긴 본문과 16주 설계가 그대로 돌아온다', () => {
  const env = load();
  const d = samples[3].data;                                  // 가장 긴 샘플(D)
  const saved = env.g.saveDraft({ id: null, step: 4, data: copy(d) });
  const back = env.g.loadApp(saved.id);
  assert.equal(back.step, 4);
  assert.equal(back.data.overview.summaryKo, d.overview.summaryKo);
  assert.equal(back.data.weeks.length, 16);
  assert.equal(back.data.weeks[13].topic, d.weeks[13].topic);
});

/* ── v1.0.3: 주차 유형과 영상 주차 자동 계산 ── */

test('[v1.0.3] 원본 주차 구성 그대로 제출된다 (7주차 중간·15주 운영·16주차 기말과제 평가)', () => {
  const env = load();
  ['샘플A_문화산업회계', '샘플C_지속가능경영시스템', '샘플D_고급표현학습(대학원)'].forEach(label => {
    const s = samples.find(x => x.label === label);
    const r = env.g.submitApp({ id: '', data: copy(s.data) });
    assert.equal(r.ok, true, label + ': ' + JSON.stringify(r.errors));
  });
  const vw = env.sheet('신청목록').records().map(r => r['영상주차수']);
  assert.deepEqual(vw, [13, 8, 13]);
});

test('[v1.0.3] 영상 주차는 직접 적은 숫자가 아니라 주차 유형으로 계산한다', () => {
  const env = load();
  const b = copy(samples.find(x => x.label === '샘플B_아동건강간호').data);
  b.basic.videoWeeks = 99;                                   // 숫자를 부풀려도
  const r = env.g.submitApp({ id: '', data: b });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('현재 4주')), JSON.stringify(r.errors));
});

test('[v1.0.3] 시험·운영 안 함 주차는 주제가 비어도 되고, 영상·오프라인 주차는 주제가 필수다', () => {
  const env = load();
  const d = copy(samples.find(x => x.label === '샘플D_고급표현학습(대학원)').data);
  d.weeks[15].topic = '';                                    // 16주차 '없음'
  d.weeks[7].topic = '';                                     // 8주차 '시험'
  assert.equal(env.g.validate_(d, env.g.getConfig_()).length, 0);
  d.weeks[10].topic = '';                                    // 11주차 '영상'
  assert.ok(env.g.validate_(d, env.g.getConfig_()).some(e => e.includes('11주차')));
});

test('[v1.0.3] 유형이 없는 예전 저장본은 8·16주차 시험 규칙과 직접 적은 영상 주차를 그대로 쓴다', () => {
  const env = load();
  const legacy = copy(samples.find(x => x.label === '샘플C_지속가능경영시스템').data);
  legacy.weeks.forEach(w => { delete w.type; });
  legacy.basic.videoWeeks = 8;
  assert.equal(env.g.videoWeeks_(legacy), 8);
  assert.equal(env.g.weekType_(legacy.weeks[7], 7), '시험');
  assert.equal(env.g.weekType_(legacy.weeks[2], 2), '영상');
  assert.equal(env.g.submitApp({ id: '', data: legacy }).ok, true);
});
