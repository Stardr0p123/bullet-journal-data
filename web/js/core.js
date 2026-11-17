// js/core.js —— 工具函数 + 事件总线，所有模块的公共依赖
export const $ = id => document.getElementById(id);
export const escapeHtml = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

/* ---------- 提示 / 日期 / 格式化 ---------- */
export function showToast(msg, type = 'info') {
  const c = $('toastContainer');
  if (!c) { console.log(msg); return; }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show'); t.classList.add('hide');
    setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 300);
  }, 2200);
}
export function fmtDate(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt)) return '';
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
export function fmtShort(s) {
  if (!s) return '';
  const p = String(s).split('-');
  if (p.length !== 3) return s;
  return p[0].slice(2) + '/' + p[1] + '/' + p[2];
}
export function todayStr() { return fmtDate(new Date()); }
export function fmtRelative(s) {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 86400000);
  if (diff < 0) return fmtShort(s);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 30) return diff + '天前';
  return fmtShort(s);
}
export function normalizePid(pid) {
  if (pid == null) return '';
  const p = String(pid).trim();
  if (!p) return '';
  if (/^AT_/i.test(p)) return 'AT_' + p.slice(3).toLowerCase();
  return p.toUpperCase();
}
export const DIFF_NAMES = { 0:'暂无',1:'入门',2:'普及-',3:'普及',4:'普及+/提高-',5:'提高',6:'提高+/省选-',7:'省选/NOI-',8:'NOI/NOI+/CTS' };
export const DIFF_COLORS = { 0:'#AAAAAA',1:'#d44141',2:'#e68d3a',3:'#d4c62a',4:'#47c49a',5:'#58c1d1',6:'#648fec',7:'#a482db',8:'#2863bb' };
export const ENCOURAGE_LINES = [
  '要不再想想？','试一试说不定就会了','先写个暴力试试？','别急着看题解',
  '你可以的','想 5 分钟再放弃','思路写出来了吗？','换个角度看看',
  '有点思路就动笔','这道题真的那么难吗？','先列个式子','试几个小样例',
  '这题只是看起来难','慢一点，别慌','搞不定就拆子问题','画个图可能就明白了'
];
export function rndLine() { return ENCOURAGE_LINES[Math.floor(Math.random() * ENCOURAGE_LINES.length)]; }
export function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}
export function copyPlainText(text) {
  const s = String(text == null ? '' : text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(s).then(() => true).catch(() => legacyCopy(s));
  }
  return Promise.resolve(legacyCopy(s));
}
function legacyCopy(s) {
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, s.length);
    const ok = document.execCommand('copy');
    ta.parentNode && ta.parentNode.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}
export function copyText(text) {
  const s = String(text == null ? '' : text);
  copyPlainText(s).then(ok => {
    if (!ok) { showToast('复制失败', 'error'); return; }
    const brief = s.length > 40 ? s.slice(0, 40) + '…' : s;
    showToast('已复制：' + brief, 'success');
  });
}

/* ---------- 题目状态 / 链接 ---------- */
export function problemStatus(p) {
  if (p.date) return 'done';
  if (p.know) return 'know';
  return 'pending';
}
/**
 * 洛谷 / Codeforces / AtCoder 打开原生（或洛谷镜像）链接；
 * 其余 OJ 统一走 Virtual Judge —— VJudge 收录了绝大多数 OJ。
 * 无法确定 VJudge 前缀的题号退回 VJudge 搜索页，保证一定能打开。
 */
const VJUDGE_BASE = 'https://vjudge.net/problem/';
const VJUDGE_OJ_MAP = [
  [/^POJ(\d+)$/i, 'POJ'],
  [/^HDU(\d+)$/i, 'HDU'],
  [/^ZOJ(\d+)$/i, 'ZOJ'],
  [/^UVA(\d+)$/i, 'UVA'],
  [/^UVALIVE(\d+)$/i, 'UVALive'],
  [/^SPOJ([A-Z0-9_]+)$/i, 'SPOJ'],
  [/^LIGHT(\d+)$/i, 'LightOJ'],
  [/^LIGHTOJ(\d+)$/i, 'LightOJ'],
  [/^LOJ(\d+)$/i, 'LibreOJ'],
  [/^LIBREOJ(\d+)$/i, 'LibreOJ'],
  [/^BZOJ(\d+)$/i, 'BZOJ'],
  [/^51NOD(\d+)$/i, '51Nod'],
  [/^AIZU(\d+)$/i, 'Aizu'],
  [/^KATTIS[-_ ]?([A-Z0-9_.-]+)$/i, 'Kattis'],
  [/^BAEKJOON(\d+)$/i, 'Baekjoon'],
  [/^BOJ(\d+)$/i, 'Baekjoon'],
  [/^CSES(\d+)$/i, 'CSES'],
  [/^DMOJ([A-Z0-9_]+)$/i, 'DMOJ'],
  [/^TOPH([A-Z0-9_]+)$/i, 'Toph'],
  [/^VNOJ([A-Z0-9_]+)$/i, 'VNOJ'],
  [/^TLX([A-Z0-9_]+)$/i, 'TLX'],
  [/^YOSUPO([A-Z0-9_]+)$/i, 'Yosupo'],
  [/^YUKI(\d+)$/i, 'yukicoder']
];
export function getProblemUrl(pid) {
  if (!pid) return '#';
  const p = String(pid).trim();
  if (!p) return '#';
  if (p.startsWith('AT_')) return 'https://www.luogu.com.cn/problem/' + p;
  if (/^P\d+$/i.test(p)) return 'https://www.luogu.com.cn/problem/' + p.toUpperCase();
  if (/^CF/i.test(p) && !/^GYM/i.test(p)) return 'https://www.luogu.com.cn/problem/' + p.toUpperCase();
  let m = p.match(/^GYM(\d+)([A-Z])$/i); if (m) return 'https://codeforces.com/gym/' + m[1] + '/problem/' + m[2].toUpperCase();
  m = p.match(/^GYM(\d+)$/i); if (m) return 'https://codeforces.com/gym/' + m[1];
  m = p.match(/^(ARC|AGC|ABC|APC|AHC|ATC)(\d+)([A-Z])$/i); if (m) return 'https://atcoder.jp/contests/' + m[1].toLowerCase() + m[2] + '/tasks/' + m[1].toLowerCase() + m[2] + '_' + m[3].toLowerCase();
  m = p.match(/^(ARC|AGC|ABC|APC|AHC|ATC)(\d+)$/i); if (m) return 'https://atcoder.jp/contests/' + m[1].toLowerCase() + m[2];
  m = p.match(/^QOJ(\d+)$/i); if (m) return VJUDGE_BASE + 'QOJ-' + m[1];
  m = p.match(/^UOJ(\d+)$/i); if (m) return VJUDGE_BASE + 'UniversalOJ-' + m[1];
  for (const [re, oj] of VJUDGE_OJ_MAP) {
    m = p.match(re);
    if (m) return 'https://vjudge.net/problem#OJId=' + encodeURIComponent(oj) + '&probNum=' + encodeURIComponent(m[1]);
  }
  return 'https://vjudge.net/problem?search=' + encodeURIComponent(p);
}
export function getOJSource(pid) {
  if (!pid) return '?';
  const p = String(pid).trim();
  if (p.startsWith('AT_')) return '洛谷(AT)';
  if (/^P\d+$/i.test(p)) return '洛谷';
  if (p.startsWith('CF') && !p.startsWith('GYM')) return '洛谷(CF)';
  if (p.startsWith('GYM')) return 'GYM';
  if (/^(ARC|AGC|ABC|APC|AHC|ATC)/i.test(p)) return 'AtCoder';
  if (/^POJ/i.test(p)) return 'POJ';
  if (/^HDU/i.test(p)) return 'HDU';
  if (/^ZOJ/i.test(p)) return 'ZOJ';
  if (/^UVA/i.test(p)) return 'UVA';
  if (/^UOJ/i.test(p)) return 'UOJ';
  if (/^QOJ/i.test(p)) return 'QOJ';
  if (/^(LOJ|LIBREOJ)/i.test(p)) return 'LOJ';
  if (/^SPOJ/i.test(p)) return 'SPOJ';
  if (/^(LIGHT|LIGHTOJ)/i.test(p)) return 'LightOJ';
  if (/^BZOJ/i.test(p)) return 'BZOJ';
  if (/^51NOD/i.test(p)) return '51Nod';
  if (/^NC/i.test(p) || p.includes('牛客')) return '牛客';
  if (/^KATTIS/i.test(p)) return 'Kattis';
  if (/^CSES/i.test(p)) return 'CSES';
  return 'VJudge';
}

/* ---------- 弹窗 ---------- */
export function closeModal(id) { const m = $(id); if (m) m.classList.remove('show'); }

/**
 * 点遮罩关闭：必须「在遮罩上按下」且「在遮罩上抬起」才算一次完整点击。
 * 只在抬起时判断 target 会把「卡片内按下 → 划到遮罩上松开」误判成点外部，
 * 框选文本时鼠标划出去就会直接关窗。
 */
export function bindOverlayClose(modal, onOutside) {
  let downOnOverlay = false;
  const isOverlay = e => e.target === modal;
  const onDown = e => { downOnOverlay = isOverlay(e); };
  const onUp = e => {
    const hit = downOnOverlay && isOverlay(e);
    downOnOverlay = false;
    if (hit) onOutside();
  };
  const onCancel = () => { downOnOverlay = false; };
  modal.addEventListener('pointerdown', onDown);
  modal.addEventListener('pointerup', onUp);
  modal.addEventListener('pointercancel', onCancel);
  return () => {
    modal.removeEventListener('pointerdown', onDown);
    modal.removeEventListener('pointerup', onUp);
    modal.removeEventListener('pointercancel', onCancel);
  };
}

export function confirmDialog(title, msg) {
  return new Promise(resolve => {
    $('confirmTitle').innerHTML = title;
    $('confirmMsg').innerHTML = msg;
    const modal = $('confirmModal'), okBtn = $('confirmBtn');
    const cancels = modal.querySelectorAll('[data-close="confirmModal"]');
    let done = false;
    const finish = v => {
      if (done) return; done = true;
      okBtn.onclick = null; cancels.forEach(b => b.onclick = null);
      unbindOverlay();
      document.removeEventListener('keydown', onK, true);
      closeModal('confirmModal'); resolve(v);
    };
    const unbindOverlay = bindOverlayClose(modal, () => finish(false));
    const onK = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
    okBtn.onclick = e => { e.stopPropagation(); finish(true); };
    cancels.forEach(b => b.onclick = e => { e.stopPropagation(); finish(false); });
    document.addEventListener('keydown', onK, true);
    modal.classList.add('show');
  });
}

export function promptInput(title, defaultValue, type = 'text') {
  return new Promise(resolve => {
    $('promptTitle').innerHTML = '<i class="fas fa-pen" style="color:var(--primary);"></i> ' + title;
    const input = $('promptInput');
    input.type = type;
    input.value = defaultValue == null ? '' : defaultValue;
    if (type === 'number') { input.min = '1'; input.step = '1'; }
    const modal = $('promptModal'), okBtn = $('promptOkBtn');
    const cancels = modal.querySelectorAll('[data-close="promptModal"]');
    let done = false;
    const finish = v => {
      if (done) return; done = true;
      okBtn.onclick = null; cancels.forEach(b => b.onclick = null);
      unbindOverlay();
      document.removeEventListener('keydown', onK, true);
      closeModal('promptModal'); resolve(v);
    };
    const unbindOverlay = bindOverlayClose(modal, () => finish(null));
    const onK = e => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
    };
    okBtn.onclick = e => { e.stopPropagation(); finish(input.value); };
    cancels.forEach(b => b.onclick = e => { e.stopPropagation(); finish(null); });
    document.addEventListener('keydown', onK, true);
    modal.classList.add('show');
    setTimeout(() => { input.focus(); input.select(); }, 100);
  });
}
export const promptText = (title, def) => promptInput(title, def, 'text');
export const promptNumber = (title, def) => promptInput(title, def == null ? 1 : def, 'number');
export const promptDate = (title, def) => promptInput(title, def, 'date');

/* ---------- Popup / 右键菜单 ---------- */
export const openPopups = new Set();
export function closePopup(el) { el.classList.remove('open'); openPopups.delete(el); }
export function closeAllPopups() { openPopups.forEach(el => el.classList.remove('open')); openPopups.clear(); }
export function togglePopup(el, anchor) {
  if (el.classList.contains('open')) { closePopup(el); return; }
  closeAllPopups();
  const r = anchor.getBoundingClientRect();
  el.style.left = (r.left + r.width / 2) + 'px';
  el.style.top = (r.top - 10) + 'px';
  el.classList.add('open');
  openPopups.add(el);
}
export function openContextMenu(x, y, items) {
  const menu = $('contextMenu');
  if (menu._handler) { document.removeEventListener('click', menu._handler, true); menu._handler = null; }
  menu.innerHTML = items.map(it => it.sep
    ? '<div class="cm-sep"></div>'
    : '<div class="cm-item' + (it.danger ? ' danger' : '') + '" data-act="' + it.act + '"><i class="fas ' + it.icon + '"></i>' + it.label + '</div>'
  ).join('');
  menu.style.left = '-9999px'; menu.style.top = '-9999px';
  menu.classList.add('open');
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let px = x, py = y;
  if (px + mw > vw - 8) px = Math.max(8, vw - mw - 8);
  if (py + mh > vh - 8) py = Math.max(8, vh - mh - 8);
  menu.style.left = px + 'px'; menu.style.top = py + 'px';
  const close = ev => {
    if (ev && ev.target.closest('#contextMenu')) return;
    menu.classList.remove('open');
    document.removeEventListener('click', close, true);
    menu._handler = null;
  };
  menu._handler = close;
  setTimeout(() => document.addEventListener('click', close, true), 0);
  menu.onclick = e => {
    const it = e.target.closest('.cm-item'); if (!it) return;
    menu.classList.remove('open');
    const cb = items.find(x => x.act === it.dataset.act);
    if (cb && cb.run) cb.run();
  };
}

/* ---------- 事件总线 ---------- */
export function createBus() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt) && map.get(evt).delete(fn);
    },
    emit(evt, payload) {
      if (!map.has(evt)) return;
      map.get(evt).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
    }
  };
}