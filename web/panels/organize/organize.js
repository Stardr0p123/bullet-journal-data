import { $, escapeHtml, showToast, problemStatus, DIFF_NAMES } from '../../js/core.js';
import { data, sortLists, pushUndo, saveData, renderAll } from '../../js/app.js';

const compareState = { left:null, right:null, matches:[], initialized:false };

function refreshCompareSelects() {
  const leftSel = $('compareLeft'), rightSel = $('compareRight');
  if (!leftSel || !rightSel) return;
  const lists = sortLists();
  const optHtml = lists.map(n => '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>').join('');
  leftSel.innerHTML = '<option value="">选择题单…</option>' + optHtml;
  rightSel.innerHTML = '<option value="">选择题单…</option>' + optHtml;
  if (compareState.left && lists.includes(compareState.left)) leftSel.value = compareState.left;
  if (compareState.right && lists.includes(compareState.right)) rightSel.value = compareState.right;
}

function renderCompareCell(p, side) {
  const st = problemStatus(p);
  const diffName = DIFF_NAMES[p.difficulty] || '?';
  const dotCls = 'cc-dot ' + (st === 'done' ? 'done' : (st === 'know' ? 'know' : ''));
  return '<div class="cc-dot-wrap" data-side="' + side + '" title="点击保留这边">' +
      '<span class="' + dotCls + '"></span>' +
    '</div>' +
    '<span class="cc-pid">' + escapeHtml(p.pid) + '</span>' +
    '<span class="cc-name" title="' + escapeHtml(p.name || '') + '">' + escapeHtml(p.name || '未知题目') + '</span>' +
    '<span class="cc-diff diff-' + (p.difficulty || 0) + '">' + escapeHtml(diffName) + '</span>';
}

function renderCompareResult() {
  const box = $('compareResult'); if (!box) return;
  if (!compareState.initialized) { box.innerHTML = '<div class="compare-empty">选择两个题单后点击中间按钮比对</div>'; return; }
  if (!compareState.matches.length) { box.innerHTML = '<div class="compare-empty">两个题单没有相同题目</div>'; return; }
  box.innerHTML = compareState.matches.map((m, idx) => {
    return '<div class="compare-row" data-idx="' + idx + '">' +
      '<div class="compare-cell" data-idx="' + idx + '">' + renderCompareCell(m.left, 'left') + '</div>' +
      '<div class="compare-cell" data-idx="' + idx + '">' + renderCompareCell(m.right, 'right') + '</div>' +
    '</div>';
  }).join('');
  box.querySelectorAll('.cc-dot-wrap').forEach(dotWrap => {
    dotWrap.addEventListener('click', () => {
      const cell = dotWrap.closest('.compare-cell');
      const idx = parseInt(cell.dataset.idx, 10);
      keepCompareSide(idx, dotWrap.dataset.side);
    });
  });
}

function keepCompareSide(idx, side) {
  const m = compareState.matches[idx]; if (!m) return;
  const deleteListName = side === 'left' ? compareState.right : compareState.left;
  const keepListName = side === 'left' ? compareState.left : compareState.right;
  const row = document.querySelector('.compare-row[data-idx="' + idx + '"]');
  const deletedList = data.lists[deleteListName];
  if (!deletedList) { showToast('目标题单不存在', 'warning'); return; }
  pushUndo();
  const beforeLen = deletedList.problems.length;
  deletedList.problems = deletedList.problems.filter(p => p.pid !== m.pid);
  if (deletedList.problems.length === beforeLen) { showToast('未找到要删除的题目', 'warning'); return; }
  saveData();
  const finish = () => {
    compareState.matches.splice(idx, 1);
    renderCompareResult();
    refreshCompareSelects();
    if (data.currentList === deleteListName || data.currentList === keepListName) renderAll();
  };
  if (row) { row.classList.add('fade-out'); setTimeout(finish, 260); }
  else { finish(); }
  showToast('已保留「' + keepListName + '」，从「' + deleteListName + '」删除「' + m.pid + '」', 'success');
}

function runCompare() {
  const leftSel = $('compareLeft'), rightSel = $('compareRight');
  if (!leftSel || !rightSel) return;
  const ln = leftSel.value, rn = rightSel.value;
  if (!ln || !rn) { showToast('请选择两个题单', 'warning'); return; }
  if (ln === rn) { showToast('不能选择同一个题单', 'warning'); return; }
  const L = data.lists[ln], R = data.lists[rn];
  if (!L || !R) return;
  const rMap = {};
  R.problems.forEach(p => { rMap[p.pid] = p; });
  const matches = [];
  L.problems.forEach(p => { if (rMap[p.pid]) matches.push({ pid:p.pid, left:p, right:rMap[p.pid] }); });
  compareState.left = ln; compareState.right = rn;
  compareState.matches = matches; compareState.initialized = true;
  renderCompareResult();
  if (matches.length === 0) showToast('两个题单没有相同题目', 'info');
  else showToast('找到 ' + matches.length + ' 道相同题目', 'success');
}

export function init(panelEl) {
  panelEl.querySelector('#compareBtn').addEventListener('click', runCompare);
  refreshCompareSelects();
  renderCompareResult();
}
export function activate() { refreshCompareSelects(); }