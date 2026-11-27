/**
 * 웹앱 진입점
 *   ?p=book (기본)  예약하기
 *   ?p=my           내 예약
 *   ?p=checkin&st=ST01&k=QR키   QR 체크인
 *   ?p=admin        담당자 화면
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var page = ['book', 'my', 'checkin', 'admin'].indexOf(p.p) !== -1 ? p.p : 'book';
  var file = page === 'checkin' ? 'ui/Checkin' : page === 'admin' ? 'ui/Admin' : 'ui/App';
  var t = HtmlService.createTemplateFromFile(file);
  t.boot = JSON.stringify({ page: page, st: p.st || '', k: p.k || '', url: webAppUrl() })
    .replace(/</g, '\\u003c');
  var titles = { book: '셀프스튜디오 예약', my: '내 예약', checkin: '스튜디오 체크인', admin: '담당자 화면' };
  return t.evaluate()
    .setTitle('HY FLIP ' + titles[page])
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** HTML 템플릿 안에서 다른 HTML 파일 포함: <?!= include('ui/Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
