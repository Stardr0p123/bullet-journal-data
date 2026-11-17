import { $, lsGet, showToast } from '../../js/core.js';
import { applyFont, applyFsize, FONT_KEY, FSIZE_KEY } from '../../js/features/theme.js';
import { openTour } from '../../js/features/tour.js';
import {
  loadGitHubSettings, saveGitHubSettings, uploadToGit, importFromGit,
  getGHSettings, exportData, importData, confirmClearAll, openShortcuts
} from '../../js/app.js';

function syncFontBtns() {
  const curFont = lsGet(FONT_KEY) || 'default';
  const curFsize = lsGet(FSIZE_KEY) || 'm';
  document.querySelectorAll('#fontOpts .set-opt').forEach(b => b.classList.toggle('active', b.dataset.font === curFont));
  document.querySelectorAll('#fsizeOpts .set-opt').forEach(b => b.classList.toggle('active', b.dataset.fsize === curFsize));
}

export function init(panelEl) {
  syncFontBtns();

  panelEl.querySelector('#fontOpts').addEventListener('click', e => {
    const b = e.target.closest('.set-opt'); if (b) applyFont(b.dataset.font);
  });
  panelEl.querySelector('#fsizeOpts').addEventListener('click', e => {
    const b = e.target.closest('.set-opt'); if (b) applyFsize(b.dataset.fsize);
  });

  loadGitHubSettings();

  panelEl.querySelector('#uploadToGitBtn').addEventListener('click', uploadToGit);
  panelEl.querySelector('#importFromGitBtn').addEventListener('click', importFromGit);
  panelEl.querySelector('#linkToGitBtn').addEventListener('click', () => {
    const s = getGHSettings();
    if (!s.username || !s.repo) { showToast('请填写用户名和仓库', 'warning'); return; }
    saveGitHubSettings();
    window.open('https://github.com/' + s.username + '/' + s.repo, '_blank');
  });

  panelEl.querySelector('#exportDataBtn').addEventListener('click', exportData);
  panelEl.querySelector('#importDataBtn2').addEventListener('click', () => $('importFile').click());
  panelEl.querySelector('#importFile').addEventListener('change', importData);
  panelEl.querySelector('#clearAllBtn').addEventListener('click', confirmClearAll);
  panelEl.querySelector('#openTourBtn2').addEventListener('click', () => {
    $('treasureModal').classList.remove('show');
    setTimeout(openTour, 200);
  });
  panelEl.querySelector('#openShortcutsBtn2').addEventListener('click', () => {
    $('treasureModal').classList.remove('show');
    setTimeout(openShortcuts, 180);
  });
}

export function activate() {
  syncFontBtns();
  loadGitHubSettings();
}