/**
 * 로컬 미리보기 서버 — 실제 서버 코드(src/Code.gs)를 가짜 시트·드라이브·메일 위에서 돌리고 화면을 띄웁니다.
 * 실행: npm run preview  →  http://localhost:8788/
 *   ?as=이메일 로 사용자 전환 (기본: prof.kim@hanyang.ac.kr, 접근 거부 확인: ?as=someone@gmail.com)
 * 메일은 실제로 발송되지 않고 /__outbox 에서, 신청서 PDF(변환 전 HTML)는 /__pdf/<파일ID> 에서 확인합니다.
 * 시트 상태는 /__sheet/<탭이름> 에서 JSON으로 볼 수 있습니다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { load, defaultSheets } = require('../test/fake-gas.js');
const samples = require('../test/fixtures/samples-2027-1.json');

const SRC = path.join(__dirname, '..', 'src');
const DEFAULT_USER = 'prof.kim@hanyang.ac.kr';
// 화면(Index.html)이 google.script.run으로 부르는 공개 함수만 허용
const API = ['getInitData', 'loadApp', 'saveDraft', 'searchCourses', 'submitApp'];
const copy = (o) => JSON.parse(JSON.stringify(o));

/** Apps Script HtmlService 템플릿(<? ?>, <?= ?>, <?!= ?>) 평가기 — Pdf.html 미리보기용 */
function compileTemplate(src) {
  let code = 'var __o = "";\nwith (__v) {\n';
  const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    code += '__o += ' + JSON.stringify(src.slice(last, m.index)) + ';\n';
    if (m[1] === '=') code += '__o += __esc(' + m[2] + ');\n';
    else if (m[1] === '!=') code += '__o += String(' + m[2] + ');\n';
    else code += m[2] + '\n';
    last = re.lastIndex;
  }
  code += '__o += ' + JSON.stringify(src.slice(last)) + ';\n}\nreturn __o;';
  // eslint-disable-next-line no-new-func
  return new Function('__v', '__esc', code);
}
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setCfg(sheets, key, value) {
  const row = sheets['설정'].find((r) => r[0] === key);
  if (row) row[1] = value; else sheets['설정'].push([key, value]);
}

function makeEnv(opts = {}) {
  const now = Date.now();
  const sheets = defaultSheets();
  // 2027-1 공문 설정값(docs/설정값_2027-1.md). 미리보기는 "지금"이 항상 신청기간 안이 되도록 시작일만 당깁니다.
  const deadline = new Date('2026-12-14T17:00:00+09:00');
  setCfg(sheets, '신청시작', new Date(Math.min(now - 86400000, new Date('2026-12-05T09:00:00+09:00').getTime())));
  setCfg(sheets, '신청마감', deadline.getTime() > now ? deadline : new Date(now + 14 * 86400000));
  setCfg(sheets, '개발기간시작', new Date('2026-12-15T00:00:00+09:00'));
  setCfg(sheets, '개발기간종료', new Date('2027-02-19T00:00:00+09:00'));
  setCfg(sheets, '담당자연락처', '에듀테크혁신팀 02-2220-1406');
  setCfg(sheets, 'Smart-F 최소주차', 8);
  setCfg(sheets, 'Smart-B 최소주차', 4);
  setCfg(sheets, '학기종료일', new Date('2027-06-21T00:00:00+09:00'));
  samples.forEach((s) => sheets['개설과목'].push(s.courseRow));
  sheets['개설과목'].push(
    ['2027-1', 'EDU3021', '01', '교육공학 세미나', 'Seminar in Educational Technology', '교육공학과', 3, '3', '김교수'],
    ['2027-1', 'EDU2010', '02', '교육방법 및 교육공학', 'Teaching Methods and Educational Technology', '교육학과', 3, '2', '이교수']
  );

  const env = load({ sheets, user: DEFAULT_USER });

  // PDF: 실제 GAS처럼 Pdf.html 템플릿을 평가하고, 변환 전 HTML을 가짜 드라이브 파일에 보관
  env.g.HtmlService.createTemplateFromFile = (name) => {
    const fn = compileTemplate(fs.readFileSync(path.join(SRC, name + '.html'), 'utf8'));
    const t = { evaluate: () => ({ getContent: () => fn(t, esc), setTitle() { return this; }, addMetaTag() { return this; } }) };
    return t;
  };
  env.g.Utilities.newBlob = (data) => ({ getAs: () => ({ html: data, setName(n) { this.name = n; return this; } }) });
  const getFolder = env.g.DriveApp.getFolderById;
  env.g.DriveApp.getFolderById = (id) => {
    const folder = getFolder(id);
    const create = folder.createFile;
    folder.createFile = (blob) => { const f = create(blob); f.html = blob.html; return f; };
    return folder;
  };

  env.g.setup();
  if (opts.seed === false) return env;   // 빈 시트로 시작 (실제 신청서 E2E 테스트용)
  // 시드: 김교수 — 제출 1건(샘플A) + 임시저장 1건(샘플C) / 박교수 — 제출 1건(샘플D, 다른 사람 신청 확인용)
  env.setUser(DEFAULT_USER);
  const a = env.g.submitApp({ id: '', data: copy(samples[0].data) });
  if (!a.ok) throw new Error('시드 실패(샘플A): ' + a.errors.join(', '));
  env.g.saveDraft({ id: '', step: 4, data: copy(samples[2].data) });
  env.setUser('prof.park@hanyang.ac.kr');
  const d = env.g.submitApp({ id: '', data: copy(samples[3].data) });
  if (!d.ok) throw new Error('시드 실패(샘플D): ' + d.errors.join(', '));
  env.state.mails = [];
  return env;
}

/** google.script.run → fetch('/__api/함수') 로 바꿔 주는 스텁 (응답 120ms 지연, JSON 직렬화) */
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

// 가짜 드라이브 주소 → 미리보기 PDF 주소
const localPdf = (s) => s.replace(/https:\/\/drive\.google\.com\/file\/d\/([-\w]+)\/view/g, '/__pdf/$1');

function start(port, opts = {}) {
  const env = makeEnv(opts);
  let user = DEFAULT_USER;
  const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj, null, 2)); };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('as')) user = url.searchParams.get('as').toLowerCase();

    if (url.pathname.startsWith('/__api/') && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const fn = url.pathname.slice(7);
        let out;
        try {
          if (API.indexOf(fn) === -1) throw new Error('허용되지 않은 함수: ' + fn);
          env.setUser(user);
          const r = env.g[fn](...JSON.parse(body || '[]'));
          out = { ok: true, result: JSON.parse(localPdf(JSON.stringify(r === undefined ? null : r))) };
        } catch (e) { out = { ok: false, error: e.message }; }
        json(res, out);
      });
      return;
    }
    if (url.pathname === '/__outbox') return json(res, env.state.mails);
    if (url.pathname.startsWith('/__sheet/')) {
      const sh = env.sheet(decodeURIComponent(url.pathname.slice(9)));
      if (!sh) { res.writeHead(404); res.end(); return; }
      return json(res, sh.records());
    }
    if (url.pathname.startsWith('/__pdf/')) {
      const f = env.state.files[url.pathname.slice(7)];
      if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('PDF 없음'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(f.html);
      return;
    }
    if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }

    env.setUser(user);
    const out = env.g.doGet();
    let html;
    if (out.html) html = out.html;   // 접근 거부 화면 (createHtmlOutput)
    else html = out.getContent()
      .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">')
      .replace('<script>', stub() + '<script>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, env, setUser: (u) => { user = u; } })));
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8788);
  start(port).then(() => {
    console.log('미리보기: http://localhost:' + port + '/   (사용자: ' + DEFAULT_USER + ')');
    console.log('  다른 교수: /?as=prof.park@hanyang.ac.kr · 접근 거부: /?as=someone@gmail.com');
    console.log('  메일: /__outbox · 시트: /__sheet/신청목록 · PDF: 제출 후 화면의 "신청서 PDF 열기"');
  });
}

module.exports = { start, DEFAULT_USER, compileTemplate };
