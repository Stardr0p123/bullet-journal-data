import { $, escapeHtml, fmtDate, DIFF_NAMES, DIFF_COLORS } from '../../js/core.js';
import { data } from '../../js/app.js';

const WEEKS = 30;
const DAYS = WEEKS * 7;
const LEVEL_OPACITY = [0, 0.35, 0.55, 0.75, 0.95];
const DIFF_LEGEND_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 0];

function allProblems() {
  const out = [];
  for (const n in data.lists) {
    const arr = data.lists[n].problems;
    for (let i = 0; i < arr.length; i++) out.push(arr[i]);
  }
  return out;
}
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function renderStats() {
  const all = allProblems();
  const done = all.filter(p => p.date);

  $('stTotal').textContent = all.length;
  $('stDone').textContent = done.length;

  // ---- 数字：本周 / 连续 ----
  const today = startOfToday();
  const todayKey = fmtDate(today);
  const weekStart = addDays(today, -((today.getDay() + 6) % 7)); // 周一
  const weekStartKey = fmtDate(weekStart);
  const thisWeek = done.filter(p => p.date >= weekStartKey && p.date <= todayKey).length;

  const doneDays = new Set(done.map(p => p.date));
  let streak = 0;
  let cursor = today;
  if (!doneDays.has(todayKey)) cursor = addDays(today, -1);
  while (doneDays.has(fmtDate(cursor))) { streak++; cursor = addDays(cursor, -1); }

  $('stWeek').textContent = thisWeek;
  $('stStreak').textContent = streak;

  // ---- 热力：最近 210 天（列=周，行=周一..周日）；深浅=题量，颜色=当天最高难度 ----
  const start = addDays(today, -((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const byDate = {};
  done.forEach(p => {
    const rec = byDate[p.date] || (byDate[p.date] = { n: 0, max: 0 });
    rec.n++;
    const d = Math.min(8, Math.max(0, p.difficulty || 0));
    if (d > rec.max) rec.max = d;
  });
  const counts = [], dates = [];
  for (let i = 0; i < DAYS; i++) {
    const key = fmtDate(addDays(start, i));
    dates.push(key);
    counts.push(byDate[key] ? byDate[key].n : 0);
  }
  let cells = '';
  for (let i = 0; i < DAYS; i++) {
    const c = counts[i], key = dates[i], rec = byDate[key];
    if (!rec) { cells += '<i class="hm-cell is-empty" title="' + key + ' · 0 题"></i>'; continue; }
    // 参照 3 题一档的绝对分档：1–3 / 4–6 / 7–9 / 10+
    const lv = c <= 3 ? 1 : c <= 6 ? 2 : c <= 9 ? 3 : 4;
    const bg = rec.max === 0 ? 'var(--diff-none)' : 'var(--diff-' + rec.max + ')';
    cells += '<i class="hm-cell" style="background:' + bg + ';opacity:' + LEVEL_OPACITY[lv] +
      '" title="' + key + ' · ' + c + ' 题 · 最高 ' + DIFF_NAMES[rec.max] + '"></i>';
  }
  $('stHeatmap').innerHTML = cells;
  // 难度图例直接由 DIFF_NAMES 生成，避免和真实档位对不上；暂无（diff-0）用粉色
  $('stDiffLegend').innerHTML = DIFF_LEGEND_ORDER.map(i => {
    const bg = i === 0 ? 'var(--diff-none)' : 'var(--diff-' + i + ')';
    return '<i class="hm-diff" style="background:' + bg + '" title="' + escapeHtml(DIFF_NAMES[i]) + '"></i>';
  }).join('');
  const winStartKey = dates[0];
  const winCount = done.filter(p => p.date >= winStartKey).length;
  $('stHmSum').textContent = '共 ' + winCount + ' 题';

  // ---- 累计曲线：窗口内每天的累计完成数 ----
  const base = done.filter(p => p.date < winStartKey).length;
  const series = [];
  let acc = base;
  for (let i = 0; i < DAYS; i++) { acc += counts[i]; series.push(acc); }
  const maxY = Math.max(1, series[series.length - 1]);
  const pts = series.map((v, i) => {
    const x = (i / (DAYS - 1)) * 100;
    const y = 40 - (v / maxY) * 36;
    return [x, y];
  });
  const line = pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
  const area = 'M0,40 L' + pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' L') + ' L100,40 Z';
  $('stCurve').innerHTML =
    '<svg class="curve-svg" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="curve-area" d="' + area + '"></path>' +
      '<polyline class="curve-line" points="' + line + '" vector-effect="non-scaling-stroke"></polyline>' +
    '</svg>';
  $('stCurveSum').textContent = '累计 ' + series[series.length - 1] + ' 题';

  // ---- 难度分布：完成率 ----
  const doneByDiff = Array(9).fill(0), totalByDiff = Array(9).fill(0);
  all.forEach(p => { const d = Math.min(8, Math.max(0, p.difficulty || 0)); totalByDiff[d]++; if (p.date) doneByDiff[d]++; });
  $('stDiffList').innerHTML = Array.from({ length: 9 }, (_, i) => {
    const dd = doneByDiff[i], tot = totalByDiff[i];
    if (!tot) return '';
    const pct = Math.round(dd / tot * 100);
    return '<div class="diff-stat-row">' +
      '<span class="lbl">' + DIFF_NAMES[i] + '</span>' +
      '<div class="bar">' +
        '<span class="done-seg" style="width:' + pct + '%;background:' + DIFF_COLORS[i] + ';"></span>' +
      '</div>' +
      '<span class="pct">' + pct + '%</span>' +
      '<span class="cnt">' + dd + '/' + tot + '</span>' +
    '</div>';
  }).join('');
}

export function init() {
  renderStats();
  window.addEventListener('app:state-changed', renderStats);
}
export function activate() { renderStats(); }
