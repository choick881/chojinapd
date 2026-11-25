/**
 * 화면 점검 — 미리보기 서버를 띄우고 Playwright로 실제 클릭 흐름을 따라가며 캡처합니다.
 * 실행: npm run shots   (결과: docs/screenshots/*.png)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { start, OWNER } = require('./server.js');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const PORT = 8799;
const base = 'http://localhost:' + PORT;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, env } = await start(PORT);
  const browser = await chromium.launch();
  const problems = [];
  const shot = async (page, name, full = true) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
  const watch = (page) => {
    page.on('pageerror', (e) => problems.push('JS 오류: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/qrcode|cdnjs|pretendard|ERR_/i.test(m.text())) problems.push('console: ' + m.text()); });
  };
  const scale = Number(process.env.SCALE || 2);

  // 1) 모바일 375 — 예약 흐름
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: scale });
  const p = await ctx.newPage(); watch(p);
  await p.goto(base + '/?p=book&as=kim.prof@hanyang.ac.kr');
  await p.waitForSelector('.studio');
  await p.check('input[name=studio][value=ST01]', { force: true });
  await p.fill('#date', '2026-12-02');
  await p.dispatchEvent('#date', 'change');
  await p.waitForSelector('.slot[data-m="540"]');
  // 10:00~12:00은 박교수 예약, 14:00 확인중 , 13:00 본인 다른 예약 → 15:30~17:00 선택
  const disabled = await p.$$eval('.slot:disabled', (els) => els.map((e) => e.dataset.m));
  if (!disabled.includes('600') || !disabled.includes('840') || !disabled.includes('780')) problems.push('예약된 시간이 비활성화되지 않음: ' + disabled.join(','));
  await p.click('.slot[data-m="930"]');
  await p.click('.slot[data-m="990"]');
  const sum = await p.textContent('#sum');
  if (!sum.includes('15:30–17:00')) problems.push('선택 요약 오류: ' + sum);
  await shot(p, '01-mobile-time-select');
  // 동의 없이 제출 → 오류 안내
  await p.click('#submit');
  await p.waitForSelector('#formErr:not([hidden])');
  const errText = await p.textContent('#formErr');
  if (!/촬영 유형|동의/.test(errText)) problems.push('필수 항목 안내 누락: ' + errText);
  await p.selectOption('#shootType', { index: 1 });
  await p.check('input[name=purpose]', { force: true });
  await p.check('#agreePrivacy');
  await p.check('#agreeRules');
  await shot(p, '02-mobile-form', true);
  await p.click('#submit');
  await p.waitForSelector('#view-done:not([hidden]) .big-status');
  await shot(p, '03-mobile-done', false);
  // 내 예약
  await p.click('text=내 예약 보기');
  await p.waitForSelector('#myBody .card');
  await shot(p, '04-mobile-my');

  // 2) 촬영 지원 체크 시 근무시간 외 비활성
  const p2 = await ctx.newPage(); watch(p2);
  await p2.goto(base + '/?p=book');
  await p2.waitForSelector('.studio');
  await p2.check('input[name=studio][value=ST05]', { force: true });
  await p2.fill('#date', '2026-12-05'); // 토요일
  await p2.dispatchEvent('#date', 'change');
  await p2.waitForSelector('.slot');
  await p2.check('#support');
  const off = await p2.$$eval('.slot:disabled', (e) => e.length);
  if (off < 26) problems.push('주말 지원 요청이 막히지 않음');
  const note = await p2.isVisible('#dateNote');
  if (!note) problems.push('주말 지원 불가 안내 없음');

  // 3) 체크인 화면 (예약 시간 중)
  const key = env.sheetRows('스튜디오').find((s) => s['코드'] === 'ST01')['QR키'];
  env.at('2026-12-02T15:35:00+09:00');
  const p3 = await ctx.newPage(); watch(p3);
  await p3.goto(base + '/?p=checkin&st=ST01&k=' + key + '&as=kim.prof@hanyang.ac.kr');
  await p3.waitForSelector('#go');
  await shot(p3, '05-mobile-checkin', false);
  await p3.click('#go');
  await p3.waitForSelector('text=체크인 완료');
  env.at('2026-11-30T10:00:00+09:00');

  // 4) 데스크톱 1440 — 담당자 화면
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale === 2 ? 1 : scale });
  const a = await ctx2.newPage(); watch(a);
  await a.goto(base + '/?p=admin&as=' + OWNER);
  await a.waitForSelector('.tbl');
  await shot(a, '06-admin-pending', false);
  await a.click('.tab[data-v=upcoming]');
  await a.waitForSelector('.tbl');
  await shot(a, '07-admin-upcoming', false);
  await a.click('.tab[data-v=stats]');
  await a.waitForSelector('.tbl');
  // 담당자 확정 흐름
  await a.click('.tab[data-v=pending]');
  a.once('dialog', (d) => d.accept());
  await a.click('.tbl .btn.primary');
  await a.waitForFunction(() => document.querySelector('#nPending').textContent === '1');

  // 5) 태블릿 768 — 예약 화면 레이아웃
  const ctx3 = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
  const t = await ctx3.newPage(); watch(t);
  await t.goto(base + '/?p=book&as=prof.lee@hanyang.ac.kr');
  await t.waitForSelector('.studio');
  await shot(t, '08-tablet-book', false);
  const overflow = await t.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) problems.push('768px 가로 스크롤 발생');
  const overflowM = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflowM) problems.push('375px 가로 스크롤 발생');

  console.log('메일 발송(가짜):', env.state.outbox.map((m) => m.to + ' | ' + m.subject).join('\n  '));
  await browser.close();
  server.close();
  if (problems.length) { console.error('문제 발견:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log('화면 점검 통과. 캡처:', fs.readdirSync(OUT).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
