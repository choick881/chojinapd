// Code.gs와 Index.html <script>의 문법만 검사합니다 (실행하지 않음).
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = path.join(__dirname, '..', 'src');
new vm.Script(fs.readFileSync(path.join(src, 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
const html = fs.readFileSync(path.join(src, 'Index.html'), 'utf8');
new vm.Script(html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')), { filename: 'Index.html' });
console.log('문법 검사 통과: Code.gs, Index.html');
