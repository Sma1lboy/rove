// EN / 中文 — one page, two language versions. Terminal-mock content
// (commands, branch names, TUI chrome) deliberately stays English.
var ROVE_I18N = (function () {
  var zh = {
    'meta.title': 'Rove — 装在你 shell 里的 agent 多路复用器',
    'meta.desc': 'Rove 是终端里的编码代理多路复用器：N 个彼此隔离的尝试，各自拥有 git worktree 和托管引擎会话，互相发消息协作——而这一整套就跑在一个你随时能关掉的 SSH 会话里。',
    'hero.title': '并行编码 agent<span class="thin">，<span class="nb">就在终端里。</span></span>',
    'hero.sub': '一个托管任务，一个 worktree，一条分支。并行工作在保持唤醒的主机上运行；断开终端后，再通过 SSH 接回来。',
    'hero.engines': '支持 Claude Code、Codex、Copilot、Gemini CLI、OpenCode 等。',
    'hero.firstTasks': '下一步：完成前两个任务 →',
    'hero.alts': '或者用',
    'copy.hint': '点击复制', 'copy.done': '✓ 已复制',

    'sheet.skip': '跳到正文',
    'sheet.nav.docs': '文档', 'sheet.nav.plugins': '插件',
    'sheet.nav.themes': '主题', 'sheet.nav.changelog': '更新日志', 'sheet.nav.github': 'GitHub',

    's1.h': '所有任务，一个终端',
    's1.bar': 'Rove：3 个仓库，4 个任务，后台运行',
    's1.tasks': '任务',
    's1.p1': '点一个任务，看它的 tab。每个引擎都在后台运行，没人接管。',
    's1.p2': '侧栏里的每个状态标记，<a href="https://docs.rove.run">文档</a>里都有说明。',

    's2.h': '任务就是 worktree、分支和 tab',
    's2.th1': '部分', 's2.th2': '每个任务', 's2.th3': '是什么',
    's2.r1n': 'Git worktree', 's2.r1d': '磁盘上自己的 checkout',
    's2.r2n': '分支', 's2.r2d': '任务创建时切出',
    's2.r3n': '终端 tab', 's2.r3d': '同一批文件，各自的对话',
    's2.tnote': 'project-main 任务复用一份已保存的 checkout，directory 任务复用你自己的目录。这两种都没有自己的 worktree 和分支。',
    's2.p1': 'Task 是 Rove 隔离的单位：一个 git worktree、一个分支，和开在里面的终端 tab。一条 prompt 可以生成好几个。',
    's2.p2': 'Task 内部再开 tab，是另一个代理动同一批文件、各自一份对话。split 只是把屏幕切开。',

    's3.h': '隔离',
    's3.r1': '新任务', 's3.r1d': '独占 worktree 和分支',
    's3.r2': '新 tab', 's3.r2d': '各自的对话，同一批文件',
    's3.r3': '新分屏', 's3.r3d': '同一个 tab，屏幕分成两块',
    's3.p1': '每往下一级，隔离就少一档。',
    's3.p2': '两个代理不能碰对方的文件：给两个 Task。一个要读另一个刚写的东西：给一个 Tab。',

    's4.h': '扇出，扇入',
    's4.prompt': '1 条 prompt',
    's4.round': '一轮生成 5 个任务，各自独占 worktree 和分支，并返回一个 group id。',
    's4.p2': '一轮跑完，<span class="mono">rove api collect --group &lt;id&gt;</span> 一次调用读完整轮：分支、diff 大小、检查、每个 worker 自己的回报。<span class="mono">rove api land --task-id &lt;id&gt;</span> 合入赢的那个。输的分支留在磁盘上。',
    's4.p3': '<b>代理之间是对等的。</b>worker 用一句裸的 <span class="mono">rove api send</span> 回报。Rove 记着谁派生了谁，回复直接送到对应的 tab。没有协调进程。',

    's5.h': '断开连接后继续运行',
    's5.th1': '部分', 's5.th2': '断开后',
    's5.r1n': '你的 TUI', 's5.r1d': '脱离',
    's5.r2n': 'Rove daemon', 's5.r2d': '继续托管引擎的 PTY',
    's5.r3n': '远端机器', 's5.r3d': '通过 SSH 转发的 socket 连接：不开端口，不加新登录',
    's5.r4n': '屏幕', 's5.r4d': '接回来时最多恢复 64 MB 回滚，从最新开始',
    's5.p1': '引擎运行在独立 PTY 宿主中。退出 TUI 或断开 SSH 只是脱离；主机保持唤醒时任务继续运行。本机睡眠会暂停计算，远端主机保持唤醒时不受客户端合盖影响。主机重启会结束进程；重新连接后恢复已保存的画面并重新启动命令，对话是否续接取决于引擎。恢复画面不代表任务已完成。',
    's5.p2': '<b>机器。</b>家里的台式机、云上的服务器？用 <span class="mono">rove machine add</span> 加一次，它的任务就和本机的出现在同一个侧栏里。走的是你已有的 SSH，不用开端口，也不用再登录一次。<b>例程。</b>一条 cron 规则，生成的是你能打开、能反驳的真任务，不是隐藏的后台作业。<b>收件箱。</b>一份列表，卡住的排前面；F7 跳到所有项目里最早那条。',

    'footer.plugins': '插件', 'footer.themesLink': '主题', 'footer.changelog': '更新日志', 'footer.docs': '文档', 'footer.keybindings': '快捷键',
    'ga.copyright': '© 2026 Sma1lboy。MIT 许可。',
  };
  var en = {
    'meta.title': 'Rove: the agent multiplexer in your shell',
    'meta.desc': 'Rove multiplexes AI coding agents in your terminal. N isolated attempts, each with its own git worktree and hosted engine session, messaging each other as peers, all inside an SSH session you can close.',
    'hero.title': 'Parallel coding agents <span class="thin">in your terminal.</span>',
    'hero.sub': 'One managed task, one worktree, one branch. Run parallel work on a host that stays awake; disconnect your terminal and pick it back up over SSH.',
    'hero.engines': 'Works with Claude Code, Codex, Copilot, Gemini CLI, OpenCode and more.',
    'hero.firstTasks': 'Next: complete your first two tasks →',
    'hero.alts': 'or with',
    'copy.hint': 'click to copy', 'copy.done': '✓ copied',

    'sheet.skip': 'Skip to content',
    'sheet.nav.docs': 'Docs', 'sheet.nav.plugins': 'Plugins',
    'sheet.nav.themes': 'Themes', 'sheet.nav.changelog': 'Changelog', 'sheet.nav.github': 'GitHub',

    's1.h': 'Every task in one terminal',
    's1.bar': 'Rove: 3 repos, 4 tasks, running in the background',
    's1.tasks': 'Tasks',
    's1.p1': 'Pick a task to see its tabs. Every engine runs in the background, with nobody attached.',
    's1.p2': 'Every status mark in the sidebar is listed in the <a href="https://docs.rove.run">docs</a>.',

    's2.h': 'A task is a worktree, a branch and tabs',
    's2.th1': 'Part', 's2.th2': 'Per task', 's2.th3': 'What it is',
    's2.r1n': 'Git worktree', 's2.r1d': 'Own checkout on disk',
    's2.r2n': 'Branch', 's2.r2d': 'Cut when the task is made',
    's2.r3n': 'Terminal tab', 's2.r3d': 'Same files, separate conversation',
    's2.tnote': 'Project-main tasks reuse a saved checkout and directory tasks reuse a directory you own. Neither gets its own worktree or branch.',
    's2.p1': 'A Task is what Rove isolates: a git worktree, a branch, and terminal tabs inside it. One prompt can make several.',
    's2.p2': 'More tabs inside a Task are another agent on the same files with its own conversation. Splits only divide the screen.',

    's3.h': 'Isolation',
    's3.r1': 'New task', 's3.r1d': 'Own worktree and own branch',
    's3.r2': 'New tab', 's3.r2d': 'Own conversation, same files',
    's3.r3': 'New split', 's3.r3d': 'Same tab, divided screen',
    's3.p1': 'Each level down isolates less.',
    's3.p2': 'If two agents must not touch each other\'s files, give them two Tasks. If one agent should read what another just wrote, give it a Tab.',

    's4.h': 'Fan out, fan in',
    's4.prompt': '1 prompt',
    's4.round': 'One round makes 5 tasks, each with its own worktree and branch, and returns one group id.',
    's4.p2': 'When the round is done, <span class="mono">rove api collect --group &lt;id&gt;</span> reads it in one call: branch, diff size, checks and each worker\'s own report. <span class="mono">rove api land --task-id &lt;id&gt;</span> merges the winner. Losing branches stay on disk.',
    's4.p3': '<b>Agents talk to each other as peers.</b> A worker reports back with a bare <span class="mono">rove api send</span>. Rove recorded who spawned whom, so the reply goes to the exact tab. There is no coordinator process.',

    's5.h': 'Keeps running when you disconnect',
    's5.th1': 'Part', 's5.th2': 'If you disconnect',
    's5.r1n': 'Your TUI', 's5.r1d': 'Detaches',
    's5.r2n': 'Rove daemon', 's5.r2d': 'Keeps hosting the engine PTYs',
    's5.r3n': 'Remote machine', 's5.r3d': 'Reached over an SSH-forwarded socket: no ports opened, no new login',
    's5.r4n': 'Screens', 's5.r4d': 'Up to 64 MB of scrollback restored on attach, newest first',
    's5.p1': 'Engines run in a separate PTY host. Quitting the TUI or dropping SSH only detaches: work continues while that host stays awake. Host sleep pauses local work; closing an SSH client laptop leaves an awake remote host working. Reboot ends processes. Reattach restores saved screens and relaunches commands; conversation resume depends on the engine. Restored output does not mean the task completed.',
    's5.p2': '<b>Machines.</b> Got a second computer, a desktop at home or a box in the cloud? Add it once with <span class="mono">rove machine add</span> and its tasks show up in the same sidebar as your local ones. It rides on the SSH access you already have. <b>Routines.</b> A cron rule that creates real tasks you can open and argue with, not a hidden job. <b>Inbox.</b> One list, blocked items first; F7 jumps to the oldest across every project.',

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
