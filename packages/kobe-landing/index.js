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
    'tb.r2': '以 <span class="mono">0.9.196</span> 发布到 npm',
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
    'ga.fig1': '图 1', 'ga.fig2': '图 2', 'ga.fig3': '图 3', 'ga.fig4': '图 4',

    'ga.n1.h': '总装',
    'ga.f1.tabs': '终端 tab', 'ga.f1.tabsSub': '同一批文件 · 各自的对话',
    'ga.f1.branch': '分支', 'ga.f1.branchSub': '随任务切出 · 留在磁盘上',
    'ga.f1.own': '自己的 checkout —— 不共享', 'ga.f1.wtSub': '并行的活儿撞不到一起',
    'ga.f1.dim': '1 个托管任务',
    'ga.f1.cap': '图 1 —— 托管任务分解图 · 比例 1:1 · A—A 剖切通过 checkout',
    'ga.n1.p1': '一条 prompt 变成一个或多个 <b>任务</b>。任务是 Rove 隔离的单位：建一个 git worktree，切一条分支，在里面开终端 tab。什么都不横向共享，所以同一条 prompt 上的第二个代理，是在另一个目录、另一条分支上干活。',
    'ga.n1.p2': '任务里还能再开 tab —— 第二个代理跑在<em>同一批</em>文件上，但有自己的对话 —— 以及分屏，那只是把屏幕切开。',
    'ga.n1.tcap': '零件表',
    'ga.n1.th1': '件号', 'ga.n1.th2': '数量', 'ga.n1.th3': '零件', 'ga.n1.th4': '说明',
    'ga.n1.r1d': '磁盘上自己的 checkout',
    'ga.n1.r2n': '分支', 'ga.n1.r2d': '任务创建时切出',
    'ga.n1.r3n': '终端 tab', 'ga.n1.r3d': '同一批文件，各自的对话',
    'ga.n1.tnote': 'project-main 任务复用一份已保存的 checkout，directory 任务复用你自己的目录；这两种都不配 1 号和 2 号零件。',
    'ga.n1.g1': '三个零件在任务创建时一次装齐，之后不再分配。',
    'ga.n1.g2': '落选的分支不删除。赢家合入之后，它们仍留在磁盘上。',
    'ga.n1.g3': '退出 TUI 只是断开，零件不会停。见注 4。',

    'ga.n2.h': '隔离',
    'ga.f2.datum': '基准',
    'ga.f2.r1': '新任务', 'ga.f2.r1s': '独占 worktree + 独占分支', 'ga.f2.r1d': '完全隔离',
    'ga.f2.r2': '新 tab', 'ga.f2.r2s': '各自的对话 · 同一批文件', 'ga.f2.r2d': '只隔离对话',
    'ga.f2.r3': '新分屏', 'ga.f2.r3d': '只是布局',
    'ga.f2.cap': '图 2 —— 从公共基准量隔离 · 剖面线面 = 磁盘上彼此独立的文件',
    'ga.n2.p1': '每往下一层，隔离就降一档，产品自己用三行说清楚：',
    'ga.n2.p2': '心智模型就这些。两个代理绝不能碰彼此的文件，就给两个任务；一个代理要读另一个刚写的东西，就给它一个 tab。',

    'ga.n3.h': '扇出，扇入',
    'ga.f3.prompt': '1 条 prompt',
    'ga.f3.dim': '5 个任务 —— 各自独占 worktree + 分支', 'ga.f3.group': '返回一个 group id',
    'ga.f3.cap': '图 3 —— 混合舰队上的扇出 · 尺寸链逐字对应舰队规格',
    'ga.n3.round': '这条命令跑一轮，量出来是',
    'ga.rr1': '5 个尝试', 'ga.rr2': '5 个 worktree', 'ga.rr3': '5 条分支',
    'ga.n3.p2': '每个同胞任务都有自己的 worktree 和分支。一轮跑完，<span class="mono">rove api collect --group &lt;id&gt;</span> 一次调用就读出整轮的状况 —— 每个任务的分支、diff 大小、检查结果，还有 worker 自己的回报 —— 再用 <span class="mono">rove api land --task-id &lt;id&gt;</span> 合入赢家。落选的分支留在磁盘上。',
    'ga.n3.p3': '<b>代理之间以对等身份互发消息。</b>从另一个任务派生出来的 worker，用一句朴素的 <span class="mono">rove api send --prompt "succeeded: … (branch fix/auth-flow)"</span> 回报。Rove 记下了谁派生了谁，所以回复会精确路由回那个 tab。没有协调器进程。',

    'ga.n4.h': '持续运行',
    'ga.f4.tui': '你的 TUI', 'ga.f4.tuiSub': '可能已断开',
    'ga.f4.dmn1': 'PTY 宿主 · 长驻', 'ga.f4.dmn2': '重启也还在',
    'ga.f4.remote': '远端 daemon',
    'ga.f4.ssh1': 'SSH 转发的 socket', 'ga.f4.ssh2': '不开端口，不加新认证',
    'ga.f4.back': '接回来时屏幕原样恢复',
    'ga.f4.dim': '最多恢复 64 MB 回滚，从最新开始',
    'ga.f4.cap': '图 4 —— 断开态运行 · 虚线 = 可能缺席的那个零件',
    'ga.n4.p1': '引擎跑在 daemon 托管的 PTY 里，不归你的终端管。退出 TUI 只是断开。掐掉 SSH、合上盖子、重启 —— 活儿照样继续，接回来时屏幕原样恢复，最多带回 64 MB 回滚，从最新开始。',
    'ga.n4.p2': '<b>机器。</b><span class="mono">rove machine add narwhal</span> 注册另一台电脑。它的任务出现在同一个侧栏、自己的一行下面 —— 不开端口，不加新认证，SSH 只是转发远端 daemon 的 unix socket。所有机器同时连着。',
    'ga.n4.p3': '<b>Routines。</b>一条 cron 规则、一条 prompt、一个仓库，由 daemon 持有。每次触发都在侧栏里创建一个真实任务，带自己的 worktree 和分支 —— 你能打开、能读、能反驳、能接着聊。不是一个藏起来的后台作业。',
    'ga.n4.p4': '<b>Inbox。</b>一份只回答<em>「哪些需要我」</em>的列表。卡住的排前面 —— 权限询问、限流、报错、引擎挂了 —— 然后才是普通的已完成轮次。<span class="mono">F7</span> 跳到所有项目里最早卡住的那一个。',

    'ga.n5.h': '符号图例', 'ga.n5.sub': '侧栏状态标记',


    'ga.copyright': '© 2026 Sma1lboy · MIT · 第 1 张 / 共 4 张',

    'footer.tagline': '终端里的编码代理多路复用器。',
    'footer.colophon': '用 Bun、OpenTUI 和 React 构建。字体为 Saira Condensed、IBM Plex Sans 与 IBM Plex Mono。MIT 许可。',
    'footer.plugins': '插件', 'footer.themesLink': '主题', 'footer.changelog': '更新日志', 'footer.docs': '文档', 'footer.keybindings': '快捷键',
    'hero.alts': '或者用',
    'ga.n5.h': '实物视图',
    'ga.n5.sub': '不是截图 · 点一个任务',
    'ga.n5.p1': '注 1 到注 4 画的是零件。<b>这是装好之后、正在跑的机器。</b>上面每一张图都是从它身上取下来的样本。',
    'ga.n5.p3': '这里每一个字形都是侧栏真会画的，每一个引擎名都是真发布了的。字形和引擎的完整清单在<a href="https://docs.rove.run">文档</a>里；这张图纸让它们跑起来，而不是列出来。',
    'ga.fig5cap': '图 5 —— 实物视图 · 三个仓库、四个任务、无人接管',
    'fleet.eyebrow': '四个任务在跑，没人接管',
    'fleet.cue': '点一个任务 →',
    'fleet.note': '一个真实会话：三个仓库、四个任务，每个任务独占自己的 worktree、分支和终端 tab。<strong>此刻没有任何人接在上面</strong>——每个引擎都跑在 daemon 托管的 hosted PTY 里，关掉 TUI 活儿照样继续。',
    'fleet.noteFull': '完整布局：左边 Tasks、中间分屏工作区、右边 Changes。点左边任意一个任务，或用 <b>[~] Zen</b> 收起 Files——这是活的布局，不是一张截图。',
    'fleet.noteZen': '现在是 Zen 模式：Files 栏收起，工作区吃掉腾出来的宽度。点左下角 <b>☯ ZEN</b> 退出，或点左边任意一个任务——这是活的布局，不是一张截图。',
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
    'tb.r2': 'Released as <span class="mono">0.9.196</span> on npm',
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
    'ga.fig1': 'Fig. 1', 'ga.fig2': 'Fig. 2', 'ga.fig3': 'Fig. 3', 'ga.fig4': 'Fig. 4',

    'ga.n1.h': 'General assembly',
    'ga.f1.tabs': 'Terminal tabs', 'ga.f1.tabsSub': 'Same files · separate conversation',
    'ga.f1.branch': 'Branch', 'ga.f1.branchSub': 'Created with the task · kept on disk',
    'ga.f1.own': 'Own checkout — not shared', 'ga.f1.wtSub': 'Parallel work cannot collide',
    'ga.f1.dim': '1 managed task',
    'ga.f1.cap': 'Fig. 1 — Managed task, exploded view · Scale 1:1 · Section A—A through the checkout',
    'ga.n1.p1': 'One prompt becomes one or more <b>Tasks</b>. A Task is the unit Rove isolates: it creates a git worktree, cuts a branch, and opens terminal tabs inside it. Nothing is shared sideways, so a second agent on the same prompt is working in a different directory on a different branch.',
    'ga.n1.p2': 'Inside a Task you can open more tabs — a second agent on the <em>same</em> files with its own conversation — and splits, which only divide the screen.',
    'ga.n1.tcap': 'Parts list',
    'ga.n1.th1': 'Item', 'ga.n1.th2': 'Qty', 'ga.n1.th3': 'Part', 'ga.n1.th4': 'Note',
    'ga.n1.r1d': 'Own checkout on disk',
    'ga.n1.r2n': 'Branch', 'ga.n1.r2d': 'Cut when the task is made',
    'ga.n1.r3n': 'Terminal tab', 'ga.n1.r3d': 'Same files, separate conversation',
    'ga.n1.tnote': 'Project-main tasks reuse a saved checkout and directory tasks reuse a directory you own; neither is supplied with items 1 and 2.',
    'ga.n1.g1': 'All three parts are created when the task is made. Nothing is allocated later.',
    'ga.n1.g2': 'Losing branches are not deleted. They stay on disk after the winner is landed.',
    'ga.n1.g3': 'Quitting the TUI detaches; it does not stop the parts. See Note 4.',

    'ga.n2.h': 'Isolation',
    'ga.f2.datum': 'Datum',
    'ga.f2.r1': 'New task', 'ga.f2.r1s': 'Own worktree + own branch', 'ga.f2.r1d': 'Full isolation',
    'ga.f2.r2': 'New tab', 'ga.f2.r2s': 'Own conversation · same files', 'ga.f2.r2d': 'Conversation only',
    'ga.f2.r3': 'New split', 'ga.f2.r3d': 'Layout only',
    'ga.f2.cap': 'Fig. 2 — Isolation from a common datum · Hatched face = separate files on disk',
    'ga.n2.p1': 'Isolation drops one notch at each level down, and the product says so in three lines:',
    'ga.n2.p2': 'That is the whole mental model. If two agents must not touch each other’s files, give them two Tasks. If one agent should read what another just wrote, give it a Tab.',

    'ga.n3.h': 'Fan out, fan in',
    'ga.f3.prompt': '1 prompt',
    'ga.f3.dim': '5 × task — each with own worktree + branch', 'ga.f3.group': 'Returns one group id',
    'ga.f3.cap': 'Fig. 3 — Fan-out on a mixed fleet · Dimension chain reads the fleet spec verbatim',
    'ga.n3.round': 'One round of that command measures as',
    'ga.rr1': '5 attempts', 'ga.rr2': '5 worktrees', 'ga.rr3': '5 branches',
    'ga.n3.p2': 'Each sibling gets its own worktree and branch. When the round is done, <span class="mono">rove api collect --group &lt;id&gt;</span> reads the whole round’s health in one call — per-task branch, diff size, checks, and the worker’s own report — and <span class="mono">rove api land --task-id &lt;id&gt;</span> merges the winner. The losing branches stay on disk.',
    'ga.n3.p3': '<b>Agents talk to each other as peers.</b> A worker spawned from another task reports home with a bare <span class="mono">rove api send --prompt "succeeded: … (branch fix/auth-flow)"</span>. Rove recorded who spawned whom, so the reply routes back to the exact tab. There is no coordinator process.',

    'ga.n4.h': 'Continuous operation',
    'ga.f4.tui': 'Your TUI', 'ga.f4.tuiSub': 'May detach',
    'ga.f4.dmn1': 'PTY host · long-lived', 'ga.f4.dmn2': 'Survives restarts',
    'ga.f4.remote': 'Remote daemon',
    'ga.f4.ssh1': 'SSH-forwarded socket', 'ga.f4.ssh2': 'No ports opened, no new auth',
    'ga.f4.back': 'Screens come back on attach',
    'ga.f4.dim': '≤ 64 MB scrollback restored, newest first',
    'ga.f4.cap': 'Fig. 4 — Detached operation · Hidden line = the part that may be absent',
    'ga.n4.p1': 'The engines run in PTYs hosted by the daemon, not by your terminal. Quitting the TUI only detaches. Drop the SSH connection, close the lid, reboot — the work keeps going, and the screens come back on attach with up to 64 MB of scrollback restored, newest first.',
    'ga.n4.p2': '<b>Machines.</b> <span class="mono">rove machine add narwhal</span> registers another computer. Its tasks appear in the same sidebar under a row of their own — no ports opened, no new auth, SSH just forwards the remote daemon’s unix socket. Every machine is connected at once.',
    'ga.n4.p3': '<b>Routines.</b> A cron rule, a prompt, and a repo, owned by the daemon. Every firing creates a real task in the sidebar with its own worktree and branch — work you can open, read, disagree with, and keep talking to. Not a hidden background job.',
    'ga.n4.p4': '<b>Inbox.</b> One list answering <em>what needs me?</em> Blocked items first — permission prompt, rate limit, error, dead engine — then plain finished turns. <span class="mono">F7</span> jumps to the oldest blocked one across every project.',

    'ga.n5.h': 'Symbol legend', 'ga.n5.sub': 'Sidebar status marks',


    'ga.copyright': '© 2026 Sma1lboy · MIT · Sheet 1 of 4',

    'footer.tagline': 'a terminal multiplexer for coding agents.',
    'footer.colophon': 'Built with Bun, OpenTUI and React. Set in Saira Condensed, IBM Plex Sans and IBM Plex Mono. MIT licensed.',
    'footer.plugins': 'plugins', 'footer.themesLink': 'themes', 'footer.changelog': 'changelog', 'footer.docs': 'docs', 'footer.keybindings': 'keybindings',
    'hero.alts': 'or with',
    'ga.n5.h': 'Physical view',
    'ga.n5.sub': 'Not a screenshot · pick a task',
    'ga.n5.p1': 'Notes 1 to 4 drew the parts. <b>This is the assembled machine, running.</b> Everything above is a specimen taken from it.',
    'ga.n5.p3': 'Every glyph here is one the sidebar really draws, and every engine name is one that ships. The full schedule of marks and engines is in the <a href="https://docs.rove.run">docs</a>; this sheet shows them working instead of listing them.',
    'ga.fig5cap': 'Fig. 5 — Physical view · three repositories, four tasks, none attached',
    'fleet.eyebrow': 'four tasks running, nobody attached',
    'fleet.cue': 'pick a task →',
    'fleet.note': 'A real session: three repositories, four tasks, each on its own worktree, branch and terminal tabs. <strong>Nothing is attached to any of them right now.</strong> Every engine runs in a hosted PTY behind the daemon, so the work continues with the TUI closed.',
    'fleet.noteFull': 'The full layout: Tasks on the left, the split workspace, Changes on the right. Pick a task, or use <b>[~] Zen</b> to collapse Files. This is a live layout, not a screenshot.',
    'fleet.noteZen': 'This is zen mode: Files is collapsed and the workspace takes the freed width. Hit <b>☯ ZEN</b> at the bottom of the rail to bring it back, or pick a task on the left. This is a live layout, not a screenshot.',
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
