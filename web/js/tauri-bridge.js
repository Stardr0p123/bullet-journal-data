function initTauriBridge() {
    const T = window.__TAURI__;
    if (!T) {
      const wc = document.querySelector('.window-controls');
      if (wc) wc.style.display = 'none';
      window.__TAURI_READY__ = true;
      window.dispatchEvent(new Event('tauri-ready'));
      return;
    }
    const { getCurrentWindow } = T.window;
    const { save } = T.dialog;
    const { writeTextFile } = T.fs;
    const { open: shellOpen } = T.shell;
    const win = getCurrentWindow();
    window.electronAPI = {
      windowControls: {
        close: () => win.close(),
        minimize: () => win.minimize(),
        toggleMaximize: async () => { await win.toggleMaximize(); return await win.isMaximized(); },
        isMaximized: () => win.isMaximized()
      },
      saveFile: async (fileName, content) => {
        const path = await save({
          defaultPath: fileName,
          filters: [
            { name: 'JSON 文件', extensions: ['json'] },
            { name: 'TSV 文件', extensions: ['tsv'] },
            { name: '文本文件', extensions: ['txt'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        });
        if (!path) throw new Error('用户取消保存');
        await writeTextFile(path, content);
        return { path };
      }
    };
    const _origOpen = window.open;
    window.open = (url, ...rest) => {
      if (typeof url === 'string' && /^https?:\/\//.test(url)) { shellOpen(url); return null; }
      return _origOpen.call(window, url, ...rest);
    };
    window.__TAURI_READY__ = true;
    window.dispatchEvent(new Event('tauri-ready'));
  }
  let tries = 0;
  (function waitTauri() {
    if (window.__TAURI__ || tries++ > 100) { initTauriBridge(); }
    else { setTimeout(waitTauri, 20); }
  })();