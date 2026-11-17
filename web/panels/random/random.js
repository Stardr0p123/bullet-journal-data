import { $, showToast } from '../../js/core.js';
import { data, renderProblemHTML, bindProblemRowEvents } from '../../js/app.js';

let randomScope = 'global';
let picked = [];   // [{ pid, listName }]

function updateScopeBtns() {
  document.querySelectorAll('#randomScopeToggle button').forEach(b => b.classList.toggle('active', b.dataset.scope === randomScope));
}

/** 把最近一次的抽取结果按主列表的行样式重画（不重新抽签） */
function renderPicked() {
  const box = $('randomResult'); if (!box) return;
  if (!picked.length) {
    box.innerHTML = '<div class="random-empty">点击「随机」抽取 5 道未做题目</div>';
    return;
  }
  // 题目可能已被删除：先过滤，再画
  picked = picked.filter(it => { const l = data.lists[it.listName]; return !!(l && l.problems.some(x => x.pid === it.pid)); });
  box.innerHTML = picked.map(it => {
    const l = data.lists[it.listName];
    const p = l.problems.find(x => x.pid === it.pid);
    return renderProblemHTML(p, false, false, { listName: it.listName, badge: it.listName, jump: true });
  }).join('');
  bindProblemRowEvents(box, { menu: false });
}

function randomPick() {
  const minD = parseInt($('randomDiffMin').value, 10);
  const maxD = parseInt($('randomDiffMax').value, 10);
  let pool = [];
  const addPool = (name, arr) => {
    arr.forEach(p => { if (p.difficulty >= minD && p.difficulty <= maxD && !p.date) pool.push({ pid: p.pid, listName: name }); });
  };
  if (randomScope === 'current') {
    if (!data.currentList) { showToast('请先选择题单', 'warning'); return; }
    addPool(data.currentList, data.lists[data.currentList].problems);
  } else if (randomScope === 'marked') {
    if (!data.markedLists.length) { showToast('请先在侧栏标记题单', 'warning'); return; }
    data.markedLists.forEach(n => { if (data.lists[n]) addPool(n, data.lists[n].problems); });
  } else {
    for (const n in data.lists) addPool(n, data.lists[n].problems);
  }
  if (!pool.length) { picked = []; renderPicked(); return; }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  picked = pool.slice(0, 5);
  renderPicked();
  $('randomGoLabel').textContent = '换一批';
}

export function init(panelEl) {
  panelEl.querySelector('#randomGoBtn').addEventListener('click', randomPick);
  panelEl.querySelector('#randomScopeToggle').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.scope === randomScope) return;
    randomScope = b.dataset.scope;
    updateScopeBtns();
    picked = [];
    renderPicked();
    $('randomGoLabel').textContent = '随机';
  });
  // 主列表里改状态 / 难度后，卡片同步刷新（保留同一批题目）
  window.addEventListener('app:state-changed', () => { if (picked.length) renderPicked(); });
  updateScopeBtns();
  renderPicked();
}
export function activate() {}
