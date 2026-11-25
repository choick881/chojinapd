/**
 * 테스트용 가짜 Apps Script 환경.
 * 실제 구글 시트·드라이브·메일 없이 Code.gs를 Node에서 돌리기 위한 최소 구현입니다.
 * - 시트: 2차원 배열(1행 = 열 이름). 빈 칸은 ''.
 * - setValue("'2027-1")은 실제 시트처럼 앞의 ' 를 떼고 텍스트로 저장합니다.
 * - 메일·드라이브·트리거는 호출 기록만 남깁니다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

class FakeRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr: nr || 1, nc: nc || 1 }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) line.push(this.sheet._get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValue() { return this.sheet._get(this.row, this.col); }
  setValue(v) {
    if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
    this.sheet._set(this.row, this.col, v);
    return this;
  }
  clearContent() { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet._set(this.row + r, this.col + c, ''); return this; }
  setNote(n) { this.sheet.notes[this.row + ',' + this.col] = n; return this; }
  clearNote() { delete this.sheet.notes[this.row + ',' + this.col]; return this; }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
}

class FakeSheet {
  constructor(name, rows) { this.name = name; this.rows = rows.map(r => r.slice()); this.notes = {}; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some(v => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
  getRange(row, col, nr, nc) {
    if (row < 1 || col < 1) throw new Error('잘못된 범위: ' + row + ',' + col);
    if (nr === 0 || nc === 0) throw new Error('행/열 수는 1 이상이어야 합니다');
    return new FakeRange(this, row, col, nr, nc);
  }
  appendRow(arr) { this.rows.splice(this.getLastRow(), 0, arr.slice()); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  _get(r, c) {
    const line = this.rows[r - 1]; const v = line ? line[c - 1] : undefined;
    if (v === undefined || v === null) return '';
    // 테스트 쪽에서 만든 Date를 Code.gs 실행 환경의 Date로 바꿔 줍니다 (instanceof Date가 통하도록)
    if (this.DateCtor && Object.prototype.toString.call(v) === '[object Date]' && !(v instanceof this.DateCtor)) return new this.DateCtor(v.getTime());
    return v;
  }
  _set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const line = this.rows[r - 1];
    while (line.length < c) line.push('');
    line[c - 1] = v;
  }
  /** 테스트 편의: 열 이름으로 행 객체 배열 */
  records() {
    const h = this.rows[0];
    return this.rows.slice(1, this.getLastRow()).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]])));
  }
}

function pad(n, w) { return String(n).padStart(w, '0'); }
function seoulParts(d) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, M: +p.month, d: +p.day, H: +p.hour, m: +p.minute };
}
function formatDate(d, tz, pattern) {
  const p = seoulParts(d);
  return pattern.replace(/yyyy|MM|M|dd|HH|mm/g, t => ({ yyyy: p.y, MM: pad(p.M, 2), M: p.M, dd: pad(p.d, 2), HH: pad(p.H, 2), mm: pad(p.m, 2) }[t]));
}

/** 기본 데이터 시트(실제 xlsx의 탭·열 이름을 변경내역·코드 기준으로 재구성) */
function defaultSheets() {
  const far = new Date(Date.now() + 30 * 86400000);
  const past = new Date(Date.now() - 30 * 86400000);
  return {
    '설정': [['항목', '값'], ['모집학기', '2027-1'], ['신청시작', past], ['신청마감', far], ['허용도메인', 'hanyang.ac.kr'],
      ['PDF폴더ID', 'FOLDER_ID_1234567890123456789'], ['학기종료일', new Date('2027-06-30T00:00:00+09:00')],
      ['개발기간시작', new Date('2027-01-05T00:00:00+09:00')], ['개발기간종료', new Date('2027-02-20T00:00:00+09:00')],
      ['담당자연락처', '02-0000-0000'], ['발신계정', 'team@hanyang.ac.kr']],
    '신청목록': [['접수번호', '접수일시', '수정일시', '학기', '학수번호', '분반', '과목명(한)', '과목명(영)', '개설학과', '권장학년', '교수명', '소속', '직위',
      '이메일', '휴대폰(선택)', '수업유형', '학점구성', '개발구분', '영상주차수', '촬영방식', '대리신청자이메일', '필수동의일시', '선택동의',
      '선정상태', '상태변경일시', '메일발송', '미선정사유', '보완내용', '보완기한', 'PDF링크', '학기종료일', '개인정보삭제일', '이력삭제일', '개인정보삭제완료']],
    '신청상세': [['접수번호', '이메일', '저장구분', '저장일시', '마지막단계', '데이터(JSON)']],
    '개설과목': [['학기', '학수번호', '분반', '과목명(한)', '과목명(영)', '개설학과', '학점', '권장학년', '담당교수']],
    '메일문구': [['구분', '설명', '제목', '본문'],
      ['접수안내', '', '[HY FLIP] {과목명} 접수 {접수번호}', '{교수명} 교수님 {학기} 접수'],
      ['선정', '', '[HY FLIP] 선정 {과목명}', '선정'], ['미선정', '', '[HY FLIP] 미선정', '{미선정사유}'],
      ['보완요청', '', '[HY FLIP] 보완요청', '{보완내용} {보완기한}']],
    '삭제대장': [['일시', '구분', '대상', '건수', '처리', '비고']]
  };
}

/**
 * Code.gs를 새 가짜 환경에 올립니다.
 * opts.sheets: 탭 이름 → 2차원 배열 (없으면 defaultSheets())
 * 반환: { g: 전역(함수 호출용), ss, sheet(name), mails, drive, triggers, setUser(email) }
 */
function load(opts = {}) {
  const tabs = opts.sheets || defaultSheets();
  const sheets = {};
  Object.keys(tabs).forEach(n => { sheets[n] = new FakeSheet(n, tabs[n]); });
  const state = { user: opts.user || 'prof.a@hanyang.ac.kr', mails: [], files: {}, trashed: [], triggers: [], uuid: 0 };

  const ss = { getSheetByName: n => sheets[n] || null, _id: 'SS' };
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => ss, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => state.user }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      formatDate,
      getUuid: () => { state.uuid++; return pad(state.uuid, 8) + '-0000-0000-0000-000000000000'; },
      newBlob: () => ({ getAs: () => ({ setName(n) { this.name = n; return this; } }) })
    },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({ getContent: () => '<html></html>' }) }),
      createHtmlOutput: h => ({ setTitle() { return this; }, html: h })
    },
    DriveApp: {
      getFolderById: id => ({
        id,
        createFile: blob => {
          const fid = 'FILE' + pad(Object.keys(state.files).length + 1, 25);
          const f = { id: fid, name: blob.name, viewers: [], getUrl: () => 'https://drive.google.com/file/d/' + fid + '/view', addViewer(e) { this.viewers.push(e); } };
          state.files[fid] = f; return f;
        }
      }),
      getFileById: id => ({ setTrashed: () => { state.trashed.push(id); } })
    },
    MailApp: { sendEmail: (to, subject, body, opt) => state.mails.push({ to, subject, body, opt }) },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.map(h => ({ getHandlerFunction: () => h })),
      newTrigger: h => {
        const b = { forSpreadsheet: () => b, onEdit: () => b, timeBased: () => b, onMonthDay: () => b, atHour: () => b, create: () => { state.triggers.push(h); } };
        return b;
      }
    },
    Logger: { log: m => { state.log = (state.log || []).concat(String(m)); } }
  };
  vm.createContext(ctx);
  const CtxDate = vm.runInContext('Date', ctx);
  Object.values(sheets).forEach(sh => { sh.DateCtor = CtxDate; });
  const code = fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8');
  // const/let 최상위 선언도 ctx에서 보이도록 끝에 노출 코드를 붙입니다.
  vm.runInContext(code + '\n;this.__SHEET = SHEET; this.__EVAL = EVAL_DEFAULT;', ctx, { filename: 'Code.gs' });

  return {
    g: ctx, ss, state,
    /** Code.gs 실행 환경의 Date */
    D: (...a) => new CtxDate(...a),
    sheet: n => sheets[n],
    setUser: e => { state.user = e; }
  };
}

/** 검증을 통과하는 완성된 신청서 데이터 */
function fullData(over = {}) {
  const weeks = [];
  for (let i = 1; i <= 16; i++) weeks.push({ no: i, topic: i === 8 ? '중간고사' : i === 16 ? '기말고사' : '주제' + i });
  return Object.assign({
    consent: { required: true, optional: false, at: '' },
    basic: { courseCode: 'EDU1001', section: '01', nameKo: '교육공학', nameEn: 'Educational Technology', dept: '교육공학과',
      prof: '홍길동', org: '사범대학', position: '교수', classType: 'Smart-F', creditPlan: '3-0-0', devType: '신규',
      shootType: '스튜디오', videoWeeks: 8 },
    overview: { purpose: 'a', features: 'b', effects: 'c', summaryKo: 'd', goals: 'e' },
    strategy: { pre: 'p', inClass: 'i', post: 'q', evalItems: [{ name: '출석', pct: 10 }, { name: '과제', pct: 10 }, { name: '중간', pct: 40 }, { name: '기말', pct: 40 }] },
    weeks
  }, over);
}

module.exports = { load, defaultSheets, fullData, FakeSheet, formatDate };
