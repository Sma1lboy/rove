// EN / 中文 — one page, two language versions. Terminal-mock content
// (commands, branch names, TUI chrome) deliberately stays English.
var ROVE_I18N = (function () {
  var zh = {
    'meta.title': 'Rove：一个终端工作区，跑所有编程 agent',
    'meta.desc': '终端里的编程 agent 工作区。在同一个窗口并行运行 Claude Code、Codex、Gemini CLI、Copilot 等工具，每个任务独立占用一个 git worktree。支持限额换手、agent 互派任务、远程机器与定时运行，断开终端任务不中断。',
    'hero.title': '一个终端工作区<span class="thin">，<span class="nb">跑所有编程 agent。</span></span>',
    'hero.sub': '在同一个终端里并行跑 Claude Code、Codex、Gemini 等 CLI，每个任务独立一个 git worktree。一个额度用完就换另一个接着干，agent 之间直接派活，断开终端也继续跑。',
    'hero.engines': '直接调用你本机已装的 CLI',
    'scene.dispatch': 'agent 互派任务', 'scene.preview': '边写边预览',
    'scene.previewAlt': 'Rove 桌面端动画演示：Claude Code 起了开发服务器，一段一段写出夏季促销页；旁边的 Browser 面板里，标题、三件商品、邮箱订阅框依次出现，最后样式写完，整页换成成品的样子。',
    'scene.swap': '限额换 agent', 'scene.machines': '远程机器', 'scene.routine': '定时任务', 'scene.split': '分屏评审',
    'scene.routineAlt': 'Rove 终端动画演示：定时任务页列出三条计划任务；早上 9 点「Dependency check」自动触发，查出三个过期依赖、跑过 212 项测试、提交 PR #412，结果进入收件箱。',
    'scene.dispatchAlt': 'Rove 终端动画演示：Claude Code 把「收藏夹」功能拆成两个子任务，接口交给另一个 Claude Code，页面交给 Codex。两个子任务并排同时干活，各用各的终端界面；然后回到最初的 agent，两边回报结果，它把前后端接起来。',
    'scene.swapAlt': 'Rove 终端动画演示：Claude Code 干到一半触及用量上限，任务切给 Codex；Codex 读取此前的对话记录，在同一分支上完成剩余步骤。',
    'scene.machinesAlt': 'Rove 动画演示：新建任务时的机器菜单里有本机、两台已登记的机器和 E2B 沙箱。第一个任务派到 gpu-box，训练命令在那边跑，结果回报到这里。第二个任务选了 E2B 沙箱：沙箱启动，跑完端到端测试，回报有一个用例失败。',
    'scene.splitAlt': 'Rove 终端动画演示：同一任务左右分屏，左侧 Claude Code 修改优惠券上限逻辑，右侧 Codex 审查 diff 并指出 NaN 和分位舍入两个问题，左侧随即一并修复。',
    'get.h': '获取 Rove',
    'get.tui': '终端版',
    'get.stable': '稳定版',
    'get.stableD': '完整测试通过的正式版，推荐首选。',
    'get.next': 'Next',
    'get.nextD': '每次合并到 main 后几分钟发布，仅跑快速检查。',
    'get.nightly': 'Nightly',
    'get.nightlyD': '每日构建，全部测试通过后发布。',
    'get.switch': '已安装可通过 <span class="mono">rove update --next</span>、<span class="mono">--nightly</span> 或 <span class="mono">--stable</span> 切换渠道；Windows 请在 PowerShell 中运行 npm 命令。',
    'get.apps': '应用',
    'get.desktop': '<b>桌面应用。</b>独立窗口加原生通知，直连同一个本地 daemon。请先安装上面的终端版。',
    'get.desktopNote': 'Windows 安装包暂未签名，首次运行请点击「更多信息」→「仍要运行」。',
    'get.dlMac': 'macOS（Apple 芯片）', 'get.dlIntel': 'macOS（Intel）',
    'get.phone': '<b>iOS 与 Android。</b>在手机上查看输出、回复确认、新建任务。暂未上架应用商店，可<a href="https://docs.rove.run/rove/ios">从源码构建</a>，或直接在手机浏览器打开 <span class="mono">rove --web</span>。',
    'hero.alts': '或者用',
    'copy.short': '复制',
    'copy.hint': '点击复制', 'copy.done': '✓ 已复制',

    'sheet.skip': '跳到正文',
    'sheet.nav.docs': '文档', 'sheet.nav.plugins': '插件',
    'sheet.nav.themes': '主题', 'sheet.nav.changelog': '更新日志', 'sheet.nav.github': 'GitHub',

    'can.h': '为并行开发而设计',
    'can.1': '独立 worktree', 'can.1d': '每个任务自带独立的 git worktree 和分支。重构、修 bug、做评审同时跑，互不覆盖。',
    'can.2': '限额换手', 'can.2d': '任务做到一半额度见底，直接切给另一个 agent。它会读完此前的对话，在同一分支上继续干。',
    'can.3': 'agent 互派任务', 'can.3d': '一个 agent 可以直接拆分子任务交给其他 agent，完成后回报自动回到它的标签页。',
    'can.4': '后台持久会话', 'can.4d': '关掉终端、断掉 SSH，托管 PTY 会话依然在宿主机运行；随时重连，现场都在。',
    'can.5': '远程机器', 'can.5d': '通过 SSH 接入另一台开发机或 GPU 服务器。任务统一显示在侧栏，文件和命令留在远端执行。',
    'can.6': '定时任务', 'can.6d': '给提示词配好 cron 计划。到点自动拉起真实任务，醒来就能看 diff、接着追问。',
    'can.7': '收件箱与 PR', 'can.7d': '跑完的和等你确认的汇总在一个列表里，直接看 diff 批注，满意就地开 PR。',
    'can.8': '桌面、网页与手机', 'can.8d': '同一批运行中的会话，在桌面窗口、浏览器（rove --web）或手机上都能随时接入。',

    'footer.plugins': '插件', 'footer.themesLink': '主题', 'footer.changelog': '更新日志', 'footer.docs': '文档', 'footer.keybindings': '快捷键',
    'ga.copyright': '© 2026 Sma1lboy。MIT 许可。',
  };
  var en = {
    'meta.title': 'Rove: One workspace for every coding agent',
    'meta.desc': 'An agent workspace for your terminal. Run Claude Code, Codex, Gemini CLI, Copilot, and more side by side, each task in its own git worktree. Switch agents on quota limits, delegate across agents, schedule routines, and disconnect without stopping work.',
    'hero.title': 'One workspace <span class="thin">for <span class="nb">every coding agent.</span></span>',
    'hero.sub': 'Run Claude Code, Codex, Gemini, and more side by side in one terminal, each task in its own git worktree. Switch agents when one hits its limit, let them hand work to each other, and disconnect while they keep working.',
    'hero.engines': 'Runs the CLIs already on your PATH',
    'scene.dispatch': 'Delegate to agents', 'scene.preview': 'Live preview',
    'scene.previewAlt': 'Animated Rove desktop demo: Claude Code starts a dev server and writes a summer sale page piece by piece. In the Browser panel beside it the headline, three products and an email signup appear one after another, and when the stylesheet lands the page takes its finished look.',
    'scene.swap': 'Switch on quota', 'scene.machines': 'Remote machines', 'scene.routine': 'Scheduled runs', 'scene.split': 'Side-by-side review',
    'scene.routineAlt': 'Animated Rove terminal demo: the Routines view lists three scheduled prompts; at 09:00 the dependency check fires automatically, updates three outdated packages, runs 212 tests, opens PR #412, and notifies the inbox.',
    'scene.dispatchAlt': 'Animated Rove terminal demo: Claude Code splits a wishlist feature into two child tasks, the API on another Claude Code and the page on Codex. The two children run side by side, each in its own terminal, then the view returns to the first agent as both report back and it wires the two together.',
    'scene.swapAlt': 'Animated Rove terminal demo: Claude Code hits its usage limit mid-task; the task switches to Codex, which reads the prior transcript and finishes the remaining steps on the same branch.',
    'scene.machinesAlt': 'Animated Rove demo: the machine menu of a new task lists this Mac, two registered machines and an E2B sandbox. The first task is sent to gpu-box, where the training commands run and the score comes back. A second task picks the E2B sandbox, which starts, runs the end-to-end suite and reports one failing test.',
    'scene.splitAlt': 'Animated Rove terminal demo: one task split into two panes; Claude Code clamps coupon percentages on the left, Codex reviews the diff on the right and flags NaN input and cent rounding, and Claude Code fixes both.',
    'get.h': 'Get Rove',
    'get.tui': 'Terminal app',
    'get.stable': 'Stable',
    'get.stableD': 'Full test suite passed. Start here.',
    'get.next': 'Next',
    'get.nextD': 'Published minutes after each merge to main; fast checks only.',
    'get.nightly': 'Nightly',
    'get.nightlyD': 'Daily build after the full suite goes green.',
    'get.switch': 'Already installed? Switch channels with <span class="mono">rove update --next</span>, <span class="mono">--nightly</span>, or <span class="mono">--stable</span>. On Windows, run the npm command in PowerShell.',
    'get.apps': 'Apps',
    'get.desktop': '<b>Desktop app.</b> Dedicated window with native notifications, backed by the same local daemon. Install the CLI above first.',
    'get.desktopNote': 'Windows builds are unsigned for now: click More info → Run anyway on first launch.',
    'get.dlMac': 'macOS, Apple silicon', 'get.dlIntel': 'macOS, Intel',
    'get.phone': '<b>iOS &amp; Android.</b> Check output, unblock agents, and start tasks from your phone. Not in app stores yet: <a href="https://docs.rove.run/rove/ios">build from source</a>, or open <span class="mono">rove --web</span> in your mobile browser.',
    'hero.alts': 'or with',
    'copy.short': 'copy',
    'copy.hint': 'click to copy', 'copy.done': '✓ copied',

    'sheet.skip': 'Skip to content',
    'sheet.nav.docs': 'Docs', 'sheet.nav.plugins': 'Plugins',
    'sheet.nav.themes': 'Themes', 'sheet.nav.changelog': 'Changelog', 'sheet.nav.github': 'GitHub',

    'can.h': 'Built for parallel work',
    'can.1': 'Isolated worktrees', 'can.1d': 'Every task gets its own git worktree and branch. Run a refactor, a fix, and a review in parallel without colliding.',
    'can.2': 'Quota handoff', 'can.2d': 'Hit a usage limit mid-task? Switch the task to another agent. It reads the transcript and picks up on the same branch.',
    'can.3': 'Agent dispatch', 'can.3d': 'One agent spawns child tasks on other agents, delegates pieces of the job, and gets reports back in its own tab.',
    'can.4': 'Detached sessions', 'can.4d': 'Close the terminal or drop SSH. Hosted PTY sessions stay alive on the host until you reattach.',
    'can.5': 'Remote machines', 'can.5d': 'Add a workstation or GPU box over SSH. Its tasks live in the same sidebar while files and commands stay there.',
    'can.6': 'Routines', 'can.6d': 'Put a prompt on a cron schedule. Rove starts a real task on time so you can inspect the diff and follow up.',
    'can.7': 'Inbox & PRs', 'can.7d': 'See finished runs and blocked agents in one queue, review diffs inline, and open a PR from the task.',
    'can.8': 'Web, desktop & phone', 'can.8d': 'Attach to the same live sessions from a desktop window, any browser (rove --web), or your phone.',

    'footer.plugins': 'Plugins', 'footer.themesLink': 'Themes', 'footer.changelog': 'Changelog', 'footer.docs': 'Docs', 'footer.keybindings': 'Keybindings',
    'ga.copyright': '© 2026 Sma1lboy. MIT license.',
  };
  var dicts = { en: en, zh: zh };
  var lang = 'en';
  try {
    var fromUrl = new URLSearchParams(location.search).get('lang');
    var stored = localStorage.getItem('rove_lang');
    var nav = (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    lang = fromUrl === 'zh' || fromUrl === 'en' ? fromUrl : stored === 'zh' || stored === 'en' ? stored : nav;
  } catch (e) {}

  function t(key) { return dicts[lang][key] || dicts.en[key] || ''; }

  // demo.js announces the scene it plays; its description is the window's accessible name.
  var scene = 'dispatch';
  function showScene(name) {
    scene = name;
    var wrap = document.getElementById('demoWrap');
    if (wrap) wrap.setAttribute('aria-label', t('scene.' + name + 'Alt'));
  }
  document.addEventListener('rove:scene', function (e) { showScene(e.detail); });

  function apply() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = t('meta.title');
    var desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', t('meta.desc'));
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = t(el.getAttribute('data-i18n'));
      if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var v = t(el.getAttribute('data-i18n-html'));
      if (v) el.innerHTML = v;
    });
    showScene(scene);
    document.dispatchEvent(new Event('rove:language'));
    var label = document.getElementById('copyLabel');
    if (label) label.textContent = t('copy.hint');
    var toggle = document.getElementById('langToggle');
    if (toggle) {
      toggle.textContent = lang === 'zh' ? 'EN' : '中文';
      // the label names the OTHER language — tag it so screen readers switch voice
      toggle.lang = lang === 'zh' ? 'en' : 'zh-CN';
    }
  }

  var toggleBtn = document.getElementById('langToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      lang = lang === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem('rove_lang', lang); } catch (e) {}
      // The browser cross-fades the two languages; without the API, or with reduced motion, it just swaps.
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply);
      else apply();
    });
  }
  apply(); // first paint: honors ?lang= / stored pref / browser language

  // The marquee loops over two copies of the list; with reduced motion it stays one wrapped row.
  var mq = document.getElementById('engineMarquee');
  if (mq && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var copy = mq.firstElementChild.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    mq.appendChild(copy);
    mq.classList.add('is-on');
  }

  return { t: t };
})();

// live GitHub star count (cache for instant first paint, refresh each load, graceful fallback)
(function () {
  var el = document.getElementById('starCount');
  if (!el) return;
  function render(n) {
    el.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }
  var CACHE_KEY = 'rove_stars';
  try {
    var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && typeof cached.n === 'number') render(cached.n);
  } catch (e) {}
  fetch('https://api.github.com/repos/Sma1lboy/rove')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || typeof d.stargazers_count !== 'number') return;
      render(d.stargazers_count);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ n: d.stargazers_count })); } catch (e) {}
    })
    .catch(function () { if (el.textContent === '–') el.textContent = '☆'; });
})();
