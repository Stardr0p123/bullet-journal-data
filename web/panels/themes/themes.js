import { $, escapeHtml, showToast, confirmDialog, openContextMenu, closeModal, hexToRgba, DIFF_NAMES, promptText } from '../../js/core.js';
import { uid } from '../../js/store.js';
import { themeData, BUILTIN_THEMES, THEME_EDIT_VARS, applyThemeById, saveThemeData, themePalette,
  BUILTIN_DIFF_PALETTES, getDiffPalette, applyDiffPalette } from '../../js/features/theme.js';

let editingThemeId = null;
let diffEditingId = null;

function safeColor(v, fallback) {
  const s = String(v == null ? '' : v).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^rgba?\([\d\s.,%]+\)$/i.test(s)) return s;
  if (/^hsla?\([\d\s.,%deg]+\)$/i.test(s)) return s;
  return fallback;
}
function glowOf(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? hexToRgba(color, 0.34) : 'transparent';
}

function themeCardHTML(t, isCustom) {
  const active = themeData.builtinId === t.id || themeData.customId === t.id;
  const pinned = themeData.pinned.includes(t.id);
  const p = themePalette(t, isCustom);
  const bg = safeColor(p.bg, '#d5dbe3');
  const surface = safeColor(p.surface, '#e6ebf0');
  const text = safeColor(p.text, '#1a2a3a');
  const muted = safeColor(p.muted, '#7a8a9a');
  const primary = safeColor(p.primary, '#5a8a9a');
  const accent = safeColor(p.accent, '#3a6a7a');
  const done = safeColor(p.done, '#61c454');
  const pending = safeColor(p.pending, '#9aa6b0');
  const kind = p.dark ? '深色' : '浅色';
  const style = '--tc-bg:' + bg + ';--tc-surface:' + surface + ';--tc-text:' + text + ';--tc-muted:' + muted +
    ';--tc-primary:' + primary + ';--tc-accent:' + accent + ';--tc-done:' + done + ';--tc-pending:' + pending +
    ';--tc-glow:' + glowOf(primary) + ';';

  const mini =
    '<div class="tc-mini">' +
      '<div class="tc-mini-side">' +
        '<span class="tc-mini-logo"></span>' +
        '<span class="tc-mini-nav active"></span><span class="tc-mini-nav"></span><span class="tc-mini-nav"></span>' +
      '</div>' +
      '<div class="tc-mini-main">' +
        '<div class="tc-mini-top"><span class="tc-mini-title"></span><span class="tc-mini-btn"></span></div>' +
        '<div class="tc-mini-row"><i class="tc-mini-dot" style="background:' + done + '"></i><i class="tc-mini-line" style="width:58%"></i><i class="tc-mini-pill" style="background:' + primary + '"></i></div>' +
        '<div class="tc-mini-row"><i class="tc-mini-dot" style="background:' + pending + '"></i><i class="tc-mini-line" style="width:72%"></i><i class="tc-mini-pill soft"></i></div>' +
        '<div class="tc-mini-row"><i class="tc-mini-dot" style="background:' + done + '"></i><i class="tc-mini-line" style="width:44%"></i><i class="tc-mini-pill" style="background:' + accent + '"></i></div>' +
      '</div>' +
    '</div>';

  return '<article class="theme-card' + (active ? ' active' : '') + (pinned ? ' pinned' : '') + '"' +
      ' data-theme-id="' + escapeHtml(t.id) + '" data-custom="' + (isCustom ? '1' : '0') + '"' +
      ' title="' + (active ? '当前主题' : '点击使用「' + escapeHtml(t.name) + '」') + '">' +
    '<div class="tc-preview" style="' + style + '">' + mini +
      (active ? '<span class="tc-active-badge"><i class="fas fa-check"></i> 已启用</span>' : '') +
      (pinned ? '<span class="tc-pin"><i class="fas fa-thumbtack"></i></span>' : '') +
      '<button class="tc-edit" data-edit="' + escapeHtml(t.id) + '" title="' + (isCustom ? '编辑主题' : '内置主题不可编辑') + '">' +
        (isCustom ? '<i class="fas fa-pen"></i>' : '<i class="fas fa-lock"></i>') + '</button>' +
    '</div>' +
    '<div class="tc-meta">' +
      '<div class="tc-meta-main">' +
        '<span class="tc-name">' + escapeHtml(t.name) + '</span>' +
        '<span class="tc-kind">' + kind + '</span>' +
      '</div>' +
      '<span class="tc-swatches" title="主色 / 背景 / 文字">' +
        '<i style="background:' + primary + '"></i><i style="background:' + bg + '"></i><i style="background:' + text + '"></i>' +
      '</span>' +
    '</div>' +
  '</article>';
}

function groupThemes(g) {
  return (g.themeIds || []).map(id => themeData.customThemes.find(t => t.id === id)).filter(Boolean);
}
function groupCardHTML(g) {
  const themes = groupThemes(g);
  const activeTheme = themes.find(t => t.id === themeData.customId);
  const selected = activeTheme ? activeTheme.id : (themes[0] ? themes[0].id : '');
  const p = themePalette(activeTheme || themes[0], true);
  const swatches = Array.from({ length: 8 }, (_, i) => {
    const t = themes[i];
    if (!t) return '<span class="tg-swatch" style="--tg-bg:var(--surface-hover);--tg-primary:transparent"></span>';
    const tp = themePalette(t, true);
    return '<span class="tg-swatch" style="--tg-bg:' + safeColor(tp.bg, '#222') + ';--tg-primary:' + safeColor(tp.primary, '#5a8a9a') + '"></span>';
  }).join('');
  const options = themes.map(t => '<option value="' + escapeHtml(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>').join('');
  return '<article class="theme-card group' + (activeTheme ? ' active' : '') + '" data-group-id="' + escapeHtml(g.id) + '" title="主题方案组">' +
    '<div class="tc-preview" style="--tc-bg:' + safeColor(p.bg, '#d5dbe3') + ';--tc-glow:' + glowOf(safeColor(p.primary, '#5a8a9a')) + '">' +
      '<div class="tg-preview-grid">' + swatches + '</div>' +
      (activeTheme ? '<span class="tc-active-badge"><i class="fas fa-check"></i> 已启用</span>' : '') +
    '</div>' +
    '<div class="tc-meta tg-meta">' +
      '<div class="tc-meta-main"><span class="tc-name">' + escapeHtml(g.name) + '</span><span class="tc-kind">' + (p.dark ? '深色' : '浅色') + ' · ' + themes.length + ' 套</span></div>' +
      '<select class="tg-select" data-group-select="' + escapeHtml(g.id) + '">' + options + '</select>' +
    '</div>' +
  '</article>';
}

function renderThemeGrid() {
  const grid = $('themeGrid'); if (!grid) return;
  const singles = themeData.customThemes.filter(t => !t.groupId);
  const entries = [];
  BUILTIN_THEMES.forEach(t => entries.push({ id:t.id, pinned:themeData.pinned.includes(t.id), html:themeCardHTML(t, false) }));
  singles.forEach(t => entries.push({ id:t.id, pinned:themeData.pinned.includes(t.id), html:themeCardHTML(t, true) }));
  themeData.themeGroups.forEach(g => entries.push({ id:g.id, pinned:false, html:groupCardHTML(g) }));
  entries.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  grid.innerHTML = entries.map(x => x.html).join('') +
    '<button class="theme-card theme-add" data-theme-action="import"><i class="fas fa-upload"></i><span>导入主题 / 方案组</span></button>' +
    '<button class="theme-card theme-add" data-theme-action="add"><i class="fas fa-plus"></i><span>添加主题</span></button>';

  const count = $('themeCount');
  if (count) count.textContent = BUILTIN_THEMES.length + ' 款内置 · ' + singles.length + ' 款自定义 · ' + themeData.themeGroups.length + ' 组';
  const cur = $('themeCurrent');
  if (cur) {
    let active = BUILTIN_THEMES.find(t => t.id === themeData.builtinId);
    if (!active) active = themeData.customThemes.find(t => t.id === themeData.customId);
    cur.textContent = active ? '当前：' + active.name : '当前：未选择';
  }
}

function openThemeEditor(id) {
  const t = themeData.customThemes.find(x => x.id === id);
  if (!t) { showToast('内置主题不可编辑', 'info'); return; }
  editingThemeId = id;
  $('editThemeName').textContent = '· ' + t.name;
  $('editThemeTitle').value = t.name;
  const html = document.documentElement;
  const getVar = k => {
    if (t.vars && t.vars[k]) return t.vars[k];
    if (k === 'primary-grad-from') return getComputedStyle(html).getPropertyValue('--primary').trim() || '#5a8a9a';
    if (k === 'primary-grad-to') return getComputedStyle(html).getPropertyValue('--primary-dark').trim() || '#3a6a7a';
    return getComputedStyle(html).getPropertyValue('--' + k).trim();
  };
  $('themeEditorRows').innerHTML = THEME_EDIT_VARS.map(v => {
    const val = getVar(v.key);
    const hex = /^#/.test(val) ? val : '#000000';
    return '<div class="theme-editor-row">' +
      '<label>' + v.name + '</label>' +
      '<input type="color" data-var="' + v.key + '" value="' + escapeHtml(hex) + '" />' +
      '<input type="text" data-var-text="' + v.key + '" value="' + escapeHtml(val) + '" />' +
    '</div>';
  }).join('');
  $('themeEditModal').classList.add('show');
}

function saveThemeEditor() {
  const t = themeData.customThemes.find(x => x.id === editingThemeId);
  if (!t) return;
  const title = $('editThemeTitle').value.trim();
  if (title) t.name = title;
  // 以文本输入为准：颜色选择器无法表示 rgba()，直接读 color input 会把半透明色存成 #000000
  const vars = {};
  $('themeEditorRows').querySelectorAll('input[data-var-text]').forEach(inp => {
    const key = inp.dataset.varText;
    const v = String(inp.value || '').trim();
    if (key && v) vars[key] = v;
  });
  t.vars = vars;
  if (vars['primary-grad-from'] || vars['primary-grad-to']) {
    const f = vars['primary-grad-from'] || '#5a8a9a';
    const to = vars['primary-grad-to'] || '#3a6a7a';
    t.preview = 'linear-gradient(135deg,' + f + ',' + to + ')';
  }
  if (vars.text) t.text = vars.text;
  themeData.customId = t.id; themeData.builtinId = null;
  saveThemeData();
  applyThemeById(t.id, true);
  renderThemeGrid();          // ← 修复：名称 / 预览色变化立即同步到网格
  closeModal('themeEditModal');
  showToast('主题已保存', 'success');
}

function exportTheme(themeId) {
  const t = themeData.customThemes.find(x => x.id === themeId) || BUILTIN_THEMES.find(x => x.id === themeId);
  if (!t) return;
  const isCustom = themeData.customThemes.some(x => x.id === themeId);
  const pack = { version:1, name:t.name, base:isCustom ? (t.base || 'default-light') : themeId, vars:isCustom ? (t.vars || {}) : {} };
  const content = JSON.stringify(pack, null, 2);
  const fileName = '主题_' + t.name + '.json';
  if (window.electronAPI && window.electronAPI.saveFile) {
    window.electronAPI.saveFile(fileName, content).then(r => showToast('已导出 → ' + r.path, 'success')).catch(e => showToast('导出失败：' + e.message, 'error'));
  } else {
    const blob = new Blob([content], { type:'application/json' });
    const u = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = u; a.download = fileName; a.click(); URL.revokeObjectURL(u);
    showToast('已导出', 'success');
  }
}

function downloadJSON(fileName, content) {
  if (window.electronAPI && window.electronAPI.saveFile) {
    window.electronAPI.saveFile(fileName, content).then(r => showToast('已导出 → ' + r.path, 'success')).catch(e => showToast('导出失败：' + e.message, 'error'));
  } else {
    const blob = new Blob([content], { type:'application/json' });
    const u = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = u; a.download = fileName; a.click(); URL.revokeObjectURL(u);
    showToast('已导出', 'success');
  }
}
function exportThemeGroup(gid) {
  const g = themeData.themeGroups.find(x => x.id === gid); if (!g) return;
  const pack = {
    version: 1, type: 'theme-pack', name: g.name, description: '',
    themes: groupThemes(g).map(t => ({ version:1, name:t.name, base:t.base, preview:t.preview, text:t.text, vars:t.vars || {} }))
  };
  downloadJSON('主题组_' + g.name + '.json', JSON.stringify(pack, null, 2));
}
function addThemesToGroup(themes, groupName) {
  const gid = uid('tg');
  const ids = [];
  themes.forEach(t => {
    if (!t || !t.name) return;
    const id = uid('ct');
    themeData.customThemes.push({
      id, name: String(t.name), base: t.base || 'default-light', vars: t.vars || {},
      preview: t.preview || 'linear-gradient(135deg,#888,#555)', text: t.text || '#333', groupId: gid
    });
    ids.push(id);
  });
  if (!ids.length) throw new Error('没有有效主题');
  themeData.themeGroups.push({ id: gid, name: groupName || '导入主题组', themeIds: ids });
  return ids.length;
}
function importThemeFile(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imp = JSON.parse(ev.target.result);
      const pack = Array.isArray(imp) ? { name:'导入主题组', themes:imp } : (imp && Array.isArray(imp.themes) ? imp : null);
      if (pack) {
        const n = addThemesToGroup(pack.themes, pack.name || '导入主题组');
        saveThemeData(); renderThemeGrid();
        showToast('已导入方案组（' + n + ' 套）', 'success');
        return;
      }
      if (!imp || !imp.name) throw new Error('格式错误');
      const id = uid('ct');
      themeData.customThemes.push({
        id, name:imp.name + ' (导入)', base:imp.base || 'default-light', vars:imp.vars || {},
        preview:imp.preview || 'linear-gradient(135deg,#888,#555)', text:imp.text || '#333', groupId:null
      });
      saveThemeData(); renderThemeGrid();
      showToast('已导入主题', 'success');
    } catch (err) { showToast('导入失败：' + err.message, 'error'); }
  };
  reader.readAsText(f);
}

function addCustomTheme() {
  const base = themeData.builtinId || 'default-light';
  const bt = BUILTIN_THEMES.find(x => x.id === base) || BUILTIN_THEMES[0];
  const name = '我的主题 ' + (themeData.customThemes.length + 1);
  const t = { id:uid('ct'), name, base, vars:{ 'primary-grad-from':bt.gradFrom, 'primary-grad-to':bt.gradTo }, preview:bt.preview, text:'#1a2a3a' };
  themeData.customThemes.push(t);
  saveThemeData();
  renderThemeGrid();          // ← 修复：新建后立即渲染网格，新卡片马上出现
  openThemeEditor(t.id);
}

function renderDiffPaletteGrid() {
  const grid = $('diffPaletteGrid'); if (!grid) return;
  const all = [
    ...BUILTIN_DIFF_PALETTES.map(p => ({ p, builtin:true })),
    ...themeData.diffPalettes.map(p => ({ p, builtin:false }))
  ];
  grid.innerHTML = all.map(({ p, builtin }) => {
    const active = themeData.diffPaletteId === p.id;
    const colors = (p.colors || []).slice(0, 9);
    return '<article class="diff-palette-card' + (active ? ' active' : '') + '" data-dp="' + escapeHtml(p.id) + '" data-builtin="' + (builtin ? '1' : '0') + '">' +
      '<div class="dp-colors">' + colors.map(c => '<i style="background:' + escapeHtml(c) + '"></i>').join('') + '</div>' +
      '<div class="dp-meta"><span class="dp-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="dp-kind">' + (builtin ? '内置' : '自定义') + '</span>' +
        (active ? '<span class="dp-check">✓</span>' : '') + '</div>' +
    '</article>';
  }).join('') +
    '<button class="diff-palette-card dp-add" data-dp-action="import"><i class="fas fa-upload"></i> 导入配色</button>' +
    '<button class="diff-palette-card dp-add" data-dp-action="add"><i class="fas fa-plus"></i> 新建配色</button>';
  const cnt = $('diffPaletteCount');
  if (cnt) cnt.textContent = BUILTIN_DIFF_PALETTES.length + ' 组内置 · ' + themeData.diffPalettes.length + ' 组自定义';
}
function openDiffEditor(id) {
  const p = id ? getDiffPalette(id) : null;
  const builtin = id ? BUILTIN_DIFF_PALETTES.some(x => x.id === id) : false;
  const colors = (p && p.colors ? p.colors : BUILTIN_DIFF_PALETTES[0].colors).slice(0, 9);
  diffEditingId = (p && !builtin) ? p.id : null;
  $('diffPaletteModalTitle').textContent = diffEditingId ? '编辑难度配色' : '新建难度配色';
  $('diffPaletteName').value = builtin ? (p.name + ' 副本') : (p ? p.name : '我的配色');
  $('diffPaletteEditor').innerHTML = colors.map((c, i) =>
    '<label class="dp-editor-row"><span>' + DIFF_NAMES[i] + '</span><input type="color" data-dp-color value="' + escapeHtml(/^#[0-9a-f]{6}$/i.test(c) ? c : '#888888') + '" /></label>'
  ).join('');
  $('diffPaletteModal').classList.add('show');
}
function saveDiffEditor() {
  const name = $('diffPaletteName').value.trim() || '未命名配色';
  const colors = Array.from($('diffPaletteEditor').querySelectorAll('input[data-dp-color]')).map(i => i.value);
  if (colors.length < 9) return;
  let p = diffEditingId ? themeData.diffPalettes.find(x => x.id === diffEditingId) : null;
  if (!p) { p = { id: uid('dp'), name, colors }; themeData.diffPalettes.push(p); }
  else { p.name = name; p.colors = colors; }
  applyDiffPalette(p.id);
  saveThemeData(); renderDiffPaletteGrid(); renderThemeGrid();
  closeModal('diffPaletteModal');
  showToast('难度配色已保存', 'success');
}
function exportDiffPalette(id) {
  const p = getDiffPalette(id); if (!p) return;
  downloadJSON('难度配色_' + p.name + '.json', JSON.stringify({ version:1, name:p.name, colors:p.colors }, null, 2));
}
function importDiffFile(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imp = JSON.parse(ev.target.result);
      const list = Array.isArray(imp) ? imp : (Array.isArray(imp.palettes) ? imp.palettes : [imp]);
      let n = 0;
      list.forEach(p => {
        if (!p || !p.name || !Array.isArray(p.colors) || p.colors.length < 9) return;
        themeData.diffPalettes.push({ id: uid('dp'), name: String(p.name), colors: p.colors.slice(0, 9) });
        n++;
      });
      if (!n) throw new Error('没有有效配色');
      saveThemeData(); renderDiffPaletteGrid();
      showToast('已导入 ' + n + ' 组难度配色', 'success');
    } catch (err) { showToast('导入失败：' + err.message, 'error'); }
  };
  reader.readAsText(f);
}

export function init(panelEl) {
  panelEl.querySelector('#themeGrid').addEventListener('click', e => {
    const action = e.target.closest('[data-theme-action]');
    if (action) {
      if (action.dataset.themeAction === 'import') $('themeFileInput').click();
      else addCustomTheme();
      return;
    }
    const editBtn = e.target.closest('.tc-edit');
    if (editBtn) {
      e.stopPropagation();
      const id = editBtn.dataset.edit;
      const isCustom = themeData.customThemes.some(x => x.id === id);
      if (!isCustom) { showToast('内置主题不可编辑，可先「添加主题」基于它创建', 'info'); return; }
      openThemeEditor(id); return;
    }
    const card = e.target.closest('.theme-card'); if (!card) return;
    if (e.target.closest('.tg-select')) return;
    if (card.dataset.groupId) {
      const gid = card.dataset.groupId;
      const g = themeData.themeGroups.find(x => x.id === gid); if (!g) return;
      const sel = card.querySelector('.tg-select');
      const tid = (sel && sel.value) || (g.themeIds || [])[0];
      if (!tid) return;
      applyThemeById(tid, true);
      renderThemeGrid();
      showToast('已切换方案组主题', 'success');
      return;
    }
    const id = card.dataset.themeId;
    const isCustom = card.dataset.custom === '1';
    applyThemeById(id, isCustom);
    renderThemeGrid();
    showToast('已切换主题', 'success');
  });
  panelEl.querySelector('#themeGrid').addEventListener('change', e => {
    const sel = e.target.closest('.tg-select'); if (!sel) return;
    applyThemeById(sel.value, true);
    renderThemeGrid();
    showToast('已切换方案组主题', 'success');
  });
  panelEl.querySelector('#themeGrid').addEventListener('contextmenu', e => {
    const card = e.target.closest('.theme-card'); if (!card || card.dataset.themeAction) return;
    e.preventDefault();
    if (card.dataset.groupId) {
      const gid = card.dataset.groupId;
      const g = themeData.themeGroups.find(x => x.id === gid); if (!g) return;
      openContextMenu(e.clientX, e.clientY, [
        { act:'rename', icon:'fa-pen', label:'重命名方案组', run: async () => {
          const name = await promptText('重命名方案组', g.name);
          if (name == null) return;
          const t = name.trim(); if (!t) return;
          g.name = t; saveThemeData(); renderThemeGrid();
        } },
        { act:'export', icon:'fa-download', label:'导出方案组', run:() => exportThemeGroup(gid) },
        { sep:true },
        { act:'del', icon:'fa-trash-alt', label:'删除方案组', danger:true, run:() => {
          confirmDialog('删除方案组', '删除方案组 <strong>' + escapeHtml(g.name) + '</strong> 及其全部主题？').then(ok => {
            if (!ok) return;
            const ids = g.themeIds || [];
            themeData.customThemes = themeData.customThemes.filter(x => ids.indexOf(x.id) === -1);
            themeData.themeGroups = themeData.themeGroups.filter(x => x.id !== gid);
            themeData.pinned = themeData.pinned.filter(x => ids.indexOf(x) === -1);
            if (ids.indexOf(themeData.customId) !== -1) { themeData.customId = null; themeData.builtinId = 'default-light'; applyThemeById('default-light', false); }
            saveThemeData(); renderThemeGrid();
          });
        } }
      ]);
      return;
    }
    const id = card.dataset.themeId;
    const isCustom = card.dataset.custom === '1';
    const pinned = themeData.pinned.includes(id);
    const items = [
      { act:'pin', icon:'fa-thumbtack', label:pinned ? '取消置顶' : '置顶', run:() => {
        if (pinned) themeData.pinned = themeData.pinned.filter(x => x !== id);
        else themeData.pinned.push(id);
        saveThemeData(); renderThemeGrid();
      } },
      { act:'export', icon:'fa-download', label:'导出主题', run:() => exportTheme(id) }
    ];
    if (isCustom) {
      items.push({ sep:true });
      items.push({ act:'edit', icon:'fa-pen', label:'编辑主题', run:() => openThemeEditor(id) });
      items.push({ act:'del', icon:'fa-trash-alt', label:'删除主题', danger:true, run:() => {
        confirmDialog('删除主题', '删除自定义主题？').then(ok => {
          if (!ok) return;
          themeData.customThemes = themeData.customThemes.filter(x => x.id !== id);
          themeData.pinned = themeData.pinned.filter(x => x !== id);
          if (themeData.customId === id) { themeData.customId = null; themeData.builtinId = 'default-light'; applyThemeById('default-light', false); }
          saveThemeData(); renderThemeGrid();
        });
      } });
    }
    openContextMenu(e.clientX, e.clientY, items);
  });
  panelEl.querySelector('#themeFileInput').addEventListener('change', importThemeFile);

  $('themeEditorRows').addEventListener('input', e => {
    if (e.target.dataset.var) {
      const txt = $('themeEditorRows').querySelector('input[data-var-text="' + e.target.dataset.var + '"]');
      if (txt) txt.value = e.target.value;
    } else if (e.target.dataset.varText) {
      const c = $('themeEditorRows').querySelector('input[data-var="' + e.target.dataset.varText + '"]');
      if (c && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) c.value = e.target.value;
    }
  });
  $('themeEditSaveBtn').addEventListener('click', saveThemeEditor);

  panelEl.querySelector('#diffPaletteGrid').addEventListener('click', e => {
    const action = e.target.closest('[data-dp-action]');
    if (action) {
      if (action.dataset.dpAction === 'import') $('diffPaletteFileInput').click();
      else openDiffEditor(null);
      return;
    }
    const card = e.target.closest('.diff-palette-card'); if (!card) return;
    applyDiffPalette(card.dataset.dp);
    renderDiffPaletteGrid();
    showToast('已切换难度配色', 'success');
  });
  panelEl.querySelector('#diffPaletteGrid').addEventListener('contextmenu', e => {
    const card = e.target.closest('.diff-palette-card'); if (!card) return;
    const id = card.dataset.dp; if (!id) return;
    e.preventDefault();
    const builtin = card.dataset.builtin === '1';
    const items = [{ act:'export', icon:'fa-download', label:'导出配色', run:() => exportDiffPalette(id) }];
    if (!builtin) {
      items.push({ sep:true });
      items.push({ act:'edit', icon:'fa-pen', label:'编辑配色', run:() => openDiffEditor(id) });
      items.push({ act:'del', icon:'fa-trash-alt', label:'删除配色', danger:true, run:() => {
        confirmDialog('删除难度配色', '删除这组自定义难度配色？').then(ok => {
          if (!ok) return;
          themeData.diffPalettes = themeData.diffPalettes.filter(x => x.id !== id);
          if (themeData.diffPaletteId === id) applyDiffPalette('default');
          saveThemeData(); renderDiffPaletteGrid();
        });
      } });
    }
    openContextMenu(e.clientX, e.clientY, items);
  });
  panelEl.querySelector('#diffPaletteFileInput').addEventListener('change', importDiffFile);
  $('diffPaletteSaveBtn').addEventListener('click', saveDiffEditor);

  renderThemeGrid();
  renderDiffPaletteGrid();
}
export function activate() { renderThemeGrid(); renderDiffPaletteGrid(); }