// EN / 中文 — one page, two language versions. Terminal-mock content
// (commands, branch names, TUI chrome) deliberately stays English.
var KOBE_I18N = (function () {
  var zh = {
    'meta.title': 'Rove — 装在你 shell 里的 agent 多路复用器',
    'meta.desc': 'Rove 是终端里的编码代理多路复用器：N 个彼此隔离的尝试，各自拥有 git worktree 和托管引擎会话，互相发消息协作——而这一整套就跑在一个你随时能关掉的 SSH 会话里。',
    'nav.workflow': '--原语', 'nav.install': '--安装', 'nav.plugins': '--插件', 'nav.themes': '--主题', 'nav.changelog': '--更新日志',
    'hero.kicker': '提示词工程 → 上下文工程 → <span class="acc">图工程</span>',
    'hero.title': '装在你 shell 里的 agent <span class="acc">多路复用器</span>。',
    'hero.sub': '一个代理是一场对话；五个同时跑就需要一个多路复用器：每个尝试独占自己的 git worktree、分支和托管引擎会话，彼此之间直接发消息，而整支舰队就跑在一个你随时能关掉的 SSH 会话里。',
    'hero.getStarted': '快速上手 ↗',
    'hero.requirements': '支持 macOS 和 Linux（Windows 走 WSL）。npm、bun、npx 或一行 curl 都能装 —— Bun 运行时由 Rove 自己带上。只需 git 和 PATH 上任意一个引擎 CLI。',
    'copy.hint': '点击复制', 'copy.done': '✓ 已复制',
    'workspace.equation': '一个节点 =', 'workspace.sessions': '托管引擎会话',
    'fleet.eyebrow': '四个任务在跑，没人接管', 'fleet.cue': '点一个任务 →',
    'fleet.note': '一个真实会话：三个仓库、四个任务，每个任务独占自己的 worktree、分支和终端 tab。<strong>此刻没有任何人接在上面</strong>——每个引擎都跑在 daemon 托管的 hosted PTY 里，关掉 TUI 活儿照样继续。',
    'fleet.noteZen': '现在是 Zen 模式：Files 栏收起，工作区吃掉腾出来的宽度。点左下角 <b>☯ ZEN</b> 退出，或点左边任意一个任务——这是活的布局，不是一张截图。',
    'fleet.noteFull': '完整布局：左边 Tasks、中间分屏工作区、右边 Changes。点左边任意一个任务，或用 <b>[~] Zen</b> 收起 Files——这是活的布局，不是一张截图。',
    's1.no': '1.0 · 多路复用', 's1.title': '一条 prompt 变成 N 个隔离的尝试。',
    's1.body': '多路复用就是全部思路：一条 prompt、N 个尝试、一次调用。Rove 把每个尝试扇出到独立的 git worktree 和分支上，跑你指定的引擎——claude、codex、copilot、kimi，或你自己的命令。独立节点，没有共享状态，代理之间互不碰文件。',
    's1.ownCmd': '你自己的命令',
    'fan.you': '你', 'fan.ask': '把 auth 流程简化一下——开三条路子并行试。',
    'fan.starting': '启动中', 'fan.running': '进行中', 'fan.done': '已回报',
    'fan.cmdLead': '技能替你跑的是：',
    's2.no': '2.0 · SSH 原生', 's2.title': '它是个 TUI——远程这件事就已经解决了。',
    's2.body': '不需要浏览器、不需要 VNC、不需要桌面应用，也不用转发端口。Rove 就跑在你代码所在的那台机器上——笔记本、devbox、VPS，任何能 SSH 上去的地方——真实的依赖、服务、凭证和构建缓存。代理跑通的对你也跑通。',
    's2.body2': '断线不是中断：引擎跑在那台机器上由 daemon 托管的 PTY 里，关掉 TUI 活儿照样继续。四十分钟后 SSH 回去重新接管就行。手边没终端？<span class="mono">rove web</span> 会把同一份 daemon 托管的任务和活的终端搬到浏览器标签页里。',
    's3.no': '3.0 · 代理互通', 's3.title': '代理之间直接发消息，不需要协调器。',
    's3.body': 'Rove 开出的每个尝试都知道是谁派发的自己，所以一句裸的 <span class="mono">rove api send</span> 就能准确发回那个引擎 tab——不用一路传 id、不用轮询、不用共享临时文件。沉默只是一个检查点，不是结论。',
    's3.body2': '消息到达时带着 <span class="mono">[KOBE PEER]</span> 标记，附上发送方和一条精确到 tab 的回复命令，接收方代理可以当场回话。一个代理编排五个，五个向上回报，同级之间也能互相提问。你的引擎从内置技能里学会这些动词——<span class="mono">rove skill install</span>。',
    'install.title': '在你代码所在的地方跑起来。',
    'install.body': '一行装好，一条命令跑起来。指向一个仓库，你就有了一支舰队——优化唯一重要的指标：你每小时注意力换来的已合并代码。',
    'install.npm': '从 npm 安装 ↗', 'install.star': '去 GitHub 点个 Star ↗',
    'final.line': '众流汇于一个 shell。',
    'footer.tagline': '终端里的编码代理多路复用器。',
    'footer.colophon': '用 Bun、OpenTUI 和 React 构建。字体为 Fraunces、DM Sans 与 JetBrains Mono。MIT 许可。',
    'footer.plugins': '插件', 'footer.changelog': '更新日志', 'footer.keybindings': '快捷键',
  };
  var en = {
    'meta.title': 'Rove — the agent multiplexer in your shell',
    'meta.desc': 'Rove multiplexes AI coding agents in your terminal: N isolated attempts, each with its own git worktree and hosted engine session, messaging each other as peers — all inside an SSH session you can close.',
    'nav.workflow': '--primitives', 'nav.install': '--install', 'nav.plugins': '--plugins', 'nav.themes': '--themes', 'nav.changelog': '--changelog',
    'hero.kicker': 'prompt engineering → context engineering → <span class="acc">graph engineering</span>',
    'hero.title': 'The agent <span class="acc">multiplexer</span> in your shell.',
    'hero.sub': 'One agent is a conversation. Five at once need a multiplexer: every attempt gets its own git worktree, branch and hosted engine session, they reach each other by message, and the whole fleet lives inside an SSH session you can close.',
    'hero.getStarted': 'Get started ↗',
    'hero.requirements': 'Runs on macOS & Linux (Windows via WSL). npm, bun, npx, or one curl line — Rove brings its own Bun runtime. Needs git and one engine CLI on your PATH.',
    'copy.hint': 'click to copy', 'copy.done': '✓ copied',
    'workspace.equation': 'one node =', 'workspace.sessions': 'hosted engine session',
    'fleet.eyebrow': 'four tasks running, nobody attached', 'fleet.cue': 'pick a task →',
    'fleet.note': 'A real session: three repositories, four tasks, each on its own worktree, branch and terminal tabs. <strong>Nothing is attached to any of them right now</strong> — every engine runs in a hosted PTY behind the daemon, so the work continues with the TUI closed.',
    'fleet.noteZen': 'This is zen mode: Files is collapsed and the workspace takes the freed width. Hit <b>☯ ZEN</b> at the bottom of the rail to bring it back, or pick a task on the left — this is a live layout, not a screenshot.',
    'fleet.noteFull': 'The full layout: Tasks on the left, the split workspace, Changes on the right. Pick a task, or use <b>[~] Zen</b> to collapse Files — this is a live layout, not a screenshot.',
    's1.no': '1.0 · MULTIPLEX', 's1.title': 'One prompt becomes N isolated attempts.',
    's1.body': 'A multiplexer is the whole idea: one prompt, N attempts, one call. Rove fans out every attempt into its own git worktree on its own branch, running whichever engine you point it at — claude, codex, copilot, kimi, or your own command. Independent nodes, no shared state, no agents stepping on each other\'s files.',
    's1.ownCmd': 'your own command',
    'fan.you': 'you', 'fan.ask': 'Simplify the auth flow — try three approaches in parallel.',
    'fan.starting': 'starting', 'fan.running': 'running', 'fan.done': 'reported',
    'fan.cmdLead': 'what the skill ran for you:',
    's2.no': '2.0 · SSH-NATIVE', 's2.title': 'It\u2019s a TUI. That is the whole remote story.',
    's2.body': 'No browser, no VNC, no desktop app, no port to forward. Rove runs where your code already lives — laptop, devbox, VPS, anything you can SSH into — with the real dependencies, services, credentials and build cache. What passes for the agent passes for you.',
    's2.body2': 'Dropping the connection is not an interrupt: engines run in hosted PTYs behind a daemon on that machine, so the fleet keeps working with the TUI closed. SSH back in 40 minutes later and reattach. No terminal to hand? <span class="mono">rove web</span> serves the same daemon-owned tasks and live terminals in a browser tab.',
    's3.no': '3.0 · PEERS', 's3.title': 'Agents message each other. No coordinator.',
    's3.body': 'Every attempt Rove spawns knows who dispatched it, so a bare <span class="mono">rove api send</span> routes home to that exact engine tab — no ids to thread through, no polling, no shared scratch file. Silence is a checkpoint, never a verdict.',
    's3.body2': 'Messages land tagged <span class="mono">[KOBE PEER]</span> with the sender and a tab-precise reply command attached, so the receiving agent can answer back mid-flight. One agent orchestrating five, five reporting in, peers asking each other questions. Your engine learns the verbs from a bundled skill — <span class="mono">rove skill install</span>.',
    'install.title': 'Spin it up where your code lives.',
    'install.body': 'One line, then one command. Point it at a repo and you have a fleet — optimizing the only metric that matters: merged code per hour of your attention.',
    'install.npm': 'Install from npm ↗', 'install.star': 'Star on GitHub ↗',
    'final.line': 'Many streams. One shell.',
    'footer.tagline': 'a terminal multiplexer for coding agents.',
    'footer.colophon': 'Built with Bun, OpenTUI and React. Set in Fraunces, DM Sans and JetBrains Mono. MIT licensed.',
    'footer.plugins': 'plugins', 'footer.changelog': 'changelog', 'footer.keybindings': 'keybindings',
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
    if (toggle) toggle.textContent = lang === 'zh' ? 'EN' : '中文';
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
      if (navigator.clipboard) navigator.clipboard.writeText('curl -fsSL https://rove.sma1lboy.me/install.sh | sh');
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

// stage-1 fan-out graph: type the ask, draw the edges, walk each lane from
// starting → running → reported. Replays on engine change, on the replay
// chip, and once when the graph first scrolls into view.
(function () {
  var root = document.getElementById('fanout');
  var askEl = document.getElementById('foAsk');
  var lanesEl = document.getElementById('foLanes');
  var cmdEl = document.getElementById('foCmd');
  var replayBtn = document.getElementById('foReplay');
  if (!root || !askEl || !lanesEl || !cmdEl) return;

  var SLUGS = { 'your own command': 'my-cli' };
  var LANES = ['a', 'b', 'c'];
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var engine = 'claude';
  var timers = [];
  var typer = null;

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (typer) { clearInterval(typer); typer = null; }
  }
  function at(ms, fn) { timers.push(setTimeout(fn, still ? 0 : ms)); }

  function slug() { return SLUGS[engine] || engine; }

  function paintLanes() {
    lanesEl.innerHTML = LANES.map(function (id) {
      return '<div class="fo-lane" data-lane="' + id + '">' +
        '<p class="fo-head"><b>' + slug() + '</b><span class="tag">' + id + '</span></p>' +
        '<p class="fo-wt">simplify-auth-' + id + '</p>' +
        '<p class="fo-st"><span class="sp">⠋</span> ' + KOBE_I18N.t('fan.starting') + '</p>' +
      '</div>';
    }).join('');
  }

  function setState(i, cls, mark, key) {
    var lane = lanesEl.children[i];
    if (!lane) return;
    lane.classList.add(cls);
    lane.querySelector('.fo-st').className = 'fo-st ' + (cls === 'ok' ? 'ok' : 'on');
    lane.querySelector('.fo-st').innerHTML = mark + ' ' + KOBE_I18N.t(key);
  }

  function play() {
    clearTimers();
    root.classList.remove('run', 'done');
    void root.offsetWidth; // restart the CSS timelines
    paintLanes();
    cmdEl.innerHTML = '<b>' + KOBE_I18N.t('fan.cmdLead') + '</b> rove api add --agents ' +
      slug() + ':3 --prompt …';
    askEl.textContent = '';

    var full = KOBE_I18N.t('fan.ask');
    if (still) {
      askEl.textContent = full;
      root.classList.add('run', 'done');
      LANES.forEach(function (_, i) { setState(i, 'ok', '✓', 'fan.done'); });
      return;
    }
    var n = 0;
    var fanAt = Math.floor(full.length * 0.45);
    typer = setInterval(function () {
      askEl.textContent = full.slice(0, ++n);
      if (n === fanAt) root.classList.add('run');
      if (n >= full.length) {
        clearInterval(typer); typer = null;
        root.classList.add('run');
        at(500, function () { LANES.forEach(function (_, i) { setState(i, 'lit', '●', 'fan.running'); }); });
        LANES.forEach(function (_, i) {
          at(1300 + i * 650, function () { setState(i, 'ok', '✓', 'fan.done'); });
        });
        at(1300 + LANES.length * 650, function () { root.classList.add('done'); });
      }
    }, 19);
  }

  document.querySelectorAll('.engine-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.engine-pill').forEach(function (p) { p.setAttribute('data-active', 'false'); });
      pill.setAttribute('data-active', 'true');
      engine = pill.getAttribute('data-engine');
      play();
    });
  });
  if (replayBtn) replayBtn.addEventListener('click', play);
  var langBtn = document.getElementById('langToggle');
  if (langBtn) langBtn.addEventListener('click', function () { setTimeout(play, 0); });

  // one ticker drives every braille spinner on the page, the way the TUI does it
  if (!still) {
    var FRAMES = '\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f';
    var f = 0;
    setInterval(function () {
      f = (f + 1) % FRAMES.length;
      var spinners = root.querySelectorAll('.fo-st .sp');
      for (var i = 0; i < spinners.length; i++) spinners[i].textContent = FRAMES[f];
    }, 90);
  }

  paintLanes();
  if (still || !window.IntersectionObserver) { play(); return; }
  var started = false;
  function start() { if (started) return; started = true; io.disconnect(); play(); }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) start(); });
  }, { threshold: 0.2 });
  io.observe(root);
  // never leave the graph frozen on its empty first frame
  setTimeout(start, 6000);
})();

// scroll reveal for the narrative stages. The class is added by JS so the page
// still renders fully when scripts are blocked (nothing carries .reveal in HTML).
(function () {
  var halves = document.querySelectorAll('.stage > .stage-txt, .stage > .stage-vis');
  if (!halves.length) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !window.IntersectionObserver) return;
  halves.forEach(function (el) { el.classList.add('reveal'); });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('seen');
      io.unobserve(e.target);
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  halves.forEach(function (el) { io.observe(el); });
  // Safety net: nothing on this page may stay invisible because an observer
  // never fired (deep link, find-in-page, print, a browser that throttles it).
  setTimeout(function () {
    io.disconnect();
    halves.forEach(function (el) { el.classList.add('seen'); });
  }, 4000);
})();
