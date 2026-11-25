/**
 * 실제 신청서 4건(2026-2 → 2027-1, 비식별) 기능 테스트
 *  1) 교수 4명이 브라우저 화면에서 신청서를 처음부터 끝까지 직접 입력·제출 (A·C·D 접수, B는 Smart-F 8주 미달로 차단)
 *  2) 저장된 내용이 원본 샘플과 같은지 대조, 샘플별 신청서 PDF 캡처
 *  3) 제출 이후 업무: 수정 재제출 / 선정·미선정·보완요청 메일 / 마감 후 보완 제출 / 학기종료일+2년 개인정보 자동 삭제
 * 실행: npm run e2e:samples   (캡처: docs/screenshots/samples/, 문제가 있으면 종료 코드 1)
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { chromium } = require('playwright');
const { start } = require('./server.js');
const samples = require('../test/fixtures/samples-2027-1.json');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots', 'samples');
const PORT = Number(process.env.PORT || 8797);
const base = 'http://localhost:' + PORT;
const SCALE = Number(process.env.SCALE || 1.5);
const USERS = ['test.prof.a@hanyang.ac.kr', 'test.prof.b@hanyang.ac.kr', 'test.prof.c@hanyang.ac.kr', 'test.prof.d@hanyang.ac.kr'];
const TAG = ['A', 'B', 'C', 'D'];
const FIXED = (t) => t === '시험' || t === '없음';

const results = [];
const check = (group, name, ok, detail) => results.push({ group, name, ok: !!ok, detail: detail || '' });
const S = (v) => String(v == null ? '' : v).trim();

/** 가짜 GAS 환경의 시계를 바꿉니다. Code.gs의 new Date()만 바뀌고, 날짜 비교(instanceof Date)는 그대로 동작합니다. */
function installClock(env) {
  vm.runInContext(`(function () {
    const R = Date; let fixed = null;
    class F extends R {
      constructor(...a) { if (a.length === 0) super(fixed === null ? R.now() : fixed); else super(...a); }
      static now() { return fixed === null ? R.now() : fixed; }
      static [Symbol.hasInstance](x) { return x instanceof R; }
    }
    globalThis.Date = F;
    globalThis.__setNow = function (ms) { fixed = ms; };
  })()`, env.g);
  return (iso) => env.g.__setNow(iso ? new Date(iso).getTime() : null);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, env } = await start(PORT, { seed: false });
  const setNow = installClock(env);
  const browser = await chromium.launch();
  const problems = [];
  const dialogs = [];
  // 입력 칸에 커서가 있는 채로 전체 페이지를 캡처하면 그다음 첫 클릭이 빠지는 현상(브라우저 자동화 타이밍)이 있어, 캡처 전에 커서를 뺍니다
  const shot = async (page, name, full = true) => {
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
    await page.waitForTimeout(200);
  };
  const watch = (page) => {
    page.on('pageerror', (e) => problems.push('JS 오류: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts|cdnjs|ERR_|favicon/i.test(m.text())) problems.push('console: ' + m.text()); });
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  };
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SCALE });
  const pdfCtx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: SCALE });

  // 화면 조작 도우미
  const next = async (p) => { await p.click('.btns button.primary:has-text("다음")'); await p.waitForTimeout(200); };
  const prev = async (p) => { await p.click('.btns button:has-text("이전")'); await p.waitForTimeout(150); };
  const fill = (p, k, v) => p.fill(`[data-p="${k}"]`, S(v));
  const pick = (p, k, v) => p.selectOption(`[data-p="${k}"]`, S(v));
  const openWeek = async (p, i) => { const d = p.locator('details').nth(i); if (!(await d.evaluate((el) => el.open))) await d.locator('summary').click(); };
  const step = (p) => p.$eval('.steps span.on', (el) => el.textContent);

  /** 샘플 1건을 화면에서 1~5단계까지 입력. 주차별 설계(5단계)에서 '다음'을 누르기 직전까지. */
  async function enter(p, s, k) {
    const d = s.data, b = d.basic;
    await p.goto(base + '/?as=' + USERS[k]);
    await p.waitForSelector('button:has-text("새 신청서 작성")');
    await p.click('button:has-text("새 신청서 작성")');
    // 1. 안내·동의
    await p.check('[data-p="consent.required"]');
    if (d.consent.optional) await p.check('[data-p="consent.optional"]');
    await next(p);
    // 2. 기본정보: 개설과목 검색 → 선택 → 나머지 칸
    await p.fill('#q', b.nameKo);
    await p.waitForSelector('#qres [data-i]');
    await p.click('#qres [data-i="0"]');
    await p.waitForTimeout(150);
    check(TAG[k], '과목 검색 → 자동 채움', (await p.inputValue('[data-p="basic.courseCode"]')) === b.courseCode, await p.inputValue('[data-p="basic.courseCode"]'));
    for (const f of ['section', 'nameKo', 'nameEn', 'dept', 'grade', 'credits', 'prof', 'position', 'org']) await fill(p, 'basic.' + f, b[f]);
    if (d.consent.optional && b.phone) await fill(p, 'basic.phone', b.phone);
    await pick(p, 'basic.majorType', b.majorType);
    await pick(p, 'basic.classType', b.classType);      // 다시 그려짐
    await pick(p, 'basic.creditPlan', b.creditPlan);
    await pick(p, 'basic.devType', b.devType);
    await pick(p, 'basic.shootType', b.shootType);
    await next(p);
    // 3. 교과목 개요
    for (const f of ['purpose', 'features', 'effects', 'summaryKo', 'summaryEn', 'goals']) await fill(p, 'overview.' + f, d.overview[f]);
    await next(p);
    // 4. 운영 전략: 평가항목 수 맞추기 → 값 입력
    const st = d.strategy, items = st.evalItems;
    for (const f of ['pre', 'inClass', 'post']) await fill(p, 'strategy.' + f, st[f]);
    let rows = await p.$$eval('[data-p$=".name"][data-p^="strategy.evalItems"]', (e) => e.length);
    while (rows < items.length) { await p.click('button:has-text("+ 평가항목 추가")'); rows++; }
    while (rows > items.length) { await p.click('table button.link:has-text("삭제")'); rows--; }
    for (let i = 0; i < items.length; i++) {
      await fill(p, `strategy.evalItems.${i}.name`, items[i].name);
      await fill(p, `strategy.evalItems.${i}.pct`, items[i].pct);
      await fill(p, `strategy.evalItems.${i}.desc`, items[i].desc);
    }
    for (const f of ['evalCriteria', 'textbook', 'subTextbook', 'etc']) await fill(p, 'strategy.' + f, st[f]);
    check(TAG[k], '평가 비율 합계 100%', /합계 100%/.test(await p.textContent('#evalSum')), await p.textContent('#evalSum'));
    await next(p);
    // 5. 주차별 설계: 유형 먼저(바꿀 때마다 다시 그려짐) → 주제·활동·시간
    for (let i = 0; i < 16; i++) {
      const want = d.weeks[i].type;
      const now = await p.inputValue(`[data-p="weeks.${i}.type"]`).catch(() => null);
      if (now !== want) { await openWeek(p, i); await pick(p, `weeks.${i}.type`, want); await p.waitForTimeout(60); }
    }
    for (let i = 0; i < 16; i++) {
      const w = d.weeks[i];
      await openWeek(p, i);
      await fill(p, `weeks.${i}.topic`, w.topic);
      if (!FIXED(w.type)) for (const f of ['pre', 'intro', 'deep', 'wrap1', 'wrap2']) await fill(p, `weeks.${i}.${f}`, w[f]);
      await fill(p, `weeks.${i}.minutes`, w.minutes);
    }
    const vc = d.weeks.filter((w) => w.type === '영상').length;
    check(TAG[k], '영상 주차 자동 계산', new RegExp('^' + vc + '주').test(await p.textContent('#videoCount')), (await p.textContent('#videoCount')) + ' (원본 ' + vc + '주)');
  }

  /** 서버에 저장된 신청서가 원본 샘플과 같은지 (화면에서 입력할 수 있는 칸 기준) */
  function compareStored(id, s, k) {
    const row = env.sheet('신청상세').records().find((r) => r['접수번호'] === id);
    if (!row) return check(TAG[k], '저장 내용 = 원본', false, '신청상세 행 없음');
    const got = JSON.parse(row['데이터(JSON)']), d = s.data, diff = [];
    const eq = (label, a, b) => { if (S(a) !== S(b)) diff.push(label + ': "' + S(a).slice(0, 20) + '" ≠ "' + S(b).slice(0, 20) + '"'); };
    ['courseCode', 'section', 'nameKo', 'nameEn', 'dept', 'grade', 'majorType', 'credits', 'prof', 'org', 'position', 'classType', 'creditPlan', 'devType', 'shootType']
      .forEach((f) => eq('basic.' + f, got.basic[f], d.basic[f]));
    eq('basic.phone', got.basic.phone, d.consent.optional ? d.basic.phone : got.basic.phone);
    Object.keys(d.overview).forEach((f) => eq('overview.' + f, got.overview[f], d.overview[f]));
    ['pre', 'inClass', 'post', 'evalCriteria', 'textbook', 'subTextbook', 'etc'].forEach((f) => eq('strategy.' + f, got.strategy[f], d.strategy[f]));
    d.strategy.evalItems.forEach((x, i) => ['name', 'pct', 'desc'].forEach((f) => eq(`eval${i + 1}.${f}`, (got.strategy.evalItems[i] || {})[f], x[f])));
    d.weeks.forEach((w, i) => {
      const g = got.weeks[i] || {};
      ['type', 'topic', 'minutes'].forEach((f) => eq(`${i + 1}주.${f}`, g[f], w[f]));
      if (!FIXED(w.type)) ['pre', 'intro', 'deep', 'wrap1', 'wrap2'].forEach((f) => eq(`${i + 1}주.${f}`, g[f], w[f]));
    });
    check(TAG[k], '저장 내용 = 원본 (기본정보·개요·전략·평가·16주)', diff.length === 0, diff.length ? diff.slice(0, 5).join(' / ') : '모든 칸 일치');
  }

  async function checkPdf(id, s, k, name) {
    const f = Object.values(env.state.files).filter((x) => x.html && x.html.includes(id)).pop();
    if (!f) return check(TAG[k], '신청서 PDF', false, 'PDF 없음');
    const pg = await pdfCtx.newPage(); watch(pg);
    await pg.goto(base + '/__pdf/' + f.id);
    const text = await pg.textContent('body');
    const wk = await pg.$$eval('table.wk tr', (rows) => rows.slice(1).map((r) => r.cells[0].innerText.replace(/\s+/g, ' ')));
    const types = s.data.weeks.map((w, i) => (i + 1) + ' ' + (w.type === '없음' ? '미운영' : w.type));
    const okWk = types.every((t, i) => wk[i] === t);
    check(TAG[k], 'PDF: 접수번호·과목명·2027-1', text.includes(id) && text.includes(s.data.basic.nameKo) && text.includes('2027-1'));
    check(TAG[k], 'PDF: 16주 표와 주차 유형', okWk, okWk ? '16주 모두 일치' : wk.join(','));
    check(TAG[k], 'PDF: 마지막 쪽 개인정보 동의 내역', /개인정보 수집·이용 동의 내역/.test(text) && /필수 동의 ○/.test(text));
    check(TAG[k], 'PDF: 템플릿 태그 없음', !/<\?|\?>/.test(text));
    await shot(pg, name);
    await pg.close();
  }

  // ───────── 1·2) A, C, D: 화면 입력 → 제출 ─────────
  const ids = {};
  for (const k of [0, 2, 3]) {
    const s = samples[k], p = await ctx.newPage(); watch(p);
    await enter(p, s, k);
    await shot(p, `${TAG[k]}-1-weeks`);
    await next(p);
    const passed = /확인·제출/.test(await step(p));
    check(TAG[k], '주차별 설계 통과', passed, passed ? await step(p) : lastDialog());
    if (!passed) { await p.close(); continue; }
    await shot(p, `${TAG[k]}-2-confirm`);
    const before = env.state.mails.length;
    await p.click('.btns button.primary:has-text("제출")');
    await p.waitForSelector('.notice.ok', { timeout: 15000 }).catch(() => {});
    const done = (await p.textContent('#app')) || '';
    const m = done.match(/FL-2027-1-\d{3}/);
    check(TAG[k], '제출 → 접수번호', !!m, m ? m[0] : done.slice(0, 80));
    if (!m) { await p.close(); continue; }
    ids[k] = m[0];
    const mails = env.state.mails.slice(before);
    check(TAG[k], '접수 안내 메일 본인 1통', mails.length === 1 && mails[0].to === USERS[k], mails.map((x) => x.to).join(','));
    check(TAG[k], '메일 답장 주소 = 부서 공동계정', mails.length === 1 && mails[0].opt && mails[0].opt.replyTo === 'hyflip@hanyang.ac.kr', mails[0] && mails[0].opt && mails[0].opt.replyTo);
    compareStored(ids[k], s, k);
    await checkPdf(ids[k], s, k, `${TAG[k]}-3-pdf`);
    await p.close();
  }

  // ───────── B: Smart-F 영상 4주 → 차단, 서버도 거절 → (11/25 결정) Smart-B로 바꾸면 접수 ─────────
  {
    const k = 1, s = samples[k], p = await ctx.newPage(); watch(p);
    await enter(p, s, k);
    await next(p);
    check('B', '화면: Smart-F 영상 4주 → 다음 단계 차단', /8주 이상/.test(lastDialog()) && /주차별 설계/.test(await step(p)), lastDialog().split('\n').pop());
    await shot(p, 'B-1-blocked', false);
    const srv = await p.evaluate(() => new Promise((res) => google.script.run.withSuccessHandler(res).withFailureHandler((e) => res({ ok: false, errors: [String(e.message)] })).submitApp({ id: S.id, data: S.data })));
    check('B', '서버: 화면을 우회해 제출해도 거절', srv.ok === false && srv.errors.some((e) => /8주 이상/.test(e)), (srv.errors || []).join(' / '));
    check('B', '차단된 신청서는 임시저장(미제출)으로 남음', env.sheet('신청상세').records().some((r) => r['이메일'] === USERS[k] && /^TMP-/.test(r['접수번호'])));
    for (let i = 0; i < 3; i++) await prev(p);
    await pick(p, 'basic.classType', 'Smart-B');
    for (let i = 0; i < 4; i++) await next(p);
    check('B', 'Smart-B로 바꾸면 최소 4주 기준 통과', /확인·제출/.test(await step(p)), await step(p));
    await p.click('.btns button.primary:has-text("제출")');
    await p.waitForSelector('.notice.ok', { timeout: 15000 }).catch(() => {});
    const m = ((await p.textContent('#app')) || '').match(/FL-2027-1-\d{3}/);
    check('B', 'Smart-B 접수', !!m, m ? m[0] : '');
    if (m) ids[k] = m[0];
    await p.close();
  }

  // ───────── 3) 제출 이후 업무 ─────────
  const list = env.sheet('신청목록');
  const H = (n) => list.rows[0].indexOf(n) + 1;
  const rowOf = (id) => list.rows.findIndex((r) => r[0] === id) + 1;
  const cell = (id, n) => list._get(rowOf(id), H(n));
  const setCell = (id, n, v) => list._set(rowOf(id), H(n), v);
  const editStatus = (id, value) => { setCell(id, '선정상태', value); env.g.onStatusEdit({ range: list.getRange(rowOf(id), H('선정상태')), value }); };
  const mailsTo = (u, from) => env.state.mails.slice(from).filter((x) => x.to === u);

  // A: 마감 전 수정 재제출 → 새 PDF·이전 PDF 휴지통·번호 유지·메일 없음 → 선정 메일
  {
    const id = ids[0], u = USERS[0];
    env.setUser(u);
    const oldPdf = cell(id, 'PDF링크'), m0 = env.state.mails.length;
    const r = env.g.loadApp(id);
    r.data.strategy.textbook = '문화산업 회계 강의노트(교수 제작)';
    const r2 = env.g.submitApp({ id, data: r.data });
    const oldId = (S(oldPdf).match(/[-\w]{25,}/) || [''])[0];
    check('A', '수정 재제출: 접수번호 유지·새 PDF·이전 PDF 휴지통·메일 없음',
      r2.ok && r2.id === id && !r2.isNew && cell(id, 'PDF링크') !== oldPdf && env.state.trashed.includes(oldId) && env.state.mails.length === m0,
      `${r2.id} / 휴지통 ${env.state.trashed.length}건 / 메일 +${env.state.mails.length - m0}`);
    const m1 = env.state.mails.length;
    editStatus(id, '선정');
    const got = mailsTo(u, m1);
    check('A', '선정 → 선정 메일(본인)', got.length === 1 && /선정/.test(got[0].subject) && S(cell(id, '메일발송')) === 'Y', got.map((x) => x.subject).join(','));
    env.setUser(u);
    check('A', '선정 후에는 교수가 수정 불가', env.g.loadApp(id).editable === false);
  }

  // D: 미선정 — 사유 없으면 메일 미발송 메모, 사유 넣고 다시 고르면 발송
  {
    const id = ids[3], u = USERS[3], m0 = env.state.mails.length;
    editStatus(id, '미선정');
    const note = list.notes[rowOf(id) + ',' + H('선정상태')] || '';
    check('D', '미선정(사유 없음) → 메일 미발송 + 메모', mailsTo(u, m0).length === 0 && /미선정사유/.test(note), note);
    setCell(id, '미선정사유', '예산 범위 초과로 다음 학기 재신청 권장');
    editStatus(id, '미선정');
    const got = mailsTo(u, m0);
    check('D', '사유 입력 후 → 미선정 메일(사유 포함)', got.length === 1 && got[0].body.includes('예산 범위 초과'), got.map((x) => x.body).join(','));
  }

  // C: 보완요청 → 메일 → 마감 후(12/20)에도 보완기한(12/24)까지 수정·재제출 → '접수'로 복귀
  {
    const id = ids[2], u = USERS[2], m0 = env.state.mails.length;
    setCell(id, '보완내용', '9~10주차 Pre-class 퀴즈 문항 수를 적어 주세요');
    setCell(id, '보완기한', new Date('2026-12-24T00:00:00+09:00'));
    editStatus(id, '보완요청');
    const got = mailsTo(u, m0);
    check('C', '보완요청 → 메일(보완내용·기한)', got.length === 1 && got[0].body.includes('Pre-class 퀴즈') && got[0].body.includes('2026-12-24'), got.map((x) => x.body).join(','));
    setNow('2026-12-20T10:00:00+09:00');   // 신청 마감(12/14 17:00) 이후
    const p = await ctx.newPage(); watch(p);
    await p.goto(base + '/?as=' + u);
    await p.waitForSelector('.app-table');
    const home = await p.textContent('#app');
    check('C', '마감 후 화면: 신청기간 아님 안내 + 보완요청 건은 "열기·수정"', /신청기간이 아닙니다/.test(home) && /보완요청/.test(home) && /열기·수정/.test(home));
    await shot(p, 'C-4-after-deadline-fix-request', false);
    await p.click('tr:has-text("보완요청") button');
    await p.waitForSelector('.steps');
    check('C', '보완요청 건 열면 수정 가능 상태', !(await p.isVisible('text=현재 수정할 수 없는 상태')));
    await p.close();
    env.setUser(u);
    const r = env.g.loadApp(id);
    r.data.weeks[8].pre = 'ESG 평가체계 영상 시청 + 사전 퀴즈 5문항';
    r.data.weeks[9].pre = 'ESG 평가체계 영상 시청 + 사전 퀴즈 5문항';
    const r2 = env.g.submitApp({ id, data: r.data });
    check('C', '보완 재제출 → 상태 "접수"로 복귀', r2.ok && S(cell(id, '선정상태')) === '접수', S(cell(id, '선정상태')));
    env.setUser(USERS[3]);
    const late = env.g.submitApp({ id: '', data: JSON.parse(JSON.stringify(samples[3].data)) });
    check('C', '마감 후 새 신청은 막힘', late.ok === false && /신청기간이 아닙니다/.test(late.errors.join()), late.errors && late.errors.join());
    setNow(null);
  }

  // 보관기간: 학기종료일 2027-06-21 → 2년 뒤 개인정보 삭제 (시트의 삭제일 수식은 학기종료일+2년/10년으로 흉내)
  {
    const all = Object.values(ids);
    const endOk = all.every((id) => { const v = cell(id, '학기종료일'); return v instanceof Date || Object.prototype.toString.call(v) === '[object Date]'; })
      && all.every((id) => new Date(cell(id, '학기종료일')).toISOString().slice(0, 10) === '2027-06-20');   // KST 6/21 00:00 = UTC 6/20 15:00
    check('보관', '제출 행의 학기종료일 = 2027-06-21', endOk, all.map((id) => env.g.Utilities.formatDate(new Date(cell(id, '학기종료일')), 'Asia/Seoul', 'yyyy-MM-dd')).join(', '));
    all.forEach((id) => {
      setCell(id, '개인정보삭제일', new Date('2029-06-21T00:00:00+09:00'));
      setCell(id, '이력삭제일', new Date('2037-06-21T00:00:00+09:00'));
    });
    const detailBefore = env.sheet('신청상세').records().length;
    setNow('2029-06-20T03:00:00+09:00');
    env.g.monthlyCleanup();
    check('보관', '하루 전(2029-06-20)에는 아무것도 지우지 않음', all.every((id) => S(cell(id, '이메일'))) && env.sheet('삭제대장').records().length === 0);
    setNow('2029-07-01T03:00:00+09:00');   // 매월 1일 03시 실행
    const trashed0 = env.state.trashed.length;
    env.g.monthlyCleanup();
    const cleared = all.every((id) => !S(cell(id, '이메일')) && !S(cell(id, '휴대폰(선택)')) && !S(cell(id, 'PDF링크')) && S(cell(id, '개인정보삭제완료')) === 'Y');
    const kept = all.every((id) => S(cell(id, '과목명(한)')) && S(cell(id, '선정상태')));
    const log = env.sheet('삭제대장').records();
    check('보관', '2029-07-01 실행: 이메일·휴대폰·PDF 삭제, 삭제완료=Y', cleared);
    check('보관', '개발 이력(과목명·선정상태)은 10년까지 남음', kept);
    check('보관', 'PDF 파일 휴지통 + 신청상세 원본 삭제', env.state.trashed.length - trashed0 === all.length && env.sheet('신청상세').records().length < detailBefore,
      `PDF ${env.state.trashed.length - trashed0}건, 신청상세 ${detailBefore}→${env.sheet('신청상세').records().length}`);
    check('보관', '삭제대장 기록', log.some((r) => /개인정보 삭제\(2년\)/.test(r['구분']) && Number(r['건수']) === all.length), log.map((r) => r['구분'] + ' ' + r['건수']).join(', '));
    setNow(null);
  }

  await browser.close();
  server.close();

  // ───────── 결과 ─────────
  problems.forEach((x) => check('화면', x, false));
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log('\n결과  그룹   확인 항목');
  results.forEach((r) => console.log((r.ok ? ' ✅ ' : ' ❌ ') + ' ' + pad(r.group, 5) + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')));
  const fail = results.filter((r) => !r.ok);
  const named = Object.fromEntries(Object.entries(ids).map(([k, v]) => [samples[k].label, v]));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ 접수번호: named, results }, null, 2) + '\n');
  console.log(`\n${results.length - fail.length}/${results.length} 통과 · 접수번호 ${JSON.stringify(named)}`);
  if (fail.length) process.exit(1);
})().catch((e) => {
  results.forEach((r) => console.log((r.ok ? ' ✅ ' : ' ❌ ') + r.group + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')));
  console.error(e); process.exit(1);
});
