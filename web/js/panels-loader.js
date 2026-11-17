// js/panels-loader.js —— 按需加载百宝箱面板（fetch HTML + import JS）
import { closeModal } from './core.js';

const htmlCache = new Map();
const jsCache = new Map();

export async function mountPanel(name, host, opts) {
  const options = opts || {};
  // 1. HTML 片段（相对页面 URL，fetch 能找到 ./panels/...）
  if (!htmlCache.has(name)) {
    const res = await fetch('./panels/' + name + '/' + name + '.html');
    if (!res.ok) throw new Error('加载 ' + name + '.html 失败 (' + res.status + ')');
    htmlCache.set(name, await res.text());
  }

  let panelEl = host.querySelector('.tp-page[data-page="' + name + '"]');
  if (!panelEl) {
    host.insertAdjacentHTML('beforeend', htmlCache.get(name));
    panelEl = host.querySelector('.tp-page[data-page="' + name + '"]');

    // 2. JS 模块（相对当前模块 URL，从 js/ 回退到根再进 panels/）
    if (!jsCache.has(name)) {
      const jsUrl = new URL('../panels/' + name + '/' + name + '.js', import.meta.url).href;
      jsCache.set(name, await import(jsUrl));
    }
    const mod = jsCache.get(name);
    if (typeof mod.init === 'function') {
      mod.init(panelEl, {
        close: () => closeModal(options.closeId || 'treasureModal'),
        isActive: () => panelEl.classList.contains('active')
      });
    }
  }

  host.querySelectorAll('.tp-page').forEach(p => p.classList.toggle('active', p === panelEl));

  const mod = jsCache.get(name);
  if (mod && typeof mod.activate === 'function') mod.activate();
}