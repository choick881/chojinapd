#!/usr/bin/env node
/**
 * HY FLIP 구글 설정 마법사 (테스트용 사본)
 *
 *   npm run setup:google                       # 대화형
 *   npm run setup:google -- --script-id=1AbC…  # 스크립트 ID를 미리 넘김
 *   npm run setup:google -- --script-id=… --yes   # 확인 질문 생략 (Remote Control용)
 *
 * 하는 일
 *   1) 도구 설치(npm install)
 *   2) Apps Script API 설정 페이지 열기  ← 사람이 "사용" 클릭
 *   3) clasp 로그인                      ← 사람이 부서 공동계정으로 로그인·허용
 *   4) 테스트용 사본의 스크립트 ID 받기   ← 사람이 사본을 만들고 ID 붙여넣기
 *   5) 코드 올리기(clasp push)
 *   6) 테스트용 웹 앱 배포(처음이면 새로 만들고, 있으면 새 버전으로 갱신)
 *   7) .env.test 작성, 웹 앱 URL과 남은 일 안내
 *
 * 실제 신청 페이지(prod)는 건드리지 않습니다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.test');
const CLASP_JSON = path.join(ROOT, '.clasp.json');
const CLASPRC = path.join(os.homedir(), '.clasprc.json');
const API_PAGE = 'https://script.google.com/home/usersettings';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const YES = !!args.yes;
const CLASP = process.env.HYFLIP_CLASP || 'npx clasp';   // 테스트에서 가짜 clasp로 바꿀 수 있게

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, a => res(a.trim())));
const step = (n, t) => console.log(`\n▶ ${n}/7 ${t}`);
const hand = t => console.log(`  👉 직접 하실 일: ${t}`);

function run(cmd, opts = {}) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (opts.capture && r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0 && !opts.allowFail) throw new Error(`명령이 실패했습니다: ${cmd}`);
  return r;
}
function openUrl(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  spawnSync(cmd, { shell: true, stdio: 'ignore' });
  console.log(`  (브라우저가 열리지 않으면 직접 여세요: ${url})`);
}
async function pause(msg) {
  if (YES) { console.log(`  (--yes: "${msg}" 확인 생략)`); return; }
  await ask(`  ${msg} 끝나면 Enter를 누르세요. `);
}
function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  return Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
}
/** 스크립트 ID, 또는 편집기 URL(…/projects/<ID>/edit, …/d/<ID>/edit)에서 ID를 뽑습니다 */
function parseScriptId(s) {
  s = String(s || '').trim();
  const m = s.match(/projects\/([-\w]{20,})/) || s.match(/\/d\/([-\w]{20,})/) || s.match(/^([-\w]{20,})$/);
  return m ? m[1] : '';
}

async function main() {
  console.log('HY FLIP 구글 설정 마법사 (테스트용 사본)\n모든 로그인은 부서 공동계정으로 하세요. 실제 신청 페이지는 건드리지 않습니다.');
  const env = readEnv();

  step(1, '도구 설치');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) throw new Error(`Node.js 18 이상이 필요합니다(현재 ${process.versions.node}). https://nodejs.org 에서 LTS를 설치하세요.`);
  if (!fs.existsSync(path.join(ROOT, 'node_modules', '@google', 'clasp')) && !process.env.HYFLIP_CLASP) run('npm install --no-audit --no-fund');
  else console.log('  이미 설치되어 있습니다.');

  step(2, 'Apps Script API 켜기');
  hand('열리는 페이지에서 "Google Apps Script API"를 "사용"으로 바꾸기 (이미 켜져 있으면 그대로)');
  if (!YES) openUrl(API_PAGE); else console.log(`  페이지: ${API_PAGE}`);
  await pause('API를 켜셨으면');

  step(3, 'clasp 로그인');
  if (fs.existsSync(CLASPRC)) console.log('  이미 로그인되어 있습니다. 다른 계정이면 "npx clasp logout" 후 다시 실행하세요.');
  else { hand('열리는 브라우저에서 부서 공동계정을 고르고 "허용"'); run(`${CLASP} login`); }

  step(4, '테스트용 사본의 스크립트 ID');
  let scriptId = parseScriptId(args['script-id'] || env.HYFLIP_SCRIPT_ID);
  if (scriptId) console.log(`  사용할 스크립트 ID: ${scriptId.slice(0, 10)}…`);
  while (!scriptId) {
    if (YES) throw new Error('--yes 모드에서는 --script-id=… 가 필요합니다.');
    hand('실제 데이터 시트에서 "파일 > 사본 만들기"(이름: HYFLIP_신청시스템_테스트) → 사본에서 "확장 프로그램 > Apps Script" → ⚙ 프로젝트 설정 > 스크립트 ID 복사');
    scriptId = parseScriptId(await ask('  스크립트 ID(또는 Apps Script 편집기 주소)를 붙여넣으세요: '));
    if (!scriptId) console.log('  ID 형식이 아닙니다. 다시 붙여넣어 주세요.');
  }
  fs.writeFileSync(CLASP_JSON, JSON.stringify({ scriptId, rootDir: 'src' }, null, 2) + '\n');

  step(5, '코드 올리기 (clasp push)');
  run('node scripts/check-syntax.js');
  run(`${CLASP} push --force`);

  step(6, '테스트용 웹 앱 배포');
  let deploymentId = env.HYFLIP_SCRIPT_ID === scriptId ? (env.HYFLIP_DEPLOYMENT_ID || '') : '';
  const desc = `HY FLIP ${require('../package.json').version} 테스트`;
  if (deploymentId) {
    run(`${CLASP} deploy --deploymentId ${deploymentId} --description "${desc}"`);
  } else {
    const out = run(`${CLASP} deploy --description "${desc}"`, { capture: true }).stdout || '';
    const m = out.match(/(AKfy[-\w]+)/);
    if (!m) throw new Error('배포 ID를 찾지 못했습니다. "npx clasp deployments"로 확인해 .env.test에 직접 적어 주세요.');
    deploymentId = m[1];
  }
  fs.writeFileSync(ENV_FILE, `# 테스트용 사본 (setup-google.js가 ${new Date().toISOString().slice(0, 10)}에 작성)\nHYFLIP_SCRIPT_ID=${scriptId}\nHYFLIP_DEPLOYMENT_ID=${deploymentId}\n`);

  step(7, '완료');
  const webUrl = `https://script.google.com/a/macros/hanyang.ac.kr/s/${deploymentId}/exec`;
  console.log(`  .env.test를 저장했습니다. 다음부터는 "npm run deploy:test" 한 줄로 갱신됩니다.`);
  console.log(`  테스트용 신청 페이지: ${webUrl}`);
  console.log('\n  남은 일 (직접):');
  console.log(`   1. 편집기에서 setup 실행 → 권한 허용 → "설치 완료: 트리거 2개" 확인: https://script.google.com/home/projects/${scriptId}/edit`);
  console.log('   2. 사본 "설정" 탭: PDF폴더ID(테스트 폴더), 신청기간·개발기간(docs/설정값_2027-1.md), 신청페이지URL(위 주소)');
  console.log('   3. 개설과목 탭에 docs/테스트샘플_입력용.md의 4줄 붙여넣기');
}

main().then(() => rl.close()).catch(e => { console.error('\n❌ ' + e.message); rl.close(); process.exit(1); });
