// js/store.js —— 唯一数据源 + 持久化 + 撤销/重做 + 事件通知
import { lsGet, lsSet, createBus, todayStr } from './core.js';

const STORAGE_KEY = 'luogu_problem_lists_v13';
const LEGACY_KEYS = ['luogu_problem_lists_v12','luogu_problem_lists_v11','luogu_problem_lists_v10'];

const bus = createBus();
let state = null;
const undoStack = [];
const redoStack = [];

export function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }

export function normalizeProblem(p) {
  const isOld = p && ('status' in p || 'think' in p);
  let date = '';
  if (isOld) { const done = p.status && p.status !== 'pending'; date = done ? (p.date || todayStr()) : ''; }
  else if (p && p.date) date = String(p.date);
  return {
    pid: p && p.pid ? String(p.pid).toUpperCase() : '',
    name: p && p.name ? String(p.name) : '',
    difficulty: p && p.difficulty != null ? (parseInt(p.difficulty, 10) || 0) : 0,
    date,
    note: p && typeof p.note === 'string' ? p.note : '',
    pinned: !!(p && p.pinned),
    know: !!(p && p.know),
    groupId: (p && p.groupId) || null
  };
}

function load() {
  let raw = lsGet(STORAGE_KEY);
  if (!raw) for (const k of LEGACY_KEYS) { raw = lsGet(k); if (raw) break; }
  const data = {
    lists: {}, listGroups: [], listGroupMap: {}, listLocks: {}, listPins: {},
    listOrder: [], markedLists: [], currentList: null
  };
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && p.lists && typeof p.lists === 'object') {
        for (const name in p.lists) {
          const v = p.lists[name];
          const obj = { groups: [], problems: [] };
          if (Array.isArray(v)) obj.problems = v.map(normalizeProblem);
          else if (v && Array.isArray(v.problems)) {
            obj.problems = v.problems.map(normalizeProblem);
            obj.groups = Array.isArray(v.groups)
              ? v.groups.map(g => ({ id: g.id || uid('g'), name: g.name || '组', collapsed: g.collapsed !== false }))
              : [];
          }
          data.lists[name] = obj;
        }
        if (Array.isArray(p.listGroups)) data.listGroups = p.listGroups;
        if (p.listGroupMap) data.listGroupMap = p.listGroupMap;
        if (p.listLocks) data.listLocks = p.listLocks;
        data.listPins = p.listPins || p.pins || {};
        if (Array.isArray(p.listOrder)) data.listOrder = p.listOrder;
        if (Array.isArray(p.markedLists)) data.markedLists = p.markedLists;
        data.currentList = p.currentList || null;
      }
    } catch (e) { console.warn('[store] 旧数据解析失败', e); }
  }
  if (Object.keys(data.lists).length === 0) {
    data.lists = {
      '示例题单': {
        groups: [],
        problems: [
          { pid:'P1001', name:'A+B Problem', difficulty:0, date:'', note:'', pinned:false, know:false, groupId:null }
        ]
      }
    };
    data.currentList = '示例题单';
  }
  if (!data.currentList || !data.lists[data.currentList]) {
    const ks = Object.keys(data.lists);
    data.currentList = ks[0] || null;
  }
  return data;
}

function persist() { lsSet(STORAGE_KEY, JSON.stringify(state)); }

export const store = {
  init() { state = load(); persist(); return state; },
  getState() { return state; },
  subscribe: bus.on,

  update(mutator, evt = 'state:changed') {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 20) undoStack.shift();
    redoStack.length = 0;
    mutator(state);
    persist();
    bus.emit(evt, state);
    bus.emit('state:changed', state);
  },
  undo() {
    if (!undoStack.length) return false;
    redoStack.push(JSON.stringify(state));
    state = JSON.parse(undoStack.pop());
    persist();
    bus.emit('state:changed', state);
    return true;
  },
  redo() {
    if (!redoStack.length) return false;
    undoStack.push(JSON.stringify(state));
    state = JSON.parse(redoStack.pop());
    persist();
    bus.emit('state:changed', state);
    return true;
  },

  curList() { const n = state.currentList; return n && state.lists[n] ? state.lists[n] : null; },
  curProblems() { const l = this.curList(); return l && Array.isArray(l.problems) ? l.problems : []; },
  curGroups() { const l = this.curList(); return l && Array.isArray(l.groups) ? l.groups : []; },
  isLocked() { return !!(state.currentList && state.listLocks[state.currentList]); },
  uid
};