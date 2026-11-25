/**
 * Index.html 화면 스크립트 자동 테스트.
 * Index.html의 <script>를 Node에서 그대로 실행하고, google.script.run을
 * "느리게 응답하는 가짜 서버"(fake-gas의 Code.gs)로 연결합니다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load, fullData } = require('./fake-gas');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Index.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function el() {
  return { innerHTML: '', textContent: '', style: {}, disabled: false, addEventListener() {}, querySelectorAll: () => [] };
}

/** 화면 + 가짜 서버. delayMs만큼 늦게 응답합니다. */
function boot({ delayMs = 30, user } = {}) {
  const server = load({ user });
  const els = {};
  const calls = [];
  const ui = { alerts: [], toasts: [], confirm: true };
  const run = () => {
    let ok = () => {}, fail = () => {};
    const api = {
      withSuccessHandler(f) { ok = f; return proxy; },
      withFailureHandler(f) { fail = f; return proxy; }
    };
    const proxy = new Proxy(api, {
      get(t, fn) {
        if (fn in t) return t[fn];
        return (...args) => {
          calls.push(fn);
          setTimeout(() => {
            try {
              const plain = JSON.parse(JSON.stringify(args));          // google.script.run 직렬화 흉내
              const r = server.g[fn](...plain);
              ok(r === undefined ? null : JSON.parse(JSON.stringify(r)));
            } catch (e) { fail(e); }
          }, delayMs);
        };
      }
    });
    return proxy;
  };
  const ctx = {
    console, setTimeout, clearTimeout, Promise,
    google: { script: { get run() { return run(); } } },
    document: { getElementById: id => (els[id] = els[id] || el()), querySelectorAll: () => [] },
    window: { scrollTo() {} },
    alert: m => ui.alerts.push(m),
    confirm: () => ui.confirm,
    event: undefined
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx, { filename: 'Index.html' });
  const js = code => vm.runInContext(code, ctx);
  return { server, ctx, js, els, calls, ui };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function idle(env) { await wait(20); await env.js('saveQueue'); await wait(20); }

test('[체크리스트/변경2] 첫 단계에서 "다음"을 누르자마자 "임시저장"을 눌러도 (미제출)은 하나만 생긴다', async () => {
  const env = boot({ delayMs: 80 });
  await wait(150);                                     // getInitData
  env.js('newApp(); S.data.consent.required = true;');
  env.js('go(1)');                                     // 저장 시작(응답 전)
  env.js('save(true)');                                // 바로 임시저장
  env.js('save(true)');                                // 한 번 더
  await idle(env);
  const rows = env.server.sheet('신청상세').records();
  assert.equal(rows.length, 1, '임시저장 행이 하나여야 함');
  assert.equal(env.js('S.id'), rows[0]['접수번호']);
  assert.equal(env.calls.filter(c => c === 'saveDraft').length, 3, '저장 요청은 세 번 모두 순서대로 나감');
});

test('[변경2] 저장 중에 바로 제출해도 주인 없는 임시저장 행이 남지 않는다', async () => {
  const env = boot({ delayMs: 80 });
  await wait(150);
  env.js('newApp()');
  env.ctx.__data = fullData();
  env.js('Object.assign(S.data, __data);');
  env.js('save(false)');
  env.ctx.event = { target: Object.assign(el(), { textContent: '제출' }) };
  env.js('submitApp()');
  await wait(400);
  const detail = env.server.sheet('신청상세').records();
  assert.equal(detail.length, 1);
  assert.equal(detail[0]['접수번호'], 'FL-2027-1-001');
  assert.equal(env.js('S.view'), 'done');
});

test('[변경2] 저장 응답 전에 다른 신청서를 열면 남은 저장은 건너뛴다', async () => {
  const env = boot({ delayMs: 60 });
  await wait(120);
  env.js('newApp(); S.data.consent.required = true;');
  env.js('save(false)');                                 // 첫 저장: 서버로 나감(응답 대기 중)
  await wait(10);
  env.js('save(false)');                                 // 두 번째 저장: 줄 서서 대기
  env.js('newApp()');                                    // 그사이 다른 신청서로 전환
  await idle(env);
  assert.equal(env.calls.filter(c => c === 'saveDraft').length, 1);
  assert.equal(env.js('S.id'), null, '새 신청서에 이전 번호가 붙으면 안 됨');
});

test('[변경6] 검증 실패 후에도 버튼 이름이 "수정 내용 제출"로 돌아온다', async () => {
  const env = boot({ delayMs: 10 });
  await wait(40);
  env.js('newApp()');
  env.ctx.__data = fullData();
  env.js('Object.assign(S.data, __data); S.submitted = true;');
  // 화면 검사는 통과하지만 서버 검증에서 걸리게: 교과목 개요 누락
  env.js('S.data.overview = {};');
  const btn = Object.assign(el(), { textContent: '수정 내용 제출' });
  env.ctx.event = { target: btn };
  env.js('submitApp()');
  assert.equal(btn.textContent, '제출 중… (PDF 생성)');
  await wait(100);
  assert.equal(btn.textContent, '수정 내용 제출');
  assert.equal(btn.disabled, false);
  assert.match(env.els.errs.innerHTML, /교과목 개요/);
});

test('[v1.0.2] 첫 화면에 대리신청 체크박스가 없고 로그인 계정이 보인다', async () => {
  const env = boot({ delayMs: 5 });
  await wait(30);
  env.js('newApp()');
  const out = env.els.app.innerHTML;
  assert.doesNotMatch(out, /data-p="proxy"|대리신청합니다/);
  assert.match(out, /prof\.a@hanyang\.ac\.kr/);
});
