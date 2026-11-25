/**
 * Apps Script 서비스 모의 환경 — 실제 src/*.js 코드를 Node에서 그대로 실행하기 위한 가짜 시트·캘린더·메일.
 * 사용: const env = createGasEnv(); env.ctx.setup(); env.as('a@school.ac.kr'); env.ctx.apiBootstrap();
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const LOAD_ORDER = ['Rules.js', 'Db.js', 'Booking.js', 'Mail.js', 'Admin.js', 'Jobs.js', 'Setup.js', 'Code.js'];

function kstParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  f.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return p;
}

function formatDate(d, tz, fmt) {
  const p = kstParts(d);
  return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
    .replace('HH', p.hour).replace('mm', p.minute)
    .replace(/^H$/, String(Number(p.hour))).replace(/^m$/, String(Number(p.minute)));
}

/* ---------- Sheets ---------- */
class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; vals.push(v === undefined ? '' : v); }
      out.push(vals);
    }
    return out;
  }
  setValues(v) {
    for (let i = 0; i < v.length; i++) {
      const ri = this.r - 1 + i;
      while (this.sheet.data.length <= ri) this.sheet.data.push([]);
      for (let j = 0; j < v[i].length; j++) this.sheet.data[ri][this.c - 1 + j] = v[i][j];
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, (r || []).length), 0); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(row) { this.data.splice(this.getLastRow(), 0, row.slice()); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() {}
}

class Spreadsheet {
  constructor(name, id) { this.name = name; this.id = id; this.sheets = [new Sheet('시트1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  setSpreadsheetTimeZone() {}
}

/* ---------- Calendar ---------- */
let evSeq = 0;
class CalEvent {
  constructor(cal, title, start, end, opts, allDay) {
    Object.assign(this, { cal, title, start: new Date(start), end: new Date(end), opts: opts || {}, allDay: !!allDay, color: '' });
    this.id = 'ev' + (++evSeq) + '@google.com';
  }
  getId() { return this.id; }
  getTitle() { return this.title; }
  setTitle(t) { this.title = t; return this; }
  setColor(c) { this.color = c; return this; }
  getStartTime() { return this.start; }
  getEndTime() { return this.end; }
  isAllDayEvent() { return this.allDay; }
  getAllDayStartDate() { return this.start; }
  deleteEvent() { this.cal.events = this.cal.events.filter((e) => e !== this); }
}
class Calendar {
  constructor(id, name) { this.id = id; this.name = name; this.events = []; }
  getId() { return this.id; }
  createEvent(t, s, e, o) { const ev = new CalEvent(this, t, s, e, o); this.events.push(ev); return ev; }
  createAllDayEvent(t, d) { const ev = new CalEvent(this, t, d, new Date(d.getTime() + 86400000), {}, true); this.events.push(ev); return ev; }
  getEvents(from, to) { return this.events.filter((e) => e.start < to && from < e.end); }
  getEventById(id) { return this.events.find((e) => e.id === id) || null; }
}

/* ---------- 템플릿(HtmlService) ---------- */
function renderTemplate(file, vars, includeFn) {
  let html = fs.readFileSync(path.join(SRC, file + '.html'), 'utf8');
  html = html.replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_, n) => includeFn(n));
  html = html.replace(/<\?!=\s*(\w+)\s*\?>/g, (_, v) => String(vars[v]));
  return html;
}

function createGasEnv(opts) {
  opts = opts || {};
  const state = {
    now: opts.now ? new Date(opts.now) : new Date(),
    user: opts.owner || 'hyflip@school.ac.kr',
    owner: opts.owner || 'hyflip@school.ac.kr',
    props: {}, spreadsheets: {}, calendars: {}, outbox: [], triggers: [], uuid: 0,
    webUrl: opts.webUrl === undefined ? 'https://script.google.com/a/macros/school.ac.kr/s/DEPLOY/exec' : opts.webUrl,
  };

  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(state.now.getTime()); }
    static now() { return state.now.getTime(); }
  }

  const ctx = {
    console: opts.quiet === false ? console : { log() {}, warn() {}, error() {}, info() {} },
    Date: FakeDate, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Promise, encodeURIComponent,
    SpreadsheetApp: {
      create(name) { const id = 'ss' + Object.keys(state.spreadsheets).length; return (state.spreadsheets[id] = new Spreadsheet(name, id)); },
      openById(id) { const s = state.spreadsheets[id]; if (!s) throw new Error('no ss ' + id); return s; },
    },
    CalendarApp: {
      EventColor: { YELLOW: '5' },
      createCalendar(name) { const id = 'cal' + Object.keys(state.calendars).length + '@group.calendar.google.com'; return (state.calendars[id] = new Calendar(id, name)); },
      getCalendarById(id) { return state.calendars[id] || null; },
    },
    MailApp: { sendEmail(to, subject, body, o) { state.outbox.push({ to, subject, body, opts: o }); } },
    Session: {
      getActiveUser: () => ({ getEmail: () => state.user }),
      getEffectiveUser: () => ({ getEmail: () => state.owner }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in state.props ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); },
      }),
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    Utilities: {
      formatDate, sleep() {},
      getUuid: () => 'uuid-' + String(++state.uuid).padStart(8, '0') + '-0000-0000-000000000000',
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => state.webUrl }),
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
      newTrigger(fn) {
        const t = { fn, getHandlerFunction: () => fn };
        const chain = { timeBased: () => chain, everyMinutes: () => chain, everyDays: () => chain, atHour: () => chain,
          inTimezone: () => chain, onMonthDay: () => chain, create: () => { state.triggers.push(t); return t; } };
        return chain;
      },
    },
    HtmlService: {
      createHtmlOutputFromFile: (n) => ({ getContent: () => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8') }),
      createTemplateFromFile(file) {
        const t = {
          evaluate() {
            const content = renderTemplate(file, t, (n) => ctx.include(n));
            const out = { getContent: () => content, setTitle: (x) => { out.title = x; return out; }, addMetaTag: () => out };
            return out;
          },
        };
        return t;
      },
    },
  };
  vm.createContext(ctx);
  LOAD_ORDER.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));

  return {
    ctx, state,
    as(email) { state.user = email; return this; },
    at(iso) { state.now = new RealDate(iso); return this; },
    ss() { return state.spreadsheets[state.props.SPREADSHEET_ID]; },
    sheetRows(name) {
      const sh = this.ss().getSheetByName(name);
      const [head, ...rows] = sh.data;
      return rows.filter((r) => r.join('') !== '').map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
    },
    setConfig(key, value) {
      const sh = this.ss().getSheetByName('설정');
      const row = sh.data.findIndex((r) => r[0] === key);
      if (row === -1) sh.appendRow([key, value, '']); else sh.data[row][1] = value;
    },
    call(fn, ...args) { this.ctx.Db.clearCache(); return this.ctx[fn](...args); },
  };
}

module.exports = { createGasEnv, renderTemplate, SRC };
