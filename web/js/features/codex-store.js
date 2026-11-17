// js/features/codex-store.js —— 修炼手册（模拟赛 / Trick 库 / 日常）数据层
// 独立于主题单数据的 localStorage 命名空间，负责读写与变更广播。
import { lsGet, lsSet, createBus, fmtDate } from '../core.js';

const MOCK_KEY  = 'codex_mock_contests_v1';
const TRICK_KEY = 'codex_tricks_v1';
const DAILY_KEY = 'codex_daily_v1';

export const INBOX_LIMIT = 10;
export const DOING_LIMIT = 3;

/** 单题满分（竞赛常规分制） */
export const MAX_PROBLEM_SCORE = 100;

/** 把分数收敛到 [0, MAX_PROBLEM_SCORE] 的整数；空/非法输入返回 '' */
export function clampScore(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (!isFinite(n)) return '';
  return Math.max(0, Math.min(MAX_PROBLEM_SCORE, Math.round(n)));
}

const bus = createBus();
export function onCodexChange(fn) { return bus.on('change', fn); }
function emit(scope) { bus.emit('change', scope); }

/* ---------- 通用读写 ---------- */
function readJSON(key, fallback) {
  const raw = lsGet(key);
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v === null || v === undefined) ? fallback : v;
  } catch (e) { return fallback; }
}
function writeJSON(key, value) {
  try { lsSet(key, JSON.stringify(value)); } catch (e) { console.warn('[codex] 保存失败', e); }
}
function nid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

/* ---------- 时间格式化 ---------- */
export function hhmmss(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = n => String(n).padStart(2, '0');
  return p(h) + ':' + p(m) + ':' + p(s);
}
export function humanDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h + '小时' + m + '分钟';
}
export function clockTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
export function shortDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ============================================================
   一、模拟赛
   ============================================================ */
export const MOCK_STYLES = {
  'csp-s': { key: 'csp-s', label: 'CSP-S', hours: 4, count: 4, accent: '#5a8a9a', desc: '4 小时 · 4 题' },
  'noip': { key: 'noip', label: 'NOIP', hours: 4.5, count: 4, accent: '#648fec', desc: '4.5 小时 · 4 题' },
  'province': { key: 'province', label: '省选', hours: 5, count: 3, accent: '#a482db', desc: '5 小时 · 3 题' }
};
export function styleOf(key) { return MOCK_STYLES[key] || MOCK_STYLES['csp-s']; }

let contests = [];
loadContests();

function loadContests() {
  const v = readJSON(MOCK_KEY, []);
  contests = Array.isArray(v) ? v : [];
  contests.forEach(c => {
    if (!Array.isArray(c.problems)) c.problems = [];
    c.problems.forEach(p => {
      if (!Array.isArray(p.records)) p.records = [];
      if (p.estScore == null) p.estScore = '';
      if (p.realScore == null) p.realScore = '';
      // 修复越界历史数据
      if (p.estScore !== '') p.estScore = clampScore(p.estScore);
      if (p.realScore !== '') p.realScore = clampScore(p.realScore);
      p.records.forEach(r => {
        if (r.score == null || r.score === '') return;
        r.score = clampScore(r.score);
      });
      if (typeof p.code !== 'string') p.code = '';
      if (typeof p.review !== 'string') p.review = '';
      if (typeof p.solutionCode !== 'string') p.solutionCode = '';
      if (typeof p.suppPid !== 'string') p.suppPid = '';
      if (!p.suppDoneAt) p.suppDoneAt = null;
      if (typeof p.suppNote !== 'string') p.suppNote = '';
    });
    if (!c.status) c.status = 'running';
    if (c.status === 'archived') c.status = 'finished';
    if (typeof c.rank !== 'string') c.rank = c.rank ? String(c.rank) : '';
    if (!c.finishedAt) c.finishedAt = c.archivedAt || null;
    if (c.scheduledAt == null) c.scheduledAt = null;
    if (c.status === 'scheduled' && (!c.scheduledAt || !c.durationMs)) c.status = 'review';
  });
  return contests;
}
export function getContests() { return loadContests(); }
export function getContest(id) { return loadContests().find(c => c.id === id) || null; }
export function runningContest() { return loadContests().find(c => c.status === 'running') || null; }
export function pendingReviewContest() { return loadContests().find(c => c.status === 'review') || null; }

function persistContests() { writeJSON(MOCK_KEY, contests); emit('mock'); }

/**
 * 新建模拟赛。
 * opts.startAt（时间戳）> 现在时创建「定时开始」的预约场：到点自动开始计时。
 * 不传则立即开始。
 */
export function createContest(name, styleKey, opts) {
  const st = styleOf(styleKey);
  const now = Date.now();
  const durationMs = Math.round(st.hours * 3600 * 1000);
  const wantedStart = opts && opts.startAt ? Number(opts.startAt) : now;
  const scheduled = isFinite(wantedStart) && wantedStart > now + 1000;
  const startAt = scheduled ? Math.floor(wantedStart) : now;
  const contest = {
    id: nid('mc'),
    name: (name || '').trim() || fmtDate(new Date()),
    style: st.key,
    createdAt: now,
    startedAt: scheduled ? null : startAt,
    endsAt: scheduled ? null : startAt + durationMs,
    scheduledAt: scheduled ? startAt : null,
    durationMs,
    status: scheduled ? 'scheduled' : 'running',
    submittedAt: null,
    archivedAt: null,
    rank: '',
    finishedAt: null,
    problems: Array.from({ length: st.count }, (_, i) => ({
      id: nid('mp'),
      name: 'T' + (i + 1),
      estScore: '',
      records: [],
      realScore: '',
      code: '',
      review: '',
      solutionCode: '',
      suppPid: '',
      suppDoneAt: null,
      suppNote: ''
    }))
  };
  contests.unshift(contest);
  persistContests();
  return contest;
}

/** 预约场立即开始（手动提前开始） */
export function startContestNow(id) {
  const c = getContest(id); if (!c) return null;
  if (c.status !== 'scheduled') return c;
  const now = Date.now();
  c.status = 'running';
  c.startedAt = now;
  c.endsAt = now + c.durationMs;
  c.scheduledAt = null;
  persistContests();
  return c;
}

/** 取消预约（未开始前直接删除该场记录） */
export function cancelScheduledContest(id) {
  const c = getContest(id); if (!c || c.status !== 'scheduled') return false;
  deleteContest(id);
  return true;
}

export function updateContest(id, patch) {
  const c = getContest(id); if (!c) return null;
  Object.assign(c, patch);
  persistContests();
  return c;
}

export function updateContestProblem(contestId, problemId, patch) {
  const c = getContest(contestId); if (!c) return null;
  const p = c.problems.find(x => x.id === problemId); if (!p) return null;
  const safe = Object.assign({}, patch);
  if ('estScore' in safe) safe.estScore = clampScore(safe.estScore);
  if ('realScore' in safe) safe.realScore = clampScore(safe.realScore);
  Object.assign(p, safe);
  persistContests();
  return p;
}

/** 记录一次赛时状态：估分 + 时间戳 */
export function recordEstimate(contestId, problemId, score) {
  const c = getContest(contestId); if (!c) return null;
  const p = c.problems.find(x => x.id === problemId); if (!p) return null;
  const safe = score == null ? null : clampScore(score);
  p.records.push({ score: safe === '' ? null : safe, at: Date.now() });
  if (p.records.length > 24) p.records.splice(0, p.records.length - 24);
  persistContests();
  return p;
}

export function latestRecord(p) {
  if (!p || !Array.isArray(p.records) || !p.records.length) return null;
  return p.records[p.records.length - 1];
}

/** 估分合计：优先取最近一次记录的分数，否则取输入框里的估分 */
export function sumEstimate(contest) {
  if (!contest) return 0;
  return contest.problems.reduce((s, p) => {
    const r = latestRecord(p);
    if (r && r.score != null) return s + (Number(r.score) || 0);
    return s + (Number(p.estScore) || 0);
  }, 0);
}
export function sumReal(contest) {
  if (!contest) return 0;
  return contest.problems.reduce((s, p) => s + (Number(p.realScore) || 0), 0);
}
export function hasAnyEstimate(contest) {
  if (!contest) return false;
  return contest.problems.some(p => latestRecord(p) || String(p.estScore).trim() !== '');
}

/**
 * 检查并推进模拟赛状态：
 *   预约场到点 → running；计时场到点 → review（自动交卷）。
 * 返回 { started: [...], finished: [...] }。
 */
export function syncContestTimers() {
  loadContests();
  const now = Date.now();
  const started = [];
  const finished = [];
  contests.forEach(c => {
    if (c.status === 'scheduled' && c.scheduledAt && now >= c.scheduledAt) {
      c.status = 'running';
      c.startedAt = c.scheduledAt;
      c.endsAt = c.startedAt + c.durationMs;
      c.scheduledAt = null;
      started.push(c);
    }
    if (c.status === 'running' && c.endsAt && now >= c.endsAt) {
      c.status = 'review';
      c.submittedAt = c.endsAt;
      finished.push(c);
    }
  });
  if (started.length || finished.length) persistContests();
  return { started, finished };
}

export function submitContest(id) {
  const c = getContest(id); if (!c) return null;
  if (c.status !== 'running') return c;
  c.status = 'review';
  c.submittedAt = Date.now();
  persistContests();
  return c;
}

export function archiveContest(id) {
  const c = getContest(id); if (!c) return null;
  c.status = 'supplement';
  c.archivedAt = c.archivedAt || Date.now();
  if (!c.submittedAt) c.submittedAt = Date.now();
  persistContests();
  return c;
}

/* ---------- 补题 ---------- */
/** 虚拟题号：T1·abcd —— 题目序号在前防止被截断，后 4 位区分场次 */
export function virtualPidOf(c, index) {
  return 'T' + (index + 1) + '·' + String(c.id || '').replace(/^mc_/, '').slice(-4);
}

function suppTaskOf(c, p) {
  if (!c || !p || !p.suppPid) return null;
  loadDaily();
  const ln = 'MOCK:' + c.id;
  return daily.inbox.concat(daily.doing, daily.suspended)
    .find(t => t.virtual && t.listName === ln && t.pid === p.suppPid) || null;
}

/** 补题按钮状态：none | inbox | doing | suspended | done */
export function supplementState(c, p) {
  if (!p) return 'none';
  if (p.suppDoneAt) return 'done';
  const t = suppTaskOf(c, p);
  if (!t) return 'none';
  if (t.status === 'suspended') return 'suspended';
  return t.status === 'doing' ? 'doing' : 'inbox';
}

/** 把某道赛题加入日常待做池（虚拟题号，不写进任何题单） */
export function addSupplement(contestId, problemId) {
  const c = getContest(contestId); if (!c) return { ok: false, reason: 'missing' };
  if (c.status !== 'supplement' && c.status !== 'review') return { ok: false, reason: 'state' };
  const idx = c.problems.findIndex(x => x.id === problemId);
  if (idx < 0) return { ok: false, reason: 'missing' };
  const p = c.problems[idx];
  if (p.suppDoneAt) return { ok: false, reason: 'done' };
  const existed = suppTaskOf(c, p);
  if (existed) return { ok: true, existed: true, task: existed };
  if (!p.suppPid) {
    p.suppPid = virtualPidOf(c, idx);
    // 先落盘题号：addToInbox 会广播 daily，面板重绘会重新 loadContests 覆盖内存引用
    persistContests();
  }
  return addToInbox({
    listName: 'MOCK:' + c.id,
    pid: p.suppPid,
    name: c.name + ' · ' + p.name,
    difficulty: 0,
    virtual: true,
    mockContestId: c.id,
    mockProblemId: p.id
  });
}

/** 日常区完成补题后回写到模拟赛题目 */
export function markSupplementDone(contestId, problemId, info) {
  const c = getContest(contestId); if (!c) return null;
  const p = c.problems.find(x => x.id === problemId); if (!p) return null;
  p.suppDoneAt = Date.now();
  const lines = ['补题完成 · ' + shortDateTime(p.suppDoneAt)];
  lines.push((info && info.usedSolution ? '看了题解' : '独立完成') +
    ((info && info.durationMs) ? ' · ' + humanDuration(info.durationMs) : ''));
  if (info && info.icebreak) lines.push('破冰点：' + info.icebreak);
  p.suppNote = lines.join('\n');
  persistContests();
  return p;
}

/** 复盘完成 → 进入补题阶段 */
export function enterSupplement(id) {
  const c = getContest(id); if (!c) return null;
  if (c.status !== 'review') return c;
  c.status = 'supplement';
  c.archivedAt = Date.now();
  if (!c.submittedAt) c.submittedAt = Date.now();
  persistContests();
  return c;
}

function reclaimMockTasks(contestId) {
  loadDaily();
  rollDailyDay();
  const isMock = t => t && t.virtual && t.mockContestId === contestId;
  let removed = 0;
  const strip = arr => arr.filter(t => {
    if (!isMock(t)) return true;
    if (daily.activeId === t.id) accumulate(t.id);
    delete daily.elapsed[t.id];
    removed++;
    return false;
  });
  daily.inbox = strip(daily.inbox);
  daily.doing = strip(daily.doing);
  daily.suspended = strip(daily.suspended);
  if (removed) persistDaily();
  return removed;
}

/** 结束补题：收回日常区未完成的题目，已完成的记录保留 */
export function finishSupplement(id) {
  const c = getContest(id); if (!c) return { ok: false, reason: 'missing' };
  if (c.status !== 'supplement') return { ok: false, reason: 'state' };
  // 先落状态：reclaimMockTasks 会广播 daily，面板重绘会重新 loadContests 覆盖内存引用
  c.status = 'finished';
  c.finishedAt = Date.now();
  persistContests();
  const removed = reclaimMockTasks(c.id);
  persistContests();
  return { ok: true, removed };
}

export function deleteContest(id) {
  // 先收回日常区任务（会广播 daily）；随后再重读比赛列表，避免被重绘覆盖
  reclaimMockTasks(id);
  loadContests();
  contests = contests.filter(c => c.id !== id);
  persistContests();
}

/* ============================================================
   二、Trick 库
   ============================================================ */
export const TRICK_SWATCHES = [
  '#5a8a9a', '#4f9d8f', '#61a35e', '#b8a04a', '#c98a4b',
  '#c06a6a', '#b06aa8', '#7d74c9', '#5b7fd6', '#6b7b8c'
];

let tricks = [];
loadTricks();

function loadTricks() {
  const v = readJSON(TRICK_KEY, []);
  tricks = Array.isArray(v) ? v : [];
  tricks.forEach(t => {
    if (typeof t.note !== 'string') t.note = '';
    if (!t.color) t.color = '#5a8a9a';
    if (t.priority == null) t.priority = 1;
    if (!t.createdAt) t.createdAt = Date.now();
    if (!t.example || typeof t.example !== 'object' || !t.example.listName || !t.example.pid) {
      t.example = null;
    } else {
      t.example = {
        listName: String(t.example.listName),
        pid: String(t.example.pid),
        name: String(t.example.name || '')
      };
    }
  });
  return tricks;
}
export function getTricks() { return loadTricks(); }
export function sortedTricks() {
  return loadTricks().slice().sort((a, b) => {
    const pa = Number(a.priority) || 0, pb = Number(b.priority) || 0;
    if (pa !== pb) return pa - pb;                       // 优先级小的靠前
    return (b.createdAt || 0) - (a.createdAt || 0);      // 同优先级新的靠前
  });
}
function persistTricks() { writeJSON(TRICK_KEY, tricks); emit('tricks'); }

export function saveTrick(id, payload) {
  loadTricks();
  const ex = payload.example;
  const data = {
    feature: String(payload.feature || '').trim(),
    transform: String(payload.transform || '').trim(),
    algo: String(payload.algo || '').trim(),
    note: String(payload.note || ''),
    color: payload.color || '#5a8a9a',
    priority: Number(payload.priority) || 1,
    example: ex && ex.listName && ex.pid ? {
      listName: String(ex.listName),
      pid: String(ex.pid),
      name: String(ex.name || '')
    } : null,
    updatedAt: Date.now()
  };
  if (id) {
    const t = tricks.find(x => x.id === id);
    if (!t) return null;
    Object.assign(t, data);
    persistTricks();
    return t;
  }
  const t = Object.assign({ id: nid('tk'), createdAt: Date.now() }, data);
  tricks.push(t);
  persistTricks();
  return t;
}

export function deleteTrick(id) {
  loadTricks();
  tricks = tricks.filter(t => t.id !== id);
  persistTricks();
}

/* ============================================================
   三、日常做题节奏
   ============================================================ */
function dayKeyOf(ts) { return fmtDate(new Date(ts == null ? Date.now() : ts)); }
function emptyDaily() {
  return {
    inbox: [], doing: [], suspended: [], done: [],
    activeId: null, activeSince: null, elapsed: {},
    today: { date: dayKeyOf(Date.now()), ms: 0 }
  };
}
let daily = emptyDaily();
loadDaily();

/**
 * 跨天处理：清空「最近完成」并把今日投入时间清零。
 * 返回是否发生了跨天重置。
 */
function rollDailyDay() {
  const key = dayKeyOf(Date.now());
  const dateChanged = !daily.today || daily.today.date !== key;
  const staleDone = daily.done.length > 0 && dayKeyOf(daily.done[0].doneAt) !== key;
  if (!dateChanged && !staleDone) return false;
  if (dateChanged) daily.today = { date: key, ms: 0 };
  else daily.today = { date: key, ms: Math.max(0, Number(daily.today.ms) || 0) };
  daily.done = [];
  return true;
}

function loadDaily() {
  const v = readJSON(DAILY_KEY, null);
  daily = emptyDaily();
  if (v && typeof v === 'object') {
    ['inbox', 'doing', 'suspended', 'done'].forEach(k => {
      if (Array.isArray(v[k])) daily[k] = v[k].filter(Boolean);
    });
    daily.activeId = v.activeId || null;
    daily.activeSince = v.activeSince || null;
    daily.elapsed = (v.elapsed && typeof v.elapsed === 'object') ? v.elapsed : {};
    if (v.today && typeof v.today === 'object') {
      daily.today = { date: String(v.today.date || ''), ms: Math.max(0, Number(v.today.ms) || 0) };
    }
  }
  daily.doing.forEach(t => { t.status = 'doing'; });
  daily.suspended.forEach(t => { t.status = 'suspended'; });
  daily.inbox.forEach(t => { t.status = 'inbox'; });
  if (daily.activeId && !daily.doing.some(t => t.id === daily.activeId)) {
    daily.activeId = null; daily.activeSince = null;
  }
  if (rollDailyDay()) persistDaily();
  return daily;
}
export function getDaily() { return loadDaily(); }
function persistDaily() { writeJSON(DAILY_KEY, daily); emit('daily'); }

export function activeTask() {
  loadDaily();
  return daily.activeId ? daily.doing.find(t => t.id === daily.activeId) || null : null;
}

function locate(id) {
  const pools = [['inbox', daily.inbox], ['doing', daily.doing], ['suspended', daily.suspended]];
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i][0], arr = pools[i][1];
    const idx = arr.findIndex(t => t.id === id);
    if (idx !== -1) return { pool, arr, index: idx, task: arr[idx] };
  }
  return null;
}
function findTaskByProblem(listName, pid) {
  const all = daily.inbox.concat(daily.doing, daily.suspended);
  return all.find(t => t.pid === pid && (t.listName || '') === (listName || '')) || null;
}

/** 加入待做池 */
export function addToInbox(item) {
  loadDaily();
  rollDailyDay();
  if (!item || !item.pid) return { ok: false, reason: 'bad' };
  if (findTaskByProblem(item.listName, item.pid)) return { ok: false, reason: 'duplicate' };
  if (daily.inbox.length >= INBOX_LIMIT) return { ok: false, reason: 'full' };
  const task = {
    id: nid('dt'),
    listName: item.listName || '',
    pid: String(item.pid),
    name: item.name || '',
    difficulty: Number(item.difficulty) || 0,
    addedAt: Date.now(),
    status: 'inbox'
  };
  if (item.virtual) {
    task.virtual = true;
    task.mockContestId = item.mockContestId || '';
    task.mockProblemId = item.mockProblemId || '';
  }
  daily.inbox.unshift(task);
  persistDaily();
  return { ok: true };
}

/** 直接从待做池移除 */
export function removeFromInbox(id) {
  loadDaily();
  const before = daily.inbox.length;
  daily.inbox = daily.inbox.filter(t => t.id !== id);
  if (daily.inbox.length === before) return false;
  persistDaily();
  return true;
}

/** 待做池 / 挂起区 → 进行中 */
export function moveToDoing(id) {
  loadDaily();
  const loc = locate(id);
  if (!loc) return { ok: false, reason: 'missing' };
  if (loc.pool === 'doing') return { ok: true };
  if (daily.doing.length >= DOING_LIMIT) return { ok: false, reason: 'full' };
  loc.arr.splice(loc.index, 1);
  loc.task.status = 'doing';
  loc.task.movedAt = Date.now();
  daily.doing.push(loc.task);
  persistDaily();
  return { ok: true };
}

/** 开做（全局仅允许一道题计时） */
export function startTask(id) {
  loadDaily();
  const t = daily.doing.find(x => x.id === id);
  if (!t) return { ok: false, reason: 'missing' };
  if (daily.activeId && daily.activeId !== id) return { ok: false, reason: 'busy' };
  if (daily.activeId === id) return { ok: true };
  daily.activeId = id;
  daily.activeSince = Date.now();
  t.status = 'doing';
  persistDaily();
  return { ok: true };
}

/**
 * 即刻开始：把题目加入进行区并立即计时。
 * · 已有题目正在计时 → 取消操作，返回 busy
 * · 进行区已满且无计时 → 把第一个进行中的题打回待做池
 * · 题目已在待做池 / 挂起区 / 进行中 → 直接复用原任务
 */
export function startNow(item) {
  loadDaily();
  rollDailyDay();
  if (!item || !item.pid) return { ok: false, reason: 'bad' };
  if (daily.activeId) {
    const active = daily.doing.find(t => t.id === daily.activeId) || null;
    return { ok: false, reason: 'busy', active };
  }
  const listName = item.listName || '';
  const pid = String(item.pid);
  let task = findTaskByProblem(listName, pid);
  const alreadyDoing = !!(task && daily.doing.some(t => t.id === task.id));

  let evicted = null;
  if (!alreadyDoing && daily.doing.length >= DOING_LIMIT) {
    const occupiedInbox = daily.inbox.length - (task && task.status === 'inbox' ? 1 : 0);
    if (occupiedInbox >= INBOX_LIMIT) return { ok: false, reason: 'inbox-full' };
    const first = daily.doing.shift();
    if (first) {
      first.status = 'inbox';
      first.movedBackAt = Date.now();
      daily.inbox.unshift(first);
      evicted = first;
    }
  }

  if (task) {
    daily.inbox = daily.inbox.filter(t => t.id !== task.id);
    daily.suspended = daily.suspended.filter(t => t.id !== task.id);
  } else {
    task = {
      id: nid('dt'),
      listName,
      pid,
      name: item.name || '',
      difficulty: Number(item.difficulty) || 0,
      addedAt: Date.now(),
      status: 'doing'
    };
    if (item.virtual) {
      task.virtual = true;
      task.mockContestId = item.mockContestId || '';
      task.mockProblemId = item.mockProblemId || '';
    }
  }
  if (!alreadyDoing) daily.doing.push(task);
  task.status = 'doing';
  task.movedAt = Date.now();
  daily.activeId = task.id;
  daily.activeSince = Date.now();
  persistDaily();
  return { ok: true, task, evicted };
}

function accumulate(id) {
  rollDailyDay();
  if (daily.activeId === id && daily.activeSince) {
    const delta = Math.max(0, Date.now() - daily.activeSince);
    daily.elapsed[id] = (daily.elapsed[id] || 0) + delta;
    daily.today.ms = (daily.today.ms || 0) + delta;
  }
  if (daily.activeId === id) { daily.activeId = null; daily.activeSince = null; }
}

/** 暂停计时（题目仍留在进行中，按钮回到「开做」） */
export function pauseTask(id) {
  loadDaily();
  const t = daily.doing.find(x => x.id === id);
  if (!t) return { ok: false, reason: 'missing' };
  accumulate(id);
  persistDaily();
  return { ok: true, durationMs: daily.elapsed[id] || 0 };
}

/** 挂起：停止计时，保留累计时间，移入挂起区 */
export function suspendTask(id) {
  loadDaily();
  const t = daily.doing.find(x => x.id === id);
  if (!t) return { ok: false, reason: 'missing' };
  accumulate(id);
  daily.doing = daily.doing.filter(x => x.id !== id);
  t.status = 'suspended';
  t.suspendedAt = Date.now();
  daily.suspended.unshift(t);
  persistDaily();
  return { ok: true, durationMs: daily.elapsed[id] || 0 };
}

/** 完成：停止计时，移入完成记录 */
export function completeTask(id, payload) {
  loadDaily();
  const t = daily.doing.find(x => x.id === id);
  if (!t) return { ok: false, reason: 'missing' };
  // 完成前检查上一条完成记录：不是同一天就清空「最近完成」，今日投入时间同步归零
  const key = dayKeyOf(Date.now());
  const prev = daily.done[0];
  if (prev && dayKeyOf(prev.doneAt) !== key) {
    daily.done = [];
    daily.today = { date: key, ms: 0 };
  }
  accumulate(id);
  const durationMs = daily.elapsed[id] || 0;
  daily.doing = daily.doing.filter(x => x.id !== id);
  daily.done.unshift({
    id: t.id,
    listName: t.listName,
    pid: t.pid,
    name: t.name,
    difficulty: t.difficulty,
    durationMs,
    usedSolution: !!(payload && payload.usedSolution),
    icebreak: String((payload && payload.icebreak) || ''),
    doneAt: Date.now()
  });
  if (daily.done.length > 40) daily.done.length = 40;
  delete daily.elapsed[id];
  persistDaily();
  return { ok: true, task: t, durationMs };
}

/** 从挂起区彻底移除 */
export function removeSuspended(id) {
  loadDaily();
  const before = daily.suspended.length;
  daily.suspended = daily.suspended.filter(t => t.id !== id);
  if (daily.suspended.length === before) return false;
  delete daily.elapsed[id];
  persistDaily();
  return true;
}

export function elapsedOf(id) {
  const base = daily.elapsed[id] || 0;
  if (daily.activeId === id && daily.activeSince) {
    return base + Math.max(0, Date.now() - daily.activeSince);
  }
  return base;
}

export function clearDoneHistory() {
  loadDaily();
  daily.done = [];
  persistDaily();
}

/** 统计：今天在题目上的累计投入时间（跨天自动清零） */
export function totalFocusedMs() {
  rollDailyDay();
  let sum = daily.today.ms || 0;
  if (daily.activeId && daily.activeSince) sum += Math.max(0, Date.now() - daily.activeSince);
  return sum;
}