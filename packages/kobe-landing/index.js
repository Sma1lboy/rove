// EN / 中文 — one page, two language versions. Terminal-mock content
// (commands, branch names, TUI chrome) deliberately stays English.
var KOBE_I18N = (function () {
  var zh = {
    'meta.title': 'Rove — 装在你 shell 里的 agent 多路复用器',
    'meta.desc': 'Rove 是终端里的编码代理多路复用器：N 个彼此隔离的尝试，各自拥有 git worktree 和托管引擎会话，互相发消息协作——而这一整套就跑在一个你随时能关掉的 SSH 会话里。',
    'nav.workflow': '--原语', 'nav.install': '--安装', 'nav.docs': '--文档', 'nav.plugins': '--插件', 'nav.themes': '--主题', 'nav.changelog': '--更新日志',
    'hero.title': 'agent <span class="nb">多路复用器</span><span class="thin">，装在你 <span class="nb">shell 里</span></span>',
    'hero.sub': 'Rove 是一个终端界面，让你同时跑很多个 AI 编码代理。每个尝试都<b>独占自己的 git worktree 和分支</b>，所以两个代理跑同一条 prompt 也永远写不到同一个文件。',
    'hero.requirements': 'macOS · Linux · Windows —— 自带 Bun 运行时。只需 git 和 PATH 上任意一个引擎 CLI。',
    'copy.hint': '点击复制', 'copy.done': '✓ 已复制',

    // ── 图纸公用（四张图共用）
    'sheet.skip': '跳到图纸',
    'sheet.stamp': '第 1 张 / 共 4 张',
    'sheet.nav.docs': '文档', 'sheet.nav.plugins': '插件',
    'sheet.nav.themes': '主题', 'sheet.nav.changelog': '更新日志', 'sheet.nav.github': 'GitHub',

    // ── 标题栏 / 修订记录
    'tb.revisions': '修订记录', 'tb.revH': '版本', 'tb.dateH': '日期', 'tb.descH': '说明',
    'tb.r1': '引擎 <span class="mono">pi</span>、<span class="mono">omp</span> 归入 contrib 类',
    'tb.r2': '以 <span class="mono" data-rev>0.9.198</span> 发布到 npm',
    'tb.title': '图名', 'tb.titleVal': 'Rove —— 托管任务总装图',
    'tb.part': '件号', 'tb.rev': '版本', 'tb.sheet': '图号', 'tb.sheetVal': '第 1 张 / 共 4 张',
    'tb.drawn': '制图', 'tb.checked': '校核', 'tb.date': '日期', 'tb.scale': '比例',
    'tb.onboard': '在图板上', 'tb.material': '材料', 'tb.materialVal': 'TypeScript · 自带 Bun',
    'tb.finish': '表面处理', 'tb.units': '单位', 'tb.unitsVal': '任务',
    'tb.platform': '平台', 'tb.platformVal': 'macOS · Linux · Windows —— 需要 git 和 PATH 上一个引擎 CLI',

    // ── 第 1 张图：总装
    'ga.installTag': '安装',
    'ga.subjCap': '图示对象', 'ga.subjTask': '托管任务', 'ga.subjBranch': '分支', 'ga.subjTabs': '终端 tab',
    'ga.subjSee': '见图 1', 'ga.subjParts': '3 个零件', 'ga.projection': '第一角投影',

    'ga.note1': '注 1', 'ga.note2': '注 2', 'ga.note3': '注 3',
    'ga.note4': '注 4', 'ga.note5': '注 5',
    'ga.fig1': '图 1', 'ga.fig2': '图 2', 'ga.fig3': '图 3', 'ga.fig4': '图 4', 'ga.fig5': '图 5',

    'ga.n1.h': '总装',
    'ga.f1.tabs': '终端 tab', 'ga.f1.tabsSub': '同一批文件 · 各自的对话',
    'ga.f1.branch': '分支', 'ga.f1.branchSub': '随任务切出 · 留在磁盘上',
    'ga.f1.own': '自己的 checkout —— 不共享', 'ga.f1.wtSub': '并行的活儿撞不到一起',
    'ga.f1.dim': '1 个托管任务',
    'ga.f1.cap': '图 2 —— 托管任务分解图 · 比例 1:1 · A—A 剖切通过 checkout',
    'ga.n1.p1': '一个 Task 就是 Rove 隔离的单位：一个 git worktree、一个分支，和开在里面的终端 tab。一条 prompt 可以生成好几个。',
    'ga.n1.p2': 'Task 内部再开 tab，是另一个代理动<i>同一批</i>文件、各自一份对话。split 只是把屏幕切开。',
    'ga.n1.tcap': '零件表',
    'ga.n1.th1': '件号', 'ga.n1.th2': '数量', 'ga.n1.th3': '零件', 'ga.n1.th4': '说明',
    'ga.n1.r1d': '磁盘上自己的 checkout',
    'ga.n1.r2n': '分支', 'ga.n1.r2d': '任务创建时切出',
    'ga.n1.r3n': '终端 tab', 'ga.n1.r3d': '同一批文件，各自的对话',
    'ga.n1.tnote': 'project-main 任务复用一份已保存的 checkout，directory 任务复用你自己的目录；这两种都不配 1 号和 2 号零件。',
    'ga.n1.g1': '三个零件在任务创建时一次装齐，之后不再分配。',

    'ga.n2.h': '隔离',
    'ga.f2.datum': '基准',
    'ga.f2.r1': '新任务', 'ga.f2.r1s': '独占 worktree + 独占分支', 'ga.f2.r1d': '完全隔离',
    'ga.f2.r2': '新 tab', 'ga.f2.r2s': '各自的对话 · 同一批文件', 'ga.f2.r2d': '只隔离对话',
    'ga.f2.r3': '新分屏', 'ga.f2.r3d': '只是布局',
    'ga.f2.cap': '图 3 —— 从公共基准量隔离 · 剖面线面 = 磁盘上彼此独立的文件',
    'ga.n2.p1': '每往下一级，隔离就松一档：',
    'ga.n2.p2': '两个代理不能碰对方的文件：给两个 Task。一个要读另一个刚写的东西：给一个 Tab。',

    'ga.n3.h': '扇出，扇入',
    'ga.f3.prompt': '1 条 prompt',
    'ga.f3.dim': '5 个任务 —— 各自独占 worktree + 分支', 'ga.f3.group': '返回一个 group id',
    'ga.f3.cap': '图 4 —— 混合舰队上的扇出 · 尺寸链逐字对应舰队规格',
    'ga.n3.round': '这条命令跑一轮，量出来是',
    'ga.rr1': '5 个尝试', 'ga.rr2': '5 个 worktree', 'ga.rr3': '5 条分支',
    'ga.n3.p2': '一轮跑完，<span class="mono">rove api collect --group &lt;id&gt;</span> 一次调用读完整轮——分支、diff 大小、检查、每个 worker 自己的回报；<span class="mono">rove api land --task-id &lt;id&gt;</span> 合入赢的那个。输的分支留在磁盘上。',
    'ga.n3.p3': 'worker 用一句裸的 <span class="mono">rove api send</span> 回报。Rove 记着谁派生了谁，回复直接路由回那个 tab。没有协调进程。',

    'ga.n4.h': '持续运行',
    'ga.f4.tui': '你的 TUI', 'ga.f4.tuiSub': '可能已断开',
    'ga.f4.dmn1': 'PTY 宿主 · 长驻', 'ga.f4.dmn2': '重启也还在',
    'ga.f4.remote': '远端 daemon',
    'ga.f4.ssh1': 'SSH 转发的 socket', 'ga.f4.ssh2': '不开端口，不加新认证',
    'ga.f4.back': '接回来时屏幕原样恢复',
    'ga.f4.dim': '最多恢复 64 MB 回滚，从最新开始',
    'ga.f4.cap': '图 5 —— 断开态运行 · 虚线 = 可能缺席的那个零件',
    'ga.n4.p1': '引擎跑在 daemon 托管的 PTY 里，不在你的终端里。退出 TUI 只是脱离——断 SSH、合盖、重启，活儿照跑，重新接上时最多 64 MB 回滚缓冲还在。',
    'ga.n4.p2': '<b>机器</b>——<span class="mono">rove machine add narwhal</span> 把另一台电脑的任务放进同一个侧栏；SSH 转发它的 daemon socket，不开端口也不加认证。<b>例程</b>——一条 cron 规则，生成的是你能打开、能反驳的真任务，不是隐藏的后台作业。<b>收件箱</b>——一份列表，卡住的排前面；F7 跳到所有项目里最早那条。',

    'ga.n5.h': '符号图例', 'ga.n5.sub': '侧栏状态标记',


    'ga.copyright': '© 2026 Sma1lboy · MIT · 第 1 张 / 共 4 张',

    'footer.tagline': '终端里的编码代理多路复用器。',
    'footer.colophon': '用 Bun、OpenTUI 和 React 构建。字体为 Saira Condensed、IBM Plex Sans 与 IBM Plex Mono。MIT 许可。',
    'footer.plugins': '插件', 'footer.themesLink': '主题', 'footer.changelog': '更新日志', 'footer.docs': '文档', 'footer.keybindings': '快捷键',
    'hero.alts': '或者用',
    'ga.n5.h': '实物视图',
    'ga.n5.sub': '不是截图 · 点一个任务',
    'ga.n5.p1': '这就是整个产品，在跑。下面几条注释把它拆开。',
    'ga.n5.p3': '每个字形都是侧栏真会画的，每个引擎名都真发布了。完整清单在<a href="https://docs.rove.run">文档</a>里。',
    'ga.fig5cap': '图 1 —— 实物视图 · 三个仓库、四个任务、无人接管',
    'fleet.eyebrow': '四个任务在跑，没人接管',
    'fleet.cue': '点一个任务 →',
    'fleet.note': '三个仓库、四个任务，<strong>没有一个有人接管</strong>——每个引擎都在 daemon 背后的 hosted PTY 里。',
    'fleet.noteFull': '左边 Tasks、中间分屏工作区、右边 Changes。点一个任务，或按 <b>[~] Zen</b> 收起 Files。',
    'fleet.noteZen': 'Zen 模式：Files 收起，工作区吃掉腾出的宽度。按 <b>☯ ZEN</b> 收回来，或者点一个任务。',
  };
  var en = {
    'meta.title': 'Rove: the agent multiplexer in your shell',
    'meta.desc': 'Rove multiplexes AI coding agents in your terminal. N isolated attempts, each with its own git worktree and hosted engine session, messaging each other as peers, all inside an SSH session you can close.',
    'nav.workflow': '--primitives', 'nav.install': '--install', 'nav.docs': '--docs', 'nav.plugins': '--plugins', 'nav.themes': '--themes', 'nav.changelog': '--changelog',
    'hero.title': 'The agent multiplexer <span class="thin">in your shell</span>',
    'hero.sub': 'Rove is a terminal UI for running many AI coding agents at once. Every attempt gets <b>its own git worktree and its own branch</b>, so two agents working the same prompt can never write the same file.',
    'hero.requirements': 'macOS · Linux · Windows — ships its own Bun runtime. Needs git and one engine CLI on PATH.',
    'copy.hint': 'click to copy', 'copy.done': '✓ copied',

    // ── sheet furniture (shared by all four sheets)
    'sheet.skip': 'Skip to drawing',
    'sheet.stamp': 'Sheet 1 of 4',
    'sheet.nav.docs': 'Docs', 'sheet.nav.plugins': 'Plugins',
    'sheet.nav.themes': 'Themes', 'sheet.nav.changelog': 'Changelog', 'sheet.nav.github': 'GitHub',

    // ── title block / revision table
    'tb.revisions': 'Revisions', 'tb.revH': 'Rev', 'tb.dateH': 'Date', 'tb.descH': 'Description',
    'tb.r1': 'Engines <span class="mono">pi</span>, <span class="mono">omp</span> added to the contrib class',
    'tb.r2': 'Released as <span class="mono" data-rev>0.9.198</span> on npm',
    'tb.title': 'Title', 'tb.titleVal': 'Rove — managed task, general assembly',
    'tb.part': 'Part no.', 'tb.rev': 'Rev', 'tb.sheet': 'Sheet', 'tb.sheetVal': '1 of 4',
    'tb.drawn': 'Drawn by', 'tb.checked': 'Checked', 'tb.date': 'Date', 'tb.scale': 'Scale',
    'tb.onboard': 'On board', 'tb.material': 'Material', 'tb.materialVal': 'TypeScript · ships its own Bun',
    'tb.finish': 'Finish', 'tb.units': 'Units', 'tb.unitsVal': 'Tasks',
    'tb.platform': 'Platform', 'tb.platformVal': 'macOS · Linux · Windows — requires git and one engine CLI on PATH',

    // ── sheet 1: general assembly
    'ga.installTag': 'Install',
    'ga.subjCap': 'Subject of drawing', 'ga.subjTask': 'Managed task', 'ga.subjBranch': 'branch', 'ga.subjTabs': 'terminal tabs',
    'ga.subjSee': 'See Fig. 1', 'ga.subjParts': '3 parts', 'ga.projection': 'First-angle projection',

    'ga.note1': 'Note 1', 'ga.note2': 'Note 2', 'ga.note3': 'Note 3',
    'ga.note4': 'Note 4', 'ga.note5': 'Note 5',
    'ga.fig1': 'Fig. 1', 'ga.fig2': 'Fig. 2', 'ga.fig3': 'Fig. 3', 'ga.fig4': 'Fig. 4', 'ga.fig5': 'Fig. 5',

    'ga.n1.h': 'General assembly',
    'ga.f1.tabs': 'Terminal tabs', 'ga.f1.tabsSub': 'Same files · separate conversation',
    'ga.f1.branch': 'Branch', 'ga.f1.branchSub': 'Created with the task · kept on disk',
    'ga.f1.own': 'Own checkout — not shared', 'ga.f1.wtSub': 'Parallel work cannot collide',
    'ga.f1.dim': '1 managed task',
    'ga.f1.cap': 'Fig. 2 — Managed task, exploded view · Scale 1:1 · Section A—A through the checkout',
    'ga.n1.p1': 'A Task is what Rove isolates: a git worktree, a branch, and terminal tabs inside it. One prompt can make several.',
    'ga.n1.p2': 'More tabs inside a Task are another agent on the <i>same</i> files with its own conversation. Splits only divide the screen.',
    'ga.n1.tcap': 'Parts list',
    'ga.n1.th1': 'Item', 'ga.n1.th2': 'Qty', 'ga.n1.th3': 'Part', 'ga.n1.th4': 'Note',
    'ga.n1.r1d': 'Own checkout on disk',
    'ga.n1.r2n': 'Branch', 'ga.n1.r2d': 'Cut when the task is made',
    'ga.n1.r3n': 'Terminal tab', 'ga.n1.r3d': 'Same files, separate conversation',
    'ga.n1.tnote': 'Project-main tasks reuse a saved checkout and directory tasks reuse a directory you own; neither is supplied with items 1 and 2.',
    'ga.n1.g1': 'All three parts are created when the task is made. Nothing is allocated later.',

    'ga.n2.h': 'Isolation',
    'ga.f2.datum': 'Datum',
    'ga.f2.r1': 'New task', 'ga.f2.r1s': 'Own worktree + own branch', 'ga.f2.r1d': 'Full isolation',
    'ga.f2.r2': 'New tab', 'ga.f2.r2s': 'Own conversation · same files', 'ga.f2.r2d': 'Conversation only',
    'ga.f2.r3': 'New split', 'ga.f2.r3d': 'Layout only',
    'ga.f2.cap': 'Fig. 3 — Isolation from a common datum · Hatched face = separate files on disk',
    'ga.n2.p1': 'Isolation drops one notch at each level down:',
    'ga.n2.p2': 'Two agents that must not touch each other’s files: two Tasks. One that should read what another just wrote: a Tab.',

    'ga.n3.h': 'Fan out, fan in',
    'ga.f3.prompt': '1 prompt',
    'ga.f3.dim': '5 × task — each with own worktree + branch', 'ga.f3.group': 'Returns one group id',
    'ga.f3.cap': 'Fig. 4 — Fan-out on a mixed fleet · Dimension chain reads the fleet spec verbatim',
    'ga.n3.round': 'One round of that command measures as',
    'ga.rr1': '5 attempts', 'ga.rr2': '5 worktrees', 'ga.rr3': '5 branches',
    'ga.n3.p2': 'When the round is done, <span class="mono">rove api collect --group &lt;id&gt;</span> reads it in one call — branch, diff size, checks, each worker’s own report — and <span class="mono">rove api land --task-id &lt;id&gt;</span> merges the winner. Losing branches stay on disk.',
    'ga.n3.p3': 'Workers report home with a bare <span class="mono">rove api send</span>. Rove recorded who spawned whom, so the reply routes back to the exact tab. No coordinator process.',

    'ga.n4.h': 'Continuous operation',
    'ga.f4.tui': 'Your TUI', 'ga.f4.tuiSub': 'May detach',
    'ga.f4.dmn1': 'PTY host · long-lived', 'ga.f4.dmn2': 'Survives restarts',
    'ga.f4.remote': 'Remote daemon',
    'ga.f4.ssh1': 'SSH-forwarded socket', 'ga.f4.ssh2': 'No ports opened, no new auth',
    'ga.f4.back': 'Screens come back on attach',
    'ga.f4.dim': '≤ 64 MB scrollback restored, newest first',
    'ga.f4.cap': 'Fig. 5 — Detached operation · Hidden line = the part that may be absent',
    'ga.n4.p1': 'Engines run in PTYs hosted by the daemon, not your terminal. Quitting the TUI only detaches — drop the SSH connection, close the lid, reboot; the work keeps going, and up to 64 MB of scrollback comes back on attach.',
    'ga.n4.p2': '<b>Machines</b> — <span class="mono">rove machine add narwhal</span> puts another computer’s tasks in the same sidebar; SSH forwards its daemon socket, so no ports and no new auth. <b>Routines</b> — a cron rule that creates real tasks you can open and argue with, not a hidden job. <b>Inbox</b> — one list, blocked items first; F7 jumps to the oldest across every project.',

    'ga.n5.h': 'Symbol legend', 'ga.n5.sub': 'Sidebar status marks',


    'ga.copyright': '© 2026 Sma1lboy · MIT · Sheet 1 of 4',

    'footer.tagline': 'a terminal multiplexer for coding agents.',
    'footer.colophon': 'Built with Bun, OpenTUI and React. Set in Saira Condensed, IBM Plex Sans and IBM Plex Mono. MIT licensed.',
    'footer.plugins': 'plugins', 'footer.themesLink': 'themes', 'footer.changelog': 'changelog', 'footer.docs': 'docs', 'footer.keybindings': 'keybindings',
    'hero.alts': 'or with',
    'ga.n5.h': 'Physical view',
    'ga.n5.sub': 'Not a screenshot · pick a task',
    'ga.n5.p1': 'The whole product, running. The notes below take it apart.',
    'ga.n5.p3': 'Every glyph is one the sidebar really draws; every engine name ships. The full schedule is in the <a href="https://docs.rove.run">docs</a>.',
    'ga.fig5cap': 'Fig. 1 — Physical view · three repositories, four tasks, none attached',
    'fleet.eyebrow': 'four tasks running, nobody attached',
    'fleet.cue': 'pick a task →',
    'fleet.note': 'Three repositories, four tasks, <strong>nobody attached to any of them</strong> — every engine in a hosted PTY behind the daemon.',
    'fleet.noteFull': 'Tasks left, split workspace, Changes right. Pick a task, or hit <b>[~] Zen</b> to collapse Files.',
    'fleet.noteZen': 'Zen mode: Files is collapsed and the workspace takes the freed width. Hit <b>☯ ZEN</b> to bring it back, or pick a task.',
  };
  var dicts = { en: en, zh: zh };
  var lang = 'en';
  try {
    var fromUrl = new URLSearchParams(location.search).get('lang');
    var stored = localStorage.getItem('kobe_lang');
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
      try { localStorage.setItem('kobe_lang', lang); } catch (e) {}
      apply();
    });
  }
  apply(); // first paint: honors ?lang= / stored pref / browser language

  return { t: t };
})();

// copy-to-clipboard for the install command
(function () {
  var btn = document.getElementById('copyBtn');
  var label = document.getElementById('copyLabel');
  var timer;
  btn.addEventListener('click', function () {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText('curl -fsSL https://rove.run/install.sh | sh');
    } catch (e) {}
    label.textContent = KOBE_I18N.t('copy.done');
    clearTimeout(timer);
    timer = setTimeout(function () { label.textContent = KOBE_I18N.t('copy.hint'); }, 1800);
  });
})();

// live GitHub star count (cache for instant first paint, refresh each load, graceful fallback)
(function () {
  var el = document.getElementById('starCount');
  if (!el) return;
  function render(n) {
    el.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }
  var CACHE_KEY = 'kobe_stars';
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
