// js/features/theme.js —— 主题 / 字体 / 字号 / 难度配色
import { lsGet, lsSet, DIFF_COLORS } from '../core.js';

export const THEME_DATA_KEY = 'theme_data_v2';
export const FONT_KEY = 'font_preference';
export const FSIZE_KEY = 'fontsize_preference';

export const BUILTIN_THEMES = [
  { id:'default-light',    name:'莫兰迪·浅',        preview:'linear-gradient(135deg,#5a8a9a,#3a6a7a)', gradFrom:'#5a8a9a', gradTo:'#3a6a7a',
    palette:{ dark:false, bg:'#d5dbe3', surface:'#e6ebf0', text:'#1a2a3a', muted:'#7a8a9a', primary:'#5a8a9a', accent:'#3a6a7a', done:'#61c454', pending:'#9aa6b0' } },
  { id:'default-dark',     name:'莫兰迪·深',        preview:'linear-gradient(135deg,#5a8a9a,#3a6a7a)', gradFrom:'#5a8a9a', gradTo:'#3a6a7a',
    palette:{ dark:true, bg:'#141a1e', surface:'#2a3238', text:'#e8ecf0', muted:'#7a8a92', primary:'#5a8a9a', accent:'#3a6a7a', done:'#61c454', pending:'#5c6a76' } },
  { id:'catppuccin-latte', name:'Catppuccin Latte', preview:'linear-gradient(135deg,#1e66f5,#179299)', gradFrom:'#1e66f5', gradTo:'#179299',
    palette:{ dark:false, bg:'#eff1f5', surface:'#ffffff', text:'#4c4f69', muted:'#8c8fa1', primary:'#1e66f5', accent:'#179299', done:'#40a02b', pending:'#9ca0b0' } },
  { id:'catppuccin-mocha', name:'Catppuccin Mocha', preview:'linear-gradient(135deg,#89b4fa,#94e2d5)', gradFrom:'#89b4fa', gradTo:'#94e2d5',
    palette:{ dark:true, bg:'#1e1e2e', surface:'#24243a', text:'#cdd6f4', muted:'#7f849c', primary:'#89b4fa', accent:'#94e2d5', done:'#a6e3a1', pending:'#6c7086' } },
  { id:'nord',             name:'Nord',             preview:'linear-gradient(135deg,#88c0d0,#81a1c1)', gradFrom:'#88c0d0', gradTo:'#81a1c1',
    palette:{ dark:true, bg:'#2e3440', surface:'#3b4252', text:'#eceff4', muted:'#7b8a9c', primary:'#88c0d0', accent:'#81a1c1', done:'#a3be8c', pending:'#4c566a' } },
  { id:'solarized-light',  name:'Solarized Light',  preview:'linear-gradient(135deg,#268bd2,#2aa198)', gradFrom:'#268bd2', gradTo:'#2aa198',
    palette:{ dark:false, bg:'#fdf6e3', surface:'#fffbf0', text:'#073642', muted:'#93a1a1', primary:'#268bd2', accent:'#2aa198', done:'#859900', pending:'#93a1a1' } },
  { id:'solarized-dark',   name:'Solarized Dark',   preview:'linear-gradient(135deg,#268bd2,#2aa198)', gradFrom:'#268bd2', gradTo:'#2aa198',
    palette:{ dark:true, bg:'#002b36', surface:'#073642', text:'#eee8d5', muted:'#6c8a8a', primary:'#268bd2', accent:'#2aa198', done:'#859900', pending:'#586e75' } },
  { id:'oled',             name:'纯黑 OLED',        preview:'linear-gradient(135deg,#5ac8fa,#30d158)', gradFrom:'#5ac8fa', gradTo:'#30d158',
    palette:{ dark:true, bg:'#000000', surface:'#0a0a0a', text:'#f5f5f7', muted:'#6e6e73', primary:'#5ac8fa', accent:'#30d158', done:'#30d158', pending:'#48484a' } }
];

/** 取主题用于预览卡片的调色板（自定义主题继承 base 并覆盖已定义变量） */
export function themePalette(t, isCustom) {
  if (!t) return BUILTIN_THEMES[0].palette;
  if (!isCustom && t.palette) return t.palette;
  const base = BUILTIN_THEMES.find(x => x.id === (t.base || 'default-light')) || BUILTIN_THEMES[0];
  const p = Object.assign({}, base.palette);
  const v = t.vars || {};
  if (v.primary) p.primary = v.primary;
  if (v['primary-grad-to']) p.accent = v['primary-grad-to'];
  if (v['bg-start']) p.bg = v['bg-start'];
  if (v['glass-bg']) p.surface = v['glass-bg'];
  if (v.text) p.text = v.text;
  if (v['text-muted']) p.muted = v['text-muted'];
  if (v['dot-done']) p.done = v['dot-done'];
  if (v['dot-pending']) p.pending = v['dot-pending'];
  if (v['bg-start']) {
    const bg = String(v['bg-start']).trim();
    if (/^#[0-9a-f]{6}$/i.test(bg)) {
      const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
      p.dark = (r * 299 + g * 587 + b * 114) / 1000 < 128;
    }
  }
  return p;
}

export const BUILTIN_DIFF_PALETTES = [
  { id:'default', name:'默认', colors:['#AAAAAA','#d44141','#e68d3a','#d4c62a','#47c49a','#58c1d1','#648fec','#a482db','#2863bb'] },
  { id:'pastel',  name:'淡彩', colors:['#b9c2cc','#e39a9a','#edb27c','#e3d581','#83cdb0','#86ccdc','#93b0ee','#c3a8e6','#7fa5d8'] },
  { id:'retro',   name:'复古', colors:['#a79b86','#a34f3c','#bf7a3d','#b39b3d','#6d8b5b','#4f7c7a','#526f9b','#7c5d8c','#3d4c66'] }
];
export function getDiffPalette(id) {
  return BUILTIN_DIFF_PALETTES.find(p => p.id === id) ||
    (themeData.diffPalettes || []).find(p => p.id === id) ||
    BUILTIN_DIFF_PALETTES[0];
}
export function applyDiffPalette(id) {
  const p = getDiffPalette(id);
  const colors = (Array.isArray(p.colors) && p.colors.length >= 9) ? p.colors : BUILTIN_DIFF_PALETTES[0].colors;
  colors.slice(0, 9).forEach((c, i) => {
    document.documentElement.style.setProperty('--diff-' + i, c);
    DIFF_COLORS[i] = c;
  });
  themeData.diffPaletteId = p.id;
  saveThemeData();
  try { window.dispatchEvent(new CustomEvent('app:diff-palette-changed')); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('app:state-changed', { detail: null })); } catch (e) {}
}

export const THEME_EDIT_VARS = [
  { key:'primary',          name:'主色' },
  { key:'primary-grad-from',name:'按钮渐变起' },
  { key:'primary-grad-to',  name:'按钮渐变止' },
  { key:'bg-start',         name:'背景色' },
  { key:'glass-bg',         name:'卡片背景' },
  { key:'text',             name:'正文文字' },
  { key:'text-secondary',   name:'次要文字' },
  { key:'text-muted',       name:'灰色文字' },
  { key:'border-color',     name:'边框色' },
  { key:'dot-done',         name:'完成色' },
  { key:'dot-know',         name:'会了没写色' },
  { key:'dot-pending',      name:'未完成色' },
  { key:'daily-queue',      name:'待做池色' },
  { key:'daily-active',     name:'计时中色' }
];

export const themeData = {
  builtinId:'default-light', customId:null, customThemes:[], pinned:[],
  themeGroups:[], diffPalettes:[], diffPaletteId:'default'
};

export function saveThemeData() { lsSet(THEME_DATA_KEY, JSON.stringify(themeData)); }

function loadThemeData() {
  try { const raw = lsGet(THEME_DATA_KEY); if (raw) Object.assign(themeData, JSON.parse(raw)); } catch (e) {}
  themeData.customThemes = Array.isArray(themeData.customThemes) ? themeData.customThemes : [];
  themeData.pinned = Array.isArray(themeData.pinned) ? themeData.pinned : [];
  themeData.themeGroups = Array.isArray(themeData.themeGroups) ? themeData.themeGroups : [];
  themeData.diffPalettes = Array.isArray(themeData.diffPalettes) ? themeData.diffPalettes : [];
  if (!themeData.diffPaletteId) themeData.diffPaletteId = 'default';
}

// 记录上一个自定义主题实际写入的行内 CSS 变量，切换时全部清掉（导入主题可能带任意变量）
const appliedCustomVars = new Set();

export function applyThemeById(id, isCustom) {
  const html = document.documentElement;
  // 先清掉上一个自定义主题留下的行内变量，避免变量串味
  appliedCustomVars.forEach(v => html.style.removeProperty(v));
  appliedCustomVars.clear();
  ['--primary','--primary-grad-from','--primary-grad-to','--bg-start','--glass-bg','--text',
   '--text-secondary','--text-muted','--border-color','--dot-done','--dot-pending','--dot-know',
   '--daily-queue','--daily-active',
   '--primary-gradient'].forEach(v => html.style.removeProperty(v));

  if (isCustom) {
    const t = themeData.customThemes.find(x => x.id === id);
    if (!t) return;
    const base = t.base || 'default-light';
    html.setAttribute('data-theme', base);
    const v = t.vars || {};
    if (v['primary-grad-from'] || v['primary-grad-to']) {
      const f = v['primary-grad-from'] || '#5a8a9a';
      const to = v['primary-grad-to'] || '#3a6a7a';
      html.style.setProperty('--primary-gradient', 'linear-gradient(135deg,' + f + ',' + to + ')');
    }
    Object.keys(v).forEach(k => {
      if (k === 'primary-grad-from' || k === 'primary-grad-to') return;
      if (!v[k]) return;
      const cssVar = '--' + k;
      html.style.setProperty(cssVar, v[k]);
      appliedCustomVars.add(cssVar);
    });
  } else {
    ['--primary','--primary-dark','--primary-light','--primary-soft','--primary-glow','--primary-gradient',
     '--bg-start','--bg-end','--text','--text-secondary','--text-muted','--glass-bg','--glass-bg-hover',
     '--surface','--surface-hover','--input-bg','--input-bg-focus','--border-subtle','--border-color',
     '--dot-done','--dot-pending','--dot-know','--daily-queue','--daily-active'].forEach(v => html.style.removeProperty(v));
    html.setAttribute('data-theme', id);
  }
  themeData.builtinId = isCustom ? null : id;
  themeData.customId = isCustom ? id : null;
  saveThemeData();
  try { window.dispatchEvent(new CustomEvent('app:theme-changed')); } catch (e) {}
}

export function applyFont(f) {
  document.documentElement.setAttribute('data-font', f);
  lsSet(FONT_KEY, f);
  document.querySelectorAll('#fontOpts .set-opt').forEach(b => b.classList.toggle('active', b.dataset.font === f));
}

export function applyFsize(f) {
  document.documentElement.setAttribute('data-fsize', f);
  lsSet(FSIZE_KEY, f);
  document.querySelectorAll('#fsizeOpts .set-opt').forEach(b => b.classList.toggle('active', b.dataset.fsize === f));
}

export function initTheme() {
  loadThemeData();
  if (themeData.customId && themeData.customThemes.some(t => t.id === themeData.customId)) {
    applyThemeById(themeData.customId, true);
  } else {
    let id = themeData.builtinId || 'default-light';
    if (!BUILTIN_THEMES.some(x => x.id === id)) id = 'default-light';
    applyThemeById(id, false);
  }
  applyDiffPalette(themeData.diffPaletteId || 'default');
}