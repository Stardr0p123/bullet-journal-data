// panels/daily/daily.js —— 日常面板：待做池 / 进行中 / 挂起区
import {
  escapeHtml, showToast, confirmDialog, openContextMenu,
  DIFF_NAMES, DIFF_COLORS, getProblemUrl, fmtDate
} from '../../js/core.js';
import { data, pushUndo, saveData, renderAll, switchCodexTab } from '../../js/app.js';
import {
  onCodexChange, INBOX_LIMIT, DOING_LIMIT, getDaily, activeTask,
  moveToDoing, removeFromInbox, startTask, pauseTask, suspendTask,
  completeTask, removeSuspended, elapsedOf, totalFocusedMs,
  hhmmss, humanDuration, clearDoneHistory, markSupplementDone
} from '../../js/features/codex-store.js';
import { requestFocusContest } from '../mock/mock.js';

let host = null;
let tickHandle = null;
let pendingDoneId = null;
let mute = 0;
let liveDay = fmtDate(new Date());

function withMute(fn) { mute++; try { return fn(); } finally { mute--; } }

/* ============================================================
   小工具
   ============================================================ */
function diffMeta(d) {
  const i = Number(d) || 0;
  return { name: DIFF_NAMES[i] || DIFF_NAMES[0], color: DIFF_COLORS[i] || DIFF_COLORS[0] };
}
function isToday(ts) {
  if (!ts) return false;
  return fmtDate(new Date(ts)) === fmtDate(new Date());
}
function todayDoneList() {
  return getDaily().done.filter(d => isToday(d.doneAt));
}

/* ============================================================
   渲染
   ============================================================ */
function inboxRowHTML(t) {
  const m = diffMeta(t.difficulty);
  return '<div class="dl-row" data-id="' + t.id + '" data-kind="inbox">' +
    '<span class="dl-dot" style="background:' + m.color + '"></span>' +
    '<span class="dl-pid" title="' + escapeHtml(t.pid) + '">' + escapeHtml(t.pid) + '</span>' +
    '<span class="dl-name" title="' + escapeHtml(t.name || t.pid) + '">' + escapeHtml(t.name || '未命名题目') + '</span>' +
    (t.virtual ? '<span class="dl-vtag" title="模拟赛补题（虚拟题号）"><i class="fas fa-stopwatch"></i></span>' : '') +
    '<span class="dl-diff" style="background:' + m.color + '">' + m.name + '</span>' +
    '<span class="dl-row-acts">' +
      '<button class="dl-mini" data-act="doing" title="加入进行中"><i class="fas fa-arrow-right"></i></button>' +
      '<button class="dl-mini danger" data-act="remove" title="从待做池删去"><i class="fas fa-times"></i></button>' +
    '</span>' +
  '</div>';
}

function suspendedRowHTML(t) {
  const m = diffMeta(t.difficulty);
  const ms = elapsedOf(t.id);
  return '<div class="dl-row" data-id="' + t.id + '" data-kind="suspended">' +
    '<span class="dl-dot" style="background:' + m.color + '"></span>' +
    '<span class="dl-pid" title="' + escapeHtml(t.pid) + '">' + escapeHtml(t.pid) + '</span>' +
    '<span class="dl-name" title="' + escapeHtml(t.name || t.pid) + '">' + escapeHtml(t.name || '未命名题目') + '</span>' +
    (t.virtual ? '<span class="dl-vtag" title="模拟赛补题（虚拟题号）"><i class="fas fa-stopwatch"></i></span>' : '') +
    '<span class="dl-diff" style="background:' + m.color + '">' + m.name + '</span>' +
    '<span class="dl-elapsed" data-elapsed="' + t.id + '" title="已耗时">' + hhmmss(ms) + '</span>' +
    '<span class="dl-row-acts">' +
      '<button class="dl-mini" data-act="doing" title="移入进行中"><i class="fas fa-bolt"></i></button>' +
      '<button class="dl-mini danger" data-act="remove" title="移出挂起区"><i class="fas fa-times"></i></button>' +
    '</span>' +
  '</div>';
}

function doingCardHTML(t, activeId) {
  const m = diffMeta(t.difficulty);
  const isActive = activeId === t.id;
  const busy = !!activeId && !isActive;
  const actions = isActive
    ? '<button class="dl-btn suspend" data-act="suspend"><i class="fas fa-pause"></i> 挂起</button>' +
      '<button class="dl-btn finish" data-act="finish"><i class="fas fa-check"></i> 完成</button>'
    : '<button class="dl-btn go" data-act="start"' + (busy ? ' disabled title="另一道题正在计时"' : '') + '>' +
        '<i class="fas fa-play"></i> 开做</button>';
  return '<article class="dl-card' + (isActive ? ' active' : '') + '" data-id="' + t.id + '">' +
    '<div class="dl-card-top">' +
      '<span class="dl-dot" style="background:' + m.color + '"></span>' +
      '<span class="dl-pid" title="' + escapeHtml(t.pid) + '">' + escapeHtml(t.pid) + '</span>' +
      (t.virtual ? '<span class="dl-vtag" title="模拟赛补题（虚拟题号）"><i class="fas fa-stopwatch"></i></span>' : '') +
      '<span class="dl-diff" style="background:' + m.color + '">' + m.name + '</span>' +
      '<button class="dl-mini dl-open" data-act="open" title="打开题目链接"><i class="fas fa-external-link-alt"></i></button>' +
    '</div>' +
    '<div class="dl-card-name" title="' + escapeHtml(t.name || '') + '">' + escapeHtml(t.name || '未命名题目') + '</div>' +
    '<div class="dl-timer-row">' +
      '<span class="dl-timer" data-timer="' + t.id + '">' + hhmmss(elapsedOf(t.id)) + '</span>' +
      (isActive ? '<span class="dl-live"><i class="fas fa-circle"></i> 计时中</span>'
                : (busy ? '<span class="dl-paused">等待中</span>' : '<span class="dl-paused">已暂停</span>')) +
    '</div>' +
    '<div class="dl-card-actions">' + actions + '</div>' +
  '</article>';
}

function render() {
  if (!host) return;
  const daily = getDaily();
  const active = activeTask();
  const activeId = active ? active.id : null;

  const doingBox = host.querySelector('#dlDoing');
  const inboxBox = host.querySelector('#dlInbox');
  const suspBox = host.querySelector('#dlSuspended');
  if (!doingBox || !inboxBox || !suspBox) return;

  doingBox.innerHTML = daily.doing.length
    ? daily.doing.map(t => doingCardHTML(t, activeId)).join('')
    : '<div class="dl-placeholder"><i class="fas fa-bolt"></i><span>暂无进行中的题 · 从待做池点 <b>➔</b> 加入</span></div>';

  const inboxBody = daily.inbox.length
    ? daily.inbox.map(inboxRowHTML).join('')
    : '<div class="dl-placeholder slim"><i class="fas fa-inbox"></i><span>待做池是空的</span></div>';
  inboxBox.innerHTML = '<div class="dl-rows">' + inboxBody + '</div>' +
    '<div class="dl-list-foot">' +
      (daily.inbox.length >= INBOX_LIMIT
        ? '<i class="fas fa-exclamation-circle"></i> 待做池已满'
        : '<i class="fas fa-plus-circle"></i> 还可加入 ' + (INBOX_LIMIT - daily.inbox.length) + ' 题') +
    '</div>';

  const suspBody = daily.suspended.length
    ? daily.suspended.map(suspendedRowHTML).join('')
    : '<div class="dl-placeholder slim"><i class="fas fa-pause-circle"></i><span>没有挂起的题</span></div>';
  const suspMs = daily.suspended.reduce((s, t) => s + elapsedOf(t.id), 0);
  suspBox.innerHTML = '<div class="dl-rows">' + suspBody + '</div>' +
    '<div class="dl-list-foot">' +
      (daily.suspended.length
        ? '<i class="fas fa-hourglass-half"></i> 已投入 ' + hhmmss(suspMs)
        : '<i class="fas fa-undo"></i> 挂起后可随时接回') +
    '</div>';

  // 计数（#dlDoneCount / #dlFocus 在 #codexHeadActions 中）
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('dlDoingCount', daily.doing.length + '/' + DOING_LIMIT);
  set('dlInboxCount', daily.inbox.length + '/' + INBOX_LIMIT);
  set('dlSuspendCount', String(daily.suspended.length));
  set('dlDoneCount', String(todayDoneList().length));
  set('dlFocus', hhmmss(totalFocusedMs()));

  const strip = host.querySelector('#dlDoneStrip');
  if (strip) {
    const done = daily.done.slice(0, 6);
    if (!done.length) { strip.innerHTML = ''; strip.classList.remove('show'); }
    else {
      strip.classList.add('show');
      strip.innerHTML = '<div class="dl-done-head">' +
          '<h3><i class="fas fa-check-double"></i> 最近完成</h3>' +
          '<button class="ck-btn ghost sm" data-act="clear-done"><i class="fas fa-eraser"></i> 清空记录</button>' +
        '</div>' +
        '<div class="dl-done-list">' + done.map(d => {
          const m = diffMeta(d.difficulty);
          return '<div class="dl-done-item" title="' + escapeHtml(d.icebreak || '') + '">' +
            '<span class="dl-dot" style="background:' + m.color + '"></span>' +
            '<span class="dl-done-pid">' + escapeHtml(d.pid) + '</span>' +
            '<span class="dl-done-name">' + escapeHtml(d.name || '') + '</span>' +
            '<span class="dl-done-dur"><i class="fas fa-clock"></i> ' + humanDuration(d.durationMs || 0) + '</span>' +
            (d.usedSolution ? '<span class="dl-done-sol"><i class="fas fa-book-open"></i> 看了题解</span>' : '') +
          '</div>';
        }).join('') + '</div>';
    }
  }

  bindRows();
}

/* ============================================================
   事件
   ============================================================ */
function bindRows() {
  const inboxBox = host.querySelector('#dlInbox');
  const suspBox = host.querySelector('#dlSuspended');
  const doingBox = host.querySelector('#dlDoing');

  inboxBox.querySelectorAll('.dl-row').forEach(row => {
    const id = row.dataset.id;
    row.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'doing') pushToDoing(id);
      else if (act.dataset.act === 'remove') removeInbox(id);
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, [
        { act: 'doing', icon: 'fa-bolt', label: '加入进行中', run: () => pushToDoing(id) },
        { sep: true },
        { act: 'remove', icon: 'fa-trash-alt', label: '从待做池中删去', danger: true, run: () => removeInbox(id) }
      ]);
    });
  });

  suspBox.querySelectorAll('.dl-row').forEach(row => {
    const id = row.dataset.id;
    row.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'doing') pushToDoing(id);
      else if (act.dataset.act === 'remove') removeSuspend(id);
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, [
        { act: 'doing', icon: 'fa-bolt', label: '移入进行中', run: () => pushToDoing(id) },
        { sep: true },
        { act: 'remove', icon: 'fa-trash-alt', label: '移出挂起区', danger: true, run: () => removeSuspend(id) }
      ]);
    });
  });

  doingBox.querySelectorAll('.dl-card').forEach(card => {
    const id = card.dataset.id;
    card.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'start') startDoing(id);
      else if (a === 'suspend') suspendDoing(id);
      else if (a === 'finish') openDoneModal(id);
      else if (a === 'open') { const t = getDaily().doing.find(x => x.id === id); if (t) openLink(t); }
    });
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      const t = getDaily().doing.find(x => x.id === id); if (!t) return;
      openContextMenu(e.clientX, e.clientY, [
        { act: 'open', icon: 'fa-external-link-alt', label: '打开题目链接', run: () => openLink(t) },
        { sep: true },
        { act: 'suspend', icon: 'fa-pause', label: '挂起（保留计时）', run: () => suspendDoing(id) },
        { act: 'finish', icon: 'fa-check', label: '完成…', run: () => openDoneModal(id) }
      ]);
    });
  });

  const clearBtn = host.querySelector('[data-act="clear-done"]');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    confirmDialog('<i class="fas fa-eraser" style="color:var(--warning)"></i> 清空完成记录',
      '只清空「最近完成」列表，题目笔记里已追加的内容不会被删除。继续？').then(ok => {
      if (!ok) return;
      clearDoneHistory();
      showToast('已清空完成记录', 'info');
    });
  });
}

/* ============================================================
   操作
   ============================================================ */
function openLink(t) {
  if (!t) return;
  if (t.virtual) {
    requestFocusContest(t.mockContestId);
    switchCodexTab('mock');
    showToast('模拟赛补题 · 已定位到本场面板', 'info');
    return;
  }
  const url = getProblemUrl(t.pid);
  if (url && url !== '#') window.open(url, '_blank');
}

function pushToDoing(id) {
  let r;
  withMute(() => { r = moveToDoing(id); });
  if (r && r.ok) { showToast('已加入进行中', 'success'); render(); }
  else if (r && r.reason === 'full') showToast('进行中已满 ' + DOING_LIMIT + ' 题', 'warning');
  else if (r && r.reason === 'missing') showToast('题目已不在列表中', 'warning');
}

function removeInbox(id) {
  const t = getDaily().inbox.find(x => x.id === id);
  if (!t) return;
  const ok = withMute(() => removeFromInbox(id));
  if (ok) { showToast('已从待做池删去', 'info'); render(); }
}

function removeSuspend(id) {
  const t = getDaily().suspended.find(x => x.id === id);
  if (!t) return;
  confirmDialog('<i class="fas fa-trash-alt" style="color:var(--danger)"></i> 移出挂起区',
    '「<strong>' + escapeHtml(t.pid) + '</strong>」将从挂起区移除，累计计时也会一并清空。').then(ok => {
    if (!ok) return;
    withMute(() => removeSuspended(id));
    showToast('已移出挂起区', 'info');
    render();
  });
}

function startDoing(id) {
  const daily = getDaily();
  if (daily.activeId && daily.activeId !== id) { showToast('已有题目正在计时，请先挂起或完成', 'warning'); return; }
  const t = daily.doing.find(x => x.id === id);
  if (!t) return;
  let r;
  withMute(() => { r = startTask(id); });
  if (!r || !r.ok) { showToast('无法开始计时', 'error'); return; }
  if (!t.virtual) openLink(t);
  render();
  showToast('开始计时 · ' + t.pid, 'success');
}

function suspendDoing(id) {
  let r;
  withMute(() => { r = suspendTask(id); });
  if (r && r.ok) {
    syncSuspendToProblem(id);   // 同步「会了没写」状态到题单
    showToast('已挂起 · 累计 ' + humanDuration(r.durationMs), 'info');
    render();
  }
}

/* ---------- 同步到题单 ---------- */
function findProblem(task) {
  if (!task) return null;
  const l = data.lists[task.listName];
  if (l) {
    const found = l.problems.find(p => p.pid === task.pid);
    if (found) return found;
  }
  for (const name in data.lists) {
    const cand = data.lists[name].problems.find(p => p.pid === task.pid);
    if (cand) return cand;
  }
  return null;
}

/** 挂起时：同步「会了没写」到题单 */
function syncSuspendToProblem(id) {
  const t = getDaily().suspended.find(x => x.id === id);
  if (!t) return;
  const target = findProblem(t);
  if (!target) return;
  pushUndo();
  target.date = '';
  target.know = true;
  saveData();
  renderAll();
}

/** 完成时：同步完成状态 + 追加「完成时间 / 题解状态 / 破冰点」到注释 */
function syncCompletionToProblem(task, durationMs, usedSolution, icebreak) {
  const target = findProblem(task);
  if (!target) return false;
  pushUndo();
  target.date = fmtDate(new Date());
  target.know = false;
  const lines = ['完成时间：' + humanDuration(durationMs), (usedSolution ? '看了题解' : '独立完成')];
  if (icebreak) lines.push('破冰点：' + icebreak);
  const stamp = lines.join('\n');
  const old = String(target.note || '').replace(/\s+$/, '');
  target.note = old ? (old + '\n' + stamp) : stamp;
  saveData();
  renderAll();
  return true;
}

/* ---------- 完成弹窗 ---------- */
function openDoneModal(id) {
  const t = getDaily().doing.find(x => x.id === id);
  if (!t) return;
  pendingDoneId = id;
  withMute(() => pauseTask(id));
  render();

  const modal = document.getElementById('dailyDoneModal');
  if (!modal) return;
  const pidEl = document.getElementById('dailyDonePid');
  const nameEl = document.getElementById('dailyDoneName');
  const elapsedEl = document.getElementById('dailyDoneElapsed');
  if (pidEl) pidEl.textContent = t.pid;
  if (nameEl) nameEl.textContent = t.name || '';
  if (elapsedEl) elapsedEl.textContent = hhmmss(elapsedOf(id));
  const area = document.getElementById('dailyIcebreak');
  if (area) { area.value = ''; area.classList.remove('invalid'); }
  document.querySelectorAll('input[name="dailySolved"]').forEach(r => { r.checked = r.value === 'no'; });
  modal.classList.add('show');
  setTimeout(() => { if (area) area.focus(); }, 160);
}

function confirmDone() {
  const id = pendingDoneId;
  if (!id) return;
  const area = document.getElementById('dailyIcebreak');
  const icebreak = area ? area.value.trim() : '';
  if (!icebreak) {
    if (area) { area.classList.add('invalid'); area.focus(); }
    showToast('破冰点记录是必填项', 'warning');
    return;
  }
  const picked = document.querySelector('input[name="dailySolved"]:checked');
  const usedSolution = !!(picked && picked.value === 'yes');

  let r;
  withMute(() => { r = completeTask(id, { usedSolution, icebreak }); });
  if (!r || !r.ok) { showToast('操作失败', 'error'); return; }

  const ok = r.task.virtual
    ? !!markSupplementDone(r.task.mockContestId, r.task.mockProblemId, { durationMs: r.durationMs, usedSolution, icebreak })
    : syncCompletionToProblem(r.task, r.durationMs, usedSolution, icebreak);
  const modal = document.getElementById('dailyDoneModal');
  if (modal) modal.classList.remove('show');
  pendingDoneId = null;
  render();
  showToast('已完成 · ' + humanDuration(r.durationMs) +
    (ok ? (r.task.virtual ? '，已回写模拟赛补题记录' : '，已同步到题目') : ''), 'success');
}

/** 关闭「完成」弹窗但未确认时，恢复计时而不要一直暂停 */
function resumePendingTask() {
  const id = pendingDoneId;
  if (!id) return;
  pendingDoneId = null;
  const daily = getDaily();
  const t = daily.doing.find(x => x.id === id);
  if (!t) return;
  if (!daily.activeId) {
    withMute(() => startTask(id));
    render();
    showToast('已取消完成，继续计时', 'info');
  }
}

function bindDoneModal() {
  const modal = document.getElementById('dailyDoneModal');
  if (!modal || modal._bound) return;
  modal._bound = true;
  const btn = document.getElementById('dailyDoneConfirmBtn');
  if (btn) btn.addEventListener('click', confirmDone);
  const cancels = modal.querySelectorAll('[data-close="dailyDoneModal"]');
  cancels.forEach(b => b.addEventListener('click', () => { resumePendingTask(); }));
  // 点遮罩 / Esc 关闭时同样恢复计时
  const obs = new MutationObserver(() => {
    if (!modal.classList.contains('show') && pendingDoneId) resumePendingTask();
  });
  obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
}

/* ============================================================
   实时时钟
   ============================================================ */
function updateLiveClocks() {
  if (!host) return;
  const today = fmtDate(new Date());
  if (today !== liveDay) { liveDay = today; render(); return; }  // 跨天：刷新「最近完成」与投入时间
  const cards = host.querySelectorAll('#dlDoing [data-timer]');
  cards.forEach(el => { el.textContent = hhmmss(elapsedOf(el.dataset.timer)); });
  const susp = host.querySelectorAll('#dlSuspended [data-elapsed]');
  if (susp.length) susp.forEach(el => { el.textContent = hhmmss(elapsedOf(el.dataset.elapsed)); });
  // #dlFocus 在 #codexHeadActions 中
  const focus = document.getElementById('dlFocus');
  if (focus) focus.textContent = hhmmss(totalFocusedMs());
}

/* ============================================================
   生命周期
   ============================================================ */
export function init(panelEl) {
  host = panelEl;
  bindDoneModal();
  onCodexChange(scope => { if (scope === 'daily' && !mute) render(); });
  render();
  if (!tickHandle) tickHandle = setInterval(updateLiveClocks, 500);
}

export function activate() { render(); }