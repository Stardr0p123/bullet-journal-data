// panels/tricks/tricks.js —— Trick 库：展开式卡片 + 例子题定位
import { escapeHtml, showToast, confirmDialog, hexToRgba } from '../../js/core.js';
import { renderMarkdown, renderInlineMultiline } from '../../js/features/markdown.js';
import { onCodexChange, sortedTricks, saveTrick, deleteTrick, TRICK_SWATCHES } from '../../js/features/codex-store.js';
import { data, goToProblem } from '../../js/app.js';

let host = null;
let editingId = null;
let pickingColor = '#5a8a9a';
let exampleSel = null;
let searchTimer = 0;
const expandedIds = new Set();

/** 用 KaTeX 渲染内容里的 $...$ / $$...$$ 公式（KaTeX 由本地 vendor 提供） */
function typesetMath(root) {
  if (!root || typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false }
      ],
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
    });
  } catch (e) { console.warn('[katex]', e); }
}

/* ============================================================
   列表渲染
   ============================================================ */
function fieldHTML(label, bodyHTML, cls) {
  return '<div class="tk-field ' + (cls || '') + '">' +
    '<span class="tk-flabel">' + label + '</span>' +
    '<div class="tk-fbody">' + bodyHTML + '</div>' +
  '</div>';
}

function exampleHTML(t) {
  const ex = t.example;
  if (!ex || !ex.pid) return '<span class="tk-none">未设置例子题</span>';
  const label = ex.name ? (ex.name + ' · ') : '';
  return '<a class="tk-example" data-tk-example="' + t.id + '" title="定位到题单原位置">' +
    '<i class="fas fa-location-arrow"></i>' + escapeHtml(label) + '<b>' + escapeHtml(ex.pid) + '</b>' +
  '</a>';
}

function cardHTML(t) {
  const color = t.color || '#5a8a9a';
  const open = expandedIds.has(t.id);
  const note = String(t.note || '').trim();
  return '<article class="tk-card' + (open ? ' open' : '') + '" data-tid="' + t.id + '" style="' +
      '--tk:' + color + ';' +
      '--tk-soft:' + hexToRgba(color, 0.10) + ';' +
      '--tk-line:' + hexToRgba(color, 0.42) + ';' +
      '--tk-glow:' + hexToRgba(color, 0.22) + ';">' +
    '<header class="tk-head" data-tk-toggle role="button" tabindex="0" title="展开 / 收起">' +
      '<span class="tk-dot"></span>' +
      '<span class="tk-title">' + escapeHtml(t.feature || '未命名 Trick') + '</span>' +
      '<span class="tk-head-tools">' +
        '<button class="tk-mini" data-tk-edit title="编辑"><i class="fas fa-pen"></i></button>' +
        '<button class="tk-mini danger" data-tk-del title="删除"><i class="fas fa-trash-alt"></i></button>' +
      '</span>' +
      '<span class="tk-caret"><i class="fas fa-chevron-down"></i></span>' +
    '</header>' +
    '<div class="tk-body">' +
      fieldHTML('关键性质', renderInlineMultiline(t.feature), 'tk-f-feature') +
      fieldHTML('转化点', renderInlineMultiline(t.transform), 'tk-f-trans') +
      '<div class="tk-pair">' +
        fieldHTML('相关算法', renderInlineMultiline(t.algo), 'tk-f-algo') +
        fieldHTML('例子题', exampleHTML(t), 'tk-f-example') +
      '</div>' +
      fieldHTML('注释', note ? '<div class="tk-md">' + renderMarkdown(note) + '</div>' : '<span class="tk-none">—</span>', 'tk-f-note') +
    '</div>' +
  '</article>';
}

function render() {
  if (!host) return;
  const list = host.querySelector('#trickList');
  if (!list) return;
  const all = sortedTricks();
  if (!all.length) {
    list.innerHTML = '<div class="ck-empty">' +
      '<div class="ck-empty-icon"><i class="fas fa-lightbulb"></i></div>' +
      '<h3>Trick 库还是空的</h3>' +
      '<p>把「看到什么性质 → 怎么转化 → 用什么算法」记下来，下次遇到同构题就能秒接。</p>' +
    '</div>';
    return;
  }
  list.innerHTML = '<div class="ck-sect">' +
      '<span class="ck-sect-label"><i class="fas fa-lightbulb"></i> 全部 Trick</span>' +
      '<span class="ck-sect-hint">点击卡片展开 · 共 ' + all.length + ' 条</span>' +
    '</div>' +
    all.map(cardHTML).join('');

  typesetMath(list);
  bindList(list);
}

function bindList(list) {
  if (list._tkBound) return;
  list._tkBound = true;
  list.addEventListener('click', e => {
    const card = e.target.closest('.tk-card');
    if (!card) return;

    const a = e.target.closest('a[href]');
    if (a && !a.closest('[data-tk-example]')) {
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) window.open(href, '_blank');
      return;
    }

    const ex = e.target.closest('[data-tk-example]');
    if (ex) {
      e.preventDefault(); e.stopPropagation();
      const t = sortedTricks().find(x => x.id === ex.dataset.tkExample);
      if (!t || !t.example) { showToast('这条 Trick 还没有例子题', 'info'); return; }
      const still = data.lists[t.example.listName] && (data.lists[t.example.listName].problems || [])
        .some(p => p.pid === t.example.pid);
      if (!still) { showToast('例子题已不在题单中（可能被删除或移走）', 'warning'); return; }
      goToProblem(t.example.listName, t.example.pid);
      return;
    }

    const edit = e.target.closest('[data-tk-edit]');
    if (edit) { e.stopPropagation(); openModal(card.dataset.tid); return; }

    const del = e.target.closest('[data-tk-del]');
    if (del) {
      e.stopPropagation();
      const id = card.dataset.tid;
      const t = sortedTricks().find(x => x.id === id);
      confirmDialog('<i class="fas fa-trash-alt" style="color:var(--danger)"></i> 删除 Trick',
        '删除「<strong>' + escapeHtml((t && t.feature) || '这条 Trick') + '</strong>」？').then(ok => {
        if (!ok) return;
        expandedIds.delete(id);
        deleteTrick(id);
        showToast('已删除', 'info');
      });
      return;
    }

    if (e.target.closest('[data-tk-toggle]') || !e.target.closest('.tk-body')) {
      const id = card.dataset.tid;
      if (expandedIds.has(id)) { expandedIds.delete(id); card.classList.remove('open'); }
      else { expandedIds.add(id); card.classList.add('open'); }
    }
  });

  list.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const head = e.target.closest('[data-tk-toggle]');
    if (!head) return;
    e.preventDefault();
    head.click();
  });
}

/* ============================================================
   编辑弹窗
   ============================================================ */
function colorRowHTML() {
  return TRICK_SWATCHES.map(c =>
    '<button type="button" class="tk-swatch" data-color="' + c + '" style="--sw:' + c + '" title="' + c + '"></button>'
  ).join('');
}

function syncSwatches() {
  const wrap = document.getElementById('trickSwatches');
  if (!wrap) return;
  if (!wrap.dataset.built) { wrap.innerHTML = colorRowHTML(); wrap.dataset.built = '1'; }
  wrap.querySelectorAll('.tk-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color.toLowerCase() === String(pickingColor).toLowerCase());
  });
}

/* ---------- 例子题选择器 ---------- */
function listLabelOf(listName) {
  const l = data.lists[listName];
  return (l && l.name) || listName;
}

function searchProblems(q) {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  const out = [];
  const lists = data.lists || {};
  for (const listName of Object.keys(lists)) {
    const l = lists[listName];
    if (!l) continue;
    for (const p of (l.problems || [])) {
      if (!p || !p.pid) continue;
      const hay = (p.pid + ' ' + (p.name || '')).toLowerCase();
      if (!hay.includes(key)) continue;
      out.push({ listName, listLabel: listLabelOf(listName), pid: p.pid, name: p.name || '' });
      if (out.length >= 30) return out;
    }
  }
  return out;
}

function syncExampleSel() {
  const box = document.getElementById('trickExampleSel');
  if (!box) return;
  if (!exampleSel) {
    box.innerHTML = '<span class="tk-none">未选择例子题（可选）</span>';
    return;
  }
  box.innerHTML = '<span class="tk-ex-chip" title="' + escapeHtml(exampleSel.listLabel + ' · ' + exampleSel.name) + '">' +
    '<i class="fas fa-location-arrow"></i>' +
    '<span class="tk-ex-chip-name">' + escapeHtml(exampleSel.name || exampleSel.pid) + '</span>' +
    '<b>' + escapeHtml(exampleSel.pid) + '</b>' +
    '<span class="tk-ex-chip-list">' + escapeHtml(exampleSel.listLabel) + '</span>' +
    '<button type="button" data-ex-clear title="清除"><i class="fas fa-times"></i></button>' +
  '</span>';
}

function renderExampleResults() {
  const box = document.getElementById('trickExampleResults');
  const inp = document.getElementById('trickExampleSearch');
  if (!box || !inp) return;
  const q = inp.value.trim();
  if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
  const rows = searchProblems(q);
  if (!rows.length) {
    box.innerHTML = '<div class="tk-ex-empty">没有找到匹配的题目</div>';
    box.classList.add('show');
    return;
  }
  box.innerHTML = rows.map(r =>
    '<div class="tk-ex-item" data-ex-pick="1" data-list="' + escapeHtml(r.listName) + '" data-pid="' + escapeHtml(r.pid) + '" data-name="' + escapeHtml(r.name) + '">' +
      '<span class="pid">' + escapeHtml(r.pid) + '</span>' +
      '<span class="nm">' + escapeHtml(r.name || '（无题名）') + '</span>' +
      '<span class="ln">' + escapeHtml(r.listLabel) + '</span>' +
    '</div>'
  ).join('');
  box.classList.add('show');
}

function bindExamplePicker() {
  const inp = document.getElementById('trickExampleSearch');
  const box = document.getElementById('trickExampleResults');
  const sel = document.getElementById('trickExampleSel');
  if (!inp || !box || !sel) return;

  inp.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderExampleResults, 120);
  });
  inp.addEventListener('focus', () => { if (inp.value.trim()) renderExampleResults(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') { box.classList.remove('show'); inp.blur(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = box.querySelector('[data-ex-pick]');
      if (first) first.click();
    }
  });

  box.addEventListener('click', e => {
    const it = e.target.closest('[data-ex-pick]');
    if (!it) return;
    e.preventDefault(); e.stopPropagation();
    exampleSel = {
      listName: it.dataset.list,
      pid: it.dataset.pid,
      name: it.dataset.name,
      listLabel: listLabelOf(it.dataset.list)
    };
    syncExampleSel();
    inp.value = '';
    box.classList.remove('show');
    box.innerHTML = '';
  });

  sel.addEventListener('click', e => {
    if (!e.target.closest('[data-ex-clear]')) return;
    exampleSel = null;
    syncExampleSel();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.tk-ex-picker')) box.classList.remove('show');
  });
}

function openModal(id) {
  const modal = document.getElementById('trickModal');
  if (!modal) return;
  const t = id ? sortedTricks().find(x => x.id === id) : null;
  editingId = t ? t.id : null;
  pickingColor = t ? (t.color || '#5a8a9a') : '#5a8a9a';
  const ex = t && t.example ? t.example : null;
  exampleSel = ex ? {
    listName: ex.listName,
    pid: ex.pid,
    name: ex.name || '',
    listLabel: listLabelOf(ex.listName)
  } : null;

  document.getElementById('trickModalTitle').textContent = t ? '编辑 Trick' : '添加 Trick';
  document.getElementById('trickKey').value = t ? (t.feature || '') : '';
  document.getElementById('trickTransform').value = t ? (t.transform || '') : '';
  document.getElementById('trickAlgo').value = t ? (t.algo || '') : '';
  document.getElementById('trickNote').value = t ? (t.note || '') : '';
  document.getElementById('trickPriority').value = t ? (t.priority || 1) : 1;
  document.getElementById('trickColor').value = pickingColor;
  const search = document.getElementById('trickExampleSearch');
  if (search) search.value = '';
  const results = document.getElementById('trickExampleResults');
  if (results) { results.innerHTML = ''; results.classList.remove('show'); }
  syncSwatches();
  syncExampleSel();

  modal.classList.add('show');
  setTimeout(() => {
    const el = document.getElementById('trickKey');
    if (el) el.focus();
  }, 160);
}

function save() {
  const feature = document.getElementById('trickKey').value.trim();
  const transform = document.getElementById('trickTransform').value.trim();
  const algo = document.getElementById('trickAlgo').value.trim();
  const note = document.getElementById('trickNote').value;
  const color = document.getElementById('trickColor').value || '#5a8a9a';
  let priority = parseInt(document.getElementById('trickPriority').value, 10);
  if (isNaN(priority) || priority < 1) priority = 1;

  if (!feature) { showToast('关键性质不能为空', 'warning'); document.getElementById('trickKey').focus(); return; }
  if (!algo) { showToast('相关算法不能为空', 'warning'); document.getElementById('trickAlgo').focus(); return; }

  const example = exampleSel && exampleSel.pid
    ? { listName: exampleSel.listName, pid: exampleSel.pid, name: exampleSel.name || '' }
    : null;

  saveTrick(editingId, { feature, transform, algo, note, color, priority, example });
  document.getElementById('trickModal').classList.remove('show');
  showToast(editingId ? '已更新 Trick' : '已加入 Trick 库', 'success');
  editingId = null;
}

function bindModal() {
  const modal = document.getElementById('trickModal');
  if (!modal || modal._bound) return;
  modal._bound = true;

  const colorInput = document.getElementById('trickColor');
  colorInput.addEventListener('input', () => { pickingColor = colorInput.value; syncSwatches(); });

  const swatches = document.getElementById('trickSwatches');
  swatches.addEventListener('click', e => {
    const sw = e.target.closest('.tk-swatch'); if (!sw) return;
    pickingColor = sw.dataset.color;
    colorInput.value = pickingColor;
    syncSwatches();
  });

  document.getElementById('trickSaveBtn').addEventListener('click', save);
  modal.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.id !== 'trickExampleSearch') {
      e.preventDefault(); save();
    }
  });

  bindExamplePicker();
}

/* ============================================================
   生命周期
   ============================================================ */
export function init(panelEl) {
  host = panelEl;
  bindModal();
  // 添加按钮已在 #codexHeadActions 中，不在 panel 内
  const addBtn = document.getElementById('trickAddBtn');
  if (addBtn && !addBtn._bound) {
    addBtn._bound = true;
    addBtn.addEventListener('click', () => openModal(null));
  }
  onCodexChange(scope => { if (scope === 'tricks') render(); });
  render();
}

export function activate() { render(); }
