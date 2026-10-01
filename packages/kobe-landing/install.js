// Keep shell choice, prerequisites and copied command in one state.
(function () {
  var select = document.getElementById('installOs');
  var button = document.getElementById('copyBtn');
  if (!select || !button) return;
  var hint = document.getElementById('copyLabel');
  var timer;
  var revision = 0;
  var copy = {
    en: {
      label: 'Install on', hint: 'click to copy', done: '✓ copied', failed: 'Copy manually',
      posix: 'macOS / Linux: use a POSIX shell. Requires git and a signed-in engine CLI. The installer sets up Bun if needed.',
      windows: 'Native Windows: install Node.js and Git for Windows including Git Bash, then restart your terminal. Run this npm command in PowerShell. Install and sign in to an engine CLI separately; Rove offers to set up Bun on first launch.',
      wsl: 'WSL: run this inside your Linux distribution. Install git and your engine CLI and sign in inside WSL too. Native Windows tools and login state do not replace these Linux prerequisites.',
    },
    zh: {
      label: '安装环境', hint: '点击复制', done: '✓ 已复制', failed: '请手动复制',
      posix: 'macOS / Linux：使用 POSIX shell。需要 git 和已登录的引擎 CLI；安装脚本会在需要时配置 Bun。',
      windows: '原生 Windows：先安装 Node.js 和 Git for Windows（含 Git Bash），再重启终端。在 PowerShell 中运行下面的 npm 命令。另行安装并登录引擎 CLI；首次启动 Rove 时可安装 Bun。',
      wsl: 'WSL：在 Linux 发行版内执行。git、引擎 CLI 和登录也须在 WSL 内准备；Windows 原生工具与登录状态不能代替这些 Linux 依赖。',
    },
  };
  function words() { return document.documentElement.lang === 'zh-CN' ? copy.zh : copy.en; }
  function render() {
    revision++;
    clearTimeout(timer);
    var command = select.value === 'windows' ? 'npm install -g @sma1lboy/rove' : 'curl -fsSL https://rove.run/install.sh | sh';
    button.setAttribute('data-cmd', command);
    button.setAttribute('aria-label', words().hint + ': ' + command);
    button.querySelector('.cmd').textContent = command;
    document.getElementById('installHelp').textContent = words()[select.value];
    document.getElementById('installOsLabel').textContent = words().label;
    hint.textContent = words().hint;
    button.classList.remove('is-copied');
  }
  select.addEventListener('change', render);
  document.addEventListener('rove:language', render);
  button.addEventListener('click', async function () {
    var current = ++revision;
    clearTimeout(timer);
    button.classList.remove('is-copied');
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(button.getAttribute('data-cmd'));
      if (current !== revision) return;
      hint.textContent = words().done;
      button.classList.add('is-copied');
    } catch (error) {
      if (current !== revision) return;
      hint.textContent = words().failed;
    }
    timer = setTimeout(function () {
      hint.textContent = words().hint;
      button.classList.remove('is-copied');
    }, 2200);
  });
  // Detection is only an initial suggestion; explicit selection always wins.
  if (/Windows/i.test(navigator.userAgent || '')) select.value = 'windows';
  render();
})();
