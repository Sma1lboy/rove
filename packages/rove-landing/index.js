// EN / 中文 — one page, two language versions. Terminal-mock content
// (commands, branch names, TUI chrome) deliberately stays English.
var ROVE_I18N = (function () {
  var zh = {
    'meta.title': 'Rove：所有编程 agent，都在一个地方',
    'meta.desc': 'Rove 是终端里的 agent 开发环境（ADE）。Claude Code、Codex、Copilot 等编程 agent 在同一个窗口里并排工作，各自拥有独立的 git worktree，还能互相派活；断开连接后会话继续运行。',
    'hero.title': '所有编程 agent<span class="thin">，<span class="nb">都在一个地方。</span></span>',
    'hero.sub': '没有哪个 agent 样样都强，额度也都会用完。Rove 把它们放进同一个终端：一个写，一个查；谁的额度用完了，换下一个接着干。',
    'why.h': '为什么要不止一个 agent？',
    'why.p1': '<b>一个写，一个查。</b>在同一个任务里再开一个 tab，让 Codex 审 Claude 刚写的代码。它有自己的对话，读的是同一批文件。',
    'why.p2': '<b>额度用完，活不停。</b>干到一半额度没了，把任务换给另一个 agent。它读一遍前一个做了什么，从那里接着干。',
    'why.p3': '<b>它们直接对话，不用你传话。</b>没有 Rove 时，每个 agent 各占一个窗口，你在中间复制粘贴。在这里，一个 agent 把活交给另一个，回报自己送回来。',
    'hero.engines': '支持 Claude Code、Codex、Copilot、Gemini CLI、OpenCode 等。',
    'hero.firstTasks': '下一步：完成前两个任务 →',
    'hero.alts': '或者用',
    'copy.hint': '点击复制', 'copy.done': '✓ 已复制',

    'sheet.skip': '跳到正文',
    'sheet.nav.docs': '文档', 'sheet.nav.plugins': '插件',
    'sheet.nav.themes': '主题', 'sheet.nav.changelog': '更新日志', 'sheet.nav.github': 'GitHub',

    's1.h': '装上以后长这样',
    's1.bar': 'Rove：3 个仓库，4 个任务，后台运行',
    's1.tasks': '任务',
    's1.p1': '左边是你的任务。点一个，中间是它的 agent 在干活，旁边是 shell 和改过的文件。',
    's1.p2': '侧栏里的每个状态标记，<a href="https://docs.rove.run">文档</a>里都有说明。',

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
    'meta.title': 'Rove: all your coding agents, in one place',
    'meta.desc': 'Rove is an agentic development environment (ADE) for your terminal. Claude Code, Codex, Copilot and more work side by side in one window, each in its own git worktree, and hand tasks to each other. Sessions keep running when you disconnect.',
    'hero.title': 'All your coding agents, <span class="thin"><span class="nb">in one place.</span></span>',
    'hero.sub': 'No single agent is best at everything, and every one of them runs out of quota. Rove puts them in one terminal: one writes, another reviews, and when one hits its limit the next picks up the task.',
    'why.h': 'Why more than one agent?',
    'why.p1': '<b>One writes, another reviews.</b> Open a second tab in the task and ask Codex to review what Claude wrote. It has its own conversation and reads the same files.',
    'why.p2': '<b>A usage limit doesn\'t stop the task.</b> When one agent hits its limit mid-task, switch the task to another one. It reads what the first one did and continues from there.',
    'why.p3': '<b>They talk to each other, not through you.</b> Without Rove, each agent sits in its own window and you copy text between them. Here one agent hands a task to another and gets the report back by itself.',
    'hero.engines': 'Works with Claude Code, Codex, Copilot, Gemini CLI, OpenCode and more.',
    'hero.firstTasks': 'Next: complete your first two tasks →',
    'hero.alts': 'or with',
    'copy.hint': 'click to copy', 'copy.done': '✓ copied',

    'sheet.skip': 'Skip to content',
    'sheet.nav.docs': 'Docs', 'sheet.nav.plugins': 'Plugins',
    'sheet.nav.themes': 'Themes', 'sheet.nav.changelog': 'Changelog', 'sheet.nav.github': 'GitHub',

    's1.h': 'What it looks like',
    's1.bar': 'Rove: 3 repos, 4 tasks, running in the background',
    's1.tasks': 'Tasks',
    's1.p1': 'Your tasks are on the left. Pick one to see its agent working in the middle, with a shell and the changed files beside it.',
    's1.p2': 'Every status mark in the sidebar is listed in the <a href="https://docs.rove.run">docs</a>.',

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
