// panels/mock/mock.js —— 模拟赛面板：列表 / 赛中 / 赛后复盘 / 补题 / 档案
import { escapeHtml, showToast, fmtDate, confirmDialog } from '../../js/core.js';
import {
  onCodexChange, styleOf, getContests, getContest,
  createContest, updateContest, updateContestProblem, recordEstimate, latestRecord,
  sumEstimate, sumReal, hasAnyEstimate, syncContestTimers,
  submitContest, enterSupplement, addSupplement, finishSupplement, supplementState,
  deleteContest, startContestNow, cancelScheduledContest,
  hhmmss, clockTime, shortDateTime, humanDuration,
  MAX_PROBLEM_SCORE
} from '../../js/features/codex-store.js';

let host = null;
let mode = 'list';          // list | exam | waiting | review | supplement | detail
let activeId = null;
let mute = 0;
let tickTimer = null;
let pendingFocusId = null;

function withMute(fn) { mute++; try { return fn(); } finally { mute--; } }
function still(fn) { withMute(fn); }

/** 0 → A, 1 → B, 2 → C … */
function letterOf(i) { return String.fromCharCode(65 + i); }

/** 从其它面板（日常区的虚拟题号）定位到某场模拟赛 */
export function requestFocusContest(id) {
  if (!id) return;
  pendingFocusId = id;
  if (!host) return;
  pendingFocusId = null;
  const c = getContest(id); if (!c) return;
  activeId = id;
  mode = modeOfContest(c);
  render();
}

/* ============================================================
   视图入口
   ============================================================ */
function render() {
  if (!host) return;
  const view = host.querySelector('#mockView');
  if (!view) return;

  let c = activeId ? getContest(activeId) : null;
  if (mode !== 'list') {
    if (!c) { mode = 'list'; activeId = null; }
    else mode = modeOfContest(c);
  }

  if (mode === 'exam' && c) { view.innerHTML = examHTML(c); bindExam(c); }
  else if (mode === 'waiting' && c) { view.innerHTML = waitingHTML(c); bindWaiting(c); }
  else if (mode === 'review' && c) { view.innerHTML = reviewHTML(c); bindReview(c); }
  else if (mode === 'supplement' && c) { view.innerHTML = supplementHTML(c); bindSupplement(c); }
  else if (mode === 'detail' && c) { view.innerHTML = detailHTML(c); bindDetail(c); }
  else { view.innerHTML = listHTML(); bindList(); }

  bindNameEdits(view);
  updateCountdownDom();
  updateScheduledCards();
}

function modeOfContest(c) {
  if (!c) return 'list';
  if (c.status === 'running') return 'exam';
  if (c.status === 'scheduled') return 'waiting';
  if (c.status === 'review') return 'review';
  if (c.status === 'supplement') return 'supplement';
  return 'detail';
}

function openContest(id) {
  const c = getContest(id); if (!c) return;
  activeId = id;
  mode = modeOfContest(c);
  render();
  const view = host.querySelector('#mockView');
  if (view) view.scrollTop = 0;
}

/* ============================================================
   通用：就地改名 / 题目名 / Rank
   ============================================================ */
function contestTitleHTML(c) {
  return '<span class="mc-name-edit" data-cid="' + c.id + '" title="点击修改比赛名称">' + escapeHtml(c.name) + '</span>';
}

function rankHTML(c) {
  if (!c || !c.rank) return '';
  return '<em class="mc-rank-mini" title="本场 Rank">#' + escapeHtml(c.rank) + '</em>';
}

function bindNameEdits(view) {
  view.querySelectorAll('.mc-name-edit').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      beginNameEdit(el, el.dataset.cid);
    });
  });
}

function beginNameEdit(el, cid) {
  const c = getContest(cid); if (!c) return;
  const input = document.createElement('input');
  input.className = 'mc-name-input';
  input.value = c.name;
  input.maxLength = 60;
  el.replaceWith(input);
  input.focus(); input.select();
  let finished = false;
  const commit = save => {
    if (finished) return;
    finished = true;
    const v = input.value.trim();
    if (save && v && v !== c.name) {
      still(() => updateContest(cid, { name: v }));
      showToast('已更新模拟赛名称', 'success');
    }
    render();
  };
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finished = true; render(); }
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', ev => ev.stopPropagation());
}

/** 复盘 / 补题 / 档案里所有题目名都可直接修改 */
function bindProblemNames(c, view) {
  view.querySelectorAll('[data-mp-name]').forEach(inp => {
    inp.addEventListener('change', () => {
      const block = inp.closest('[data-mpid]');
      if (!block) return;
      const v = inp.value.trim() || '未命名题目';
      inp.value = v;
      still(() => updateContestProblem(c.id, block.dataset.mpid, { name: v }));
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('click', e => e.stopPropagation());
  });
}

/** 复盘时填写的 rank：a/b，a ≤ b；空串允许 */
function parseRank(v) {
  const s = String(v || '').trim().replace(/^#/, '').replace(/\s+/g, '');
  if (!s) return '';
  const m = /^(\d+)\/(\d+)$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (a < 1 || b < 1 || a > b) return null;
  return a + '/' + b;
}

/* ============================================================
   一、列表
   ============================================================ */
function statusRank(c) {
  if (c.status === 'running') return 0;
  if (c.status === 'scheduled') return 1;
  if (c.status === 'review') return 2;
  if (c.status === 'supplement') return 3;
  return 4;
}

function statusMetaOf(c) {
  if (c.status === 'running') return { flag: '<span class="mc-flag live"><i class="fas fa-circle"></i> 进行中</span>', action: '继续考试' };
  if (c.status === 'scheduled') return { flag: '<span class="mc-flag scheduled"><i class="fas fa-clock"></i> 已预约</span>', action: '查看预约' };
  if (c.status === 'review') return { flag: '<span class="mc-flag warn"><i class="fas fa-exclamation-circle"></i> 待复盘</span>', action: '去复盘' };
  if (c.status === 'supplement') return { flag: '<span class="mc-flag supp"><i class="fas fa-book-open"></i> 补题中</span>', action: '继续补题' };
  return { flag: '<span class="mc-flag ok"><i class="fas fa-check-circle"></i> 已结束</span>', action: '查看档案' };
}

function countdownText(ms) {
  if (!isFinite(ms) || ms <= 0) return '即将开始';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  if (d > 0) return d + ' 天 ' + hhmmss(ms - d * 86400000);
  return hhmmss(ms);
}

/** 每秒刷新列表里的预约倒计时 */
function updateScheduledCards() {
  if (!host) return;
  host.querySelectorAll('.mc-countdown[data-cid]').forEach(el => {
    const c = getContest(el.dataset.cid);
    if (!c || c.status !== 'scheduled' || !c.scheduledAt) { el.textContent = '即将开始'; return; }
    el.textContent = countdownText(c.scheduledAt - Date.now());
  });
}

function listHTML() {
  const all = getContests().slice().sort((a, b) => {
    const ra = statusRank(a), rb = statusRank(b);
    if (ra !== rb) return ra - rb;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  if (!all.length) {
    return '<div class="ck-empty">' +
        '<div class="ck-empty-icon"><i class="fas fa-stopwatch"></i></div>' +
        '<h3>还没有模拟赛记录</h3>' +
        '<p>选一个赛制，用整块时间全真模拟；交卷后强制复盘，把每一分都记住。</p>' +
      '</div>';
  }

  const cards = all.map(c => {
    const st = styleOf(c.style);
    const isScheduled = c.status === 'scheduled';
    const isSettled = c.status === 'finished' || c.status === 'supplement';
    const score = isSettled ? sumReal(c) : sumEstimate(c);
    const hasScore = isScheduled ? false : (isSettled ? true : hasAnyEstimate(c));
    const scoreLabel = isScheduled ? '未开始' : (isSettled ? '实际总分' : '估分合计');
    const meta = statusMetaOf(c);
    const scheduleLine = isScheduled
      ? '<span><i class="fas fa-play-circle"></i> ' + shortDateTime(c.scheduledAt) + ' 开始</span>' +
        '<span><i class="fas fa-hourglass-half"></i> <span class="mc-countdown" data-cid="' + c.id + '">' + countdownText(c.scheduledAt - Date.now()) + '</span></span>'
      : '<span><i class="fas fa-calendar-alt"></i> ' + fmtDate(new Date(c.createdAt)) + '</span>';
    return '<article class="mc-card" data-cid="' + c.id + '" style="--mc-accent:' + st.accent + '">' +
      '<span class="mc-card-stripe"></span>' +
      '<div class="mc-card-body">' +
        '<div class="mc-card-line1">' +
          '<span class="mc-card-name">' + contestTitleHTML(c) + '</span>' +
          '<span class="mc-tag">' + escapeHtml(st.label) + '</span>' +
          meta.flag +
        '</div>' +
        '<div class="mc-card-line2">' +
          scheduleLine +
          '<span><i class="fas fa-clock"></i> ' + st.hours + ' 小时</span>' +
          '<span><i class="fas fa-list-ol"></i> ' + c.problems.length + ' 题</span>' +
        '</div>' +
      '</div>' +
      '<div class="mc-card-score' + (hasScore ? '' : ' blank') + '">' +
        '<b>' + (hasScore ? score : '—') + '</b>' +
        '<span>' + scoreLabel + '</span>' +
        rankHTML(c) +
      '</div>' +
      '<div class="mc-card-actions"><button class="ck-btn sm" data-mc-open>' + meta.action + '</button></div>' +
    '</article>';
  }).join('');

  return '<div class="ck-sect">' +
      '<span class="ck-sect-label"><i class="fas fa-folder-open"></i> 历史记录</span>' +
      '<span class="ck-sect-hint">进行中 / 待复盘优先 · 共 ' + all.length + ' 场</span>' +
    '</div>' +
    '<div class="mc-list">' + cards + '</div>';
}

function bindList() {
  const view = host.querySelector('#mockView');
  view.querySelectorAll('.mc-card').forEach(card => {
    card.addEventListener('click', () => openContest(card.dataset.cid));
  });
}

/* ============================================================
   二、预约等待
   ============================================================ */
function waitingHTML(c) {
  const st = styleOf(c.style);
  return '<div class="mc-wait">' +
    '<div class="mc-wait-card">' +
      '<span class="mc-wait-ico"><i class="fas fa-hourglass-half"></i></span>' +
      '<h3>模拟赛已预约</h3>' +
      '<p class="mc-wait-name">' + contestTitleHTML(c) + ' · ' + escapeHtml(st.label) + '</p>' +
      '<div class="mc-wait-timer" id="mcWaitTimer">' + countdownText((c.scheduledAt || Date.now()) - Date.now()) + '</div>' +
      '<div class="mc-wait-cap">距开始 · 到点自动开始计时</div>' +
      '<div class="mc-wait-meta">' +
        '<span><i class="fas fa-play-circle"></i> ' + shortDateTime(c.scheduledAt) + ' 开始</span>' +
        '<span><i class="fas fa-clock"></i> ' + st.hours + ' 小时 · ' + c.problems.length + ' 题</span>' +
      '</div>' +
      '<div class="mc-wait-actions">' +
        '<button class="ck-btn ghost sm" id="mcWaitBack"><i class="fas fa-chevron-left"></i> 列表</button>' +
        '<button class="ck-btn danger ghost sm" id="mcWaitCancel"><i class="fas fa-trash-alt"></i> 取消预约</button>' +
        '<button class="ck-btn primary sm" id="mcWaitStart"><i class="fas fa-play"></i> 立即开始</button>' +
      '</div>' +
    '</div>' +
    '<div class="mc-wait-tip"><i class="fas fa-info-circle"></i> 可以先去刷别的题，到点后会自动开赛并开始计时。</div>' +
  '</div>';
}

function bindWaiting(c) {
  const view = host.querySelector('#mockView');
  const back = view.querySelector('#mcWaitBack');
  if (back) back.addEventListener('click', () => { mode = 'list'; render(); });
  const start = view.querySelector('#mcWaitStart');
  if (start) start.addEventListener('click', () => {
    startContestNow(c.id);
    activeId = c.id; mode = 'exam'; render();
    showToast('模拟赛提前开始，计时不暂停', 'success');
  });
  const cancel = view.querySelector('#mcWaitCancel');
  if (cancel) cancel.addEventListener('click', () => {
    confirmDialog('取消预约', '取消模拟赛 <strong>' + escapeHtml(c.name) + '</strong> 的预约？').then(ok => {
      if (!ok) return;
      cancelScheduledContest(c.id);
      activeId = null; mode = 'list'; render();
      showToast('已取消预约', 'info');
    });
  });
}

/* ============================================================
   三、赛中模式
   ============================================================ */
function recordsHTML(p) {
  if (!p.records.length) return '<span class="mc-records-empty">尚未记录赛时状态</span>';
  return p.records.slice().reverse().map((r, i) =>
    '<span class="mc-chip' + (i === 0 ? ' latest' : '') + '">' +
      '<b>' + (r.score == null ? '—' : r.score) + '</b><i>分</i>' +
      '<em>' + clockTime(r.at) + '</em>' +
    '</span>').join('');
}

function problemBlockHTML(p, i) {
  const last = latestRecord(p);
  return '<section class="mc-pblock" data-mpid="' + p.id + '">' +
    '<header class="mc-pblock-head">' +
      '<span class="mc-pindex">' + letterOf(i) + '</span>' +
      '<input class="mc-pname" data-mp-name value="' + escapeHtml(p.name) + '" title="点击修改题目名称" spellcheck="false" />' +
      '<span class="mc-pbest">最近 <b data-mp-best>' + (last ? last.score : '—') + '</b> 分</span>' +
    '</header>' +
    '<div class="mc-pblock-body">' +
      '<label class="mc-est-field">' +
        '<span class="mc-est-label">赛时估分</span>' +
        '<span class="mc-est-control">' +
          '<input type="number" min="0" max="' + MAX_PROBLEM_SCORE + '" step="1" class="mc-est-input" data-mp-est value="' + escapeHtml(p.estScore) + '" placeholder="0" />' +
          '<span class="mc-est-stamp" data-mp-stamp title="最近一次记录时间">' +
            (last ? clockTime(last.at) : '未记录') +
          '</span>' +
        '</span>' +
      '</label>' +
      '<button class="mc-record-btn" data-mp-record><i class="fas fa-clock"></i> 记录当前状态</button>' +
    '</div>' +
    '<div class="mc-records" data-mp-records>' + recordsHTML(p) + '</div>' +
  '</section>';
}

function examHTML(c) {
  const st = styleOf(c.style);
  const remain = Math.max(0, c.endsAt - Date.now());
  const pct = c.durationMs ? Math.max(0, Math.min(100, remain / c.durationMs * 100)) : 0;
  return '<div class="mc-exam">' +
    '<div class="mc-timer-bar">' +
      '<div class="mc-timer-main">' +
        '<span class="mc-timer-ico"><i class="fas fa-hourglass-half"></i></span>' +
        '<div>' +
          '<div class="mc-timer" id="mcTimer">' + hhmmss(remain) + '</div>' +
          '<div class="mc-timer-cap">剩余时间 · 不可暂停</div>' +
        '</div>' +
      '</div>' +
      '<div class="mc-timer-info">' +
        '<span><i class="fas fa-flag"></i> ' + contestTitleHTML(c) + '</span>' +
        '<span><i class="fas fa-list-ol"></i> ' + escapeHtml(st.label) + ' · ' + c.problems.length + ' 题</span>' +
        '<span><i class="fas fa-play-circle"></i> 开赛 ' + clockTime(c.startedAt) + '</span>' +
      '</div>' +
      '<div class="mc-timer-actions">' +
        '<button class="ck-btn ghost sm" id="mcBackBtn"><i class="fas fa-chevron-left"></i> 列表</button>' +
        '<button class="ck-btn danger sm" id="mcSubmitBtn"><i class="fas fa-flag-checkered"></i> 提前交卷</button>' +
      '</div>' +
      '<div class="mc-track"><i class="mc-track-fill" id="mcTrackFill" style="width:' + pct.toFixed(2) + '%"></i></div>' +
    '</div>' +
    '<div class="mc-note-line"><i class="fas fa-info-circle"></i> 估分可以随时修改；点「记录当前状态」会把当前分数和时间戳一起留下，交卷后进入强制复盘。</div>' +
    '<div class="mc-grid">' + c.problems.map(problemBlockHTML).join('') + '</div>' +
  '</div>';
}

function bindExam(c) {
  const view = host.querySelector('#mockView');
  const back = view.querySelector('#mcBackBtn');
  if (back) back.addEventListener('click', () => { mode = 'list'; activeId = c.id; render(); });

  const submit = view.querySelector('#mcSubmitBtn');
  if (submit) submit.addEventListener('click', () => {
    confirmDialog('<i class="fas fa-flag-checkered" style="color:var(--warning)"></i> 提前交卷',
      '交卷后计时立即停止，进入 <strong>赛后复盘模式</strong>。<br>确定现在交卷吗？').then(ok => {
      if (!ok) return;
      submitContest(c.id);
      showToast('已交卷，进入复盘模式', 'success');
      mode = 'review'; render();
    });
  });

  view.querySelectorAll('.mc-pblock').forEach(block => {
    const mpid = block.dataset.mpid;
    const estInput = block.querySelector('[data-mp-est]');

    estInput.addEventListener('change', () => {
      const raw = String(estInput.value).trim();
      if (raw === '') { still(() => updateContestProblem(c.id, mpid, { estScore: '' })); return; }
      const n = Number(raw);
      if (!isFinite(n)) {
        showToast('请输入有效分数', 'warning');
        estInput.value = '';
        still(() => updateContestProblem(c.id, mpid, { estScore: '' }));
        return;
      }
      const clamped = Math.max(0, Math.min(MAX_PROBLEM_SCORE, Math.round(n)));
      if (clamped !== n) {
        showToast('分数范围 0–' + MAX_PROBLEM_SCORE + '，已自动修正', 'warning');
        estInput.value = clamped;
      }
      still(() => updateContestProblem(c.id, mpid, { estScore: clamped }));
    });

    block.querySelector('[data-mp-record]').addEventListener('click', () => {
      const raw = String(estInput.value).trim();
      if (raw === '') {
        showToast('请先填写赛时估分', 'warning');
        estInput.focus();
        return;
      }
      const n = Number(raw);
      if (!isFinite(n)) {
        showToast('请输入有效分数', 'warning');
        estInput.focus();
        return;
      }
      const clamped = Math.max(0, Math.min(MAX_PROBLEM_SCORE, Math.round(n)));
      if (clamped !== n) {
        showToast('分数范围 0–' + MAX_PROBLEM_SCORE + '，已自动修正', 'warning');
        estInput.value = clamped;
      }
      let p = null;
      still(() => { p = recordEstimate(c.id, mpid, clamped); });
      if (!p) return;
      const last = latestRecord(p);
      const stamp = block.querySelector('[data-mp-stamp]');
      if (stamp) stamp.textContent = clockTime(last.at);
      const best = block.querySelector('[data-mp-best]');
      if (best) best.textContent = last.score;
      const rec = block.querySelector('[data-mp-records]');
      if (rec) rec.innerHTML = recordsHTML(p);
      block.classList.remove('flash'); void block.offsetWidth; block.classList.add('flash');
      showToast('已记录 ' + last.score + ' 分 · ' + clockTime(last.at), 'success');
    });
  });
  bindProblemNames(c, view);
}

function updateCountdownDom() {
  if (!host) return;
  if (mode === 'waiting') {
    const wc = activeId ? getContest(activeId) : null;
    if (!wc) return;
    if (wc.status !== 'scheduled') { mode = modeOfContest(wc); render(); return; }
    const waitEl = host.querySelector('#mcWaitTimer');
    if (waitEl) waitEl.textContent = countdownText((wc.scheduledAt || Date.now()) - Date.now());
    return;
  }
  if (mode !== 'exam') return;
  const timerEl = host.querySelector('#mcTimer');
  if (!timerEl) return;
  const c = activeId ? getContest(activeId) : null;
  if (!c || c.status !== 'running') return;
  const remain = Math.max(0, c.endsAt - Date.now());
  timerEl.textContent = hhmmss(remain);
  timerEl.classList.toggle('warn', remain <= 30 * 60000 && remain > 10 * 60000);
  timerEl.classList.toggle('danger', remain <= 10 * 60000);
  const fill = host.querySelector('#mcTrackFill');
  if (fill && c.durationMs) fill.style.width = (Math.max(0, Math.min(1, remain / c.durationMs)) * 100).toFixed(2) + '%';
}

/* ============================================================
   三、赛后复盘
   ============================================================ */
function reviewCardHTML(p, i) {
  const last = latestRecord(p);
  return '<section class="mc-rcard" data-mpid="' + p.id + '">' +
    '<header class="mc-rcard-head">' +
      '<span class="mc-pindex">' + letterOf(i) + '</span>' +
      '<input class="mc-pname" data-mp-name value="' + escapeHtml(p.name) + '" title="点击修改题目名称" spellcheck="false" />' +
      '<span class="mc-rcard-est">赛时估分 <b>' + (last ? last.score : (p.estScore === '' ? '—' : p.estScore)) + '</b></span>' +
      '<label class="mc-rcard-real">实际得分' +
        '<input type="number" min="0" max="' + MAX_PROBLEM_SCORE + '" step="1" data-mp-real value="' + escapeHtml(p.realScore) + '" placeholder="0" />' +
      '</label>' +
    '</header>' +
    '<div class="mc-rcard-grid">' +
      '<div class="mc-rcard-col">' +
        '<label class="mc-lbl"><i class="fas fa-code"></i> 代码保存</label>' +
        '<textarea class="mc-code" data-mp-code spellcheck="false" placeholder="// 赛后把关键代码存进来（可选）">' + escapeHtml(p.code) + '</textarea>' +
      '</div>' +
      '<div class="mc-rcard-col">' +
        '<label class="mc-lbl"><i class="fas fa-pen-nib"></i> 心得笔记 <em class="req">*</em></label>' +
        '<textarea class="mc-review-text" data-mp-review placeholder="挂分原因：&#10;破冰点分析：">' + escapeHtml(p.review) + '</textarea>' +
      '</div>' +
    '</div>' +
  '</section>';
}

function reviewHTML(c) {
  const st = styleOf(c.style);
  const used = (c.submittedAt || Date.now()) - (c.startedAt || c.createdAt || Date.now());
  return '<div class="mc-review">' +
    '<div class="mc-review-top">' +
      '<button class="ck-btn ghost sm" id="mcBackBtn2"><i class="fas fa-chevron-left"></i> 列表</button>' +
      '<div class="mc-review-title">' + contestTitleHTML(c) + '<span class="mc-tag">' + escapeHtml(st.label) + '</span></div>' +
      '<div class="mc-review-meta">交卷于 ' + shortDateTime(c.submittedAt) + ' · 赛时 ' + humanDuration(used) + '</div>' +
      '<label class="mc-rank-field">Rank <input id="mcRankInput" class="mc-rank-input" value="' + escapeHtml(c.rank) + '" placeholder="12/345" spellcheck="false" /></label>' +
      '<div class="mc-score-compare">' +
        '<div><span>估分</span><b>' + sumEstimate(c) + '</b></div>' +
        '<i class="fas fa-arrow-right"></i>' +
        '<div><span>实际</span><b class="real">' + sumReal(c) + '</b></div>' +
        rankHTML(c) +
      '</div>' +
    '</div>' +
    '<div class="mc-review-body">' + c.problems.map(reviewCardHTML).join('') + '</div>' +
    '<div class="mc-review-footer">' +
      '<div class="mc-review-tip"><i class="fas fa-circle-exclamation"></i> 复盘是强制的：每题都要填实际得分与心得笔记（挂分原因 / 破冰点分析）才能进入补题。补题阶段可以补充正解代码。</div>' +
      '<button class="ck-btn primary" id="mcArchiveBtn"><i class="fas fa-book-open"></i> 完成复盘 · 进入补题</button>' +
    '</div>' +
  '</div>';
}

function bindReview(c) {
  const view = host.querySelector('#mockView');
  const back = view.querySelector('#mcBackBtn2');
  if (back) back.addEventListener('click', () => { mode = 'list'; render(); });

  view.querySelectorAll('.mc-rcard').forEach(card => {
    const mpid = card.dataset.mpid;
    const real = card.querySelector('[data-mp-real]');
    const code = card.querySelector('[data-mp-code]');
    const review = card.querySelector('[data-mp-review]');

    real.addEventListener('input', () => {
      const raw = String(real.value).trim();
      if (raw === '') {
        still(() => updateContestProblem(c.id, mpid, { realScore: '' }));
      } else {
        const n = Number(raw);
        if (isFinite(n)) still(() => updateContestProblem(c.id, mpid, { realScore: n }));
      }
      const realEl = view.querySelectorAll('.mc-score-compare b.real')[0];
      if (realEl) realEl.textContent = sumReal(getContest(c.id));
    });
    real.addEventListener('change', () => {
      const raw = String(real.value).trim();
      if (raw === '') { card.classList.remove('invalid'); return; }
      const n = Number(raw);
      if (!isFinite(n)) {
        showToast('请输入有效分数', 'warning');
        real.value = '';
        still(() => updateContestProblem(c.id, mpid, { realScore: '' }));
        card.classList.add('invalid');
        return;
      }
      const clamped = Math.max(0, Math.min(MAX_PROBLEM_SCORE, Math.round(n)));
      if (clamped !== n) {
        showToast('分数范围 0–' + MAX_PROBLEM_SCORE + '，已自动修正', 'warning');
        real.value = clamped;
        still(() => updateContestProblem(c.id, mpid, { realScore: clamped }));
      }
      card.classList.remove('invalid');
      const realEl = view.querySelectorAll('.mc-score-compare b.real')[0];
      if (realEl) realEl.textContent = sumReal(getContest(c.id));
    });
    code.addEventListener('input', () => still(() => updateContestProblem(c.id, mpid, { code: code.value })));
    review.addEventListener('input', () => {
      still(() => updateContestProblem(c.id, mpid, { review: review.value }));
      if (review.value.trim()) card.classList.remove('invalid');
    });
  });

  const rankInput = view.querySelector('#mcRankInput');
  if (rankInput) {
    rankInput.addEventListener('change', () => {
      const norm = parseRank(rankInput.value);
      if (norm === null) {
        showToast('Rank 格式为 a/b（如 12/345），且 a ≤ b', 'warning');
        rankInput.value = c.rank || '';
        return;
      }
      rankInput.value = norm;
      still(() => updateContest(c.id, { rank: norm }));
      const holder = view.querySelector('.mc-score-compare');
      if (holder) {
        const old = holder.querySelector('.mc-rank-mini');
        if (old) old.remove();
        if (norm) holder.insertAdjacentHTML('beforeend', '<em class="mc-rank-mini" title="本场 Rank">#' + escapeHtml(norm) + '</em>');
      }
    });
  }

  const archiveBtn = view.querySelector('#mcArchiveBtn');
  if (archiveBtn) archiveBtn.addEventListener('click', () => {
    const fresh = getContest(c.id); if (!fresh) return;
    let bad = null;
    for (let i = 0; i < fresh.problems.length; i++) {
      const p = fresh.problems[i];
      if (String(p.realScore).trim() === '' || isNaN(Number(p.realScore))) { bad = { i, p, field: 'real' }; break; }
    }
    if (!bad) {
      for (let i = 0; i < fresh.problems.length; i++) {
        const p = fresh.problems[i];
        if (!String(p.review).trim()) { bad = { i, p, field: 'review' }; break; }
      }
    }
    if (bad) {
      const card = view.querySelector('.mc-rcard[data-mpid="' + bad.p.id + '"]');
      if (card) {
        card.classList.add('invalid');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = card.querySelector(bad.field === 'real' ? '[data-mp-real]' : '[data-mp-review]');
        if (input) setTimeout(() => input.focus(), 260);
      }
      showToast(bad.field === 'real' ? (letterOf(bad.i) + ' 题还没填实际得分') : (letterOf(bad.i) + ' 题的心得笔记是必填项'), 'warning');
      return;
    }
    enterSupplement(c.id);
    showToast('复盘完成，进入补题阶段', 'success');
    mode = 'supplement'; render();
  });
  bindProblemNames(c, view);
}

/* ============================================================
   三.5、补题阶段
   ============================================================ */
function suppButtonHTML(c, p, state) {
  if (Number(p.realScore) >= 100) {
    return '<span class="mc-supp-none"><i class="fas fa-check-circle"></i> 无需补题</span>';
  }
  if (state === 'done') return '<button class="ck-btn ghost sm" disabled><i class="fas fa-check"></i> 已补题</button>';
  if (state === 'inbox' || state === 'doing') return '<button class="ck-btn ghost sm" disabled><i class="fas fa-hourglass-half"></i> 正在补题</button>';
  if (state === 'suspended') return '<button class="ck-btn ghost sm" disabled><i class="fas fa-pause"></i> 挂起中</button>';
  return '<button class="ck-btn primary sm" data-mp-supp><i class="fas fa-plus"></i> 补题</button>';
}

function supplementCardHTML(c, p, i) {
  const state = supplementState(c, p);
  const last = latestRecord(p);
  const est = last ? last.score : p.estScore;
  const real = String(p.realScore).trim() === '' ? '—' : p.realScore;
  const note = String(p.suppNote || '').trim();
  const review = String(p.review || '').trim();
  return '<section class="mc-scard" data-mpid="' + p.id + '">' +
    '<header class="mc-scard-head">' +
      '<span class="mc-pindex">' + letterOf(i) + '</span>' +
      '<input class="mc-pname" data-mp-name value="' + escapeHtml(p.name) + '" title="点击修改题目名称" spellcheck="false" />' +
      '<span class="mc-scard-score">估 <b>' + (est === '' ? '—' : est) + '</b> · 实 <b class="real">' + real + '</b></span>' +
      suppButtonHTML(c, p, state) +
    '</header>' +
    (note ? '<div class="mc-supp-note"><i class="fas fa-check-circle"></i> ' + escapeHtml(note).replace(/\n/g, ' · ') + '</div>' : '') +
    '<div class="mc-scard-meta">' +
      (p.suppPid
        ? '<code class="mc-vpid" title="虚拟题号，仅本场补题使用，不写入题单">' + escapeHtml(p.suppPid) + '</code>'
        : '<span class="mc-vpid dim">尚未生成虚拟题号</span>') +
      '<span class="mc-supp-hint">' + (state === 'none' ? '点「补题」加入日常待做池' : '去「日常」面板继续') + '</span>' +
    '</div>' +
    '<div class="mc-scard-grid">' +
      '<div class="mc-rcard-col">' +
        '<label class="mc-lbl"><i class="fas fa-code"></i> 赛时代码</label>' +
        '<textarea class="mc-code" data-mp-code spellcheck="false" placeholder="// 赛时提交的代码">' + escapeHtml(p.code) + '</textarea>' +
      '</div>' +
      '<div class="mc-rcard-col">' +
        '<label class="mc-lbl"><i class="fas fa-lightbulb"></i> 正解代码</label>' +
        '<textarea class="mc-code" data-mp-sol spellcheck="false" placeholder="// 补题时写下正解">' + escapeHtml(p.solutionCode) + '</textarea>' +
      '</div>' +
    '</div>' +
    (review ? '<div class="mc-quote mc-supp-review"><b>复盘心得：</b>' + escapeHtml(review) + '</div>' : '') +
  '</section>';
}

function supplementHTML(c) {
  const st = styleOf(c.style);
  return '<div class="mc-supp">' +
    '<div class="mc-review-top">' +
      '<button class="ck-btn ghost sm" id="mcBackBtn4"><i class="fas fa-chevron-left"></i> 列表</button>' +
      '<div class="mc-review-title">' + contestTitleHTML(c) +
        '<span class="mc-tag">' + escapeHtml(st.label) + '</span>' +
        '<span class="mc-flag supp"><i class="fas fa-book-open"></i> 补题中</span>' +
      '</div>' +
      '<div class="mc-review-meta">复盘完成于 ' + shortDateTime(c.archivedAt || c.submittedAt) + '</div>' +
      '<div class="mc-score-compare">' +
        '<div><span>估分</span><b>' + sumEstimate(c) + '</b></div>' +
        '<i class="fas fa-arrow-right"></i>' +
        '<div><span>实际</span><b class="real">' + sumReal(c) + '</b></div>' +
        rankHTML(c) +
      '</div>' +
    '</div>' +
    '<div class="mc-note-line"><i class="fas fa-info-circle"></i> 实际得分 &lt; 100 的题可以点「补题」加入日常待做池；每题能同时保存赛时代码与正解代码。结束补题会收回所有未完成的补题任务。</div>' +
    '<div class="mc-supp-body">' + c.problems.map((p, i) => supplementCardHTML(c, p, i)).join('') + '</div>' +
    '<div class="mc-review-footer">' +
      '<div class="mc-review-tip"><i class="fas fa-flag-checkered"></i> 结束后本场标记为「已结束」，未完成的补题会从日常区收回，已完成的补题记录保留。</div>' +
      '<button class="ck-btn primary" id="mcFinishSuppBtn"><i class="fas fa-flag-checkered"></i> 结束补题</button>' +
    '</div>' +
  '</div>';
}

function bindSupplement(c) {
  const view = host.querySelector('#mockView');
  const back = view.querySelector('#mcBackBtn4');
  if (back) back.addEventListener('click', () => { mode = 'list'; render(); });
  bindProblemNames(c, view);

  view.querySelectorAll('.mc-scard').forEach(card => {
    const mpid = card.dataset.mpid;
    const code = card.querySelector('[data-mp-code]');
    const sol = card.querySelector('[data-mp-sol]');
    if (code) code.addEventListener('input', () => still(() => updateContestProblem(c.id, mpid, { code: code.value })));
    if (sol) sol.addEventListener('input', () => still(() => updateContestProblem(c.id, mpid, { solutionCode: sol.value })));
    const btn = card.querySelector('[data-mp-supp]');
    if (btn) btn.addEventListener('click', () => {
      let r;
      still(() => { r = addSupplement(c.id, mpid); });
      if (!r || !r.ok) {
        if (r && r.reason === 'full') showToast('待做池已满（10 题），先清理一下再补题', 'warning');
        else if (r && r.reason === 'done') showToast('这道题已经补过了', 'info');
        else showToast('加入待做池失败', 'error');
        return;
      }
      showToast(r.existed ? '这道题已在日常区，去「日常」继续即可' : '已加入待做池，去「日常」开始补题', 'success');
      render();
    });
  });

  const finishBtn = view.querySelector('#mcFinishSuppBtn');
  if (finishBtn) finishBtn.addEventListener('click', () => {
    confirmDialog('<i class="fas fa-flag-checkered" style="color:var(--warning)"></i> 结束补题',
      '结束后本场标记为「已结束」，所有<strong>未完成</strong>的补题会从日常区收回；已完成的补题记录保留。<br>确定结束吗？').then(ok => {
      if (!ok) return;
      const r = finishSupplement(c.id);
      if (!r || !r.ok) { showToast('操作失败', 'error'); return; }
      showToast('已结束补题' + (r.removed ? '，收回 ' + r.removed + ' 道未完成任务' : ''), 'success');
      mode = 'detail'; render();
    });
  });
}

/* ============================================================
   四、已结束档案（只读）
   ============================================================ */
function detailHTML(c) {
  const st = styleOf(c.style);
  const used = (c.submittedAt || c.archivedAt || Date.now()) - (c.startedAt || c.createdAt || Date.now());
  return '<div class="mc-detail">' +
    '<div class="mc-review-top">' +
      '<button class="ck-btn ghost sm" id="mcBackBtn3"><i class="fas fa-chevron-left"></i> 列表</button>' +
      '<div class="mc-review-title">' + contestTitleHTML(c) +
        '<span class="mc-tag">' + escapeHtml(st.label) + '</span>' +
        '<span class="mc-archived-flag"><i class="fas fa-lock"></i> 已结束</span>' +
      '</div>' +
      '<div class="mc-review-meta">' + fmtDate(new Date(c.createdAt)) + ' · 赛时 ' + humanDuration(used) + '</div>' +
      '<div class="mc-score-compare">' +
        '<div><span>估分</span><b>' + sumEstimate(c) + '</b></div>' +
        '<i class="fas fa-arrow-right"></i>' +
        '<div><span>实际</span><b class="real">' + sumReal(c) + '</b></div>' +
        rankHTML(c) +
      '</div>' +
    '</div>' +
    '<div class="mc-detail-body">' + c.problems.map(detailCardHTML).join('') + '</div>' +
    '<div class="mc-review-footer">' +
      '<div class="mc-review-tip"><i class="fas fa-lock"></i> 已结束：分数与代码只读，比赛名 / 题目名仍可修改。</div>' +
      '<button class="ck-btn danger ghost" id="mcDeleteBtn"><i class="fas fa-trash-alt"></i> 删除本场记录</button>' +
    '</div>' +
  '</div>';
}

function detailCardHTML(p, i) {
  const last = latestRecord(p);
  const est = last ? (Number(last.score) || 0) : (Number(p.estScore) || 0);
  const real = Number(p.realScore) || 0;
  const diff = est - real;
  const diffHtml = diff > 0
    ? '<span class="mc-gap down">挂 ' + diff + '</span>'
    : (diff < 0 ? '<span class="mc-gap up">赚 ' + Math.abs(diff) + '</span>' : '<span class="mc-gap even">稳</span>');
  const code = String(p.code || '').trim();
  const sol = String(p.solutionCode || '').trim();
  const note = String(p.suppNote || '').trim();
  return '<section class="mc-dcard" data-mpid="' + p.id + '">' +
    '<header class="mc-dcard-head">' +
      '<span class="mc-pindex">' + letterOf(i) + '</span>' +
      '<input class="mc-pname" data-mp-name value="' + escapeHtml(p.name) + '" title="点击修改题目名称" spellcheck="false" />' +
      '<span class="mc-dcard-scores"><i>' + est + '</i><span>→</span><b>' + real + '</b>' + diffHtml + '</span>' +
    '</header>' +
    '<div class="mc-dcard-grid">' +
      '<div class="mc-rcard-col">' +
        '<label class="mc-lbl"><i class="fas fa-code"></i> 赛时代码</label>' +
        '<pre class="mc-code-block">' + (code ? escapeHtml(code) : '<span class="mc-dim">// 未保存代码</span>') + '</pre>' +
      '</div>' +
      '<div class="mc-rcard-col">' +
        '<label class="mc-lbl"><i class="fas fa-lightbulb"></i> 正解代码</label>' +
        '<pre class="mc-code-block">' + (sol ? escapeHtml(sol) : '<span class="mc-dim">// 未保存正解</span>') + '</pre>' +
      '</div>' +
    '</div>' +
    '<div class="mc-dcard-grid">' +
      '<div class="mc-rcard-col">' +
        '<label class="mc-lbl"><i class="fas fa-pen-nib"></i> 心得笔记</label>' +
        '<div class="mc-quote">' + escapeHtml(p.review || '—') + '</div>' +
      '</div>' +
      '<div class="mc-rcard-col">' +
        '<label class="mc-lbl"><i class="fas fa-book-open"></i> 补题记录</label>' +
        '<div class="mc-quote">' + (note ? escapeHtml(note) : '<span class="mc-dim">未补题</span>') + '</div>' +
      '</div>' +
    '</div>' +
  '</section>';
}

function bindDetail(c) {
  const view = host.querySelector('#mockView');
  const back = view.querySelector('#mcBackBtn3');
  if (back) back.addEventListener('click', () => { mode = 'list'; activeId = c.id; render(); });
  const del = view.querySelector('#mcDeleteBtn');
  if (del) del.addEventListener('click', () => {
    confirmDialog('<i class="fas fa-trash-alt" style="color:var(--danger)"></i> 删除档案',
      '删除模拟赛 <strong>' + escapeHtml(c.name) + '</strong> 的全部记录？不可恢复。').then(ok => {
      if (!ok) return;
      deleteContest(c.id);
      activeId = null; mode = 'list'; render();
      showToast('已删除该场记录', 'info');
    });
  });
  bindProblemNames(c, view);
}

/* ============================================================
   新建弹窗
   ============================================================ */
let pendingStyle = 'csp-s';
let pendingStartMode = 'now';

/** 时间戳 → datetime-local 输入值（本地时区） */
function toLocalInput(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function renderStylePicker() {
  const picker = document.getElementById('mockStylePicker');
  if (!picker) return;
  picker.querySelectorAll('.style-card').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === pendingStyle);
    const st = styleOf(btn.dataset.style);
    const desc = btn.querySelector('.sc-desc');
    if (desc) desc.textContent = st.desc;
    btn.style.setProperty('--sc-accent', st.accent);
  });
}

function renderStartMode() {
  const toggle = document.getElementById('mockStartToggle');
  const wrap = document.getElementById('mockStartAtWrap');
  const btn = document.getElementById('mockCreateBtn');
  if (toggle) {
    toggle.dataset.mode = pendingStartMode;
    toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === pendingStartMode));
  }
  if (wrap) wrap.style.display = pendingStartMode === 'at' ? 'block' : 'none';
  if (btn) btn.innerHTML = pendingStartMode === 'at'
    ? '<i class="fas fa-calendar-check"></i> 预约模拟赛'
    : '<i class="fas fa-flag-checkered"></i> 开始模拟';
}

function openNewModal() {
  const modal = document.getElementById('mockNewModal');
  if (!modal) return;
  pendingStyle = 'csp-s';
  pendingStartMode = 'now';
  const nameInput = document.getElementById('mockNameInput');
  if (nameInput) nameInput.value = fmtDate(new Date());
  const atInput = document.getElementById('mockStartAt');
  if (atInput) atInput.value = toLocalInput(Date.now() + 10 * 60000);
  renderStylePicker();
  renderStartMode();
  modal.classList.add('show');
  setTimeout(() => { if (nameInput) { nameInput.focus(); nameInput.select(); } }, 160);
}

function bindNewModal() {
  const modal = document.getElementById('mockNewModal');
  if (!modal || modal._bound) return;
  modal._bound = true;
  const picker = document.getElementById('mockStylePicker');
  if (picker) picker.addEventListener('click', e => {
    const btn = e.target.closest('.style-card'); if (!btn) return;
    pendingStyle = btn.dataset.style;
    renderStylePicker();
  });
  const startToggle = document.getElementById('mockStartToggle');
  if (startToggle) startToggle.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    pendingStartMode = b.dataset.mode === 'at' ? 'at' : 'now';
    renderStartMode();
  });
  const createBtn = document.getElementById('mockCreateBtn');
  if (createBtn) createBtn.addEventListener('click', () => {
    const nameInput = document.getElementById('mockNameInput');
    let startAt = null;
    if (pendingStartMode === 'at') {
      const atInput = document.getElementById('mockStartAt');
      const ts = atInput && atInput.value ? new Date(atInput.value).getTime() : NaN;
      if (!isFinite(ts)) { showToast('请选择有效的开始时间', 'warning'); return; }
      if (ts <= Date.now() + 1000) { showToast('开始时间需要晚于当前时间', 'warning'); return; }
      startAt = ts;
    }
    const c = createContest(nameInput ? nameInput.value : '', pendingStyle, { startAt });
    modal.classList.remove('show');
    activeId = c.id;
    mode = c.status === 'scheduled' ? 'waiting' : 'exam';
    render();
    if (c.status === 'scheduled') showToast('已预约：' + shortDateTime(c.scheduledAt) + ' 自动开始', 'success');
    else showToast('模拟赛开始，计时不暂停', 'success');
  });
  const nameInput = document.getElementById('mockNameInput');
  if (nameInput) nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (createBtn) createBtn.click(); }
  });
}

/* ============================================================
   生命周期
   ============================================================ */
export function init(panelEl) {
  host = panelEl;
  bindNewModal();
  // 新建按钮已在 #codexHeadActions 中，不在 panel 内
  const newBtn = document.getElementById('mockNewBtn');
  if (newBtn && !newBtn._bound) {
    newBtn._bound = true;
    newBtn.addEventListener('click', openNewModal);
  }

  onCodexChange(scope => {
    if (mute) return;
    if (scope !== 'mock' && scope !== 'daily') return;
    render();
  });

  syncContestTimers();
  const focus = pendingFocusId ? getContest(pendingFocusId) : null;
  pendingFocusId = null;
  if (focus) {
    activeId = focus.id;
    mode = modeOfContest(focus);
  } else {
    const running = getContests().find(x => x.status === 'running');
    if (running) { activeId = running.id; mode = 'exam'; } else { mode = 'list'; }
  }
  render();

  if (!tickTimer) {
    tickTimer = setInterval(() => {
      const r = syncContestTimers();
      const started = r.started || [];
      const finished = r.finished || [];
      if (started.length || finished.length) {
        started.forEach(c => showToast('模拟赛《' + c.name + '》已开始计时', 'success'));
        finished.forEach(c => showToast('《' + c.name + '》时间到，自动交卷进入复盘', 'info'));
        const affected = !!activeId && (started.some(c => c.id === activeId) || finished.some(c => c.id === activeId));
        if (affected) {
          const cur = getContest(activeId);
          if (cur) mode = modeOfContest(cur);
          render();
        } else if (mode === 'list' || mode === 'waiting') {
          render();
        }
      }
      updateCountdownDom();
      updateScheduledCards();
    }, 1000);
  }
}

export function activate() {
  syncContestTimers();
  if (pendingFocusId) {
    const c = getContest(pendingFocusId);
    pendingFocusId = null;
    if (c) { activeId = c.id; mode = modeOfContest(c); }
  }
  render();
  updateScheduledCards();
}