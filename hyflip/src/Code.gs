/**
 * HY FLIP 플립러닝 콘텐츠 개발 신청 모듈 (v1.0.2)
 * - v1.0.2: 대리신청 기능 삭제. 책임교수 본인 계정으로만 신청·수정·제출할 수 있습니다.
 * - 데이터 시트: HYFLIP_신청시스템_데이터시트_v1.0 (구글 시트로 변환한 것)
 * - 이 스크립트는 그 시트에 "확장 프로그램 > Apps Script"로 만든 바인딩 스크립트입니다.
 * - 웹 앱 배포: 실행 사용자 = 나(부서 공동계정), 액세스 = 한양대학교 도메인 사용자
 * - 탭 이름과 1행 열 이름을 바꾸면 동작하지 않습니다.
 */

const TZ = 'Asia/Seoul';
const SHEET = {
  CONFIG: '설정', LIST: '신청목록', DETAIL: '신청상세', COURSE: '개설과목',
  MAIL: '메일문구', LOG: '삭제대장'
};
const EVAL_DEFAULT = [
  { name: '출석', pct: 10 }, { name: '과제', pct: 10 },
  { name: '중간고사', pct: 40 }, { name: '기말고사', pct: 40 }
];

/* ───────────────────────── 공통 ───────────────────────── */

function ss_() { return SpreadsheetApp.getActive(); }
function sh_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('시트 탭을 찾을 수 없습니다: ' + name);
  return s;
}
function headers_(sheet) {
  const row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  row.forEach(function (v, i) { map[String(v).trim()] = i + 1; });
  return map;
}
function fmt_(d, pattern) {
  if (!(d instanceof Date)) return d ? String(d) : '';
  return Utilities.formatDate(d, TZ, pattern || 'yyyy-MM-dd HH:mm');
}
/** 학기 값 정규화: 시트가 '2027-1'을 날짜(2027-01-01)로 바꿔 저장한 경우에도 '2027-1'로 돌려줍니다 */
function semKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy') + '-' + Number(Utilities.formatDate(v, TZ, 'M'));
  return String(v == null ? '' : v).trim();
}
function getConfig_() {
  const values = sh_(SHEET.CONFIG).getRange(2, 1, sh_(SHEET.CONFIG).getLastRow() - 1, 2).getValues();
  const cfg = {};
  values.forEach(function (r) { if (r[0] !== '') cfg[String(r[0]).trim()] = r[1]; });
  if (cfg['모집학기'] !== undefined) cfg['모집학기'] = semKey_(cfg['모집학기']);
  return cfg;
}
function currentUser_() {
  const cfg = getConfig_();
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const domain = String(cfg['허용도메인'] || 'hanyang.ac.kr').toLowerCase();
  return { email: email, ok: !!email && email.endsWith('@' + domain), cfg: cfg, domain: domain };
}
function requireUser_() {
  const u = currentUser_();
  if (!u.ok) throw new Error('한양대학교 계정으로 로그인한 경우에만 이용할 수 있습니다.');
  return u;
}
function isOpen_(cfg) {
  const now = new Date();
  const start = cfg['신청시작'], end = cfg['신청마감'];
  return (start instanceof Date ? now >= start : true) && (end instanceof Date ? now <= end : true);
}
function minWeeks_(cfg, classType) {
  return classType === 'Smart-B' ? Number(cfg['Smart-B 최소주차'] || 4) : Number(cfg['Smart-F 최소주차'] || 8);
}
function fileIdFromUrl_(url) {
  const m = String(url || '').match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

/* ───────────────────────── 웹 화면 ───────────────────────── */

function doGet() {
  const u = currentUser_();
  if (!u.ok) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;line-height:1.6">' +
      '<h2>접근 권한이 없습니다</h2><p>한양대학교 계정(@' + u.domain + ')으로 로그인한 뒤 다시 열어 주세요.</p></div>')
      .setTitle('HY FLIP');
  }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('HY FLIP 플립러닝 콘텐츠 개발 신청')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 첫 화면 데이터: 사용자, 모집 정보, 내 신청 목록 */
function getInitData() {
  const u = requireUser_();
  const cfg = u.cfg;
  return {
    email: u.email,
    domain: u.domain,
    semester: String(cfg['모집학기'] || ''),
    open: isOpen_(cfg),
    start: fmt_(cfg['신청시작']),
    deadline: fmt_(cfg['신청마감']),
    devPeriod: fmt_(cfg['개발기간시작'], 'yyyy-MM-dd') + ' ~ ' + fmt_(cfg['개발기간종료'], 'yyyy-MM-dd'),
    minWeeks: { 'Smart-F': minWeeks_(cfg, 'Smart-F'), 'Smart-B': minWeeks_(cfg, 'Smart-B') },
    contact: String(cfg['담당자연락처'] || ''),
    evalDefault: EVAL_DEFAULT,
    apps: listMyApps_(u.email, cfg)
  };
}

/** 내가 책임교수인 신청 목록 */
function listMyApps_(email, cfg) {
  const detail = sh_(SHEET.DETAIL);
  if (detail.getLastRow() < 2) return [];
  const hm = headers_(detail);
  const rows = detail.getRange(2, 1, detail.getLastRow() - 1, detail.getLastColumn()).getValues();
  const statusById = statusMap_();
  const out = [];
  rows.forEach(function (r) {
    const id = String(r[hm['접수번호'] - 1] || '');
    if (!id) return;
    let data = {};
    try { data = JSON.parse(r[hm['데이터(JSON)'] - 1] || '{}'); } catch (e) { data = {}; }
    const owner = String(r[hm['이메일'] - 1] || '').toLowerCase();
    if (appProf_(data, owner) !== email) return;
    if (data.basic && data.basic.semester && String(data.basic.semester) !== String(cfg['모집학기'])) return;
    const st = statusById[id] || null;
    out.push({
      id: id,
      course: (data.basic && data.basic.nameKo) || '(과목 미입력)',
      saveType: String(r[hm['저장구분'] - 1] || ''),
      savedAt: fmt_(r[hm['저장일시'] - 1]),
      status: st ? st.status : '작성 중',
      pdf: st ? st.pdf : '',
      editable: canEdit_(id, cfg, st)
    });
  });
  return out;
}

function statusMap_() {
  const list = sh_(SHEET.LIST);
  const map = {};
  if (list.getLastRow() < 2) return map;
  const hm = headers_(list);
  const rows = list.getRange(2, 1, list.getLastRow() - 1, list.getLastColumn()).getValues();
  rows.forEach(function (r) {
    const id = String(r[hm['접수번호'] - 1] || '');
    if (id) map[id] = {
      status: String(r[hm['선정상태'] - 1] || '접수'),
      pdf: String(r[hm['PDF링크'] - 1] || ''),
      dueFix: r[hm['보완기한'] - 1]
    };
  });
  return map;
}

/** 수정 가능: 신청기간 안의 접수·심의 전 신청, 또는 보완요청 상태에서 보완기한 이내 */
function canEdit_(id, cfg, st) {
  if (!st) return isOpen_(cfg);                         // 임시저장(미제출)
  if (st.status === '보완요청') {
    const due = st.dueFix instanceof Date ? new Date(st.dueFix.getTime() + 86400000 - 1) : null;
    return due ? new Date() <= due : true;
  }
  return st.status === '접수' && isOpen_(cfg);
}

/** 신청서 불러오기 */
function loadApp(id) {
  const u = requireUser_();
  const found = findDetail_(id);
  if (!found) throw new Error('신청서를 찾을 수 없습니다: ' + id);
  assertOwner_(found.data, found.owner, u.email);
  const st = statusMap_()[id] || null;
  return { id: id, step: found.step, data: found.data, editable: canEdit_(id, u.cfg, st), submitted: !!st };
}

function findDetail_(id) {
  const detail = sh_(SHEET.DETAIL);
  if (detail.getLastRow() < 2) return null;
  const hm = headers_(detail);
  const ids = detail.getRange(2, hm['접수번호'], detail.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      const row = i + 2;
      const r = detail.getRange(row, 1, 1, detail.getLastColumn()).getValues()[0];
      let data = {};
      try { data = JSON.parse(r[hm['데이터(JSON)'] - 1] || '{}'); } catch (e) { data = {}; }
      return { row: row, hm: hm, owner: String(r[hm['이메일'] - 1] || '').toLowerCase(), step: Number(r[hm['마지막단계'] - 1] || 0), data: data };
    }
  }
  return null;
}

/** 신청서의 책임교수 이메일.
 *  v1.0.2부터는 신청서를 만든 사람(신청상세 이메일)이 곧 책임교수입니다.
 *  v1.0에서 대리신청으로 만든 신청서만 예외로, 지정된 책임교수 이메일을 따릅니다. */
function appProf_(data, owner) {
  if (data && data.proxy && data.profEmail) return String(data.profEmail).toLowerCase();
  return owner;
}

function assertOwner_(data, owner, email) {
  if (appProf_(data, owner) !== email) {
    throw new Error('책임교수 본인의 신청서만 열 수 있습니다. 책임교수님 계정으로 로그인해 주세요.');
  }
}

/* ───────────────────────── 임시저장 ───────────────────────── */

/** payload = { id, step, data } → 저장된 id 반환 */
function saveDraft(payload) {
  const u = requireUser_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let id = payload.id;
    const detail = sh_(SHEET.DETAIL);
    const hm = headers_(detail);
    const json = JSON.stringify(payload.data || {});
    if (json.length > 49000) throw new Error('입력 내용이 너무 깁니다(약 5만 자 제한). 일부 내용을 줄여 주세요.');
    if (id) {
      const found = findDetail_(id);
      if (!found) throw new Error('저장할 신청서를 찾을 수 없습니다.');
      assertOwner_(found.data, found.owner, u.email);
      const st = statusMap_()[id] || null;
      if (!canEdit_(id, u.cfg, st)) throw new Error('수정 가능한 기간이 아닙니다.');
      detail.getRange(found.row, hm['저장구분']).setValue(st ? '수정중' : '임시저장');
      detail.getRange(found.row, hm['저장일시']).setValue(new Date());
      detail.getRange(found.row, hm['마지막단계']).setValue(payload.step || 0);
      detail.getRange(found.row, hm['데이터(JSON)']).setValue(json);
    } else {
      if (!isOpen_(u.cfg)) throw new Error('신청기간이 아닙니다.');
      id = 'TMP-' + Utilities.getUuid().slice(0, 8);
      const row = [];
      row[hm['접수번호'] - 1] = id;
      row[hm['이메일'] - 1] = u.email;
      row[hm['저장구분'] - 1] = '임시저장';
      row[hm['저장일시'] - 1] = new Date();
      row[hm['마지막단계'] - 1] = payload.step || 0;
      row[hm['데이터(JSON)'] - 1] = json;
      detail.appendRow(fill_(row, detail.getLastColumn()));
    }
    return { id: id, savedAt: fmt_(new Date()) };
  } finally {
    lock.releaseLock();
  }
}

function fill_(arr, len) {
  for (let i = 0; i < len; i++) if (arr[i] === undefined) arr[i] = '';
  return arr;
}

/* ───────────────────────── 개설과목 검색 ───────────────────────── */

function searchCourses(q) {
  const u = requireUser_();
  q = String(q || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const sheet = sh_(SHEET.COURSE);
  if (sheet.getLastRow() < 2) return [];
  const hm = headers_(sheet);
  const sem = String(u.cfg['모집학기'] || '');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const out = [];
  for (let i = 0; i < rows.length && out.length < 30; i++) {
    const r = rows[i];
    if (sem && semKey_(r[hm['학기'] - 1]) !== sem) continue;
    const hay = [r[hm['학수번호'] - 1], r[hm['과목명(한)'] - 1], r[hm['과목명(영)'] - 1], r[hm['담당교수'] - 1]].join(' ').toLowerCase();
    if (hay.indexOf(q) === -1) continue;
    out.push({
      courseCode: String(r[hm['학수번호'] - 1]), section: String(r[hm['분반'] - 1]),
      nameKo: String(r[hm['과목명(한)'] - 1]), nameEn: String(r[hm['과목명(영)'] - 1]),
      dept: String(r[hm['개설학과'] - 1]), credits: String(r[hm['학점'] - 1]),
      grade: String(r[hm['권장학년'] - 1]), prof: String(r[hm['담당교수'] - 1])
    });
  }
  return out;
}

/* ───────────────────────── 제출 ───────────────────────── */

function validate_(data, cfg) {
  const e = [];
  const b = data.basic || {}, o = data.overview || {}, s = data.strategy || {};
  if (!data.consent || !data.consent.required) e.push('개인정보 수집·이용(필수)과 준수사항에 동의해 주세요.');
  [['courseCode', '학수번호'], ['nameKo', '과목명(한글)'], ['nameEn', '과목명(영문)'], ['dept', '개설학과'],
   ['prof', '책임교수 성명'], ['org', '소속'], ['position', '직위'], ['classType', '수업유형'],
   ['creditPlan', '학점 구성'], ['devType', '개발구분'], ['shootType', '촬영방식']].forEach(function (f) {
    if (!String(b[f[0]] || '').trim()) e.push('기본정보: ' + f[1] + '을(를) 입력해 주세요.');
  });
  const minW = minWeeks_(cfg, b.classType);
  if (!(Number(b.videoWeeks) >= minW)) e.push('영상 개발 주차 수는 ' + (b.classType || '선택한 유형') + ' 기준 ' + minW + '주 이상이어야 합니다.');
  [['purpose', '교육목적 및 필요성'], ['features', '교과목 특징 및 장점'], ['effects', '기대효과'],
   ['summaryKo', '과목개요(국문)'], ['goals', '학습목표']].forEach(function (f) {
    if (!String(o[f[0]] || '').trim()) e.push('교과목 개요: ' + f[1] + '을(를) 입력해 주세요.');
  });
  [['pre', 'Pre-class 전략'], ['inClass', 'In-class 전략'], ['post', 'Post-class 전략']].forEach(function (f) {
    if (!String(s[f[0]] || '').trim()) e.push('운영 전략: ' + f[1] + '을(를) 입력해 주세요.');
  });
  const sum = (s.evalItems || []).reduce(function (a, x) { return a + (Number(x.pct) || 0); }, 0);
  if (sum !== 100) e.push('평가항목 반영비율 합계가 100%가 아닙니다(현재 ' + sum + '%).');
  const weeks = data.weeks || [];
  for (let i = 1; i <= 16; i++) {
    const w = weeks[i - 1] || {};
    if (i !== 8 && i !== 16 && !String(w.topic || '').trim()) { e.push('주차별 설계: ' + i + '주차 학습주제를 입력해 주세요.'); }
  }
  return e;
}

/** payload = { id, data } */
function submitApp(payload) {
  const u = requireUser_();
  const cfg = u.cfg;
  const data = payload.data || {};
  data.basic = data.basic || {};
  data.basic.semester = String(cfg['모집학기'] || '');
  const errors = validate_(data, cfg);
  if (errors.length) return { ok: false, errors: errors };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const statusById = statusMap_();
    let id = payload.id || '';
    const isNew = !id || id.indexOf('TMP-') === 0 || !statusById[id];
    const found = id ? findDetail_(id) : null;      // 기존 신청상세 행(임시저장 또는 제출본)
    if (found) assertOwner_(found.data, found.owner, u.email);
    if (!isNew) {
      if (!found) return { ok: false, errors: ['신청상세에서 신청서를 찾을 수 없습니다. 담당자에게 문의해 주세요.'] };
      if (!canEdit_(id, cfg, statusById[id])) return { ok: false, errors: ['수정 가능한 기간이 아닙니다.'] };
    } else if (!isOpen_(cfg)) {
      return { ok: false, errors: ['신청기간이 아닙니다.'] };
    }

    if (isNew) id = nextId_(data.basic.semester);
    const now = new Date();
    // 책임교수 = 지금 로그인해 제출하는 본인 (대리신청 없음)
    const profEmail = u.email;
    delete data.proxy; delete data.profEmail;      // v1.0 대리신청 흔적 정리
    if (!data.consent.at) data.consent.at = fmt_(now);

    // 1) PDF
    const rec = { id: id, submittedAt: fmt_(now), profEmail: profEmail };
    const pdf = makePdf_(rec, data, cfg);

    // 2) 신청목록
    const list = sh_(SHEET.LIST);
    const hm = headers_(list);
    const b = data.basic;
    const values = {
      '접수번호': id, '학기': "'" + b.semester,   // ' 접두: 날짜로 바뀌지 않게 텍스트로 저장
      '학수번호': b.courseCode, '분반': b.section || '',
      '과목명(한)': b.nameKo, '과목명(영)': b.nameEn, '개설학과': b.dept, '권장학년': b.grade || '',
      '교수명': b.prof, '소속': b.org, '직위': b.position, '이메일': profEmail, '휴대폰(선택)': (data.consent.optional ? (b.phone || '') : ''),
      '수업유형': b.classType, '학점구성': b.creditPlan, '개발구분': b.devType, '영상주차수': Number(b.videoWeeks),
      '촬영방식': b.shootType, '대리신청자이메일': '', '필수동의일시': data.consent.at,   // 열이 남아 있으면 비워 둠
      '선택동의': data.consent.optional ? 'Y' : 'N', 'PDF링크': pdf.getUrl(), '학기종료일': cfg['학기종료일'] || ''
    };
    let row;
    if (isNew) {
      row = firstEmptyRow_(list, hm['접수번호']);   // 수식이 미리 깔린 행 중 첫 빈 행
      values['접수일시'] = now; values['선정상태'] = '접수'; values['메일발송'] = 'N'; values['개인정보삭제완료'] = 'N';
    } else {
      row = findListRow_(id);
      const oldPdf = list.getRange(row, hm['PDF링크']).getValue();
      const oldId = fileIdFromUrl_(oldPdf);
      if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* 이미 삭제됨 */ } }
      values['수정일시'] = now;
      // 보완요청 → 보완 제출 시 '접수'로 되돌려 담당자 재검토
      if (list.getRange(row, hm['선정상태']).getValue() === '보완요청') values['선정상태'] = '접수';
    }
    Object.keys(values).forEach(function (k) {
      if (hm[k]) list.getRange(row, hm[k]).setValue(values[k]);
    });
    if (b.courseManual) list.getRange(row, hm['학수번호']).setNote('개설과목 목록에 없는 과목: 확인 필요');

    // 3) 신청상세 (임시 id → 접수번호)
    const detail = sh_(SHEET.DETAIL);
    const dh = headers_(detail);
    const dRow = found ? found.row : detail.getLastRow() + 1;
    detail.getRange(dRow, dh['이메일']).setValue(u.email);   // 신청서 주인 = 책임교수 본인
    detail.getRange(dRow, dh['접수번호']).setValue(id);
    detail.getRange(dRow, dh['저장구분']).setValue('제출');
    detail.getRange(dRow, dh['저장일시']).setValue(now);
    detail.getRange(dRow, dh['마지막단계']).setValue(5);
    detail.getRange(dRow, dh['데이터(JSON)']).setValue(JSON.stringify(data));

    // 4) 접수 안내 메일 (신규 제출 때만)
    if (isNew) sendTemplate_('접수안내', vars_(list, row, cfg), profEmail);

    SpreadsheetApp.flush();
    return { ok: true, id: id, pdf: pdf.getUrl(), isNew: isNew };
  } finally {
    lock.releaseLock();
  }
}

function nextId_(sem) {
  const list = sh_(SHEET.LIST);
  const prefix = 'FL-' + sem + '-';
  let max = 0;
  if (list.getLastRow() >= 2) {
    list.getRange(2, headers_(list)['접수번호'], list.getLastRow() - 1, 1).getValues().forEach(function (r) {
      const v = String(r[0]);
      if (v.indexOf(prefix) === 0) max = Math.max(max, Number(v.slice(prefix.length)) || 0);
    });
  }
  return prefix + ('00' + (max + 1)).slice(-3);
}

function firstEmptyRow_(sheet, col) {
  const last = Math.max(sheet.getLastRow(), 2);
  const vals = sheet.getRange(2, col, last - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (vals[i][0] === '') return i + 2;
  return last + 1;
}

function findListRow_(id) {
  const list = sh_(SHEET.LIST);
  const ids = list.getRange(2, headers_(list)['접수번호'], Math.max(list.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  throw new Error('신청목록에서 접수번호를 찾을 수 없습니다: ' + id);
}

/* ───────────────────────── PDF ───────────────────────── */

function makePdf_(rec, data, cfg) {
  const folderId = String(cfg['PDF폴더ID'] || '').trim();
  if (!folderId) throw new Error('설정 탭의 PDF폴더ID가 비어 있습니다. 담당자에게 문의해 주세요.');
  const t = HtmlService.createTemplateFromFile('Pdf');
  t.r = rec; t.d = data; t.devPeriod = fmt_(cfg['개발기간시작'], 'yyyy. MM. dd') + ' ~ ' + fmt_(cfg['개발기간종료'], 'yyyy. MM. dd');
  const html = t.evaluate().getContent();
  const name = rec.id + '_' + (data.basic.nameKo || '') + '_' + (data.basic.prof || '') + '.pdf';
  const blob = Utilities.newBlob(html, 'text/html', 'apply.html').getAs('application/pdf').setName(name);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  if (rec.profEmail) { try { file.addViewer(rec.profEmail); } catch (e) { /* 공유 실패는 무시: 담당자 드라이브에는 저장됨 */ } }
  return file;
}

/* ───────────────────────── 메일 ───────────────────────── */

function vars_(list, row, cfg) {
  const hm = headers_(list);
  const r = list.getRange(row, 1, 1, list.getLastColumn()).getValues()[0];
  const g = function (k) { return hm[k] ? r[hm[k] - 1] : ''; };
  return {
    '교수명': g('교수명'), '과목명': g('과목명(한)'), '학기': semKey_(g('학기')), '접수번호': g('접수번호'),
    '수업유형': g('수업유형'), '최소주차': minWeeks_(cfg, g('수업유형')) + '주',
    '개발기간': fmt_(cfg['개발기간시작'], 'yyyy-MM-dd') + ' ~ ' + fmt_(cfg['개발기간종료'], 'yyyy-MM-dd'),
    '마감일시': fmt_(cfg['신청마감']), 'PDF링크': g('PDF링크'),
    '신청페이지URL': String(cfg['신청페이지URL'] || ''), '예약페이지URL': String(cfg['예약페이지URL'] || '(추후 안내)'),
    '담당자연락처': String(cfg['담당자연락처'] || ''),
    '미선정사유': g('미선정사유'), '보완내용': g('보완내용'), '보완기한': fmt_(g('보완기한'), 'yyyy-MM-dd'),
    '_to': g('이메일')
  };
}

function sendTemplate_(kind, v, to) {
  const m = sh_(SHEET.MAIL);
  const rows = m.getRange(2, 1, m.getLastRow() - 1, 4).getValues();
  const t = rows.filter(function (r) { return String(r[0]).trim() === kind; })[0];
  if (!t || String(t[2]).indexOf('발송 없음') !== -1) return false;
  const fillIn = function (s) { return String(s).replace(/\{([^}]+)\}/g, function (all, k) { return v[k] !== undefined ? String(v[k]) : all; }); };
  const cfg = getConfig_();
  const opt = { name: 'HY FLIP 에듀테크혁신팀' };
  if (cfg['발신계정']) opt.replyTo = String(cfg['발신계정']);
  MailApp.sendEmail(to, fillIn(t[2]), fillIn(t[3]), opt);
  return true;
}

/* ───────────────────────── 선정상태 변경 트리거 ───────────────────────── */

/** 설치형 onEdit 트리거(setup에서 생성). 담당자가 '선정상태'를 바꾸면 메일 발송 */
function onStatusEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET.LIST || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  const hm = headers_(sheet);
  const row = e.range.getRow(), col = e.range.getColumn();
  if (row < 2 || col !== hm['선정상태']) return;
  const status = String(e.value || '');
  sheet.getRange(row, hm['상태변경일시']).setValue(new Date());
  const kindByStatus = { '선정': '선정', '미선정': '미선정', '보완요청': '보완요청' };
  const kind = kindByStatus[status];
  if (!kind) { e.range.clearNote(); return; }                 // 접수·심의중: 메일 없음
  const need = { '미선정': ['미선정사유'], '보완요청': ['보완내용', '보완기한'] }[status] || [];
  const missing = need.filter(function (k) { return !sheet.getRange(row, hm[k]).getValue(); });
  if (missing.length) {
    e.range.setNote('메일 미발송: ' + missing.join(', ') + ' 입력 후 상태를 다시 선택하세요.');
    sheet.getRange(row, hm['메일발송']).setValue('N');
    return;
  }
  const cfg = getConfig_();
  const v = vars_(sheet, row, cfg);
  const sent = sendTemplate_(kind, v, v._to);
  sheet.getRange(row, hm['메일발송']).setValue(sent ? 'Y' : 'N');
  e.range.setNote(sent ? (status + ' 메일 발송 ' + fmt_(new Date())) : '');
}

/* ───────────────────────── 월간 보관기간 처리 ───────────────────────── */

/** 매월 1일 새벽 실행: 2년 경과 개인정보 삭제, 10년 경과 이력 삭제, 삭제대장 기록 */
function monthlyCleanup() {
  const today = new Date();
  const draftIds = cleanupDrafts_(sh_(SHEET.DETAIL), today);
  if (draftIds.length) sh_(SHEET.LOG).appendRow([today, '미제출 임시저장 삭제(2년)', draftIds.join(', '), draftIds.length, '자동', '']);

  const list = sh_(SHEET.LIST);
  if (list.getLastRow() < 2) return;
  const hm = headers_(list);
  const rows = list.getRange(2, 1, list.getLastRow() - 1, list.getLastColumn()).getValues();
  const piIds = [], histRows = [], histIds = [];
  const detail = sh_(SHEET.DETAIL);

  rows.forEach(function (r, i) {
    const row = i + 2, id = String(r[hm['접수번호'] - 1] || '');
    const piDue = r[hm['개인정보삭제일'] - 1], histDue = r[hm['이력삭제일'] - 1];
    if (histDue instanceof Date && histDue <= today) { histRows.push(row); histIds.push(id); return; }
    if (piDue instanceof Date && piDue <= today && r[hm['개인정보삭제완료'] - 1] !== 'Y') {
      ['이메일', '휴대폰(선택)', '대리신청자이메일'].forEach(function (k) { if (hm[k]) list.getRange(row, hm[k]).clearContent(); });   // 대리신청자이메일: v1.0 자료 정리용
      const fid = fileIdFromUrl_(r[hm['PDF링크'] - 1]);
      if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) { } }
      list.getRange(row, hm['PDF링크']).clearContent();
      list.getRange(row, hm['개인정보삭제완료']).setValue('Y');
      deleteDetailById_(detail, id);
      piIds.push(id);
    }
  });
  histRows.sort(function (a, b) { return b - a; }).forEach(function (r) { list.deleteRow(r); });

  const log = sh_(SHEET.LOG);
  if (piIds.length) log.appendRow([today, '개인정보 삭제(2년)', piIds.join(', '), piIds.length, '자동', '']);
  if (histIds.length) log.appendRow([today, '이력 삭제(10년)', histIds.join(', '), histIds.length, '자동', '']);
}

/** 제출되지 않은 임시저장(TMP-)은 신청목록에 없어 위 처리에 걸리지 않으므로,
 *  마지막 저장일시로부터 2년이 지나면 행을 지웁니다. 지운 접수번호 목록을 돌려줍니다. */
function cleanupDrafts_(detail, today) {
  if (detail.getLastRow() < 2) return [];
  const hm = headers_(detail);
  const rows = detail.getRange(2, 1, detail.getLastRow() - 1, detail.getLastColumn()).getValues();
  const ids = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const id = String(rows[i][hm['접수번호'] - 1] || '');
    const saved = rows[i][hm['저장일시'] - 1];
    if (id.indexOf('TMP-') !== 0 || !(saved instanceof Date)) continue;
    const due = new Date(saved.getTime()); due.setFullYear(due.getFullYear() + 2);
    if (due <= today) { detail.deleteRow(i + 2); ids.push(id); }
  }
  return ids.reverse();
}

function deleteDetailById_(detail, id) {
  if (detail.getLastRow() < 2) return;
  const col = headers_(detail)['접수번호'];
  const ids = detail.getRange(2, col, detail.getLastRow() - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) detail.deleteRow(i + 2);
}

/* ───────────────────────── 설치 ───────────────────────── */

/** 최초 1회 실행: 시트 점검 + 트리거 생성 */
function setup() {
  const required = {
    // 신청목록: 제출·상태변경 메일·보관기간 처리에서 반드시 쓰는 열
    '설정': [], '신청목록': ['접수번호', '학수번호', '이메일', '휴대폰(선택)', '선정상태', '상태변경일시',
      '메일발송', '미선정사유', '보완내용', '보완기한', 'PDF링크', '개인정보삭제일', '이력삭제일', '개인정보삭제완료'],
    '신청상세': ['접수번호', '이메일', '저장구분', '저장일시', '마지막단계', '데이터(JSON)'],
    '개설과목': ['학기', '학수번호', '과목명(한)'], '메일문구': [], '삭제대장': []
  };
  Object.keys(required).forEach(function (name) {
    const hm = headers_(sh_(name));
    required[name].forEach(function (h) { if (!hm[h]) throw new Error(name + ' 탭에 "' + h + '" 열이 없습니다.'); });
  });
  const cfg = getConfig_();
  if (!cfg['PDF폴더ID']) throw new Error('설정 탭에 PDF폴더ID를 먼저 입력하세요.');
  DriveApp.getFolderById(String(cfg['PDF폴더ID']));   // 접근 권한 확인

  // 메일문구 탭에 필요한 구분이 모두 있는지 확인 (없으면 해당 메일이 조용히 발송되지 않음)
  const m = sh_(SHEET.MAIL);
  const kinds = m.getLastRow() < 2 ? [] : m.getRange(2, 1, m.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  const noMail = ['접수안내', '선정', '미선정', '보완요청'].filter(function (k) { return kinds.indexOf(k) === -1; });
  if (noMail.length) throw new Error('메일문구 탭에 다음 구분이 없습니다: ' + noMail.join(', '));

  const ss = ss_();
  const have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('onStatusEdit') === -1) ScriptApp.newTrigger('onStatusEdit').forSpreadsheet(ss).onEdit().create();
  if (have.indexOf('monthlyCleanup') === -1) ScriptApp.newTrigger('monthlyCleanup').timeBased().onMonthDay(1).atHour(3).create();
  Logger.log('설치 완료: 트리거 ' + ScriptApp.getProjectTriggers().length + '개');
}

/** 테스트용: PDF와 메일 없이 검증 규칙만 확인 */
function testValidate() {
  Logger.log(validate_({ basic: {}, overview: {}, strategy: { evalItems: EVAL_DEFAULT }, weeks: [] }, getConfig_()).join('\n'));
}
