// js/app.js —— 主页面全部逻辑（约 1300 行）
// 面板通过 window 事件 'app:state-changed' 订阅刷新；通过 import 复用本文件导出的函数/状态

import {
  $, escapeHtml, lsGet, lsSet, showToast,
  fmtDate, fmtShort, fmtRelative, todayStr,
  normalizePid, DIFF_NAMES, DIFF_COLORS, rndLine, hexToRgba, copyText, copyPlainText,
  problemStatus, getProblemUrl, getOJSource,
  closeModal, confirmDialog, promptText, promptNumber, promptDate, bindOverlayClose,
  openPopups, closePopup, closeAllPopups, togglePopup, openContextMenu
} from './core.js';
import { store, uid, normalizeProblem } from './store.js';
import { mountPanel } from './panels-loader.js';
import { onCodexChange, addToInbox, getContests, getDaily, syncContestTimers, startNow, activeTask, INBOX_LIMIT } from './features/codex-store.js';
import { initTheme } from './features/theme.js';
import { openTour, initTour, shouldShowTour } from './features/tour.js';

/* ============================================================
   常量
   ============================================================ */
const STORAGE_KEY = 'luogu_problem_lists_v13';
const GITHUB_KEY = 'github_settings_problem_lists';

// 训练板块的独立 localStorage 键；导出/导入时一并带上
const CODEX_KEYS = ['mock', 'tricks', 'daily'];
const CODEX_KEY_MAP = {
  mock: 'codex_mock_contests_v1',
  tricks: 'codex_tricks_v1',
  daily: 'codex_daily_v1'
};

/* ============================================================
   全局状态
   ============================================================ */
const data = store.init();
export { data };

let renamingList = null;
let multiSelectMode = false;
let randomScope = 'global';
let currentViewMode = 'all';
let groupViewMode = 'none';
let moveCopyMode = false;
let moveGroupFor = 'batch';
let batchParsedData = [];
let batchParsedHasGroups = false;
let importMode = 'nodiff';
let selectedProblems = new Set();
let lastSelectedPid = null;
let undoStack = [], redoStack = [];
let hoveredElem = null;
let difficultyCursor = 0;
let difficultyCursorSig = '';

/* ---------- 界面记忆：题单滚动位置 / 分组展开状态 ---------- */
const UI_STATE_KEY = 'app_ui_state_v1';
function loadUIState() {
  try {
    const v = JSON.parse(lsGet(UI_STATE_KEY) || '{}');
    return (v && typeof v === 'object') ? v : {};
  } catch (e) { return {}; }
}
let uiState = loadUIState();
uiState.scroll = (uiState.scroll && typeof uiState.scroll === 'object') ? uiState.scroll : {};
uiState.viewGroups = (uiState.viewGroups && typeof uiState.viewGroups === 'object') ? uiState.viewGroups : {};
uiState.twoCol = !!uiState.twoCol;
let viewGroupState = uiState.viewGroups;
let uiStateSaveTimer = null;

function persistUIState() {
  try { lsSet(UI_STATE_KEY, JSON.stringify(uiState)); } catch (e) {}
}
function rememberProblemScroll() {
  const box = $('problemList');
  if (!box || !data.currentList) return;
  uiState.scroll[data.currentList] = box.scrollTop || 0;
}
function scheduleUIStateSave() {
  clearTimeout(uiStateSaveTimer);
  uiStateSaveTimer = setTimeout(persistUIState, 240);
}
/* ---------- 侧栏宽度：拖动右边缘调整，双击复位 ---------- */
const SIDEBAR_MIN = 220, SIDEBAR_MAX = 560;
function applySidebarWidth() {
  const aside = document.querySelector('.sidebar-left');
  if (!aside) return;
  const w = parseInt(uiState.sidebarWidth, 10);
  if (w > 0) aside.style.flexBasis = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)) + 'px';
}
function bindSidebarResize() {
  const aside = document.querySelector('.sidebar-left');
  const rz = $('sidebarResizer');
  if (!aside || !rz || rz.dataset.bound) return;
  rz.dataset.bound = '1';
  rz.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = aside.getBoundingClientRect().width;
    rz.classList.add('dragging');
    document.body.classList.add('sidebar-resizing');
    try { rz.setPointerCapture(e.pointerId); } catch (err) {}
    const move = ev => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(startW + ev.clientX - startX)));
      aside.style.flexBasis = w + 'px';
    };
    const up = () => {
      rz.classList.remove('dragging');
      document.body.classList.remove('sidebar-resizing');
      rz.removeEventListener('pointermove', move);
      rz.removeEventListener('pointerup', up);
      rz.removeEventListener('pointercancel', up);
      try { rz.releasePointerCapture(e.pointerId); } catch (err) {}
      uiState.sidebarWidth = Math.round(aside.getBoundingClientRect().width);
      scheduleUIStateSave();
      fitProblemTags($('problemList'));
    };
    rz.addEventListener('pointermove', move);
    rz.addEventListener('pointerup', up);
    rz.addEventListener('pointercancel', up);
  });
  rz.addEventListener('dblclick', () => {
    aside.style.flexBasis = '';
    delete uiState.sidebarWidth;
    scheduleUIStateSave();
    fitProblemTags($('problemList'));
  });
}

/* ============================================================
   持久化 + 事件通知
   ============================================================ */
function notifyStateChanged() {
  try { window.dispatchEvent(new CustomEvent('app:state-changed', { detail: data })); } catch (e) {}
}
function saveData() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  notifyStateChanged();
}
function pushUndo() {
  try { undoStack.push(JSON.stringify(data)); if (undoStack.length > 20) undoStack.shift(); redoStack = []; } catch (e) {}
}
function applySnapshot(snap) {
  try {
    const r = JSON.parse(snap);
    for (const k in data) delete data[k];
    Object.assign(data, r);
    if (!data.lists) data.lists = {};
    if (!Array.isArray(data.listGroups)) data.listGroups = [];
    if (!data.listGroupMap) data.listGroupMap = {};
    if (!data.listLocks) data.listLocks = {};
    if (!data.listPins) data.listPins = {};
    if (!Array.isArray(data.listOrder)) data.listOrder = [];
    if (!Array.isArray(data.markedLists)) data.markedLists = [];
    if (data.currentList && !data.lists[data.currentList]) {
      const ks = sortLists();
      data.currentList = ks.length ? ks[0] : null;
    }
    saveData(); renderAll();
  } catch (e) { console.error(e); }
}
function undo() {
  if (!undoStack.length) { showToast('没有可撤销的操作', 'info'); return; }
  try { redoStack.push(JSON.stringify(data)); } catch (e) {}
  applySnapshot(undoStack.pop());
  showToast('已撤销', 'success');
}
function redo() {
  if (!redoStack.length) { showToast('没有可重做的操作', 'info'); return; }
  try { undoStack.push(JSON.stringify(data)); } catch (e) {}
  applySnapshot(redoStack.pop());
  showToast('已重做', 'success');
}

/* ============================================================
   当前题单 / 过滤
   ============================================================ */
export function curList() { const n = data.currentList; return (n && data.lists[n]) ? data.lists[n] : null; }
function curProblems() { const l = curList(); return (l && Array.isArray(l.problems)) ? l.problems : []; }
function curGroups() { const l = curList(); return (l && Array.isArray(l.groups)) ? l.groups : []; }
function isLocked() { return !!(data.currentList && data.listLocks[data.currentList]); }
function getFilteredProblems() {
  const all = curProblems();
  if (currentViewMode === 'pending') return all.filter(p => !p.date);
  if (currentViewMode === 'done')    return all.filter(p => !!p.date);
  return all;
}
function sortForDisplay(arr) { return arr.filter(p => p.pinned).concat(arr.filter(p => !p.pinned)); }
export function sortLists() {
  const keys = Object.keys(data.lists);
  const order = Array.isArray(data.listOrder) ? data.listOrder : [];
  return keys.sort((a, b) => {
    const pa = data.listPins[a] ? 1 : 0, pb = data.listPins[b] ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

/* ============================================================
   粒子 / 涟漪
   ============================================================ */
function playCompletionParticles(dotEl) {
  if (!dotEl) return;
  const rect = dotEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const colors = ['#61c454','#5a8a9a','#f5bd4f','#ed6a5e','#a482db','#58c1d1','#47c49a'];
  const host = document.createElement('div'); host.className = 'particle-host';
  document.body.appendChild(host);
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('div'); p.className = 'particle';
    const size = 3 + Math.random() * 4;
    const angle = (Math.PI * 2 * i) / 14 + (Math.random() - 0.5) * 0.6;
    const dist = 24 + Math.random() * 36;
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
    p.style.left = cx + 'px'; p.style.top = cy + 'px';
    p.style.width = size + 'px'; p.style.height = size + 'px';
    p.style.background = colors[i % colors.length];
    host.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(0.2)';
      p.style.opacity = '0';
    });
  }
  setTimeout(() => host.remove(), 600);
}
function playRipple(itemEl, color) {
  if (!itemEl) return;
  itemEl.style.setProperty('--ripple-color', color);
  itemEl.classList.remove('ripple'); void itemEl.offsetWidth;
  itemEl.classList.add('ripple');
  setTimeout(() => itemEl.classList.remove('ripple'), 600);
}

/* ============================================================
   组 / 排序工具
   ============================================================ */
function nextGroupName() {
  const l = curList(); const used = new Set();
  if (l) l.groups.forEach(g => { const m = String(g.name).match(/^组\s*(\d+)$/); if (m) used.add(parseInt(m[1], 10)); });
  let i = 1; while (used.has(i)) i++; return '组 ' + i;
}
function askImportGroup(l) {
  return new Promise(resolve => {
    const sel = $('importGroupSelect');
    sel.innerHTML = '<option value="__new__">添加到新组</option><option value="__none__">未分组</option>';
    l.groups.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.name; sel.appendChild(o); });
    const modal = $('importGroupModal'), okBtn = $('importGroupOkBtn'), cancelBtn = $('importGroupCancelBtn');
    let done = false;
    const finish = v => {
      if (done) return; done = true;
      okBtn.onclick = null; cancelBtn.onclick = null; unbindOverlay();
      closeModal('importGroupModal'); resolve(v);
    };
    const unbindOverlay = bindOverlayClose(modal, () => finish(null));
    okBtn.onclick = e => {
      e.stopPropagation();
      let v = sel.value;
      if (v === '__new__') { const g = addProblemGroup(nextGroupName()); v = g.id; }
      finish(v);
    };
    cancelBtn.onclick = e => { e.stopPropagation(); finish(null); };
    modal.classList.add('show');
  });
}
function addListGroup(name) {
  name = (name || '').trim() || ('未命名组 ' + (data.listGroups.length + 1));
  const g = { id: uid('lg'), name, collapsed: false };
  data.listGroups.push(g);
  return g;
}
function addProblemGroup(name) {
  const l = curList(); if (!l) return null;
  name = (name || '').trim() || '新组';
  const g = { id: uid('g'), name, collapsed: true };
  l.groups.push(g);
  return g;
}
function getGroupById(gid) { const l = curList(); return l ? l.groups.find(g => g.id === gid) : null; }
function moveWithinGroup(pid, delta) {
  const l = curList(); if (!l) return false;
  const idx = l.problems.findIndex(p => p.pid === pid); if (idx === -1) return false;
  const gid = l.problems[idx].groupId;
  const sameGroupIdxs = []; l.problems.forEach((p, i) => { if (p.groupId === gid) sameGroupIdxs.push(i); });
  const posInGroup = sameGroupIdxs.indexOf(idx);
  const newPos = Math.max(0, Math.min(sameGroupIdxs.length - 1, posInGroup + delta));
  if (newPos === posInGroup) return false;
  const targetGlobalIdx = sameGroupIdxs[newPos];
  const [moved] = l.problems.splice(idx, 1);
  let insertAt = targetGlobalIdx > idx ? targetGlobalIdx - 1 : targetGlobalIdx;
  if (delta > 0) insertAt += 1;
  l.problems.splice(insertAt, 0, moved);
  return true;
}
function moveListOrder(name, delta) {
  const keys = sortLists();
  if (!data.listOrder.length || data.listOrder.length !== keys.length) data.listOrder = keys.slice();
  keys.forEach(k => { if (!data.listOrder.includes(k)) data.listOrder.push(k); });
  data.listOrder = data.listOrder.filter(k => keys.includes(k));
  const i = data.listOrder.indexOf(name); if (i === -1) return false;
  const j = i + delta; if (j < 0 || j >= data.listOrder.length) return false;
  [data.listOrder[i], data.listOrder[j]] = [data.listOrder[j], data.listOrder[i]];
  return true;
}
function moveListGroupOrder(gid, delta) {
  const i = data.listGroups.findIndex(g => g.id === gid); if (i === -1) return false;
  const j = i + delta; if (j < 0 || j >= data.listGroups.length) return false;
  [data.listGroups[i], data.listGroups[j]] = [data.listGroups[j], data.listGroups[i]];
  return true;
}
function moveProblemGroupOrder(gid, delta) {
  const l = curList(); if (!l) return false;
  const i = l.groups.findIndex(g => g.id === gid); if (i === -1) return false;
  const j = i + delta; if (j < 0 || j >= l.groups.length) return false;
  [l.groups[i], l.groups[j]] = [l.groups[j], l.groups[i]];
  return true;
}
function getDiffDotsHTML(problems) {
  if (!problems.length) return '';
  const counts = Array(9).fill(0); problems.forEach(p => { counts[p.difficulty || 0]++; });
  const arr = counts.map((c, i) => ({ i, c })).filter(x => x.c > 0).sort((a, b) => { if (b.c !== a.c) return b.c - a.c; return b.i - a.i; });
  return '<div class="gh-dots">' + arr.map(x => '<span class="diff-dot" style="background:' + DIFF_COLORS[x.i] + ';" title="' + DIFF_NAMES[x.i] + '"></span>').join('') + '</div>';
}

/* ============================================================
   左侧题单列表
   ============================================================ */
function renderLists() {
  const box = $('listContainer'); if (!box) return;
  const keys = sortLists();
  if (keys.length === 0) {
    box.innerHTML = '<div class="empty-state"><div class="icon"><i class="fas fa-inbox"></i></div><p>还没有题单</p></div>';
    return;
  }
  const groups = data.listGroups; const groupsOf = {}; const ungrouped = [];
  keys.forEach(name => {
    const gid = data.listGroupMap[name];
    if (gid && groups.some(g => g.id === gid)) (groupsOf[gid] = groupsOf[gid] || []).push(name);
    else ungrouped.push(name);
  });
  let html = '';
  ungrouped.forEach(name => { html += renderListItemHTML(name, false); });
  groups.forEach(g => {
    const arr = groupsOf[g.id] || [];
    const total = arr.reduce((s, n) => s + (data.lists[n] ? data.lists[n].problems.length : 0), 0);
    html += '<div class="list-group-head' + (g.collapsed ? ' collapsed' : '') + '" data-lgroup="' + g.id + '">' +
      '<i class="fas fa-caret-down toggle-arrow"></i>' +
      '<span class="lg-name">' + escapeHtml(g.name) + '</span>' +
      '<span class="lg-count">' + total + '</span>' +
    '</div>';
    if (!g.collapsed) arr.forEach(name => { html += renderListItemHTML(name, true); });
  });
  box.innerHTML = html; bindListEvents();
}
function renderListItemHTML(name, grouped) {
  const l = data.lists[name]; if (!l) return '';
  const isActive = name === data.currentList;
  const count = l.problems.length;
  const done = l.problems.filter(p => p.date).length;
  const safe = escapeHtml(name);
  const pinned = !!data.listPins[name];
  const locked = !!data.listLocks[name];
  const marked = data.markedLists.includes(name);
  const cls = 'list-item' + (isActive ? ' active' : '') + (grouped ? ' grouped' : '');
  if (renamingList === name) {
    return '<div class="' + cls + '" data-name="' + safe + '">' +
      '<input class="li-name-input" type="text" value="' + safe + '" data-old="' + safe + '" />' +
      '<span class="li-count">' + (done > 0 ? done + '/' + count : count) + '</span>' +
    '</div>';
  }
  return '<div class="' + cls + '" data-name="' + safe + '">' +
    '<span class="li-name" title="' + safe + '">' + safe + '</span>' +
    '<span class="li-count">' + (done > 0 ? done + '/' + count : count) + '</span>' +
    '<div class="li-marks">' +
      '<button class="li-mark' + (pinned ? ' pinned' : '') + '" data-action="pin" title="' + (pinned ? '取消置顶' : '置顶') + '"><i class="fas fa-arrow-up"></i></button>' +
      '<button class="li-mark' + (marked ? ' marked' : '') + '" data-action="mark" title="' + (marked ? '取消标记' : '标记参与随机') + '"><i class="fas fa-random"></i></button>' +
      '<button class="li-mark' + (locked ? ' locked' : '') + '" data-action="lock" title="' + (locked ? '解锁' : '锁定为只读') + '"><i class="fas fa-' + (locked ? 'lock' : 'lock-open') + '"></i></button>' +
    '</div>' +
  '</div>';
}
function bindListEvents() {
  const box = $('listContainer'); if (!box) return;
  box.querySelectorAll('.list-group-head').forEach(head => {
    head.addEventListener('click', () => {
      const gid = head.dataset.lgroup; const g = data.listGroups.find(x => x.id === gid); if (!g) return;
      g.collapsed = !g.collapsed; saveData(); renderLists();
    });
    head.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const gid = head.dataset.lgroup; const g = data.listGroups.find(x => x.id === gid); if (!g) return;
      openContextMenu(e.clientX, e.clientY, [
        { act:'up', icon:'fa-arrow-up', label:'上移', run:() => { if (moveListGroupOrder(gid, -1)) { saveData(); renderLists(); } } },
        { act:'down', icon:'fa-arrow-down', label:'下移', run:() => { if (moveListGroupOrder(gid, 1)) { saveData(); renderLists(); } } },
        { sep:true },
        { act:'rename', icon:'fa-pen', label:'重命名', run: async () => {
          const nn = await promptText('重命名分组', g.name);
          if (nn === null) return; const t = nn.trim(); if (t && t !== g.name) { g.name = t; saveData(); renderLists(); }
        } },
        { act:'del', icon:'fa-trash-alt', label:'删除分组', danger:true, run:() => {
          confirmDialog('删除分组', '删除分组 <strong>' + escapeHtml(g.name) + '</strong>？组内题单将变为未分组。').then(ok => {
            if (!ok) return; pushUndo();
            data.listGroups = data.listGroups.filter(x => x.id !== gid);
            for (const n in data.listGroupMap) if (data.listGroupMap[n] === gid) delete data.listGroupMap[n];
            saveData(); renderLists();
          });
        } }
      ]);
    });
  });
  box.querySelectorAll('.list-item').forEach(it => {
    it.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); openListContextMenu(e.clientX, e.clientY, it.dataset.name); });
  });
  const input = box.querySelector('.li-name-input');
  if (input && input.dataset.old !== undefined && input.dataset.old !== null) {
    let cancelled = false;
    const commit = () => { if (cancelled) return; confirmRenameList(input.dataset.old, input.value); };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled = true; renamingList = null; renderLists(); }
    });
  }
}
export function updateRandomScopeBtns() {
  document.querySelectorAll('#randomScopeToggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.scope === randomScope);
  });
}
function openListContextMenu(x, y, name) {
  if (!data.lists[name]) return;
  const pinned = !!data.listPins[name];
  const locked = !!data.listLocks[name];
  const isCurrent = name === data.currentList;
  const items = [
    { act:'up', icon:'fa-arrow-up', label:'上移', run:() => { if (moveListOrder(name, -1)) { saveData(); renderLists(); } } },
    { act:'down', icon:'fa-arrow-down', label:'下移', run:() => { if (moveListOrder(name, 1)) { saveData(); renderLists(); } } },
    { sep:true },
    { act:'rename', icon:'fa-pen', label:'重命名', run:() => { renamingList = name; renderLists(); setTimeout(() => { const i = document.querySelector('.list-item[data-name="' + CSS.escape(name) + '"] .li-name-input'); if (i) { i.focus(); i.select(); } }, 30); } },
    { act:'movegroup', icon:'fa-folder-tree', label:'加入分组…', run:() => openListGroupPicker(name, x, y) },
    { act:'pin', icon:'fa-arrow-up', label:pinned ? '取消置顶' : '置顶', run:() => toggleListPin(name) },
    { act:'lock', icon:locked ? 'fa-lock-open' : 'fa-lock', label:locked ? '解锁' : '锁定为只读', run:() => toggleListLock(name) }
  ];
  if (!isCurrent) { items.push({ sep:true }); items.push({ act:'open', icon:'fa-folder-open', label:'打开', run:() => selectList(name) }); }
  items.push({ sep:true });
  items.push({ act:'del', icon:'fa-trash-alt', label:'删除题单', danger:true, run:() => deleteList(name) });
  openContextMenu(x, y, items);
}
function openListGroupPicker(listName, x, y) {
  const items = [{ act:'none', icon:'fa-ban', label:'移出分组', run:() => { delete data.listGroupMap[listName]; saveData(); renderLists(); } }];
  data.listGroups.forEach(g => { items.push({ act:'g_' + g.id, icon:'fa-folder', label:g.name, run:() => { data.listGroupMap[listName] = g.id; saveData(); renderLists(); } }); });
  items.push({ sep:true });
  items.push({ act:'new', icon:'fa-folder-plus', label:'新建分组…', run: async () => {
    const name = await promptText('新分组名称', '');
    if (!name) return;
    const g = addListGroup(name); data.listGroupMap[listName] = g.id;
    saveData(); renderLists();
  } });
  openContextMenu(x, y, items);
}
function openListBlankContextMenu(x, y) {
  openContextMenu(x, y, [
    { act:'newListGroup', icon:'fa-folder-plus', label:'新建题单组', run: async () => {
      const name = await promptText('新题单组名称', '新分组');
      if (name === null) return;
      pushUndo(); addListGroup(name); saveData(); renderLists();
      showToast('已新建分组「' + name + '」', 'success');
    } },
    { act:'clearMarks', icon:'fa-eraser', label:'取消所有题单标记', run:() => {
      if (!data.markedLists.length) { showToast('没有标记的题单', 'info'); return; }
      data.markedLists = []; saveData(); renderLists(); updateRandomScopeBtns();
      showToast('已取消所有标记', 'success');
    } }
  ]);
}
function openProblemContextMenu(x, y, pid) {
  const l = curList(); if (!l) return;
  const p = l.problems.find(x => x.pid === pid); if (!p) return;
  const locked = isLocked();
  const items = [];
  if (!locked) {
    items.push({ act:'up', icon:'fa-arrow-up', label:'上移 x 位…', run: async () => {
      const v = await promptNumber('上移位数', 1); const n = parseInt(v, 10); if (!n || n <= 0) return;
      if (moveWithinGroup(pid, -n)) { saveData(); renderProblems(); }
    } });
    items.push({ act:'down', icon:'fa-arrow-down', label:'下移 x 位…', run: async () => {
      const v = await promptNumber('下移位数', 1); const n = parseInt(v, 10); if (!n || n <= 0) return;
      if (moveWithinGroup(pid, n)) { saveData(); renderProblems(); }
    } });
    items.push({ sep:true });
    items.push({ act:'movegroup', icon:'fa-folder-tree', label:'加入组…', run:() => {
      const fakeAnchor = { getBoundingClientRect: () => ({ left:x, right:x, top:y, bottom:y, width:0, height:0 }) };
      openMoveGroupPopup(fakeAnchor, pid);
    } });
    items.push({ act:'pin', icon:'fa-thumbtack', label:p.pinned ? '取消置顶' : '置顶', run:() => toggleProblemPin(pid) });
  }
  items.push({ act:'note', icon:'fa-sticky-note', label:p.note ? '编辑笔记' : '添加笔记', run:() => openNoteModal(pid) });
  items.push({ act:'startNow', icon:'fa-play', label:'即刻开始', run:() => startProblemNow(p) });
  items.push({ act:'inbox', icon:'fa-inbox', label:'加入待做池', run:() => addProblemToInbox(p) });
  items.push({ act:'date', icon:'fa-calendar', label:'设置完成时间…', run: async () => {
    const d = await promptDate('设置完成时间', p.date || todayStr());
    if (d === null) return; pushUndo(); p.date = d || ''; p.know = false; saveData(); renderAll();
  } });
  items.push({ act:'open', icon:'fa-external-link-alt', label:'打开题目链接', run:() => openProblemLink(pid) });
  if (!locked) {
    items.push({ sep:true });
    items.push({ act:'edit', icon:'fa-edit', label:'编辑题号/名称…', run:() => openEditModal(pid) });
    items.push({ act:'del', icon:'fa-trash-alt', label:'删除题目', danger:true, run:() => deleteProblem(pid) });
  }
  openContextMenu(x, y, items);
}

/* ============================================================
   进度条 / 题目列表
   ============================================================ */
function renderProgress() {
  const wrap = $('phProgress'), fill = $('progressFill'), text = $('progressText');
  if (!wrap || !fill || !text) return;
  const l = curList();
  if (!l) { wrap.classList.remove('show'); const db = $('diffBar'); if (db) db.classList.remove('show'); return; }
  const arr = l.problems; const total = arr.length, done = arr.filter(p => p.date).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  fill.style.width = pct + '%'; text.textContent = done + '/' + total + ' (' + pct + '%)'; wrap.classList.add('show');
  const bar = $('diffBar'); if (!bar) return;
  if (total === 0) { bar.classList.remove('show'); }
  else {
    bar.classList.add('show');
    const counts = Array(9).fill(0); arr.forEach(p => { counts[p.difficulty || 0]++; });
    bar.innerHTML = counts.map((c, i) => c ? '<div class="seg" style="flex:' + c + ';background:' + DIFF_COLORS[i] + ';" title="' + DIFF_NAMES[i] + ': ' + c + '"></div>' : '').join('');
  }
}
function refreshGroupSelect() {
  const sel = $('problemGroupSelect'); if (!sel) return;
  const cur = sel.value; const l = curList();
  sel.innerHTML = '<option value="">未分组</option>';
  if (l) l.groups.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.name; sel.appendChild(o); });
  if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
}
let lastRenderedList = null;

function renderProblems() {
  const box = $('problemList'); if (!box) return;
  const prevScroll = box.scrollTop;
  const sameList = lastRenderedList === data.currentList;
  const l = curList(); const nameEl = $('currentListName');
  if (!l) {
    lastRenderedList = null;
    if (nameEl) nameEl.innerHTML = '选择题单 <span class="ph-sub">查看题目</span>';
    box.innerHTML = '<div class="empty-state"><div class="icon"><i class="fas fa-hand-point-left"></i></div><p>选择题单查看题目</p></div>';
    const lb = $('listLockBtn'); if (lb) lb.style.opacity = '0.4';
    refreshGroupSelect(); updateReadonlyUI(); return;
  }
  const total = l.problems.length;
  if (nameEl) nameEl.innerHTML = escapeHtml(data.currentList) + ' <span class="ph-sub">· ' + total + ' 题</span>';
  renderLockBtn(); box.classList.toggle('multi-select-active', multiSelectMode); refreshGroupSelect();

  const problems = getFilteredProblems(); const groups = curGroups();

  if (problems.length === 0) {
    let msg = '还没有题目，添加一个吧';
    if (currentViewMode === 'pending') msg = '🎉 所有题目都已完成！';
    else if (currentViewMode === 'done') msg = '还没有已完成的题目，加油！';
    let html = '';
    if (groups.length > 0) {
      groups.forEach(g => {
        html += '<div class="group-head' + (g.collapsed ? ' collapsed' : '') + '" data-group="' + g.id + '">' +
          '<i class="fas fa-caret-down toggle-arrow"></i>' +
          '<span class="gh-name">' + escapeHtml(g.name) + '</span>' +
          '<span class="gh-count">0/0</span>' +
          getDiffDotsHTML([]) +
        '</div>';
      });
    }
    html += '<div class="empty-state"><div class="icon"><i class="fas fa-plus-circle"></i></div><p>' + msg + '</p></div>';
    box.innerHTML = html;
    box.querySelectorAll('.group-head[data-group]').forEach(head => {
      head.addEventListener('click', e => {
        if (e.target.closest('.gh-select')) return;
        const gid = head.dataset.group; const g = getGroupById(gid); if (!g) return;
        g.collapsed = !g.collapsed; saveData(); renderProblems();
      });
      head.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        const gid = head.dataset.group; const g = getGroupById(gid); if (!g) return;
        if (isLocked()) { showToast('只读模式', 'warning'); return; }
        openGroupContextMenu(e, gid, g);
      });
    });
    updateSelectedUI(); updateReadonlyUI();
    lastRenderedList = data.currentList;
    if (sameList) box.scrollTop = prevScroll;
    return;
  }

  const groupMap = {}; groups.forEach(g => groupMap[g.id] = []);
  const ungrouped = [];
  problems.forEach(p => { if (p.groupId && groupMap[p.groupId]) groupMap[p.groupId].push(p); else ungrouped.push(p); });

  const viewGrouper = (arr) => {
    if (groupViewMode === 'none' || arr.length === 0) return [{ key:null, label:null, items:sortForDisplay(arr) }];
    const keyFn = groupViewMode === 'oj' ? (p => getOJSource(p.pid)) : (p => DIFF_NAMES[p.difficulty || 0]);
    const buckets = {}; arr.forEach(p => { const k = keyFn(p); (buckets[k] = buckets[k] || []).push(p); });
    return Object.keys(buckets).map(k => ({ key:k, label:k, items:sortForDisplay(buckets[k]) }));
  };

  const locked = isLocked(); let html = '';
  const dailyMap = buildDailyMap();

  const renderBlock = (items, scopeKey) => {
    if (items.length === 0) return '';
    const sub = viewGrouper(items);
    return sub.map(sb => {
      if (!sb.label) return sb.items.map(p => renderProblemHTML(p, locked, false, { dailyMap })).join('');
      const key = scopeKey + ':' + groupViewMode + ':' + sb.label;
      if (!(key in viewGroupState)) viewGroupState[key] = true;
      const collapsed = viewGroupState[key];
      let out = '<div class="group-head sub' + (collapsed ? ' collapsed' : '') + '" data-vgroup="' + escapeHtml(key) + '">' +
        '<i class="fas fa-caret-down toggle-arrow"></i>' +
        '<span style="flex:1;">' + escapeHtml(sb.label) + '</span>' +
        '<span class="gh-count">' + sb.items.length + '</span>' +
        getDiffDotsHTML(sb.items) +
      '</div>';
      if (!collapsed) out += sb.items.map(p => renderProblemHTML(p, locked, false, { dailyMap })).join('');
      return out;
    }).join('');
  };

  const UG = '__ungrouped__';
  if (ungrouped.length) html += renderBlock(ungrouped, UG);
  groups.forEach(g => {
    const arr = groupMap[g.id] || [];
    const done = arr.filter(p => p.date).length;
    const picked = arr.filter(p => selectedProblems.has(p.pid)).length;
    const allPicked = arr.length > 0 && picked === arr.length;
    html += '<div class="group-head' + (g.collapsed ? ' collapsed' : '') + '" data-group="' + g.id + '">' +
      '<i class="fas fa-caret-down toggle-arrow"></i>' +
      '<span class="gh-name">' + escapeHtml(g.name) + '</span>' +
      '<span class="gh-count">' + done + '/' + arr.length + '</span>' +
      getDiffDotsHTML(arr) +
      '<input type="checkbox" class="custom-checkbox gh-select" data-group-select="' + g.id + '"' + (allPicked ? ' checked' : '') + (picked > 0 && !allPicked ? ' data-indeterminate="1"' : '') + ' style="opacity:1;width:18px;height:18px;margin-right:2px;" />' +
    '</div>';
    if (!g.collapsed) html += renderBlock(arr, g.id);
  });

  box.innerHTML = html;
  fitProblemTags(box);

  box.querySelectorAll('.gh-select[data-indeterminate]').forEach(cb => { cb.indeterminate = true; });

  bindProblemRowEvents(box, {});

  box.querySelectorAll('.group-head.sub').forEach(head => {
    head.addEventListener('click', () => {
      viewGroupState[head.dataset.vgroup] = !viewGroupState[head.dataset.vgroup];
      persistUIState();
      renderProblems();
    });
  });

  box.querySelectorAll('.group-head[data-group]').forEach(head => {
    head.addEventListener('click', e => {
      if (e.target.closest('.gh-select')) return;
      const gid = head.dataset.group; const g = getGroupById(gid); if (!g) return;
      g.collapsed = !g.collapsed; saveData(); renderProblems();
    });
    head.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const gid = head.dataset.group; const g = getGroupById(gid); if (!g) return;
      if (locked) { showToast('只读模式', 'warning'); return; }
      openGroupContextMenu(e, gid, g);
    });
  });

  box.querySelectorAll('.gh-select').forEach(cb => {
    cb.addEventListener('change', () => {
      const gid = cb.dataset.groupSelect;
      const arr = groupMap[gid] || [];
      arr.forEach(p => { cb.checked ? selectedProblems.add(p.pid) : selectedProblems.delete(p.pid); });
      updateSelectedUI();
      box.querySelectorAll('.custom-checkbox[data-pid]').forEach(inner => { inner.checked = selectedProblems.has(inner.dataset.pid); });
    });
  });

  updateSelectedUI(); updateReadonlyUI();
  lastRenderedList = data.currentList;
  if (sameList) box.scrollTop = prevScroll;
}

/* 主列表与随机面板共用的行内交互；opts.menu=false 时不弹主列表右键菜单 */
export function bindProblemRowEvents(container, opts) {
  opts = opts || {};
  container.querySelectorAll('.problem-item').forEach(item => {
    const listName = item.dataset.list || data.currentList;
    item.addEventListener('contextmenu', e => {
      if (e.target.closest('.pi-diff') || e.target.closest('select')) return;
      e.preventDefault();
      if (e.target.closest('.pi-pid')) { openProblemLink(item.dataset.pid); return; }
      if (opts.menu === false) return;
      if (listName !== data.currentList) { openProblemLink(item.dataset.pid); return; }
      openProblemContextMenu(e.clientX, e.clientY, item.dataset.pid);
    });
    item.addEventListener('dblclick', e => {
      if (e.target.closest('.pi-pid')) { copyText(item.dataset.pid); e.stopPropagation(); return; }
      if (e.target.closest('.pi-name')) {
        const l = data.lists[listName]; const p = l && l.problems.find(x => x.pid === item.dataset.pid);
        if (p) copyText(p.name || '');
        e.stopPropagation(); return;
      }
    });
    if (item.classList.contains('pi-jump')) {
      item.addEventListener('click', e => {
        if (e.target.closest('.pi-dot') || e.target.closest('select') || e.target.closest('.custom-checkbox')) return;
        goToProblem(listName, item.dataset.pid);
      });
    }
    // 跨题单视图（随机面板等）：复选框无意义，隐藏但保留占位
    if (listName !== data.currentList) {
      const cb = item.querySelector('.custom-checkbox');
      if (cb) cb.style.visibility = 'hidden';
    }
  });

  container.querySelectorAll('.custom-checkbox[data-pid]').forEach(cb => {
    if (cb.style.visibility === 'hidden') return;
    cb.addEventListener('click', e => {
      if (!multiSelectMode) { e.preventDefault(); return; }
      const pid = cb.dataset.pid;
      if (e.shiftKey && lastSelectedPid) {
        const arr = getFilteredProblems().map(p => p.pid);
        const a = arr.indexOf(lastSelectedPid), b = arr.indexOf(pid);
        if (a !== -1 && b !== -1) {
          const [s, t] = a < b ? [a, b] : [b, a];
          arr.slice(s, t + 1).forEach(id => {
            if (cb.checked) selectedProblems.add(id); else selectedProblems.delete(id);
            const inner = container.querySelector('.custom-checkbox[data-pid="' + CSS.escape(id) + '"]');
            if (inner) inner.checked = cb.checked;
          });
          updateSelectedUI(); return;
        }
      }
      if (cb.checked) selectedProblems.add(pid); else selectedProblems.delete(pid);
      lastSelectedPid = pid; updateSelectedUI();
    });
  });

  container.querySelectorAll('.pi-diff select').forEach(sel => {
    sel.addEventListener('change', e => {
      const row = e.target.closest('.problem-item');
      if (row) changeProblemDifficulty(row.dataset.pid, e.target.value, row.dataset.list || data.currentList);
    });
  });

  container.querySelectorAll('.pi-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const row = dot.closest('.problem-item');
      cycleProblemStatus(dot.dataset.pid, dot, (row && row.dataset.list) || data.currentList);
    });
  });
}
function openGroupContextMenu(e, gid, g) {
  const l = curList(); if (!l) return;
  openContextMenu(e.clientX, e.clientY, [
    { act:'up', icon:'fa-arrow-up', label:'上移', run:() => { if (moveProblemGroupOrder(gid, -1)) { saveData(); renderProblems(); } } },
    { act:'down', icon:'fa-arrow-down', label:'下移', run:() => { if (moveProblemGroupOrder(gid, 1)) { saveData(); renderProblems(); } } },
    { sep:true },
    { act:'rename', icon:'fa-pen', label:'重命名', run: async () => {
      const nn = await promptText('重命名组', g.name);
      if (nn === null) return; const t = nn.trim(); if (t && t !== g.name) { g.name = t; saveData(); renderProblems(); refreshGroupSelect(); }
    } },
    { act:'del', icon:'fa-trash-alt', label:'删除组', danger:true, run:() => {
      confirmDialog('删除组', '删除组 <strong>' + escapeHtml(g.name) + '</strong>？组内题目会变为未分组。').then(ok => {
        if (!ok) return; pushUndo();
        l.problems.forEach(p => { if (p.groupId === gid) p.groupId = null; });
        l.groups = l.groups.filter(x => x.id !== gid);
        saveData(); renderProblems(); renderProgress(); refreshGroupSelect();
      });
    } }
  ]);
}
/**
 * 标签：笔记任意位置写 `#<颜色> <标签文本>`，例如
 *   #red 莫队 / #FFEE00 注意取模细节 / #f0e 卡常
 * 颜色可用预设名（red orange yellow green cyan blue purple pink gray，也认中文名），
 * 也可以直接写十六进制（#FFEE00 或 #f0e）。一个标签的文本一直延续到下一个颜色标记。
 * 兼容旧笔记：整段没有任何颜色标记时，退回「开头两行 # / @」的旧解析。
 */
const TAG_COLORS = {
  red: '#e05252', orange: '#e08a3c', yellow: '#c9a227', green: '#34a06b', cyan: '#2aa6b8',
  blue: '#4a86d8', purple: '#8b6bd8', pink: '#e06a9a', gray: '#8b96a3',
  红: '#e05252', 橙: '#e08a3c', 黄: '#c9a227', 绿: '#34a06b', 青: '#2aa6b8',
  蓝: '#4a86d8', 紫: '#8b6bd8', 粉: '#e06a9a', 灰: '#8b96a3'
};
function tagColorOf(word) {
  const w = String(word || '');
  const named = TAG_COLORS[w.toLowerCase()];
  if (named) return named;
  if (/^[0-9a-fA-F]{3}$/.test(w)) return '#' + w[0] + w[0] + w[1] + w[1] + w[2] + w[2];
  if (/^[0-9a-fA-F]{6}$/.test(w)) return '#' + w;
  return '';
}
function rgbaOf(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return 'rgba(90,138,154,' + alpha + ')';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
function getProblemTags(note) {
  const text = String(note || '');
  const marks = [];
  const re = /(^|[\s])#([A-Za-z0-9\u4e00-\u9fa5]{1,12})(?=\s|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const color = tagColorOf(m[2]);
    if (color) marks.push({ start: m.index, end: m.index + m[0].length, color });
  }
  if (marks.length) {
    const out = [], seen = new Set();
    marks.forEach((mk, i) => {
      const nextMark = i + 1 < marks.length ? marks[i + 1].start : text.length;
      const lineEnd = text.indexOf('\n', mk.end);
      const stop = lineEnd === -1 ? nextMark : Math.min(nextMark, lineEnd);
      // 空格即换标签：同一个颜色后面可以连写多个词，换行或下一个颜色标记结束
      text.slice(mk.end, stop).split(/\s+/).forEach(word => {
        if (!word) return;
        const key = mk.color + '|' + word;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ text: word, color: mk.color });
      });
    });
    if (out.length) return out;
  }
  // 旧格式兜底（只在没有颜色标记时生效）
  const lines = text.split(/\r?\n/).slice(0, 2);
  const out = [], seen = new Set();
  lines.forEach(line => {
    const s = line.trim();
    const color = s.charAt(0) === '#' ? TAG_COLORS.blue : (s.charAt(0) === '@' ? TAG_COLORS.green : '');
    if (!color) return;
    s.slice(1).trim().split(/\s+/).forEach(t => {
      const key = color + '|' + t;
      if (!t || seen.has(key)) return;
      seen.add(key);
      out.push({ text: t, color });
    });
  });
  return out;
}
function renderProblemTagsHTML(p) {
  const tags = getProblemTags(p && p.note);
  if (!tags.length) return '';
  return '<span class="pi-tags" title="' + escapeHtml(tags.map(t => t.text).join('  ')) + '">' +
    tags.map(t => '<span class="pi-tag" data-tag="1" style="background:' + rgbaOf(t.color, 0.16) + ';color:' + t.color + '">' + escapeHtml(t.text) + '</span>').join('') +
    '<span class="pi-tag pi-tag-more" style="display:none"></span>' +
  '</span>';
}
/** 放不下的标签收成 +N，避免窄栏里把标签截成半个 */
function fitProblemTags(root) {
  if (!root) return;
  root.querySelectorAll('.pi-tags').forEach(wrap => {
    if (!wrap.clientWidth) return;
    const chips = Array.from(wrap.querySelectorAll('.pi-tag[data-tag]'));
    if (!chips.length) return;
    let more = wrap.querySelector('.pi-tag-more');
    if (!more) {
      more = document.createElement('span');
      more.className = 'pi-tag pi-tag-more';
      wrap.appendChild(more);
    }
    chips.forEach(c => { c.style.display = ''; });
    more.style.display = 'none';
    more.textContent = '';
    const fits = () => wrap.scrollWidth <= wrap.clientWidth + 1;
    if (fits()) return;
    let hidden = 0;
    while (hidden < chips.length) {
      chips[chips.length - 1 - hidden].style.display = 'none';
      hidden++;
      more.style.display = '';
      more.textContent = '+' + hidden;
      if (fits()) break;
    }
  });
}
/** 某题在训练区（待做池 / 进行中 / 挂起）里的状态；不在其中返回空串 */
/** 某题在训练区（待做池 / 进行中 / 挂起）里的状态；不在其中返回空串。
 *  进行中的题再区分「正在计时（active）」和「只是排在行队里（doing）」 */
function dailyStateOf(listName, pid) {
  try {
    const d = getDaily();
    const hit = d.inbox.concat(d.doing, d.suspended).find(t => t.pid === pid && (t.listName || '') === (listName || ''));
    if (!hit) return '';
    return (hit.status === 'doing' && hit.id === d.activeId) ? 'active' : hit.status;
  } catch (e) { return ''; }
}
/** 一次渲染只读一遍 daily，避免每行都 parse 一遍 localStorage */
function buildDailyMap() {
  const m = new Map();
  try {
    const d = getDaily();
    const put = t => m.set((t.listName || '') + '\u0000' + t.pid,
      (t.status === 'doing' && t.id === d.activeId) ? 'active' : t.status);
    d.inbox.concat(d.doing, d.suspended).forEach(put);
  } catch (e) {}
  return m;
}
/** 训练区状态的指纹：只有真的变了才重画主列表，避免重复渲染 */
function dailyStatusSignature() {
  try {
    const d = getDaily();
    const one = (t, st) => st + ':' + (t.listName || '') + '/' + t.pid;
    return [d.activeId || '-'].concat(
      d.inbox.map(t => one(t, 'inbox')),
      d.doing.map(t => one(t, t.id === d.activeId ? 'active' : 'doing')),
      d.suspended.map(t => one(t, 'suspended'))
    ).join('|');
  } catch (e) { return ''; }
}
function renderProblemHTML(p, locked, inGroup, opts) {
  opts = opts || {};
  const listName = opts.listName || data.currentList || '';
  const diffClass = 'diff-' + (p.difficulty || 0);
  const isChecked = selectedProblems.has(p.pid);
  const st = problemStatus(p);
  const isDone = st === 'done', isKnow = st === 'know';
  let optsHtml = '';
  for (const k in DIFF_NAMES) optsHtml += '<option value="' + k + '"' + (parseInt(k, 10) === p.difficulty ? ' selected' : '') + '>' + DIFF_NAMES[k] + '</option>';
  let revealHtml = '';
  if (isDone) revealHtml = '<span class="pi-date-reveal reveal-done">' + escapeHtml(fmtRelative(p.date)) + '</span>';
  else if (isKnow) revealHtml = '<span class="pi-date-reveal reveal-hint">' + escapeHtml(rndLine()) + '</span>';
  const ds = opts.dailyMap ? opts.dailyMap.get(listName + '\u0000' + p.pid) : dailyStateOf(listName, p.pid);
  const dotCls = 'pi-dot' + (isDone ? ' done' : '') + (isKnow ? ' know' : '') + (ds ? ' daily-' + ds : '');
  const dotTip = ds === 'inbox' ? '待做'
    : (ds === 'doing' || ds === 'active') ? '进行中'
    : ds === 'suspended' ? '挂起中……'
    : '点击切换：未完成 → 已完成 → 会了没写';
  const cls = 'problem-item' + (p.pinned ? ' pinned' : '') + (inGroup ? ' grouped' : '') + (opts.jump ? ' pi-jump' : '');
  const badge = opts.badge ? '<span class="pi-badge">' + escapeHtml(opts.badge) + '</span>' : '';
  return '<div class="' + cls + '" data-pid="' + escapeHtml(p.pid) + '" data-list="' + escapeHtml(listName) + '">' +
    '<div class="pi-row">' +
      '<span class="pi-dot-cell"><span class="' + dotCls + '" data-pid="' + escapeHtml(p.pid) + '" title="' + dotTip + '"></span>' +
        revealHtml +
      '</span>' +
      '<input type="checkbox" class="custom-checkbox" data-pid="' + escapeHtml(p.pid) + '"' + (isChecked ? ' checked' : '') + ' />' +
      '<span class="pi-pid" title="按住上滑加入待做池 / 下滑即刻开始 · 右键打开链接 · 双击复制">' + escapeHtml(p.pid) + '</span>' +
      '<div class="pi-main">' +
        '<span class="pi-name" title="' + escapeHtml(p.name || '') + ' · 双击复制题名">' + escapeHtml(p.name || '未知题目') + '</span>' +
        renderProblemTagsHTML(p) +
        badge +
      '</div>' +
      '<div class="pi-diff ' + diffClass + '"><select' + (locked ? ' disabled' : '') + '>' + optsHtml + '</select></div>' +
    '</div>' +
  '</div>';
}
function renderLockBtn() {
  const btn = $('listLockBtn'); if (!btn) return;
  const locked = isLocked();
  btn.className = 'ph-lock' + (locked ? ' locked' : '');
  btn.innerHTML = '<i class="fas fa-' + (locked ? 'lock' : 'lock-open') + '"></i>';
  btn.title = locked ? '点击解锁' : '点击锁定为只读';
  const badge = $('readonlyBadge'); if (badge) badge.classList.toggle('show', locked);
}
function updateReadonlyUI() {
  const locked = isLocked(); const hasList = !!curList(); const dis = locked || !hasList;
  ['problemPidInput','problemNameInput','problemDiffSelect','problemGroupSelect','addProblemBtn','sortByOjBtn','sortByDiffBtn','addGroupBtn','batchImportBtn']
    .forEach(id => { const el = $(id); if (el) el.disabled = dis; });
  updateSelectedUI();
}
function updateSelectedUI() {
  const cntEl = $('selectedCount');
  const count = selectedProblems.size;
  if (cntEl) cntEl.textContent = '已选 ' + count + ' 题';
  const allCb = $('selectAllCheckbox');
  const filtered = getFilteredProblems();
  const total = filtered.length;
  const visiblePicked = filtered.filter(p => selectedProblems.has(p.pid)).length;
  if (allCb) {
    if (total === 0 || visiblePicked === 0) { allCb.checked = false; allCb.indeterminate = false; }
    else if (visiblePicked === total) { allCb.checked = true; allCb.indeterminate = false; }
    else { allCb.checked = false; allCb.indeterminate = true; }
  }
  const locked = isLocked(); const has = count > 0 && multiSelectMode;
  ['batchMoveBtn','batchMoveListBtn','applyDiffBtn','batchDeleteBtn'].forEach(id => { const el = $(id); if (el) el.disabled = !has || locked; });
  ['batchExportBtn','batchOpenBtn'].forEach(id => { const el = $(id); if (el) el.disabled = !has; });
  if (!has) closeAllPopups();
  updateMoveTargets();
}
function updateMoveTargets() {
  const sel = $('moveTargetList'); if (!sel) return;
  const cur = data.currentList;
  const all = sortLists().filter(n => n !== cur);
  sel.innerHTML = '';
  const ph = document.createElement('option'); ph.value = ''; ph.textContent = all.length ? '选择题单…' : '无其他题单';
  sel.appendChild(ph);
  all.forEach(name => { const o = document.createElement('option'); o.value = name; o.textContent = name + ' (' + (data.lists[name] ? data.lists[name].problems.length : 0) + ')'; sel.appendChild(o); });
  sel.disabled = !all.length;
}
function setMultiSelect(on) {
  if (multiSelectMode === on) return;
  multiSelectMode = on; difficultyCursor = 0; difficultyCursorSig = '';
  const tb = $('problemToolbar'), btn = $('toggleMultiSelectBtn'), lst = $('problemList');
  if (!tb || !btn || !lst) return;
  if (on) {
    tb.classList.add('multi-select-active'); lst.classList.add('multi-select-active');
    btn.innerHTML = '<i class="fas fa-times"></i> 取消多选';
    btn.classList.add('danger'); btn.classList.remove('ghost');
  } else {
    tb.classList.remove('multi-select-active'); lst.classList.remove('multi-select-active');
    btn.innerHTML = '<i class="fas fa-check-square"></i> 多选';
    btn.classList.remove('danger'); btn.classList.add('ghost');
    closeAllPopups();
    document.querySelectorAll('.custom-checkbox[data-pid]').forEach(cb => cb.checked = false);
  }
  selectedProblems.clear(); lastSelectedPid = null;
  updateSelectedUI();
}
function _doSelectAll(sel) {
  const arr = getFilteredProblems();
  arr.forEach(p => { sel ? selectedProblems.add(p.pid) : selectedProblems.delete(p.pid); });
  document.querySelectorAll('.custom-checkbox[data-pid]').forEach(cb => { cb.checked = selectedProblems.has(cb.dataset.pid); });
  updateSelectedUI();
}

/* ============================================================
   题单增删改
   ============================================================ */
function addList() {
  const inp = $('listNameInput'); if (!inp) return;
  const name = inp.value.trim();
  if (!name) { showToast('请输入题单名称', 'warning'); return; }
  if (data.lists[name]) { showToast('题单已存在', 'warning'); return; }
  pushUndo();
  data.lists[name] = { groups:[], problems:[] };
  data.listOrder.push(name); data.currentList = name; inp.value = '';
  setMultiSelect(false); saveData(); renderAll();
  showToast('已创建题单「' + name + '」', 'success');
}
function deleteList(name) {
  if (!data.lists[name]) { showToast('题单不存在', 'warning'); return; }
  confirmDialog('删除题单', '确定删除题单 <strong>' + escapeHtml(name) + '</strong> 及其所有题目？不可恢复。').then(ok => {
    if (!ok) return; pushUndo();
    delete data.lists[name]; delete data.listPins[name]; delete data.listLocks[name]; delete data.listGroupMap[name];
    data.listOrder = data.listOrder.filter(x => x !== name);
    data.markedLists = data.markedLists.filter(x => x !== name);
    const ks = sortLists(); data.currentList = ks.length ? ks[0] : null;
    setMultiSelect(false); saveData(); renderAll(); updateRandomScopeBtns();
    showToast('已删除题单', 'info');
  });
}
function selectList(name) {
  if (name === data.currentList) return;
  if (!data.lists[name]) return;
  rememberProblemScroll();
  data.currentList = name; renamingList = null; setMultiSelect(false);
  saveData(); renderAll();
  restoreProblemScroll(name);
}
function restoreProblemScroll(name) {
  const box = $('problemList'); if (!box) return;
  const y = uiState.scroll[name || data.currentList] || 0;
  box.scrollTop = y;
  requestAnimationFrame(() => { if (box.scrollTop !== y) box.scrollTop = y; });
}
function applyColumnMode() {
  const two = !!uiState.twoCol;
  const box = $('problemList');
  if (box) box.classList.toggle('two-col', two);
  const btn = $('layoutToggleBtn');
  if (btn) {
    btn.innerHTML = '<i class="fas fa-' + (two ? 'table-columns' : 'bars') + '"></i> <span>' + (two ? '双栏' : '单栏') + '</span>';
    btn.title = two ? '切换为单栏' : '切换为双栏';
    btn.classList.toggle('active', two);
  }
}
function toggleColumnMode() {
  uiState.twoCol = !uiState.twoCol;
  persistUIState();
  applyColumnMode();
  requestAnimationFrame(() => fitProblemTags($('problemList')));
}
function confirmRenameList(oldName, newName) {
  if (!data.lists[oldName]) return;
  newName = (newName || '').trim();
  if (!newName || newName === oldName) { renamingList = null; renderLists(); return; }
  if (data.lists[newName]) { showToast('题单名已存在', 'warning'); renamingList = null; renderLists(); return; }
  pushUndo();
  data.lists[newName] = data.lists[oldName]; delete data.lists[oldName];
  if (data.listPins[oldName]) { data.listPins[newName] = true; delete data.listPins[oldName]; }
  if (data.listLocks[oldName]) { data.listLocks[newName] = true; delete data.listLocks[oldName]; }
  if (data.listGroupMap[oldName]) { data.listGroupMap[newName] = data.listGroupMap[oldName]; delete data.listGroupMap[oldName]; }
  const idx = data.listOrder.indexOf(oldName); if (idx !== -1) data.listOrder[idx] = newName;
  const mi = data.markedLists.indexOf(oldName); if (mi !== -1) data.markedLists[mi] = newName;
  if (data.currentList === oldName) data.currentList = newName;
  renamingList = null; saveData(); renderAll(); updateRandomScopeBtns();
  showToast('已重命名', 'success');
}
function toggleListPin(name) {
  if (!data.lists[name]) return;
  if (data.listPins[name]) delete data.listPins[name]; else data.listPins[name] = true;
  saveData(); renderLists();
}
function toggleListLock(name) {
  if (!data.lists[name]) return;
  if (data.listLocks[name]) delete data.listLocks[name]; else data.listLocks[name] = true;
  saveData(); renderAll(); showToast(data.listLocks[name] ? '已锁定为只读' : '已解锁', 'info');
}

/* ============================================================
   题目增删改
   ============================================================ */
function addProblem() {
  const l = curList(); if (!l) { showToast('请先选择题单', 'warning'); return; }
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const pidEl = $('problemPidInput'), nameEl = $('problemNameInput'), diffEl = $('problemDiffSelect'), grpEl = $('problemGroupSelect');
  if (!pidEl || !nameEl || !diffEl) return;
  const pid = normalizePid(pidEl.value);
  const name = nameEl.value.trim();
  const diff = parseInt(diffEl.value, 10) || 0;
  const groupId = (grpEl && grpEl.value) ? grpEl.value : null;
  if (!pid) { showToast('请输入题号', 'warning'); return; }
  if (!name) { showToast('请输入题目名称', 'warning'); return; }
  if (l.problems.some(p => p.pid.toLowerCase() === pid.toLowerCase())) { showToast('题目已存在', 'warning'); return; }
  pushUndo();
  l.problems.push({ pid, name, difficulty:diff, date:'', note:'', pinned:false, know:false, groupId });
  saveData(); renderAll();
  pidEl.value = ''; nameEl.value = ''; pidEl.focus();
  showToast('已添加「' + pid + '」', 'success');
}
function deleteProblem(pid) {
  const l = curList(); if (!l) return;
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const idx = l.problems.findIndex(p => p.pid === pid); if (idx === -1) return;
  pushUndo(); l.problems.splice(idx, 1); selectedProblems.delete(pid);
  saveData(); renderAll(); showToast('已删除', 'info');
}
function cycleProblemStatus(pid, dotEl, listName) {
  const name = listName || data.currentList;
  // 训练区（待做池 / 进行中 / 挂起）改变了圆点颜色，此时圆点只作状态指示，点击不切换
  if (dailyStateOf(name, pid)) return;
  const l = data.lists[name]; if (!l) return;
  if (name === data.currentList && isLocked()) { showToast('只读模式', 'warning'); return; }
  const p = l.problems.find(x => x.pid === pid); if (!p) return;
  pushUndo();
  const cur = problemStatus(p);
  if (cur === 'pending') {
    p.date = todayStr(); p.know = false;
    if (!p.firstDone) p.firstDone = p.date;
    if (dotEl) { playCompletionParticles(dotEl); const item = dotEl.closest('.problem-item'); if (item) playRipple(item, 'rgba(97,196,84,.22)'); }
  } else if (cur === 'done') { p.date = ''; p.know = true; }
  else { p.date = ''; p.know = false; }
  saveData();
  if (name === data.currentList) renderAll();
}
function changeProblemDifficulty(pid, val, listName) {
  const name = listName || data.currentList;
  const l = data.lists[name]; if (!l) return;
  if (name === data.currentList && isLocked()) { showToast('只读模式', 'warning'); return; }
  const p = l.problems.find(x => x.pid === pid); if (!p) return;
  pushUndo(); p.difficulty = parseInt(val, 10) || 0;
  saveData();
  if (name === data.currentList) { renderProblems(); renderProgress(); }
  const item = document.querySelector('.problem-item[data-list="' + CSS.escape(name) + '"][data-pid="' + CSS.escape(pid) + '"]');
  if (item) { const c = DIFF_COLORS[p.difficulty] || '#AAAAAA'; playRipple(item, hexToRgba(c, 0.28)); }
}
function toggleProblemPin(pid) {
  const l = curList(); if (!l) return;
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const p = l.problems.find(x => x.pid === pid); if (!p) return;
  pushUndo(); p.pinned = !p.pinned; saveData(); renderProblems();
}
function openProblemLink(pid) { const url = getProblemUrl(pid); if (url && url !== '#') window.open(url, '_blank'); }

/* 右键 → 加入待做池（日常面板模块 A 的数据来源） */
function addProblemToInbox(p, listName) {
  if (!p) return;
  const ln = listName || data.currentList;
  const r = addToInbox({ listName: ln, pid: p.pid, name: p.name, difficulty: p.difficulty });
  if (r.ok) { showToast('已加入待做池', 'success'); updateCodexBadge(); renderAll(); }
  else if (r.reason === 'full') showToast('待做池已满', 'warning');
  else if (r.reason === 'duplicate') showToast('该题已在待做池 / 进行中 / 挂起区', 'info');
  else showToast('加入待做池失败', 'error');
}

/** 右键「即刻开始」：加入进行区并开始计时（进行区满则把第一题打回待做池） */
function startProblemNow(p, listName) {
  if (!p) return;
  const ln = listName || data.currentList;
  const r = startNow({ listName: ln, pid: p.pid, name: p.name, difficulty: p.difficulty });
  if (r && r.ok) {
    if (r.evicted) showToast('已开始计时 · ' + p.pid + '（' + r.evicted.pid + ' 已移回待做池）', 'success');
    else showToast('已开始计时 · ' + p.pid, 'success');
    updateCodexBadge();
    renderAll();
    openProblemLink(p.pid);
    return;
  }
  if (r && r.reason === 'busy') {
    const a = r.active;
    showToast('「' + (a ? a.pid : '另一道题') + '」正在计时，请先完成或挂起它', 'warning');
  } else if (r && r.reason === 'inbox-full') {
    showToast('进行区与待做池都已满，无法腾出位置', 'warning');
  } else {
    showToast('无法开始：题目数据异常', 'error');
  }
}
/* ============================================================
   题号手势：按住上滑 → 加入待做池；按住下滑 → 即刻开始
   - 判定阈值 = 该行与相邻行的中间（行距的一半）
   - 视觉上限 = 阈值后再走一小段，之后不再跟手
   - 反馈 = 题号前景色：起手全透明，随位移渐变为不透明
   ============================================================ */
const PID_ARM_PX = 5;
const PID_UP_RGB = '59,130,246';
const PID_DOWN_RGB = '34,160,107';
const PID_WARN_RGB = '220,80,80';
let pidGesture = null;

/** 相邻行距（含间距），用于把「半行」换算成像素 */
function pidRowPitch(item) {
  const h = item ? item.getBoundingClientRect().height : 0;
  const sib = (item && item.nextElementSibling && item.nextElementSibling.classList.contains('problem-item')) ? item.nextElementSibling
    : ((item && item.previousElementSibling && item.previousElementSibling.classList.contains('problem-item')) ? item.previousElementSibling : null);
  const hs = sib ? sib.getBoundingClientRect().height : 0;
  const avg = (h && hs) ? (h + hs) / 2 : (h || 40);
  return Math.max(30, Math.min(72, avg));
}
/** 某题当前的训练区状态 + 计时/容量事实 */
function pidGestureInfo(listName, pid) {
  const d = getDaily();
  const match = t => t.pid === pid && (t.listName || '') === (listName || '');
  const task = d.inbox.find(match) || d.doing.find(match) || d.suspended.find(match) || null;
  const active = activeTask();
  const isThisActive = !!active && match(active);
  return {
    status: task ? task.status : '',
    isThisActive,
    otherBusy: !!active && !isThisActive,
    activePid: active ? active.pid : '',
    inboxFull: d.inbox.length >= INBOX_LIMIT
  };
}
function bindPidGesture() {
  const box = $('problemList');
  if (!box || box.dataset.pidGesture === '1') return;
  box.dataset.pidGesture = '1';
  box.addEventListener('pointerdown', onPidPointerDown);
}
function onPidPointerDown(e) {
  if (e.button !== 0 || e.ctrlKey) return;
  const pidEl = e.target.closest('.pi-pid'); if (!pidEl) return;
  const item = pidEl.closest('.problem-item'); if (!item) return;
  const listName = item.dataset.list || data.currentList;
  const l = data.lists[listName]; if (!l) return;
  const p = l.problems.find(x => x.pid === item.dataset.pid); if (!p) return;
  const pitch = pidRowPitch(item);
  pidGesture = {
    pidEl, item, listName, p,
    startX: e.clientX, startY: e.clientY,
    commit: Math.max(14, Math.round(pitch / 2)),
    cap: 0, dy: 0, armed: false, pointerId: e.pointerId,
    info: pidGestureInfo(listName, p.pid)
  };
  pidGesture.cap = Math.round(pidGesture.commit * 1.45);
  window.addEventListener('pointermove', onPidPointerMove);
  window.addEventListener('pointerup', onPidPointerUp);
  window.addEventListener('pointercancel', onPidPointerCancel);
  window.addEventListener('keydown', onPidGestureKey, true);
}
function onPidPointerMove(e) {
  const g = pidGesture; if (!g) return;
  const dy = e.clientY - g.startY;
  const dx = e.clientX - g.startX;
  if (!g.armed) {
    if (Math.abs(dy) < PID_ARM_PX && Math.abs(dx) < PID_ARM_PX) return;
    if (Math.abs(dy) <= Math.abs(dx)) return; // 横向拖拽（如未来要选文本）不抢
    g.armed = true;
    try { g.pidEl.setPointerCapture(g.pointerId); } catch (_) { }
    document.body.classList.add('pid-dragging');
  }
  g.dy = dy;
  applyPidDragVisual();
}
function pidGestureRgb(g, dir) {
  if (dir === 'up') return (!g.info.status && g.info.inboxFull) ? PID_WARN_RGB : PID_UP_RGB;
  return g.info.otherBusy ? PID_WARN_RGB : PID_DOWN_RGB;
}
function applyPidDragVisual() {
  const g = pidGesture; if (!g || !g.armed) return;
  const dir = g.dy < 0 ? 'up' : 'down';
  const dist = Math.min(g.cap, Math.abs(g.dy));
  g.pidEl.style.transform = 'translateY(' + (g.dy < 0 ? -dist : dist) + 'px)';
  const alpha = Math.min(1, dist / g.commit);
  const rgb = pidGestureRgb(g, dir);
  const warn = rgb === PID_WARN_RGB;
  g.pidEl.style.color = 'rgba(' + rgb + ',' + alpha.toFixed(2) + ')';
  g.pidEl.classList.add('pid-dragging');
  g.item.classList.toggle('pid-drag-up', dir === 'up' && !warn);
  g.item.classList.toggle('pid-drag-down', dir === 'down' && !warn);
  g.item.classList.toggle('pid-drag-warn', warn);
}
function cleanupPidGesture() {
  const g = pidGesture; if (!g) return null;
  pidGesture = null;
  window.removeEventListener('pointermove', onPidPointerMove);
  window.removeEventListener('pointerup', onPidPointerUp);
  window.removeEventListener('pointercancel', onPidPointerCancel);
  window.removeEventListener('keydown', onPidGestureKey, true);
  document.body.classList.remove('pid-dragging');
  g.pidEl.classList.remove('pid-dragging');
  g.pidEl.style.transform = '';
  g.pidEl.style.color = '';
  g.item.classList.remove('pid-drag-up', 'pid-drag-down', 'pid-drag-warn');
  try { g.pidEl.releasePointerCapture(g.pointerId); } catch (_) { }
  return g;
}
function onPidPointerUp(e) {
  const g = pidGesture; if (!g || e.pointerId !== g.pointerId) return;
  const dir = g.dy < 0 ? 'up' : 'down';
  const reached = g.armed && Math.min(g.cap, Math.abs(g.dy)) >= g.commit;
  const snapshot = cleanupPidGesture();
  if (!reached || !snapshot) return;
  if (dir === 'up') commitPidInbox(snapshot);
  else commitPidStart(snapshot);
}
function onPidPointerCancel() { cleanupPidGesture(); }
function onPidGestureKey(e) {
  if (e.key === 'Escape' && pidGesture) { e.preventDefault(); e.stopPropagation(); cleanupPidGesture(); }
}
function commitPidInbox(g) {
  const info = pidGestureInfo(g.listName, g.p.pid);
  if (info.status) {
    const msg = info.status === 'inbox' ? '已在待做池中' : (info.status === 'doing' ? '正在进行' : '已在挂起区');
    showToast(msg, 'info'); return;
  }
  if (info.inboxFull) { showToast('待做池已满', 'warning'); return; }
  const r = addToInbox({ listName: g.listName, pid: g.p.pid, name: g.p.name, difficulty: g.p.difficulty });
  if (r.ok) { showToast('已加入待做池', 'success'); updateCodexBadge(); renderAll(); }
  else if (r.reason === 'duplicate') showToast('已在待做池中', 'info');
  else if (r.reason === 'full') showToast('待做池已满', 'warning');
  else showToast('加入待做池失败', 'error');
}
function commitPidStart(g) {
  const info = pidGestureInfo(g.listName, g.p.pid);
  if (info.isThisActive) { showToast('正在进行', 'info'); return; }
  if (info.otherBusy) {
    showToast('「' + info.activePid + '」正在计时，请先完成或挂起它', 'warning'); return;
  }
  const r = startNow({ listName: g.listName, pid: g.p.pid, name: g.p.name, difficulty: g.p.difficulty });
  if (r && r.ok) {
    showToast(r.evicted ? ('已开始计时 · ' + g.p.pid + '（' + r.evicted.pid + ' 已移回待做池）') : ('已开始计时 · ' + g.p.pid), 'success');
    updateCodexBadge(); renderAll();
    openProblemLink(g.p.pid);
  } else if (r && r.reason === 'inbox-full') {
    showToast('进行区与待做池都已满，无法腾出位置', 'warning');
  } else {
    showToast('无法开始：题目数据异常', 'error');
  }
}

function openEditModal(pid) {
  const l = curList(); if (!l) return;
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const p = l.problems.find(x => x.pid === pid); if (!p) return;
  $('editProblemPid').value = pid; $('editPid').value = p.pid;
  $('editName').value = p.name || ''; $('editDate').value = p.date || '';
  $('editModal').classList.add('show');
  setTimeout(() => $('editPid').focus(), 200);
}
function saveEditProblem() {
  const oldPid = $('editProblemPid').value; const l = curList(); if (!l) return;
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const p = l.problems.find(x => x.pid === oldPid); if (!p) return;
  const newPid = normalizePid($('editPid').value);
  const newName = $('editName').value.trim();
  const newDate = $('editDate').value || '';
  if (!newPid || !newName) { showToast('题号与名称不能为空', 'warning'); return; }
  if (newPid !== oldPid && l.problems.some(x => x.pid === newPid)) { showToast('题号已存在', 'warning'); return; }
  pushUndo(); p.pid = newPid; p.name = newName;
  if (newDate) { p.date = newDate; p.know = false; if (!p.firstDone) p.firstDone = newDate; } else { p.date = ''; }
  if (oldPid !== newPid && selectedProblems.has(oldPid)) { selectedProblems.delete(oldPid); selectedProblems.add(newPid); }
  saveData(); closeModal('editModal'); renderAll(); showToast('已更新', 'success');
}
function openNoteModal(pid) {
  const l = curList(); if (!l) return;
  const p = l.problems.find(x => x.pid === pid); if (!p) return;
  $('noteTitle').textContent = '笔记 · ' + p.pid;
  $('noteTextarea').value = p.note || '';
  $('noteModal').classList.add('show');
  setTimeout(() => $('noteTextarea').focus(), 200);
}
function saveNote() {
  const l = curList(); if (!l) return;
  const m = $('noteTitle').textContent.match(/笔记 · (.+)$/); if (!m) return;
  const p = l.problems.find(x => x.pid === m[1]); if (!p) return;
  pushUndo(); p.note = $('noteTextarea').value;
  saveData(); closeModal('noteModal'); renderProblems(); showToast('笔记已保存', 'success');
}
function sortByOJ() {
  const l = curList(); if (!l) return;
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  pushUndo();
  l.problems.sort((a, b) => { const oa = getOJSource(a.pid), ob = getOJSource(b.pid); return oa !== ob ? oa.localeCompare(ob) : a.pid.localeCompare(b.pid); });
  saveData(); renderAll(); showToast('已按 OJ 排序', 'info');
}
function sortByDiff() {
  const l = curList(); if (!l) return;
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  pushUndo();
  l.problems.sort((a, b) => a.difficulty !== b.difficulty ? a.difficulty - b.difficulty : a.pid.localeCompare(b.pid));
  saveData(); renderAll(); showToast('已按难度排序', 'info');
}

/* ============================================================
   批量操作
   ============================================================ */
/** 当前选中的题目（按界面从上到下的顺序；不可见的选中项排在最后） */
function selectedInDisplayOrder() {
  const l = curList(); if (!l) return [];
  const seen = new Set();
  const ordered = [];
  const box = $('problemList');
  if (box) {
    box.querySelectorAll('.problem-item[data-pid]').forEach(el => {
      const pid = el.dataset.pid;
      if (!selectedProblems.has(pid) || seen.has(pid)) return;
      const p = l.problems.find(x => x.pid === pid);
      if (p) { ordered.push(p); seen.add(pid); }
    });
  }
  l.problems.forEach(p => {
    if (selectedProblems.has(p.pid) && !seen.has(p.pid)) { ordered.push(p); seen.add(p.pid); }
  });
  return ordered;
}
function requireSelection() {
  if (!multiSelectMode) { showToast('请先进入多选模式', 'warning'); return null; }
  const arr = selectedInDisplayOrder();
  if (!arr.length) { showToast('请先选中题目', 'warning'); return null; }
  return arr;
}
function batchOpen() {
  const sel = requireSelection(); if (!sel) return;
  let n = 0, delay = 0;
  sel.forEach(p => {
    const u = getProblemUrl(p.pid);
    if (u && u !== '#') {
      delay += 150 + Math.random() * 100;   // 0.2s ± 0.05s，模拟人类点击节奏
      setTimeout(() => window.open(u, '_blank'), delay);
      n++;
    }
  });
  showToast('正在按从上到下的顺序打开 ' + n + ' 个页面', 'success');
}
function batchDelete() {
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const sel = requireSelection(); if (!sel) return;
  confirmDialog('批量删除', '确定删除选中的 <strong>' + sel.length + '</strong> 道题目？').then(ok => {
    if (!ok) return; pushUndo();
    const l = curList(); const ids = new Set(sel.map(p => p.pid));
    l.problems = l.problems.filter(p => !ids.has(p.pid));
    selectedProblems.clear(); saveData(); renderAll();
    showToast('已删除 ' + sel.length + ' 题', 'success');
  });
}
function applyDiffString() {
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const sel = requireSelection(); if (!sel) return;
  const el = $('batchDiffString'); const str = el.value.trim();
  if (!str) { showToast('请输入数字串', 'warning'); return; }
  const digits = str.split('').map(Number);
  if (digits.some(d => isNaN(d) || d < 0 || d > 8)) { showToast('数字串只能含 0-8', 'warning'); return; }
  if (digits.length < sel.length) { showToast('长度不足', 'warning'); return; }
  pushUndo(); sel.forEach((p, i) => { p.difficulty = digits[i] || 0; });
  difficultyCursor = 0; difficultyCursorSig = '';
  saveData(); renderAll(); el.value = ''; closePopup($('diffPopup'));
  showToast('已为 ' + sel.length + ' 题应用难度', 'success');
}

let exportMode = 'nodiff';
/** 生成批量导出文本；pid 模式只输出一行英文逗号分隔的题号 */
function buildBatchExportText(sel, mode) {
  if (mode === 'pid') return sel.map(p => p.pid).join(',');
  const l = curList();
  const groupOrder = [];
  sel.forEach(p => { if (!groupOrder.includes(p.groupId)) groupOrder.push(p.groupId); });
  const sorted = []; groupOrder.forEach(gid => { sel.filter(p => p.groupId === gid).forEach(p => sorted.push(p)); });
  const lines = []; let lastGid = '__unset__';
  sorted.forEach(p => {
    if (p.groupId !== lastGid) {
      const g = l ? l.groups.find(x => x.id === p.groupId) : null;
      lines.push('>\t' + (g ? g.name : '未分组')); lastGid = p.groupId;
    }
    lines.push(mode === 'diff' ? (p.pid + '\t' + p.difficulty + '\t' + p.name) : (p.pid + '\t' + p.name));
  });
  return lines.join('\n');
}
function setExportMode(mode) {
  exportMode = mode === 'pid' ? 'pid' : (mode === 'diff' ? 'diff' : 'nodiff');
  const t = $('exportModeToggle');
  if (!t) return;
  t.dataset.mode = exportMode;
  t.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.exportMode === exportMode));
}
async function doBatchExport(kind) {
  const sel = requireSelection(); if (!sel) return;
  closePopup($('exportPopup'));
  const mode = exportMode;
  const pidOnly = mode === 'pid';
  const content = buildBatchExportText(sel, mode);
  if (kind === 'clip') {
    const ok = await copyPlainText(content);
    if (ok) showToast(pidOnly ? '已复制 ' + sel.length + ' 个题号' : '已复制 ' + sel.length + ' 题到剪贴板', 'success');
    else showToast('复制失败，请检查剪贴板权限', 'error');
    return;
  }
  const fileName = (data.currentList || '题单') + '_导出_' + fmtDate(new Date()) + (pidOnly ? '.txt' : '.tsv');
  const payload = (pidOnly ? '' : '\uFEFF') + content;
  const mime = pidOnly ? 'text/plain;charset=utf-8' : 'text/tab-separated-values;charset=utf-8';
  if (window.electronAPI && window.electronAPI.saveFile) {
    try { const r = await window.electronAPI.saveFile(fileName, payload); showToast('已导出 → ' + r.path, 'success'); }
    catch (err) { showToast('导出失败：' + err.message, 'error'); }
  } else {
    const blob = new Blob([payload], { type:mime });
    const u = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = u; a.download = fileName; a.click(); URL.revokeObjectURL(u);
    showToast('已导出 ' + sel.length + (pidOnly ? ' 个题号' : ' 题'), 'success');
  }
}
function batchMoveList() {
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const sel = requireSelection(); if (!sel) return;
  const targetName = $('moveTargetList').value;
  if (!targetName) { showToast('请选择目标题单', 'warning'); return; }
  if (targetName === data.currentList) { showToast('不能移动到当前题单', 'warning'); return; }
  if (!data.lists[targetName]) { showToast('目标不存在', 'warning'); return; }
  pushUndo();
  const target = data.lists[targetName];
  const ids = new Set(sel.map(p => p.pid));
  if (!moveCopyMode) { const l = curList(); l.problems = l.problems.filter(p => !ids.has(p.pid)); }
  let added = 0;
  sel.forEach(p => { if (!target.problems.some(t => t.pid === p.pid)) { target.problems.push({ ...p, groupId:null }); added++; } });
  selectedProblems.clear(); closePopup($('moveListPopup'));
  saveData(); renderAll();
  showToast((moveCopyMode ? '已复制 ' : '已移动 ') + added + ' 题', 'success');
}
function openMoveGroupPopup(anchor, pid) {
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  moveGroupFor = pid || 'batch';
  const sel = $('moveGroupSelect'); const l = curList(); if (!l) return;
  const cur = pid ? l.problems.find(x => x.pid === pid) : null;
  const curGid = cur ? cur.groupId : null;
  sel.innerHTML = '<option value="">未分组</option>';
  l.groups.forEach(g => {
    const o = document.createElement('option'); o.value = g.id; o.textContent = g.name;
    if (g.id === curGid) o.selected = true; sel.appendChild(o);
  });
  const optNew = document.createElement('option'); optNew.value = '__new__'; optNew.textContent = '＋ 新组…'; sel.appendChild(optNew);
  $('newGroupName').style.display = 'none'; $('newGroupName').value = '';
  togglePopup($('moveGroupPopup'), anchor);
}
function confirmMoveGroup() {
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const val = $('moveGroupSelect').value;
  let gid = null;
  if (val === '__new__') {
    const name = $('newGroupName').value.trim();
    if (!name) { showToast('请输入新组名称', 'warning'); $('newGroupName').focus(); return; }
    const g = addProblemGroup(name); gid = g.id;
  } else if (val) { gid = val; }
  const l = curList(); if (!l) return;
  pushUndo();
  if (moveGroupFor === 'batch') {
    const sel = requireSelection(); if (!sel) return;
    sel.forEach(p => { p.groupId = gid; });
    saveData(); renderAll(); showToast('已移动 ' + sel.length + ' 题', 'success');
    selectedProblems.clear(); updateSelectedUI();
  } else {
    const p = l.problems.find(x => x.pid === moveGroupFor); if (!p) return;
    p.groupId = gid; saveData(); renderProblems(); showToast('已移动到组', 'success');
  }
  closePopup($('moveGroupPopup')); moveGroupFor = 'batch';
}

/* ============================================================
   搜索
   ============================================================ */
let searchMode = 'title';
let searchTimer = null;
function setSearchMode(mode) {
  searchMode = (mode === 'tag' || mode === 'note') ? mode : 'title';
  const t = $('searchModeToggle');
  if (t) {
    t.dataset.mode = searchMode;
    t.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.searchMode === searchMode));
  }
  runSearch();
}
function searchTagChipsHTML(p) {
  const tags = getProblemTags(p.note);
  if (!tags.length) return '';
  return '<span class="si-tags">' + tags.map(t =>
    '<span class="si-tag" style="background:' + rgbaOf(t.color, 0.16) + ';color:' + t.color + '">' + escapeHtml(t.text) + '</span>').join('') + '</span>';
}
/** 笔记里命中位置前后各取一点文本，命中词用 <mark> 标出 */
function noteSnippetHTML(note, q) {
  const text = String(note || '');
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return '';
  const start = Math.max(0, idx - 20), end = Math.min(text.length, idx + q.length + 40);
  const before = (start > 0 ? '…' : '') + text.slice(start, idx);
  const hit = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length, end) + (end < text.length ? '…' : '');
  return '<span class="si-snippet">' + escapeHtml(before) + '<mark>' + escapeHtml(hit) + '</mark>' + escapeHtml(after) + '</span>';
}
const SEARCH_HINTS = {
  title: ['搜索题号 / 题名', '输入题号或题名关键词'],
  tag: ['按标签搜索', '输入算法标签或题目标签关键词'],
  note: ['搜索笔记', '输入笔记里出现过的关键词']
};
function runSearch() {
  const inp = $('searchInput'), box = $('searchResults'), title = $('searchTitle');
  if (!inp || !box) return;
  const q = inp.value.trim().toLowerCase();
  if (!q) {
    const hint = SEARCH_HINTS[searchMode] || SEARCH_HINTS.title;
    if (title) title.textContent = hint[0];
    box.innerHTML = '<div class="search-empty"><i class="fas fa-search"></i> ' + hint[1] + '</div>';
    return;
  }
  const results = [];
  sortLists().forEach(listName => {
    const l = data.lists[listName]; if (!l) return;
    l.problems.forEach(p => {
      if (searchMode === 'tag') {
        const hit = getProblemTags(p.note).some(t => t.text.toLowerCase().includes(q));
        if (hit) results.push({ listName, p });
      } else if (searchMode === 'note') {
        if (String(p.note || '').toLowerCase().includes(q)) results.push({ listName, p });
      } else {
        const hit = (p.pid || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
        if (hit) results.push({ listName, p });
      }
    });
  });
  if (title) title.textContent = (SEARCH_HINTS[searchMode] || SEARCH_HINTS.title)[0] + ' · ' + results.length + ' 条';
  if (!results.length) {
    box.innerHTML = '<div class="search-empty"><i class="fas fa-search-minus"></i> ' + (searchMode === 'note' ? '没有笔记匹配的题目' : '没有匹配的题目') + '</div>';
    return;
  }
  box.innerHTML = results.map(r => {
    const p = r.p;
    return '<div class="search-item" data-list="' + escapeHtml(r.listName) + '" data-pid="' + escapeHtml(p.pid) + '">' +
      '<span class="si-pid" title="' + escapeHtml(p.pid) + '">' + escapeHtml(p.pid) + '</span>' +
      '<div class="si-main">' +
        '<span class="si-name">' + escapeHtml(p.name || '未命名') + '</span>' +
        (searchMode === 'note' ? (noteSnippetHTML(p.note, q) || searchTagChipsHTML(p)) : searchTagChipsHTML(p)) +
      '</div>' +
      '<span class="si-list"><i class="fas fa-folder"></i> ' + escapeHtml(r.listName) + '</span>' +
      '<span class="si-state">' + (p.date ? fmtRelative(p.date) : '未完成') + '</span>' +
    '</div>';
  }).join('');
}
function openSearch() {
  const inp = $('searchInput');
  if (inp) inp.value = '';
  setSearchMode('title');
  $('searchModal').classList.add('show');
  setTimeout(() => { if (inp) inp.focus(); }, 120);
}
export function goToProblem(listName, pid) {
  closeModal('searchModal'); closeModal('treasureModal'); closeModal('codexModal');
  if (!data.lists[listName]) return;
  currentViewMode = 'all'; updateViewToggleUI();
  const lgid = data.listGroupMap[listName];
  if (lgid) { const lg = data.listGroups.find(g => g.id === lgid); if (lg && lg.collapsed) lg.collapsed = false; }
  if (data.currentList !== listName) {
    rememberProblemScroll();
    data.currentList = listName;
    const nl = data.lists[listName];
    if (nl && nl.groups) nl.groups.forEach(g => { g.collapsed = false; });
    saveData(); renderAll();
  } else {
    const l = data.lists[listName]; const p = l.problems.find(x => x.pid === pid);
    if (p && p.groupId) { const g = l.groups.find(x => x.id === p.groupId); if (g) g.collapsed = false; }
    if (groupViewMode !== 'none' && p) {
      const scopeKey = p.groupId || '__ungrouped__';
      const keyFn = groupViewMode === 'oj' ? (x => getOJSource(x.pid)) : (x => DIFF_NAMES[x.difficulty || 0]);
      viewGroupState[scopeKey + ':' + groupViewMode + ':' + keyFn(p)] = false;
    }
    saveData(); renderAll();
  }
  setTimeout(() => {
    const el = document.querySelector('.problem-item[data-list="' + CSS.escape(listName) + '"][data-pid="' + CSS.escape(pid) + '"]');
    if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' }); el.style.background = 'var(--primary-soft)'; setTimeout(() => el.style.background = '', 1500); }
  }, 120);
}

/* ============================================================
   批量导入
   ============================================================ */
function openBatchImport() {
  if (!data.currentList) { showToast('请先选择题单', 'warning'); return; }
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  $('batchInput').value = ''; $('batchPreview').innerHTML = '';
  $('batchStats').textContent = '已解析 0 条'; batchParsedData = []; batchParsedHasGroups = false;
  $('batchModal').classList.add('show');
  setTimeout(() => $('batchInput').focus(), 200);
}
function setImportMode(mode) {
  importMode = mode;
  const t = $('importSegToggle'); t.dataset.mode = mode;
  t.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('batchHint').textContent = mode === 'diff' ? '带难度：每行「题号 + Tab/空格 + 难度(0-8) + Tab/空格 + 题目名」' : '不带难度：每行「题号 + Tab/空格 + 题目名」';
  parseBatch();
}
function parseBatch() {
  const text = $('batchInput').value;
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  const result = []; let currentGroupName = null; let hasGroups = false;
  for (const line of lines) {
    const raw = line; const trimmed = line.trim(); if (!trimmed) continue;
    if (trimmed.startsWith('>')) {
      let name = trimmed.slice(1).trim();
      if (name.startsWith('\t')) name = name.slice(1).trim();
      name = name.replace(/^[\t ]+/, '').trim() || '未命名组';
      currentGroupName = name; hasGroups = true;
      result.push({ isGroup:true, groupName:name }); continue;
    }
    let parts = raw.split('\t').map(s => s.trim()).filter(s => s !== '');
    if (parts.length < 2) parts = trimmed.split(/\s+/);
    if (!parts.length) continue;
    const pid = normalizePid(parts[0]); if (!pid) continue;
    let diff = 0, name = '';
    if (importMode === 'diff') {
      if (parts.length >= 2 && /^\d+$/.test(parts[1]) && parseInt(parts[1], 10) <= 8) { diff = parseInt(parts[1], 10); name = parts.slice(2).join(' ') || '未知题目'; }
      else { name = parts.slice(1).join(' ') || '未知题目'; }
    } else { name = parts.slice(1).join(' ') || '未知题目'; }
    result.push({ pid, difficulty:diff, name, groupName:currentGroupName });
  }
  batchParsedData = result; batchParsedHasGroups = hasGroups;
  const itemCount = result.filter(r => !r.isGroup).length;
  $('batchStats').textContent = '已解析 ' + itemCount + ' 条' + (hasGroups ? ' · 含分组' : '');
  const prev = $('batchPreview');
  if (!result.length) { prev.innerHTML = '<div style="color:var(--text-muted);font-size:.86em;padding:12px 0;text-align:center;">没有解析到有效数据</div>'; return; }
  prev.innerHTML = result.map(it => {
    if (it.isGroup) return '<div class="preview-item preview-group"><i class="fas fa-folder"></i> ' + escapeHtml(it.groupName) + '</div>';
    return '<div class="preview-item">' +
      '<span class="p-pid">' + escapeHtml(it.pid) + '</span>' +
      (importMode === 'diff' ? '<span class="p-diff">' + (DIFF_NAMES[it.difficulty] || '?') + '</span>' : '') +
      '<span class="p-name">' + escapeHtml(it.name) + '</span>' +
    '</div>';
  }).join('');
}
async function confirmBatchImport() {
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  if (!batchParsedData.length) { showToast('请先粘贴数据', 'warning'); return; }
  const l = curList(); if (!l) { showToast('请先选择题单', 'warning'); return; }
  const items = batchParsedData.filter(x => !x.isGroup);
  if (!items.length) { showToast('没有可导入的题目', 'warning'); return; }
  pushUndo();
  let added = 0, skipped = 0; const groupNameToId = {};
  if (batchParsedHasGroups) {
    batchParsedData.forEach(entry => {
      if (entry.isGroup) {
        if (groupNameToId[entry.groupName]) return;
        let g = l.groups.find(x => x.name === entry.groupName);
        if (!g) { g = addProblemGroup(entry.groupName); }
        groupNameToId[entry.groupName] = g.id;
      } else {
        if (l.problems.some(p => p.pid === entry.pid)) { skipped++; return; }
        const gid = groupNameToId[entry.groupName] || null;
        l.problems.push({ pid:entry.pid, name:entry.name, difficulty:entry.difficulty, date:'', note:'', pinned:false, know:false, groupId:gid });
        added++;
      }
    });
    saveData(); renderAll(); closeModal('batchModal');
    showToast('导入 ' + added + ' 题' + (skipped ? '，跳过 ' + skipped : ''), 'success');
    return;
  }
  closeModal('batchModal');
  const targetGid = await askImportGroup(l);
  if (targetGid === null) { showToast('已取消导入', 'info'); return; }
  const useGid = (targetGid === '__none__') ? null : targetGid;
  items.forEach(entry => {
    if (l.problems.some(p => p.pid === entry.pid)) { skipped++; return; }
    l.problems.push({ pid:entry.pid, name:entry.name, difficulty:entry.difficulty, date:'', note:'', pinned:false, know:false, groupId:useGid });
    added++;
  });
  saveData(); renderAll();
  showToast('导入 ' + added + ' 题' + (skipped ? '，跳过 ' + skipped : ''), 'success');
}

/* ============================================================
   百宝箱外壳
   ============================================================ */
export function openTreasure(tab) {
  $('treasureModal').classList.add('show');
  const last = tab || lsGet('treasure_tab') || 'stats';
  switchTreasureTab(last);
}
export function closeTreasure() { $('treasureModal').classList.remove('show'); }
export async function switchTreasureTab(tab) {
  document.querySelectorAll('.ts-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  lsSet('treasure_tab', tab);
  try { await mountPanel(tab, $('treasureContent')); }
  catch (err) { console.error(err); showToast('面板加载失败：' + err.message, 'error'); }
}

/* ============================================================
   训练（模拟赛 / Trick 库 / 日常）
   ============================================================ */
const CODEX_TABS = ['mock', 'tricks', 'daily'];

export function openCodex(tab) {
  const modal = $('codexModal'); if (!modal) return;
  modal.classList.add('show');
  switchCodexTab(tab || lsGet('codex_tab') || 'mock');
}
export function closeCodex() { $('codexModal').classList.remove('show'); }
export async function switchCodexTab(tab) {
  if (CODEX_TABS.indexOf(tab) === -1) tab = 'mock';
  const nav = $('codexTabs');
  if (nav) nav.dataset.index = String(CODEX_TABS.indexOf(tab));
  const headActions = $('codexHeadActions');
  if (headActions) headActions.dataset.active = tab;
  document.querySelectorAll('.codex-tab').forEach(b => b.classList.toggle('active', b.dataset.codexTab === tab));
  lsSet('codex_tab', tab);
  try { await mountPanel(tab, $('codexContent'), { closeId: 'codexModal' }); }
  catch (err) { console.error(err); showToast('训练加载失败：' + err.message, 'error'); }
  updateCodexBadge();
}
/** 书本图标上的小红点：有比赛进行中 / 有题目正在计时 */
export function updateCodexBadge() {
  const badge = $('codexBadge'), btn = $('codexBtn');
  if (!badge || !btn) return;
  const contests = getContests();
  const running = contests.some(c => c.status === 'running');
  const scheduled = contests.some(c => c.status === 'scheduled');
  const pending = contests.some(c => c.status === 'review');
  const daily = getDaily();
  const timing = !!daily.activeId;
  const count = (running ? 1 : 0) + (timing ? 1 : 0) + (scheduled && !running ? 1 : 0);
  badge.textContent = count ? String(count) : '';
  badge.classList.toggle('show', count > 0);
  badge.classList.toggle('alert', running);
  btn.classList.toggle('has-alert', running || timing);
  btn.classList.toggle('has-review', pending && !running);
}

/* ============================================================
   窗口标题：弹百宝箱 / 训练时同步顶栏文字
   ============================================================ */
function updateWindowTitle() {
  const el = document.querySelector('.window-title');
  if (!el) return;
  const codex = $('codexModal');
  const treasure = $('treasureModal');
  let t;
  if (codex && codex.classList.contains('show')) t = '训练中心';
  else if (treasure && treasure.classList.contains('show')) t = '百宝箱';
  else {
    const l = curList();
    t = l ? data.currentList + '  ·  ' + l.problems.filter(p => p.date).length + '/' + l.problems.length : '未选择题单';
  }
  if (el.textContent !== t) el.textContent = t;
}
function bindWindowTitleObserver() {
  const update = updateWindowTitle;
  const mo = new MutationObserver(update);
  ['codexModal', 'treasureModal'].forEach(id => {
    const el = $(id);
    if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  update();
}

/* ============================================================
   视图切换 / 分组
   ============================================================ */
function updateViewToggleUI() {
  const t = $('viewToggle'); if (!t) return;
  t.dataset.view = currentViewMode;
  document.querySelectorAll('#viewToggle .view-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === currentViewMode));
}
function updateGroupViewBtn() {
  const b = $('groupViewBtn'); if (!b) return;
  const labels = { none:'无分类', oj:'按 OJ', diff:'按难度' };
  b.innerHTML = '<i class="fas fa-layer-group"></i> ' + labels[groupViewMode];
}
function switchGroupView() {
  const order = ['none', 'oj', 'diff'];
  const i = order.indexOf(groupViewMode);
  groupViewMode = order[(i + 1) % order.length];
  updateGroupViewBtn();
  renderProblems();
}

/* ============================================================
   数据导入导出
   ============================================================ */
function collectCodexData() {
  const codex = {};
  for (const k of CODEX_KEYS) {
    const raw = lsGet(CODEX_KEY_MAP[k]);
    if (raw) { try { codex[k] = JSON.parse(raw); } catch (e) {} }
  }
  return codex;
}
function applyCodexData(codex) {
  if (!codex || typeof codex !== 'object') return false;
  let wrote = false;
  for (const k of CODEX_KEYS) {
    if (codex[k] == null) continue;
    try { lsSet(CODEX_KEY_MAP[k], JSON.stringify(codex[k])); wrote = true; } catch (e) {}
  }
  return wrote;
}
function reloadAfterCodexImport() {
  showToast('导入成功，正在刷新以载入训练数据…', 'info');
  setTimeout(() => location.reload(), 600);
}

async function exportData() {
  const codex = collectCodexData();
  const payload = Object.assign({}, data, Object.keys(codex).length ? { _codex: codex } : {});
  const json = JSON.stringify(payload, null, 2);
  const fileName = '题单备份_' + fmtDate(new Date()) + '.json';
  if (window.electronAPI && window.electronAPI.saveFile) {
    try { const r = await window.electronAPI.saveFile(fileName, json); showToast('已导出 → ' + r.path, 'success'); }
    catch (e) { showToast('导出失败：' + e.message, 'error'); }
  } else {
    const blob = new Blob([json], { type:'application/json' });
    const u = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = u; a.download = fileName; a.click(); URL.revokeObjectURL(u);
    showToast('导出成功', 'success');
  }
}
function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    let imp;
    try { imp = JSON.parse(ev.target.result); if (!imp.lists) throw new Error('格式错误'); }
    catch (err) { showToast('导入失败：' + err.message, 'warning'); return; }
    const hasCodex = !!(imp._codex && typeof imp._codex === 'object');
    const tipMsg = '导入将 <strong>覆盖</strong> 当前本地数据' + (hasCodex ? '（含训练数据）' : '') + '，继续？';
    confirmDialog('导入数据', tipMsg).then(ok => {
      if (!ok) return; pushUndo();
      Object.keys(data.lists).forEach(k => delete data.lists[k]);
      for (const name in imp.lists) {
        const v = imp.lists[name];
        data.lists[name] = { groups:[], problems:[] };
        if (Array.isArray(v)) data.lists[name].problems = v.map(normalizeProblem);
        else if (v && Array.isArray(v.problems)) {
          data.lists[name].problems = v.problems.map(normalizeProblem);
          data.lists[name].groups = Array.isArray(v.groups) ? v.groups : [];
        }
      }
      data.listGroups = imp.listGroups || []; data.listGroupMap = imp.listGroupMap || {};
      data.listLocks = imp.listLocks || {}; data.listPins = imp.listPins || imp.pins || {};
      data.listOrder = imp.listOrder || []; data.markedLists = imp.markedLists || [];
      data.currentList = imp.currentList && data.lists[imp.currentList] ? imp.currentList : (sortLists()[0] || null);
      setMultiSelect(false); saveData(); renderAll(); updateRandomScopeBtns();
      if (hasCodex) {
        const wrote = applyCodexData(imp._codex);
        if (wrote) { reloadAfterCodexImport(); return; }
      }
      showToast('导入成功', 'success');
    });
  };
  reader.readAsText(f);
}
function confirmClearAll() {
  if (!Object.keys(data.lists).length) { showToast('没有数据', 'warning'); return; }
  confirmDialog('清空所有数据', '确定要清空所有题单？<br><span style="font-size:.79em;color:var(--text-muted);">建议先导出备份</span>').then(ok => {
    if (!ok) return; pushUndo();
    data.lists = {}; data.listGroups = []; data.listGroupMap = {}; data.listLocks = {}; data.listPins = {};
    data.listOrder = []; data.markedLists = []; data.currentList = null;
    setMultiSelect(false); saveData(); renderAll(); updateRandomScopeBtns();
    showToast('已清空', 'info');
  });
}

/* ============================================================
   GitHub 同步
   ============================================================ */
export function loadGitHubSettings() {
  try {
    const raw = lsGet(GITHUB_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const u = $('githubUsername'), r = $('githubRepo'), t = $('githubToken');
      if (u) u.value = s.username || '';
      if (r) r.value = s.repo || '';
      if (t) t.value = s.token || '';
    }
  } catch (e) {}
}
export function saveGitHubSettings() {
  const u = $('githubUsername'), r = $('githubRepo'), t = $('githubToken');
  lsSet(GITHUB_KEY, JSON.stringify({
    username: u ? u.value.trim() : '',
    repo: r ? r.value.trim() : '',
    token: t ? t.value.trim() : ''
  }));
}
export function getGHSettings() {
  const u = $('githubUsername'), r = $('githubRepo'), t = $('githubToken');
  return {
    username: u ? u.value.trim() : '',
    repo: r ? r.value.trim() : '',
    token: t ? t.value.trim() : ''
  };
}
function utf8ToBase64(str) { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function base64ToUtf8(b64) { const bin = atob(b64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new TextDecoder('utf-8').decode(b); }
export async function uploadToGit() {
  const s = getGHSettings();
  if (!s.username || !s.repo || !s.token) { showToast('请填写完整 GitHub 信息', 'warning'); return; }
  saveGitHubSettings();
  const ok = await confirmDialog('上传到 GitHub', '上传到 <strong>' + escapeHtml(s.username) + '/' + escapeHtml(s.repo) + '</strong>？');
  if (!ok) return;
  const url = 'https://api.github.com/repos/' + s.username + '/' + s.repo + '/contents/data/problem_lists.json';
  const codex = collectCodexData();
  const payload = Object.assign({}, data, Object.keys(codex).length ? { _codex: codex } : {});
  const content = utf8ToBase64(JSON.stringify(payload, null, 2));
  try {
    let sha = null;
    const r = await fetch(url, { headers:{ 'Authorization':'Bearer ' + s.token, 'Accept':'application/vnd.github.v3+json' } });
    if (r.ok) sha = (await r.json()).sha; else if (r.status !== 404) throw new Error('获取失败');
    const pr = await fetch(url, {
      method:'PUT',
      headers:{ 'Authorization':'Bearer ' + s.token, 'Accept':'application/vnd.github.v3+json', 'Content-Type':'application/json' },
      body: JSON.stringify({ message:'更新题单 ' + new Date().toISOString(), content, sha: sha || undefined })
    });
    if (!pr.ok) { const e = await pr.json(); throw new Error(e.message || '上传失败'); }
    showToast('已上传到 GitHub', 'success');
  } catch (e) { showToast('上传失败：' + e.message, 'error'); }
}
export async function importFromGit() {
  const s = getGHSettings();
  if (!s.username || !s.repo || !s.token) { showToast('请填写完整 GitHub 信息', 'warning'); return; }
  saveGitHubSettings();
  const ok = await confirmDialog('从 GitHub 导入', '将 <strong>替换</strong> 当前所有本地数据（含训练数据），确定？');
  if (!ok) return;
  const url = 'https://api.github.com/repos/' + s.username + '/' + s.repo + '/contents/data/problem_lists.json';
  try {
    const r = await fetch(url, { headers:{ 'Authorization':'Bearer ' + s.token, 'Accept':'application/vnd.github.v3+json' } });
    if (!r.ok) throw new Error(r.status === 404 ? '远程文件不存在' : '获取失败');
    const rd = await r.json();
    const imp = JSON.parse(base64ToUtf8(rd.content));
    if (!imp.lists) throw new Error('格式错误');
    pushUndo();
    Object.keys(data.lists).forEach(k => delete data.lists[k]);
    for (const name in imp.lists) {
      const v = imp.lists[name];
      data.lists[name] = { groups:[], problems:[] };
      if (Array.isArray(v)) data.lists[name].problems = v.map(normalizeProblem);
      else if (v && Array.isArray(v.problems)) {
        data.lists[name].problems = v.problems.map(normalizeProblem);
        data.lists[name].groups = Array.isArray(v.groups) ? v.groups : [];
      }
    }
    data.listGroups = imp.listGroups || []; data.listGroupMap = imp.listGroupMap || {};
    data.listLocks = imp.listLocks || {}; data.listPins = imp.listPins || imp.pins || {};
    data.listOrder = imp.listOrder || []; data.markedLists = imp.markedLists || [];
    data.currentList = imp.currentList && data.lists[imp.currentList] ? imp.currentList : (sortLists()[0] || null);
    saveData(); renderAll(); updateRandomScopeBtns();
    if (imp._codex && typeof imp._codex === 'object') {
      const wrote = applyCodexData(imp._codex);
      if (wrote) { reloadAfterCodexImport(); return; }
    }
    showToast('从 GitHub 导入成功', 'success');
  } catch (e) { showToast('导入失败：' + e.message, 'error'); }
}

/* ============================================================
   快捷键辅助
   ============================================================ */
function clearAllMarks() {
  if (!data.markedLists.length) { showToast('没有标记的题单', 'info'); return; }
  data.markedLists = []; saveData(); renderLists(); updateRandomScopeBtns();
  showToast('已取消所有标记', 'success');
}
function quickNewGroup() {
  const l = curList(); if (!l) { showToast('请先选择题单', 'warning'); return; }
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  promptText('新组名称', '新组').then(name => {
    if (name === null) return;
    pushUndo(); addProblemGroup(name);
    saveData(); renderProblems(); renderProgress(); refreshGroupSelect();
    showToast('已新建组「' + name + '」', 'success');
  });
}
function quickToggleView() {
  const order = ['all', 'pending', 'done'];
  const labels = { all:'全部', pending:'未做', done:'已做' };
  const i = order.indexOf(currentViewMode);
  currentViewMode = order[(i + 1) % 3];
  updateViewToggleUI(); renderProblems();
  showToast('视图：' + labels[currentViewMode], 'info');
}
function quickPaste() {
  if (!curList()) { showToast('请先选择题单', 'warning'); return; }
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  if (!navigator.clipboard || !navigator.clipboard.readText) { showToast('当前环境不支持读取剪贴板', 'warning'); return; }
  navigator.clipboard.readText().then(text => {
    if (!text || !text.trim()) { showToast('剪贴板为空', 'info'); return; }
    const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
    if (lines.length <= 1) {
      const line = lines[0] || text;
      let pid = '', name = '';
      if (line.includes('\t')) { const p = line.split('\t'); pid = p[0].trim(); name = p.slice(1).join(' ').trim(); }
      else if (/\s/.test(line)) { const i = line.search(/\s/); pid = line.slice(0, i).trim(); name = line.slice(i + 1).trim(); }
      else { pid = line.trim(); }
      const pidEl = $('problemPidInput'), nameEl = $('problemNameInput');
      if (pidEl) pidEl.value = pid;
      if (nameEl) nameEl.value = name;
      if (name && nameEl) nameEl.focus(); else if (pidEl) pidEl.focus();
      showToast('已填充到输入框', 'success');
    } else {
      openBatchImport();
      setTimeout(() => { const ta = $('batchInput'); if (ta) { ta.value = text; parseBatch(); } }, 280);
    }
  }).catch(err => { showToast('无法读取剪贴板：' + (err && err.message ? err.message : err), 'warning'); });
}
function toggleMarkCurrentList() {
  const name = data.currentList;
  if (!name) { showToast('请先选择题单', 'warning'); return; }
  const idx = data.markedLists.indexOf(name);
  if (idx === -1) data.markedLists.push(name); else data.markedLists.splice(idx, 1);
  saveData(); renderLists(); updateRandomScopeBtns();
  showToast(idx === -1 ? '已标记「' + name + '」' : '已取消标记「' + name + '」', 'success');
}
function toggleMarkCurrentListFor(name) {
  const idx = data.markedLists.indexOf(name);
  if (idx === -1) data.markedLists.push(name); else data.markedLists.splice(idx, 1);
  saveData(); renderLists(); updateRandomScopeBtns();
  showToast(idx === -1 ? '已标记「' + name + '」' : '已取消标记「' + name + '」', 'info');
}
function toggleSelectAllMulti() {
  if (!multiSelectMode) { setMultiSelect(true); _doSelectAll(true); return; }
  const f = getFilteredProblems();
  const all = f.length && f.every(p => selectedProblems.has(p.pid));
  _doSelectAll(!all);
  const cb = $('selectAllCheckbox');
  if (cb) cb.checked = !all;
}
function quickSetDifficulty(d) {
  if (!multiSelectMode) { showToast('请先进入多选模式', 'warning'); return; }
  const l = curList(); if (!l) return;
  if (isLocked()) { showToast('只读模式', 'warning'); return; }
  const selected = selectedInDisplayOrder();
  if (!selected.length) { showToast('请先选中题目', 'warning'); return; }
  // 候选集合变化（新选/取消选）时，从头开始标记
  const sig = selected.map(p => p.pid).join('\u0001');
  if (sig !== difficultyCursorSig) { difficultyCursorSig = sig; difficultyCursor = 0; }
  if (difficultyCursor >= selected.length) difficultyCursor = 0;
  const target = selected[difficultyCursor];
  pushUndo(); target.difficulty = d; difficultyCursor++;
  saveData(); renderProblems(); renderProgress();
  const remaining = selected.length - difficultyCursor;
  showToast('「' + target.pid + '」→ ' + DIFF_NAMES[d] + (remaining > 0 ? '（剩 ' + remaining + ' 题）' : '（已完成）'), 'success');
}
const SHORTCUT_GROUPS = [
  {
    title: '全局', icon: 'fa-keyboard',
    items: [
      [['Ctrl', ','], '打开百宝箱'],
      [['Ctrl', 'B'], '打开训练中心（模拟赛 / Trick / 日常）'],
      [['Ctrl', 'F'], '搜索题号 / 题名 / 标签'],
      [['Ctrl', 'Z'], '撤销'],
      [['Ctrl', 'Y'], '重做'],
      [['Ctrl', 'L'], '切换当前题单只读锁'],
      [['Ctrl', 'T'], '置顶 / 取消置顶当前题单'],
      [['Ctrl', 'R'], '标记 / 取消标记当前题单（随机范围）'],
      [['Ctrl', 'H'], '清除所有题单标记'],
      [['Ctrl', 'V'], '从剪贴板填充题号 / 题目名'],
      [['Esc'], '关闭弹窗 / 退出多选']
    ]
  },
  {
    title: '题单与题目', icon: 'fa-list',
    items: [
      [['Ctrl', 'N'], '新建组'],
      [['Ctrl', 'P'], '批量导入题目'],
      [['Ctrl', 'I'], '切换分组视图：无分类 / 按 OJ / 按难度'],
      [['Ctrl', 'O'], '切换视图：全部 / 未做 / 已做'],
      [['Ctrl', '↑ / ↓'], '悬停题单、题目或组时上移 / 下移'],
      [['右键题目'], '即刻开始 / 加入待做池 / 笔记等']
    ]
  },
  {
    title: '多选批量操作', icon: 'fa-check-square',
    items: [
      [['Ctrl', 'M'], '进入 / 退出多选模式'],
      [['Alt', 'A'], '全选 / 取消全选'],
      [['Shift', '点击'], '范围选择'],
      [['Ctrl', '0–8'], '按从上到下顺序依次标记难度'],
      [['Alt', 'O'], '批量打开选中题目'],
      [['右键题目'], '「即刻开始」直接加入进行区并计时']
    ]
  },
  {
    title: '训练中心', icon: 'fa-stopwatch',
    items: [
      [['模拟赛'], '新建时可选择「立即开始」或「定时开始」'],
      [['定时开始'], '到点自动计时，无需手动卡时间'],
      [['日常'], '待做池 / 进行中 / 挂起区，全局只允许一题计时']
    ]
  }
];
export function openShortcuts() {
  const body = $('shortcutsBody'); if (!body) return;
  body.innerHTML = SHORTCUT_GROUPS.map(g =>
    '<section class="sc-group">' +
      '<h4><i class="fas ' + g.icon + '"></i> ' + g.title + '</h4>' +
      g.items.map(it => '<div class="sc-row"><span class="sc-desc">' + it[1] + '</span><span class="sc-keys">' +
        it[0].map(k => /^[A-Za-z0-9,↑↓/–+\s]+$/.test(k) ? '<kbd>' + escapeHtml(k) + '</kbd>' : '<span class="sc-key-text">' + escapeHtml(k) + '</span>').join('') +
      '</span></div>').join('') +
    '</section>'
  ).join('');
  $('shortcutsModal').classList.add('show');
}

function handleCtrlArrow(delta) {
  if (!hoveredElem) return;
  const t = hoveredElem.type;
  if (t === 'problem') {
    if (isLocked()) { showToast('只读模式', 'warning'); return; }
    if (moveWithinGroup(hoveredElem.pid, delta)) { saveData(); renderProblems(); }
  } else if (t === 'problemGroup') {
    if (isLocked()) { showToast('只读模式', 'warning'); return; }
    if (moveProblemGroupOrder(hoveredElem.gid, delta)) { saveData(); renderProblems(); }
  } else if (t === 'list') {
    if (moveListOrder(hoveredElem.name, delta)) { saveData(); renderLists(); }
  } else if (t === 'listGroup') {
    if (moveListGroupOrder(hoveredElem.gid, delta)) { saveData(); renderLists(); }
  }
}

/* ============================================================
   事件绑定
   ============================================================ */
/** 只有真正需要输入文字的元素才拦截快捷键；复选框/下拉框不应让快捷键失效 */
function isTextEntry(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (el.isContentEditable || tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const t = String(el.type || 'text').toLowerCase();
    return ['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'range', 'file', 'image'].indexOf(t) === -1;
  }
  return false;
}
function digitFromEvent(e) {
  if (/^[0-8]$/.test(e.key || '')) return parseInt(e.key, 10);
  const m = /^(?:Digit|Numpad)([0-8])$/.exec(e.code || '');
  return m ? parseInt(m[1], 10) : -1;
}
function bindGlobalShortcuts() {
  document.addEventListener('keydown', e => {
    const a = document.activeElement;
    const isInput = isTextEntry(a);
    const ctrl = e.ctrlKey || e.metaKey;
    const alt = e.altKey;
    const key = (e.key || '').toLowerCase();

    if (e.key === 'Escape') {
      closeAllPopups();
      document.querySelectorAll('.modal-overlay.show').forEach(m => {
        if (m.id !== 'confirmModal' && m.id !== 'promptModal') m.classList.remove('show');
      });
      if (renamingList) { renamingList = null; renderLists(); }
      if (multiSelectMode) setMultiSelect(false);
      return;
    }
    if (isInput) return;

    if (ctrl && !alt) {
      if (key === 'z') { e.preventDefault(); undo(); return; }
      if (key === 'y') { e.preventDefault(); redo(); return; }
      if (key === 'h') { e.preventDefault(); clearAllMarks(); return; }
      if (key === 't') { e.preventDefault(); if (data.currentList) toggleListPin(data.currentList); return; }
      if (key === ',') { e.preventDefault(); openTreasure(); return; }
      if (key === 'b') { e.preventDefault(); openCodex(); return; }
      if (key === 'f') { e.preventDefault(); openSearch(); return; }
      if (key === 'n') { e.preventDefault(); quickNewGroup(); return; }
      if (key === 'p') { e.preventDefault(); openBatchImport(); return; }
      if (key === 'o') { e.preventDefault(); quickToggleView(); return; }
      if (key === 'i') { e.preventDefault(); switchGroupView(); return; }
      if (key === 'v') { e.preventDefault(); quickPaste(); return; }
      if (key === 'l') { e.preventDefault(); if (data.currentList) toggleListLock(data.currentList); return; }
      if (key === 'r') { e.preventDefault(); toggleMarkCurrentList(); return; }
      if (key === 'm') { e.preventDefault(); setMultiSelect(!multiSelectMode); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); handleCtrlArrow(-1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); handleCtrlArrow(1); return; }
      const digit = digitFromEvent(e);
      if (multiSelectMode && digit >= 0) { e.preventDefault(); quickSetDifficulty(digit); return; }
    }

    if (multiSelectMode && alt && !ctrl) {
      if (key === 'a') { e.preventDefault(); toggleSelectAllMulti(); return; }
      if (key === 'o') { e.preventDefault(); batchOpen(); return; }
    }
  }, true);
}
function bindHoverTracking() {
  document.addEventListener('mouseover', e => {
    const probItem = e.target.closest('.problem-item');
    const groupHead = e.target.closest('.group-head[data-group]');
    const listItem = e.target.closest('.list-item');
    const listGroupHead = e.target.closest('.list-group-head');
    if (probItem && probItem.dataset.pid) hoveredElem = { type:'problem', el:probItem, pid:probItem.dataset.pid };
    else if (groupHead && groupHead.dataset.group) hoveredElem = { type:'problemGroup', el:groupHead, gid:groupHead.dataset.group };
    else if (listItem && listItem.dataset.name) hoveredElem = { type:'list', el:listItem, name:listItem.dataset.name };
    else if (listGroupHead && listGroupHead.dataset.lgroup) hoveredElem = { type:'listGroup', el:listGroupHead, gid:listGroupHead.dataset.lgroup };
    else hoveredElem = null;
  });
  document.addEventListener('mouseleave', () => { hoveredElem = null; });
}
function bindEvents() {
  const api = window.electronAPI;
  const winCtrl = $('title-bar').querySelector('.window-controls');
  if (api && api.windowControls) {
    const c = api.windowControls;
    $('winCloseBtn').addEventListener('click', () => c.close());
    $('winMinBtn').addEventListener('click', () => c.minimize());
    const maxBtn = $('winMaxBtn');
    const maxIcon = maxBtn.querySelector('i');
    const toggleMax = async () => { const m = await c.toggleMaximize(); maxIcon.className = m ? 'fas fa-chevron-down' : 'fas fa-chevron-up'; };
    maxBtn.addEventListener('click', toggleMax);
    $('title-bar').addEventListener('dblclick', e => { if (e.target.closest('.window-controls')) return; toggleMax(); });
  } else if (winCtrl) { winCtrl.style.display = 'none'; }

  $('logoBtn').addEventListener('dblclick', redo);
  $('treasureBtn').addEventListener('click', () => openTreasure());
  const codexBtn = $('codexBtn');
  if (codexBtn) codexBtn.addEventListener('click', () => openCodex());
  document.querySelectorAll('.codex-tab').forEach(b => {
    b.addEventListener('click', () => switchCodexTab(b.dataset.codexTab));
  });

  document.querySelectorAll('.ts-btn').forEach(b => b.addEventListener('click', () => switchTreasureTab(b.dataset.tab)));
  $('treasureModal').addEventListener('click', e => { if (e.target === $('treasureModal')) closeTreasure(); });
  document.querySelectorAll('[data-close="treasureModal"]').forEach(b => b.addEventListener('click', closeTreasure));

  $('createListBtn').addEventListener('click', addList);
  $('searchBtn').addEventListener('click', openSearch);
  $('listNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') addList(); });
  $('listContainer').addEventListener('click', e => {
    const it = e.target.closest('.list-item'); if (!it) return;
    const name = it.dataset.name;
    const btn = e.target.closest('button');
    if (btn) {
      const a = btn.dataset.action;
      if (a === 'pin') { toggleListPin(name); return; }
      if (a === 'lock') { toggleListLock(name); return; }
      if (a === 'mark') { toggleMarkCurrentListFor(name); return; }
      return;
    }
    if (renamingList === name) return;
    selectList(name);
  });
  $('listContainer').addEventListener('contextmenu', e => {
    if (e.target.closest('.list-item') || e.target.closest('.list-group-head')) return;
    e.preventDefault();
    openListBlankContextMenu(e.clientX, e.clientY);
  });
  $('viewToggle').addEventListener('click', e => {
    const b = e.target.closest('.view-toggle-btn'); if (!b) return;
    if (b.dataset.view === currentViewMode) return;
    currentViewMode = b.dataset.view;
    updateViewToggleUI(); renderProblems();
  });
  $('groupViewBtn').addEventListener('click', switchGroupView);
  $('layoutToggleBtn').addEventListener('click', toggleColumnMode);
  $('addGroupBtn').addEventListener('click', quickNewGroup);
  $('batchImportBtn').addEventListener('click', openBatchImport);
  $('listLockBtn').addEventListener('click', () => { if (data.currentList) toggleListLock(data.currentList); });

  const plBox = $('problemList');
  if (plBox) {
    plBox.addEventListener('scroll', () => {
      rememberProblemScroll();
      scheduleUIStateSave();
    }, { passive: true });
  }
  window.addEventListener('beforeunload', () => { rememberProblemScroll(); persistUIState(); });

  $('toggleMultiSelectBtn').addEventListener('click', () => setMultiSelect(!multiSelectMode));
  $('selectAllCheckbox').addEventListener('change', e => {
    if (!multiSelectMode) { setMultiSelect(true); _doSelectAll(true); return; }
    _doSelectAll(e.target.checked);
  });
  $('batchOpenBtn').addEventListener('click', batchOpen);
  $('batchDeleteBtn').addEventListener('click', batchDelete);

  $('applyDiffBtn').addEventListener('click', e => {
    e.stopPropagation();
    if (isLocked()) { showToast('只读模式', 'warning'); return; }
    togglePopup($('diffPopup'), e.currentTarget);
    if ($('diffPopup').classList.contains('open')) setTimeout(() => $('batchDiffString').focus(), 60);
  });
  $('batchDiffString').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyDiffString(); }
    else if (e.key === 'Escape') closePopup($('diffPopup'));
  });
  $('batchExportBtn').addEventListener('click', e => {
    e.stopPropagation();
    setExportMode(exportMode);
    togglePopup($('exportPopup'), e.currentTarget);
  });
  $('exportPopup').addEventListener('click', e => {
    const modeBtn = e.target.closest('[data-export-mode]');
    if (modeBtn) { setExportMode(modeBtn.dataset.exportMode); return; }
    const go = e.target.closest('[data-export-go]');
    if (go) doBatchExport(go.dataset.exportGo);
  });
  $('batchMoveListBtn').addEventListener('click', e => {
    e.stopPropagation();
    if (isLocked()) { showToast('只读模式', 'warning'); return; }
    updateMoveTargets(); togglePopup($('moveListPopup'), e.currentTarget);
  });
  $('moveCopyToggle').addEventListener('click', e => {
    e.stopPropagation(); moveCopyMode = !moveCopyMode;
    const b = e.currentTarget;
    b.innerHTML = moveCopyMode ? '<i class="fas fa-copy"></i> 复制' : '<i class="fas fa-share"></i> 移动';
    b.classList.toggle('success', moveCopyMode); b.classList.toggle('ghost', !moveCopyMode);
  });
  $('moveConfirmBtn').addEventListener('click', e => { e.stopPropagation(); batchMoveList(); });
  $('batchMoveBtn').addEventListener('click', e => {
    e.stopPropagation();
    if (isLocked()) { showToast('只读模式', 'warning'); return; }
    openMoveGroupPopup(e.currentTarget, null);
  });
  $('moveGroupSelect').addEventListener('change', () => {
    const v = $('moveGroupSelect').value;
    $('newGroupName').style.display = v === '__new__' ? 'block' : 'none';
    if (v === '__new__') $('newGroupName').focus();
  });
  $('newGroupName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirmMoveGroup(); } });
  $('moveGroupConfirmBtn').addEventListener('click', e => { e.stopPropagation(); confirmMoveGroup(); });

  $('addProblemBtn').addEventListener('click', addProblem);
  $('sortByOjBtn').addEventListener('click', sortByOJ);
  $('sortByDiffBtn').addEventListener('click', sortByDiff);
  $('problemPidInput').addEventListener('paste', e => {
    const t = (e.clipboardData || window.clipboardData).getData('text');
    if (!t || t.includes('\n')) return;
    let pid = '', name = '';
    if (t.includes('\t')) { const p = t.split('\t'); pid = p[0].trim(); name = p.slice(1).join(' ').trim(); }
    else if (/\s/.test(t)) { const i = t.search(/\s/); pid = t.slice(0, i).trim(); name = t.slice(i + 1).trim(); }
    if (pid && name) { e.preventDefault(); $('problemPidInput').value = pid; $('problemNameInput').value = name; $('problemNameInput').focus(); }
  });
  $('problemPidInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('problemNameInput').focus(); } });
  $('problemNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addProblem(); } });

  $('editSaveBtn').addEventListener('click', saveEditProblem);
  $('editModal').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveEditProblem(); } });
  $('noteSaveBtn').addEventListener('click', saveNote);

  $('searchResults').addEventListener('click', e => { const it = e.target.closest('.search-item'); if (it) goToProblem(it.dataset.list, it.dataset.pid); });
  $('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 180);
  });
  $('searchModeToggle').addEventListener('click', e => {
    const b = e.target.closest('button'); if (b) setSearchMode(b.dataset.searchMode);
  });

  $('importSegToggle').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setImportMode(b.dataset.mode); });
  $('batchInput').addEventListener('input', () => { clearTimeout($('batchInput')._t); $('batchInput')._t = setTimeout(parseBatch, 300); });
  $('batchConfirmBtn').addEventListener('click', confirmBatchImport);

  // 只有在遮罩上「按下并在遮罩上抬起」才算点击外部；
  // 从卡片内按下、划到遮罩上松开（选文本时的常见动作）不再误关弹窗
  let overlayDownOn = null;
  document.addEventListener('pointerdown', e => {
    // 只有「按下的目标就是遮罩本身」才算数：在卡片里按下、划到遮罩上松开不算
    const el = e.target;
    overlayDownOn = (el && el.classList && el.classList.contains('modal-overlay')) ? el : null;
  }, true);
  document.addEventListener('click', e => {
    const cb = e.target.closest('[data-close]');
    if (cb) { closeModal(cb.dataset.close); return; }
    const ov = e.target.closest('.modal-overlay');
    if (ov && e.target === ov && overlayDownOn === ov && ov.id !== 'confirmModal' && ov.id !== 'promptModal' && ov.id !== 'treasureModal' && ov.id !== 'themeEditModal' && ov.id !== 'importGroupModal') {
      ov.classList.remove('show'); return;
    }
    if (!e.target.closest('.popup') && !e.target.closest('[data-popup-trigger]') && !e.target.closest('#contextMenu')) closeAllPopups();
  });

  let tagFitTimer = null;
  window.addEventListener('resize', () => {
    closeAllPopups();
    clearTimeout(tagFitTimer);
    tagFitTimer = setTimeout(() => fitProblemTags($('problemList')), 120);
  });

  initTour();
}

/* ============================================================
   总渲染 / 启动
   ============================================================ */
function renderAll() {
  try { renderLists(); } catch (e) { console.error('[renderLists]', e); }
  try { renderProblems(); } catch (e) { console.error('[renderProblems]', e); }
  try { renderProgress(); } catch (e) { console.error('[renderProgress]', e); }
  try {
    const has = !!curList();
    const tb = $('problemToolbar'); if (tb) tb.style.display = has ? 'flex' : 'none';
  } catch (e) { console.error('[toolbar]', e); }
  try { updateReadonlyUI(); } catch (e) { console.error('[updateReadonlyUI]', e); }
  try { updateWindowTitle(); } catch (e) { console.error('[windowTitle]', e); }
}

function boot() {
  try { loadGitHubSettings(); } catch (e) { console.error('[loadGitHub]', e); }
  try { initTheme(); } catch (e) { console.error('[initTheme]', e); }
  try { applySidebarWidth(); } catch (e) { console.error('[sidebarWidth]', e); }
  try { bindSidebarResize(); } catch (e) { console.error('[sidebarResize]', e); }
  try { updateGroupViewBtn(); } catch (e) { console.error('[updateGroupViewBtn]', e); }
  try { updateViewToggleUI(); } catch (e) { console.error('[updateViewToggleUI]', e); }
  try { updateRandomScopeBtns(); } catch (e) { console.error('[updateRandomScopeBtns]', e); }
  try { bindEvents(); } catch (e) { console.error('[bindEvents]', e); }
  try { bindGlobalShortcuts(); } catch (e) { console.error('[bindGlobalShortcuts]', e); }
  try { bindHoverTracking(); } catch (e) { console.error('[bindHoverTracking]', e); }
  try { bindPidGesture(); } catch (e) { console.error('[pidGesture]', e); }
  try { bindWindowTitleObserver(); } catch (e) { console.error('[windowTitle]', e); }
  try { applyColumnMode(); } catch (e) { console.error('[columnMode]', e); }
  try { renderAll(); } catch (e) { console.error('[renderAll]', e); }
  try { window.addEventListener('app:diff-palette-changed', () => { try { renderAll(); } catch (e) {} }); } catch (e) {}
  try { restoreProblemScroll(); } catch (e) { console.error('[restoreScroll]', e); }
  try { syncContestTimers(); } catch (e) { console.error('[syncContestTimers]', e); }
  try {
    updateCodexBadge();
    let lastCodexSig = dailyStatusSignature();
    onCodexChange(scope => {
      try { updateCodexBadge(); } catch (e) { console.error('[codexBadge]', e); }
      if (scope === 'mock' || scope === 'tricks') return;
      try {
        const sig = dailyStatusSignature();
        if (sig === lastCodexSig) return;
        if (pidGesture) return; // 手势进行中：松手后的 commit 路径会自己重画
        lastCodexSig = sig;
        renderProblems();
        updateWindowTitle();
      } catch (e) { console.error('[codexRender]', e); }
    });
  } catch (e) { console.error('[codexBadge]', e); }
  // 定时开始：即使没有打开训练面板，也会在到点后自动开赛 / 自动交卷
  try {
    setInterval(() => {
      try {
        const r = syncContestTimers();
        (r.started || []).forEach(c => showToast('模拟赛《' + c.name + '》已开始计时', 'success'));
        (r.finished || []).forEach(c => showToast('《' + c.name + '》时间到，已自动交卷', 'info'));
        if ((r.started && r.started.length) || (r.finished && r.finished.length)) updateCodexBadge();
      } catch (e) {}
    }, 10000);
  } catch (e) {}

  try { if (shouldShowTour()) setTimeout(openTour, 600); } catch (e) {}

  console.log('题单管理 v2.2.0 — 就绪');
  console.log('已加载 ' + Object.keys(data.lists).length + ' 个题单');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ==== 面板需要的写操作接口 ====
export { saveData, renderAll, pushUndo, exportData, importData, confirmClearAll, renderProblemHTML };