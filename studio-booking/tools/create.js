/**
 * 새 Apps Script 프로젝트 만들기 (최초 1회)
 *   npm run create
 * clasp create가 src/appsscript.json(웹앱·권한 설정)을 덮어쓰지 않도록 백업 후 복원합니다.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const manifest = path.join(root, 'src', 'appsscript.json');
if (fs.existsSync(path.join(root, '.clasp.json'))) {
  console.log('이미 .clasp.json이 있습니다. 새로 만들지 않고 "npm run push"로 올리세요.');
  process.exit(0);
}
const backup = fs.readFileSync(manifest, 'utf8');
try {
  execSync('npx clasp create --type standalone --title "HY FLIP 셀프스튜디오 예약" --rootDir src', { cwd: root, stdio: 'inherit' });
} finally {
  fs.writeFileSync(manifest, backup);
}
const conf = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8'));
conf.filePushOrder = ['src/Rules.js', 'src/Db.js'];
fs.writeFileSync(path.join(root, '.clasp.json'), JSON.stringify(conf, null, 2));
console.log('\n완료: 스크립트 ID ' + conf.scriptId + '\n다음 단계: npm run push');
