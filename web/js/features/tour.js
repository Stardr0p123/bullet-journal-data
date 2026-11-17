// js/features/tour.js —— 新手引导
import { $, lsSet } from '../core.js';

const TOUR_KEY = 'tour_shown_v7';

const TOUR_STEPS = [
  { icon:'fa-layer-group', title:'欢迎使用题单管理', text:'一个简洁的刷题记录工具，帮你整理和管理题单。', tips:[['fa-gem','右上角「···」或 Ctrl+, 打开百宝箱'],['fa-book','📖 书本图标或 Ctrl+B 打开训练（模拟赛 / Trick 库 / 日常）']] },
  { icon:'fa-plus-circle', title:'创建题单与分组', text:'左侧输入名称创建题单，Ctrl+N 新建组，右键题单加入分组。', tips:[['fa-folder-tree','右键题单加入分组'],['fa-random','点 🔃 标记题单用于随机跳题']] },
  { icon:'fa-circle', title:'圆点状态', text:'点击圆点切换：未完成 → 已完成 → 会了没写。', tips:[['fa-lightbulb','悬停「会了没写」看鼓励语'],['fa-clock','悬停已完成看完成时间'],['fa-mug-hot','待做池紫色、进行中蓝色、挂起橙色（呼吸表示还有事在跑）']] },
  { icon:'fa-hand-pointer', title:'按住题号上滑 / 下滑', text:'按住题号往上滑加入待做池，往下滑立刻开始计时。', tips:[['fa-arrow-up','题号变蓝＝会进待做池；变红＝池已满'],['fa-arrow-down','题号变绿＝会开始计时；变红＝已有别的题在计时']] },
  { icon:'fa-mouse-pointer', title:'右键与移动', text:'右键题单/题目/组可操作；hover 后 Ctrl+↑/↓ 可上下移动。', tips:[['fa-pen','编辑、删除都在右键菜单里'],['fa-arrows-alt-v','空白处右键可新建题单组'],['fa-link','右键题号打开原题链接，双击复题号']] },
  { icon:'fa-check-double', title:'多选与快捷键', text:'Ctrl+M 多选，Alt+A 全选，Ctrl+数字 依次设置难度。', tips:[['fa-shift','Shift+点击范围选择'],['fa-external-link-alt','Alt+O 批量打开']] },
  { icon:'fa-file-export', title:'导入导出与比对', text:'Ctrl+P 批量导入；百宝箱 → 题单整理 可对两个题单去重。', tips:[['fa-right-left','比对相同题目，点击圆点保留某一边'],['fa-upload','无分组时可选择目标组']] }
];

let tourStep = 0;

function renderTourStep() {
  const s = TOUR_STEPS[tourStep];
  const tipsHtml = s.tips ? s.tips.map(t => '<div class="tour-tip"><i class="fas ' + t[0] + '"></i><span>' + t[1] + '</span></div>').join('') : '';
  const slide = $('tourSlide');
  slide.innerHTML = '<div class="tour-icon"><i class="fas ' + s.icon + '"></i></div><h2>' + s.title + '</h2><p>' + s.text + '</p>' + (tipsHtml ? '<div class="tour-tips">' + tipsHtml + '</div>' : '');
  slide.classList.remove('slide-in'); void slide.offsetWidth; slide.classList.add('slide-in');
  $('tourDots').innerHTML = TOUR_STEPS.map((_, i) => '<span class="dot' + (i === tourStep ? ' active' : '') + '" data-idx="' + i + '"></span>').join('');
  const nb = $('tourNextBtn');
  nb.innerHTML = tourStep === TOUR_STEPS.length - 1 ? '<i class="fas fa-check"></i> 开始使用' : '下一步 <i class="fas fa-arrow-right"></i>';
  $('tourSkipBtn').style.visibility = tourStep === TOUR_STEPS.length - 1 ? 'hidden' : 'visible';
}

function tourNext() { if (tourStep >= TOUR_STEPS.length - 1) { closeTour(); return; } tourStep++; renderTourStep(); }
function tourGoTo(i) { if (i < 0 || i >= TOUR_STEPS.length) return; tourStep = i; renderTourStep(); }

function closeTour() {
  $('tourModal').classList.remove('show');
  lsSet(TOUR_KEY, '1');
  document.removeEventListener('keydown', tourKeyHandler, true);
}

function tourKeyHandler(e) {
  if (e.key === 'ArrowRight') { e.preventDefault(); tourNext(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); tourGoTo(tourStep - 1); }
  else if (e.key === 'Escape') { e.preventDefault(); closeTour(); }
}

export function openTour() {
  tourStep = 0;
  renderTourStep();
  $('tourModal').classList.add('show');
  document.addEventListener('keydown', tourKeyHandler, true);
}

export function initTour() {
  if (!$('tourNextBtn')) return;
  $('tourNextBtn').addEventListener('click', tourNext);
  $('tourSkipBtn').addEventListener('click', closeTour);
  $('tourDots').addEventListener('click', e => { const d = e.target.closest('.dot'); if (d) tourGoTo(parseInt(d.dataset.idx, 10)); });
  $('tourModal').addEventListener('click', e => { if (e.target === $('tourModal')) closeTour(); });
}

export function shouldShowTour() { return !localStorage.getItem(TOUR_KEY); }