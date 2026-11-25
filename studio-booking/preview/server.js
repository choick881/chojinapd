/**
 * 로컬 미리보기 서버 — 실제 서버 코드(src/*.js)를 가짜 시트·캘린더 위에서 돌리고 화면을 띄웁니다.
 * 실행: npm run preview  →  http://localhost:8787/?p=book
 *   ?as=이메일 로 이용자 전환 (담당자: hyflip@hanyang.ac.kr)
 *   PREVIEW_NOW=2026-11-30T10:00:00+09:00 으로 현재 시각 고정
 * 메일은 실제로 발송되지 않고 /__outbox 에서 확인합니다.
 */
const http = require('http');
const { URL } = require('url');
const { createGasEnv } = require('../test/gas-mock.js');

const OWNER = 'hyflip@hanyang.ac.kr';

function seed(env) {
  env.call('setup');
  env.setConfig('담당자 알림 메일', 'staff@hanyang.ac.kr');
  const f = (o) => Object.assign({ studioId: 'ST01', date: '2026-12-02', startMin: 600, endMin: 660, support: false,
    name: '박교수', org: '자연과학대학', shootType: '일반 강의', purpose: '플립러닝 개발', agreedPrivacy: true, agreedRules: true }, o);
  env.as('prof.park@hanyang.ac.kr');
  env.call('apiCreateBooking', f({ startMin: 600, endMin: 720 }));
  env.call('apiCreateBooking', f({ studioId: 'ST09', date: '2026-12-01', startMin: 840, endMin: 960, support: true }));
  env.as('prof.lee@hanyang.ac.kr');
  env.call('apiCreateBooking', f({ name: '이교수', org: '사범대학', startMin: 840, endMin: 930, support: true }));
  env.call('apiCreateBooking', f({ name: '이교수', org: '사범대학', startMin: 1140, endMin: 1260, purpose: '일반 강의' }));
  env.as('kim.prof@hanyang.ac.kr');
  env.call('apiCreateBooking', f({ name: '김교수', org: '경영대학', studioId: 'ST02', date: '2026-12-02', startMin: 780, endMin: 840 }));
  env.call('apiCreateBooking', f({ name: '김교수', org: '경영대학', date: '2026-12-03', startMin: 600, endMin: 690 }));
  // 선정 교수 표시 예시
  env.ss().getSheetByName('선정교수').appendRow(['kim.prof@hanyang.ac.kr', '2027-1학기', '경영통계', '']);
  env.state.outbox = [];
}

function stub() {
  return `<script>
  (function () {
    function runner(ok, fail) {
      return new Proxy({}, { get: function (_, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/__api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
            .then(function (r) { return r.json(); })
            .then(function (j) { setTimeout(function () { j.ok ? ok && ok(j.result) : fail && fail(new Error(j.error)); }, 120); });
        };
      } });
    }
    window.google = { script: { run: runner(null, null) } };
  })();
  </script>`;
}

function start(port, nowIso) {
  const env = createGasEnv({ owner: OWNER, now: nowIso || process.env.PREVIEW_NOW || '2026-11-30T10:00:00+09:00', webUrl: '' });
  seed(env);
  let user = 'kim.prof@hanyang.ac.kr';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('as')) user = url.searchParams.get('as');
    if (url.pathname.startsWith('/__api/') && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const fn = url.pathname.slice(7);
        let out;
        try {
          if (!/^api\w+$/.test(fn)) throw new Error('unknown ' + fn);
          env.as(user);
          out = { ok: true, result: JSON.parse(JSON.stringify(env.call(fn, ...JSON.parse(body || '[]')) ?? null)) };
        } catch (e) { out = { ok: false, error: e.message }; }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (url.pathname === '/__outbox') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(env.state.outbox, null, 2));
      return;
    }
    if (url.pathname === '/__clock' && url.searchParams.get('now')) { env.at(url.searchParams.get('now')); res.end('ok'); return; }
    if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
    env.as(user);
    const params = Object.fromEntries(url.searchParams.entries());
    let html = env.ctx.doGet({ parameter: params }).getContent();
    html = html.replace('<script>var BOOT', stub() + '<script>var BOOT');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, env, setUser: (u) => { user = u; } })));
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  start(port).then(() => console.log('미리보기: http://localhost:' + port + '/?p=book  (담당자: /?p=admin&as=' + OWNER + ')'));
}

module.exports = { start, OWNER };
