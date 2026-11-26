// EN / 中文 — one page, two language versions. Terminal-mock content
// (commands, branch names, TUI chrome) deliberately stays English.
var ROVE_I18N = (function () {
  var zh = {
    'meta.title': 'Rove：各种编程 agent 都能用的 agent workspace',
    'meta.desc': 'Rove 是终端里的 agent workspace，Claude Code、Codex、Copilot、Gemini CLI、OpenCode 等编程 agent 都能放进来一起跑。Claude Code 额度用完了，可以把任务换给 Codex 或别的 agent 接着干；agent 之间直接派活，关掉终端它们也继续干活。',
    'hero.title': 'Agent workspace<span class="thin">，<span class="nb">各种编程 agent 都能用。</span></span>',
    'hero.sub': 'Rove 把你已经在用的编程 agent 放进同一个终端一起跑。一个额度用完了，把任务换给另一个接着干；它们之间直接对话，不用你来回传话。',
    'why.h': '多开几个 agent 的两个好处',
    'why.p2': '<b>额度用完了，就换一个 agent。</b>Claude Code 干到一半额度没了，把任务换给 Codex 或者别的 agent。它读一遍前一个做了什么，从那里接着干。',
    'why.p3': '<b>agent 之间直接对话。</b>没有 Rove 时，每个 agent 各占一个窗口，你在中间复制粘贴。在这里，一个 agent 把活交给另一个，回报自己送回来。',
    'hero.engines': '你已经在用的 agent 都能接进来',
    'scene.dispatch': '把活分给别的 agent', 'scene.swap': '额度用完，换一个接着干', 'scene.machines': '跑在别的机器上', 'scene.routine': '定时自动跑', 'scene.split': '两个 agent 并排',
    'scene.routineAlt': 'Rove 界面的动画演示：例行任务列表里有三条定时任务；到了早上 9 点，「检查依赖」自己启动，agent 查出三个过期的依赖、跑完测试、开好 PR，结果进到收件箱。',
    'scene.dispatchAlt': 'Rove 界面的动画演示：Claude Code 把一件事拆成三份，自己做一份，另外两份交给 Codex 和 Gemini；两个子任务出现在侧栏里，做完后把结果报回来。',
    'scene.swapAlt': 'Rove 界面的动画演示：Claude Code 做到一半额度用完，任务换给 Codex；Codex 读完之前的对话，在同一个分支上接着做完。',
    'scene.machinesAlt': 'Rove 界面的动画演示：在这台电脑上新建任务时选了另一台机器 gpu-box，文件和命令都在那台机器上，训练结果报回到这里。',
    'scene.splitAlt': 'Rove 界面的动画演示：同一个任务分成两栏，左边 Claude Code 改代码，右边 Codex 审这份改动并指出一个 bug，左边随后修掉。',
    'get.h': '获取 Rove',
    'get.tui': '终端版',
    'get.stable': '稳定版',
    'get.stableD': '测试过的正式版本。第一次用就装这个。',
    'get.next': 'Next',
    'get.nextD': '每个改动合并后几分钟你就能装到，测试跑得少一些。',
    'get.nightly': 'Nightly',
    'get.nightlyD': '每天早上出一版，全部测试通过后才发。',
    'get.switch': '已经装了的话，用 <span class="mono">rove update --next</span>、<span class="mono">--nightly</span> 或 <span class="mono">--stable</span> 切换。Windows 上在 PowerShell 里用 npm 那条命令。',
    'get.apps': '应用',
    'get.desktop': '<b>桌面版。</b>Rove 有自己的窗口，不用一直开着终端。先装上面的终端版，桌面版要靠它运行。',
    'get.desktopNote': 'Windows 安装包还没有签名，第一次运行时系统会拦一下：点「更多信息」，再点「仍要运行」。',
    'get.dlMac': 'macOS（Apple 芯片）', 'get.dlIntel': 'macOS（Intel）',
    'get.phone': '<b>手机：iOS 和 Android。</b>在手机上看输出、回答问题、开任务。还没上架应用商店：<a href="https://docs.rove.run/rove/ios">从源码构建</a>，或者现在就在手机浏览器里打开 <span class="mono">rove --web</span>。',
    'hero.alts': '或者用',
    'copy.short': '复制',
    'copy.hint': '点击复制', 'copy.done': '✓ 已复制',

    'sheet.skip': '跳到正文',
    'sheet.nav.docs': '文档', 'sheet.nav.plugins': '插件',
    'sheet.nav.themes': '主题', 'sheet.nav.changelog': '更新日志', 'sheet.nav.github': 'GitHub',

    'can.h': '装上以后能做什么',
    'can.1': '新建任务', 'can.1d': '打一句话。Rove 给这个 agent 单独一份代码去改，不会碰到别的任务。',
    'can.2': '任选 agent', 'can.2d': 'Claude Code、Codex、Copilot、Gemini CLI，还有十几个。每个任务挑一个。',
    'can.3': '互相派活', 'can.3d': '一个 agent 可以把一部分活交给另一个，做完把结果拿回来。',
    'can.4': '关了也在跑', 'can.4d': '关掉终端或者断网，只要电脑没休眠，agent 就继续干活；回来时一切都还在。',
    'can.5': '收件箱', 'can.5d': '谁做完了、谁在等你回话，都在一个列表里。',
    'can.6': '开 PR', 'can.6d': '任务做完，不用离开 Rove 就能提 PR。',
    'can.7': '例行任务', 'can.7d': '给一句话定个时间，比如每天早上 9 点，Rove 到点自己开任务。',
    'can.8': '网页和手机', 'can.8d': '同一批会话，在浏览器和手机上都能打开。',
    'can.more': 'Rove 用的是你已经装好的 agent，所以先装一个并登录，比如 Claude Code 或 Codex。每项功能怎么用，见<a href="https://docs.rove.run">文档</a>。',

    'footer.plugins': '插件', 'footer.themesLink': '主题', 'footer.changelog': '更新日志', 'footer.docs': '文档', 'footer.keybindings': '快捷键',
    'ga.copyright': '© 2026 Sma1lboy。MIT 许可。',
  };
  var en = {
    'meta.title': 'Rove: the agent workspace for every coding agent',
    'meta.desc': 'Rove is an agent workspace for your terminal. It runs Claude Code, Codex, Copilot, Gemini CLI, OpenCode and other coding agents side by side. When one runs out of quota, you switch the task to another and it continues. Agents hand work to each other directly, and they keep working after you close the terminal.',
    'hero.title': 'The agent workspace <span class="thin">for <span class="nb">every coding agent.</span></span>',
    'hero.sub': 'Rove runs the coding agents you already have, side by side in one terminal. When one runs out of quota, switch the task to another and it continues. They also talk to each other directly, so you stop passing messages between them.',
    'why.h': 'Two things you get from more than one agent',
    'why.p2': '<b>When one agent runs out of quota, switch to another.</b> When Claude Code hits its usage limit halfway through a task, switch the task to Codex or any other agent. It reads what the first one did and continues from there.',
    'why.p3': '<b>Agents talk to each other directly.</b> Without Rove, each agent sits in its own window and you copy text between them. Here one agent hands a task to another and gets the report back by itself.',
    'hero.engines': 'Works with the agents you already have',
    'scene.dispatch': 'Hand work to other agents', 'scene.swap': 'Switch agent when quota runs out', 'scene.machines': 'Run on another machine', 'scene.routine': 'Run on a schedule', 'scene.split': 'Two agents side by side',
    'scene.routineAlt': 'An animated drawing of Rove. The Routines page lists three scheduled prompts. At 09:00 the dependency check starts by itself: the agent finds three outdated packages, runs the tests, opens a pull request, and the result lands in the inbox.',
    'scene.dispatchAlt': 'An animated drawing of Rove. Claude Code splits a job in three, keeps one part, and hands the other two to Codex and Gemini. The two child tasks appear in the sidebar and report back when they finish.',
    'scene.swapAlt': 'An animated drawing of Rove. Claude Code runs out of quota halfway through a task. The task moves to Codex, which reads the earlier conversation and finishes on the same branch.',
    'scene.machinesAlt': 'An animated drawing of Rove. A new task is started from this computer on another machine, gpu-box. Its files and commands are on that machine, and the training result is reported back here.',
    'scene.splitAlt': 'An animated drawing of Rove. One task is split into two panes: Claude Code changes the code on the left, Codex reviews the change on the right and points out a bug, and Claude Code fixes it.',
    'get.h': 'Get Rove',
    'get.tui': 'Terminal app',
    'get.stable': 'Stable',
    'get.stableD': 'The tested release. Install this one if you are new.',
    'get.next': 'Next',
    'get.nextD': 'You get every change a few minutes after it is merged. It has had fewer tests.',
    'get.nightly': 'Nightly',
    'get.nightlyD': 'You get one new build each morning, after all the tests have passed.',
    'get.switch': 'If Rove is already installed, switch with <span class="mono">rove update --next</span>, <span class="mono">--nightly</span> or <span class="mono">--stable</span>. On Windows use the npm command in PowerShell.',
    'get.apps': 'Apps',
    'get.desktop': '<b>Desktop app.</b> Rove in its own window, so you don\'t need to keep a terminal open. Install the terminal app above first, because the desktop app runs it for you.',
    'get.desktopNote': 'The Windows installer is not signed yet, so Windows asks once: choose More info, then Run anyway.',
    'get.dlMac': 'macOS, Apple silicon', 'get.dlIntel': 'macOS, Intel',
    'get.phone': '<b>Phone: iOS and Android.</b> Read output, answer questions and start tasks from your phone. Not in the app stores yet: <a href="https://docs.rove.run/rove/ios">build it from source</a>, or open <span class="mono">rove --web</span> in your phone browser today.',
    'hero.alts': 'or with',
    'copy.short': 'copy',
    'copy.hint': 'click to copy', 'copy.done': '✓ copied',

    'sheet.skip': 'Skip to content',
    'sheet.nav.docs': 'Docs', 'sheet.nav.plugins': 'Plugins',
    'sheet.nav.themes': 'Themes', 'sheet.nav.changelog': 'Changelog', 'sheet.nav.github': 'GitHub',

    'can.h': 'What you can do',
    'can.1': 'New task', 'can.1d': 'Type one sentence. Rove gives the agent its own copy of your code to work on, so nothing else gets touched.',
    'can.2': 'Any agent', 'can.2d': 'Claude Code, Codex, Copilot, Gemini CLI and a dozen more. Pick one per task.',
    'can.3': 'Hand off', 'can.3d': 'An agent can pass part of the job to another agent and get the result back.',
    'can.4': 'Keeps running', 'can.4d': 'Close the terminal or lose your connection. The agents keep working while the computer is awake, and everything is there when you come back.',
    'can.5': 'Inbox', 'can.5d': 'One list of the agents that finished and the ones waiting for your answer.',
    'can.6': 'Pull request', 'can.6d': 'Turn a finished task into a pull request without leaving Rove.',
    'can.7': 'Routines', 'can.7d': 'Give a prompt a schedule, like every morning at 9, and Rove starts the task for you.',
    'can.8': 'Web and phone', 'can.8d': 'Open the same sessions in a browser or on your phone.',
    'can.more': 'Rove runs agents you already have, so install and sign in to one first, such as Claude Code or Codex. How each feature works is in the <a href="https://docs.rove.run">docs</a>.',

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
      apply();
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
