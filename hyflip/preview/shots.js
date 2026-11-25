/**
 * 화면 점검 — 미리보기 서버를 띄우고 Playwright로 실제 신청 흐름을 클릭해 보며 캡처합니다.
 * 실행: npm run shots   (결과: docs/screenshots/*.png, 문제가 있으면 목록을 출력하고 종료 코드 1)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { start, DEFAULT_USER } = require('./server.js');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const PORT = Number(process.env.PORT || 8798);
const base = 'http://localhost:' + PORT;
const OTHER = 'prof.lee@hanyang.ac.kr';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, env } = await start(PORT);
  const browser = await chromium.launch();
  const problems = [];
  const scale = Number(process.env.SCALE || 2);
  const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
  const dialogs = [];
  const watch = (page) => {
    page.on('pageerror', (e) => problems.push('JS 오류: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts|cdnjs|ERR_|favicon/i.test(m.text())) problems.push('console: ' + m.text()); });
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  };
  const noHScroll = async (page, where) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) problems.push(where + ': 가로 스크롤 ' + over + 'px');
  };
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const next = async (page) => { await page.click('.btns button.primary:has-text("다음")'); await page.waitForTimeout(250); };
  const fill = (page, p, v) => page.fill(`[data-p="${p}"]`, String(v));
  const pick = (page, p, v) => page.selectOption(`[data-p="${p}"]`, v);
  // 주차는 접혀 있을 수 있으므로 사람처럼 주차 제목을 눌러 펼친 뒤 유형을 고릅니다
  const weekType = async (page, i, v) => {
    const d = page.locator('details').nth(i);
    if (!(await d.evaluate((el) => el.open))) await d.locator('summary').click();
    await pick(page, `weeks.${i}.type`, v);
  };

  // ───────── 1) 모바일 375 — 새 신청서 작성 전체 흐름 ─────────
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: scale });
  const p = await ctx.newPage(); watch(p);
  await p.goto(base + '/?as=' + DEFAULT_USER);
  await p.waitForSelector('.app-card');
  // 모바일은 표 대신 카드 목록
  if (await p.isVisible('.app-table')) problems.push('모바일에서 내 신청서 표가 보임(카드여야 함)');
  if ((await p.$$('.app-card')).length !== 2) problems.push('모바일 카드 개수 오류');
  const cardBtnH = await p.$eval('.app-card .acts button', (b) => b.getBoundingClientRect().height);
  if (cardBtnH < 36) problems.push('카드 버튼이 너무 작음: ' + cardBtnH + 'px');
  const homeText = await p.textContent('#app');
  if (!/FL-2027-1-001/.test(homeText) || !/\(미제출\)/.test(homeText)) problems.push('내 신청서 목록에 제출·미제출 건이 보이지 않음');
  if (/FL-2027-1-002/.test(homeText)) problems.push('다른 교수(박교수)의 신청서가 목록에 보임');
  await noHScroll(p, '모바일 첫 화면');
  await shot(p, '01-mobile-home');

  // 안내·동의: 동의 없이 다음 → 막힘
  await p.click('button:has-text("새 신청서 작성")');
  await p.waitForSelector('.steps');
  await next(p);
  if (!/필수 동의/.test(lastDialog())) problems.push('필수 동의 없이 다음으로 넘어감: ' + lastDialog());
  await p.check('[data-p="consent.required"]');
  await shot(p, '02-mobile-consent');
  await next(p);

  // 기본정보: 과목 검색 → 선택 → 자동 채움
  await p.waitForSelector('#q');
  await p.fill('#q', '교육공학');
  await p.waitForSelector('#qres [data-i]');
  await shot(p, '03-mobile-search', false);
  await p.click('#qres [data-i="0"]');
  await p.waitForTimeout(200);
  const code = await p.inputValue('[data-p="basic.courseCode"]');
  const nameEn = await p.inputValue('[data-p="basic.nameEn"]');
  if (code !== 'EDU3021' || !nameEn) problems.push('과목 선택 자동 채움 안 됨: ' + code + ' / ' + nameEn);
  // 다음을 누르면 비어 있는 필수 항목 안내
  await next(p);
  if (!/직위/.test(lastDialog())) problems.push('기본정보 필수 항목 안내 누락: ' + lastDialog());
  await fill(p, 'basic.prof', '김교수');
  await fill(p, 'basic.position', '부교수');
  await fill(p, 'basic.org', '사범대학 교육공학과');
  await pick(p, 'basic.classType', 'Smart-F');
  await pick(p, 'basic.creditPlan', '3학점(온1.5+오1.5)');
  await pick(p, 'basic.devType', '신규');
  await pick(p, 'basic.shootType', '셀프스튜디오');
  const auto = await p.inputValue('#videoWeeksAuto');
  if (!/^14주/.test(auto)) problems.push('영상 주차 자동 계산 표시 오류: ' + auto);
  await noHScroll(p, '모바일 기본정보');
  await shot(p, '04-mobile-basic');
  await next(p);

  // 교과목 개요
  await p.waitForSelector('[data-p="overview.purpose"]');
  for (const k of ['purpose', 'features', 'effects', 'summaryKo', 'goals']) await fill(p, 'overview.' + k, '미리보기 입력 — ' + k);
  await next(p);

  // 운영 전략: 평가 비율 합계 100% 아니면 막힘
  await p.waitForSelector('#evalSum');
  for (const k of ['pre', 'inClass', 'post']) await fill(p, 'strategy.' + k, '미리보기 입력 — ' + k);
  await fill(p, 'strategy.evalItems.0.pct', 20);
  const sumCls = await p.getAttribute('#evalSum', 'class');
  if (!/bad/.test(sumCls)) problems.push('평가 비율 110%인데 합계 경고 표시 없음');
  await shot(p, '05-mobile-eval-110');
  await next(p);
  if (!/100%/.test(lastDialog())) problems.push('평가 비율 110%로 다음 단계 진행됨: ' + lastDialog());
  await fill(p, 'strategy.evalItems.0.pct', 10);
  await next(p);

  // 주차별 설계: 7주차 중간고사로 옮기기, 영상 주차 미달 막힘 확인
  await p.waitForSelector('#videoCount');
  await weekType(p, 6, '시험');
  await weekType(p, 7, '영상');
  await p.waitForTimeout(150);
  if (!/14주/.test(await p.textContent('#videoCount'))) problems.push('주차 유형 변경 후 영상 주차 계산 오류');
  for (let i = 0; i < 16; i++) {
    const sel = `[data-p="weeks.${i}.topic"]`;
    if (i === 6 || i === 7) { const d = p.locator('details').nth(i); if (!(await d.evaluate((el) => el.open))) await d.locator('summary').click(); }
    if (await p.isVisible(sel)) {
      if (i === 6) await p.fill(sel, '중간고사');
      else if (i === 7 || !(await p.inputValue(sel))) await p.fill(sel, (i + 1) + '주차 학습주제');
    }
  }
  // 영상 주차를 7주로 줄이면 막혀야 함 (1~7주차를 오프라인으로)
  for (const i of [0, 1, 2, 3, 4, 5, 8]) { await weekType(p, i, '오프라인'); }
  await p.waitForTimeout(150);
  await next(p);
  if (!/8주 이상/.test(lastDialog())) problems.push('영상 7주인데 다음 단계로 넘어감: ' + lastDialog());
  for (const i of [0, 1, 2, 3, 4, 5, 8]) { await weekType(p, i, '영상'); }
  await p.waitForTimeout(150);
  await noHScroll(p, '모바일 주차별 설계');
  await shot(p, '06-mobile-weeks');
  await next(p);

  // 확인·제출
  await p.waitForSelector('button:has-text("제출")');
  await shot(p, '07-mobile-confirm');
  const before = env.state.mails.length;
  await p.click('.btns button.primary:has-text("제출")');
  await p.waitForSelector('.notice.ok', { timeout: 10000 });
  const doneText = await p.textContent('.notice.ok');
  const m = doneText.match(/FL-2027-1-\d{3}/);
  if (!m) problems.push('접수번호 표시 없음: ' + doneText);
  const doneAll = await p.textContent('#app');
  if (!/서약서는 따로 내지 않습니다/.test(doneAll) || /서약서 1부와 함께/.test(doneAll)) problems.push('완료 화면 개인정보서약서 안내가 11/25 결정과 다름');
  if (!/PDF 마지막 쪽/.test(doneAll)) problems.push('완료 화면에 "동의 내역은 PDF 마지막 쪽" 안내 없음');
  await shot(p, '08-mobile-done', false);
  const mails = env.state.mails.slice(before);
  if (mails.length !== 1 || mails[0].to !== DEFAULT_USER || (mails[0].opt && mails[0].opt.cc)) {
    problems.push('접수 메일이 본인에게만 1통 가지 않음: ' + JSON.stringify(mails.map((x) => [x.to, x.opt])));
  }
  const drafts = env.sheet('신청상세').records().filter((r) => r['이메일'] === DEFAULT_USER && r['저장구분'] !== '제출');
  if (drafts.length !== 1) problems.push('임시저장 행 개수 이상(기존 샘플C 1건이어야 함): ' + drafts.length);

  // 신청서 PDF(변환 전 HTML) — A4 폭
  const pdfHref = await p.getAttribute('a:has-text("신청서 PDF 열기")', 'href');
  const pdf = await (await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: scale })).newPage();
  watch(pdf);
  await pdf.goto(base + pdfHref);
  const pdfText = await pdf.textContent('body');
  if (!m || !pdfText.includes(m[0])) problems.push('PDF에 접수번호 없음');
  if (!/교육공학 세미나/.test(pdfText) || !/시험/.test(pdfText)) problems.push('PDF에 과목명·주차 유형 누락');
  const wk = await pdf.$$eval('table.wk tr', (rows) => rows.slice(1).map((r) => r.cells[0].innerText.replace(/\s+/g, ' ') + '|' + r.cells[1].innerText));
  if (!/^7 시험\|중간고사/.test(wk[6] || '') || !/^8 영상\|8주차/.test(wk[7] || '')) problems.push('PDF 7·8주차 표가 화면 입력과 다름: ' + wk[6] + ' / ' + wk[7]);
  if (/<\?|\?>/.test(pdfText)) problems.push('PDF 템플릿 태그가 그대로 보임');
  await shot(pdf, '09-pdf-a4');

  // 다른 교수: 내 목록에 남의 신청 없음 + 접수번호로 직접 열어도 막힘
  const o = await ctx.newPage(); watch(o);
  await o.goto(base + '/?as=' + OTHER);
  await o.waitForSelector('.card h2');
  const otherText = await o.textContent('#app');
  if (/FL-2027-1-/.test(otherText)) problems.push('다른 교수 화면에 남의 신청서가 보임');
  const peek = await o.evaluate((id) => fetch('/__api/loadApp', { method: 'POST', body: JSON.stringify([id]) }).then((r) => r.json()), m ? m[0] : 'FL-2027-1-001');
  if (peek.ok) problems.push('다른 교수가 남의 신청서를 열 수 있음');
  await shot(o, '10-mobile-other-prof', false);

  // 학교 계정이 아니면 접근 거부
  const g = await ctx.newPage(); watch(g);
  await g.goto(base + '/?as=someone@gmail.com');
  if (!/접근 권한이 없습니다/.test(await g.textContent('body'))) problems.push('개인 Gmail 접근이 막히지 않음');
  await shot(g, '11-mobile-denied', false);

  // ───────── 2) 태블릿 768 · PC 1440 ─────────
  for (const [w, h, tag] of [[768, 1024, 'tablet'], [1440, 900, 'desktop']]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    const t = await c.newPage(); watch(t);
    await t.goto(base + '/?as=' + DEFAULT_USER);
    await t.waitForSelector('.app-table tr td');
    if (await t.isVisible('.app-cards')) problems.push(tag + ': 카드 목록이 표와 함께 보임');
    await noHScroll(t, tag + ' 첫 화면');
    await shot(t, (tag === 'tablet' ? '12' : '14') + '-' + tag + '-home');
    // 임시저장본(샘플C) 다시 열기 → 저장된 단계(주차별 설계)로 열림
    await t.click('tr:has-text("(미제출)") button');
    await t.waitForSelector('#videoCount');
    await noHScroll(t, tag + ' 주차별 설계');
    await shot(t, (tag === 'tablet' ? '13' : '15') + '-' + tag + '-draft-weeks', false);
    await c.close();
  }

  await browser.close();
  server.close();
  if (problems.length) {
    console.error('문제 ' + problems.length + '건:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  console.log('화면 점검 통과 — 캡처: ' + path.relative(process.cwd(), OUT));
})().catch((e) => { console.error(e); process.exit(1); });
