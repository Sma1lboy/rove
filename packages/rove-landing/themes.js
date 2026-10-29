// EN / 中文: same mechanism as the home page (data-i18n + localStorage).
// Terminal-mock content (task names, diff lines) deliberately stays English.
var ROVE_I18N = (function () {
  var zh = {
    'meta.title': 'Rove — 主题',
    'meta.desc': '每个内置 Rove 主题都由它真实的配色文件渲染，另附如何编写并发布你自己的主题。一个主题就是一个 JSON 文件，没有需要挤进去的注册表。',
    'nav.docs': '文档',
    'nav.plugins': '插件',
    'nav.themes': '主题',
    'nav.changelog': '更新日志',
    'skip': '跳到正文',
    'head.title': '内置三套，<span class="acc">另外十套</span>一条命令。',
    'head.lede': '下面每一块面板都由真实的主题文件绘制——就是 Rove 启动时加载的那份 JSON，不是谁手工调色的截图。在 <code>设置 → General → Theme</code> 里挑内置的三套之一，其余的一条命令装上，或者自己写——一个主题就是一个 JSON 文件，没有需要挤进去的注册表。',
    'sched.h': '全部主题',
    'sched.cap': '三套内置，十套托管',
    'sched.th.theme': '主题',
    'sched.th.source': '来源',
    'sched.th.slots': '色槽',
    'sched.th.bg': '背景',
    'sched.th.colors': '配色',
    'sched.th.slot': '色槽',
    'sched.bundledDefault': '内置，默认',
    'sched.bundled': '内置',
    'sched.hosted': '托管',
    'sched.note': '色块是各主题深色模式下的取值，从它自己的 JSON 里解析而来，顺序为：背景、面板、边框、文字、主色、强调色、成功、警告、错误。“色槽”列是文件实际填写的数量，其余的会向下回落。托管主题位于 <code>rove.run/themes/&lt;name&gt;.json</code>。',
    'sec.bundled': '内置主题',
    'bundled.body': 'Rove 刻意把内置的一套保持得很小——用 <code>ctrl+a</code> <code>,</code> 打开设置直接选，无需安装。每个预览都用该主题自己的色槽绘制侧边栏、选中的任务和一段 diff，所以你看到的就是实际会得到的对比度。每个主题同时定义了浅色模式，预览展示的是深色。',
    'bundled.note': '选中的行用 <code>primary</code> 填充，文字用 <code>selectedListItemText</code>。这十三个主题里它都解析为背景色，所以把 <code>primary</code> 用在近白色上的主题，看起来就是一次单纯的反色。',
    'note.claude': '暖石墨配陶土色——Rove 自己的身份色，与 Claude Code 的配色一致。',
    'note.conductor': '近黑与近白。没有色相来跟你的 diff 抢注意力——投屏时首选这套。',
    'note.dracula': '大家早就有肌肉记忆的那套。这里饱和度最高的一组。',
    'note.nord': '北极蓝灰，刻意压低对比。长时间工作最不累的选择。',
    'note.opencode': '中性炭灰加沙色强调色——从 opencode 过来会觉得眼熟。',
    'note.osaka': '深玉底色配薄荷信号色。最有主张的一套，运行指示也最响。',
    'note.tokyonight': '靛蓝夜色配珊瑚强调色。和你 nvim 里大概已经在用的 tokyonight 成套。',
    'note.gruvbox': '复古律动：暖棕底色配一记信号橙。暖色系里对比最强的一套，也是多数人说「终端配色」时想到的那个。',
    'note.catppuccin': '冷灰底上的柔和粉彩——藕紫作标志色，没有一处喧哗。深色用 Mocha，浅色用 Latte。',
    'note.rosepine': '近黑的梅色底上低饱和的鸢尾与玫瑰。安静但不发灰；浅色侧是 Dawn。',
    'note.everforest': '去饱和的森林绿，为暖色底上的长时间工作调过。',
    'note.kanagawa': '取自葛饰北斋的浪——墨蓝压在墨黑上，浅色侧是 lotus。',
    'note.solarized': '2011 年那个开创了精确终端配色的原版。深浅两侧共用同一组强调色。',
    'sec.hosted': '托管主题',
    'dl.body': '这些不装在二进制里，而是作为纯 JSON 托管在这——主题本来就只是这个。复制命令、运行、重启 Rove。其中几套在早先版本里是内置的；除了存放位置，它们没有任何变化。',
    'hosted.note': '点击文件名即可复制对应的安装命令。',
    'card.copy': '复制',
    'card.copied': '已复制',
    'themes.slot': '主题名',
    'slots.h': '色槽落在哪里',
    'slots.th2': '它给什么上色',
    'slots.d1': '选中行的填充',
    'slots.d2': '每个窗格的边框',
    'slots.d3': '正文和任务行',
    'slots.d4': '突出显示的值',
    'slots.d5': '所有内容后面的底色',
    'slots.p1': '色槽是界面里一个有名字的位置，不是一种带情绪的颜色。填上 <span class="mono">primary</span>，选中行、焦点窗格指示和 markdown 标题会一起变，因为它们读的是同一个色槽。',
    'slots.p2': '不必填满所有色槽。解析器保证提供二十五个，漏掉的会向相邻的色槽回落：<span class="mono">borderActive</span> → <span class="mono">border</span> → <span class="mono">text</span>，<span class="mono">backgroundPanel</span> → <span class="mono">background</span>，<span class="mono">diffAdded</span> → <span class="mono">success</span>。只有 <span class="mono">text</span> 和 <span class="mono">background</span> 无处可回落。',
    'slots.gcap': '色槽分组',
    'slots.g1': '背景',
    'slots.g2': '文字',
    'slots.g3': '边框',
    'slots.g4': '品牌',
    'slots.g5': '状态',
    'slots.g6': 'Diff',
    'slots.g6tail': '以及它们的背景',
    'write.title': '一个主题就是一个 JSON 文件。',
    'write.body': '把任意 <code>*.json</code> 丢进 <code>~/.rove/themes/</code>，下次启动就出现在选择器里。取和内置主题同名，你的那份优先。也不必填满所有色槽——缺失的会向下回落（<code>borderActive</code> → <code>border</code> → <code>text</code>），所以十几行就已经是一套可用的主题。',
    'write.body2': '<code>defs</code> 是可选的命名色板，色槽可以按名字引用它。色槽的值可以是 hex 字符串、<code>defs</code> 的键，或者一个 <code>{ dark, light }</code> 对——用对偶形式时两边都必填。<code>$schema</code> 那行的作用是让编辑器给你自动补全。',
    'write.ex': '完整示例：<span class="mono">claude.json</span> 用 42 个 defs 填了 54 个色槽；<span class="mono">conductor.json</span> 填了 35 个。复制任意一个，然后开始删。',
    'fmt.note': '文件名就是主题名。用户文件与内置主题同名时，以用户文件为准。',
    'pub.title': '分享一个 URL。这就是全部的注册表。',
    'pub.body': '没有提交队列，也没有清单文件要写。安装走的是 HTTPS 读取原始文件，所以任何你能链接到的地方都能装——一个仓库、一个 gist、或者你自己的服务器。',
    'pub.s1': '把 JSON 提交到一个 <b>公开仓库或 gist</b>。',
    'pub.s2': '在 GitHub 上点 <b>Raw</b> 复制地址，形如 <code>raw.githubusercontent.com/&lt;你&gt;/&lt;仓库&gt;/main/&lt;主题&gt;.json</code>。',
    'pub.s3': '让别人运行 <code>rove theme add &lt;raw-url&gt;</code>。它会先校验 JSON 再写入，且不加 <code>--force</code> 不会覆盖已有主题。',
    'pub.s4': '给仓库打上 GitHub topic <code>rove-theme</code> 方便被搜到，再对本页提个 PR，就能带预览收录进来。',
    'route.th1': '步骤',
    'route.th2': '发生什么',
    'route.n1': '原始 URL',
    'route.d1': '任何仓库、gist 或服务器。',
    'route.n2': '校验',
    'route.d2': '规则与启动时相同。无效的文件会被拒绝，并给出一行原因。',
    'route.n3': '写入',
    'route.d3': '<span class="mono">~/.rove/themes/&lt;name&gt;.json</span>。同名文件已存在时，不加 <span class="mono">--force</span> 会被拒绝。',
    'route.n4': '下次启动',
    'route.d4': '主题出现在选择器里。',
    'copy.hint': '点击复制',
    'copy.done': '已复制',
    'footer.plugins': '插件',
    'footer.changelog': '更新日志',
    'footer.themedocs': '主题文档',
    'footer.keybindings': '快捷键',
    'footer.copy': '© 2026 Sma1lboy。MIT 许可。',
  };
  var en = {
    'meta.title': 'Rove: themes',
    'meta.desc': 'Every bundled Rove theme, rendered from its real color file, plus how to write and publish your own. A theme is one JSON file; there is no registry to get into.',
    'nav.docs': 'Docs',
    'nav.plugins': 'Plugins',
    'nav.themes': 'Themes',
    'nav.changelog': 'Changelog',
    'skip': 'Skip to content',
    'head.title': 'Three in the box, <span class="acc">ten more</span> a command away.',
    'head.lede': 'Every panel below is drawn from a real theme file, the same JSON Rove loads at boot, not a screenshot someone re-tinted by hand. Pick one of the three bundled ones in <code>Settings → General → Theme</code>, install any of the rest with one command, or write your own. A theme is one JSON file, and there is no registry to get into.',
    'sched.h': 'All themes',
    'sched.cap': '3 bundled, 10 hosted',
    'sched.th.theme': 'Theme',
    'sched.th.source': 'Source',
    'sched.th.slots': 'Slots',
    'sched.th.bg': 'Background',
    'sched.th.colors': 'Colors',
    'sched.th.slot': 'Slot',
    'sched.bundledDefault': 'Bundled, default',
    'sched.bundled': 'Bundled',
    'sched.hosted': 'Hosted',
    'sched.note': 'Swatches show each theme\'s dark values, resolved from its own JSON, in this order: background, panel, border, text, primary, accent, success, warning, error. Slots is how many slots the file fills; the rest fall through. Hosted themes live at <code>rove.run/themes/&lt;name&gt;.json</code>.',
    'sec.bundled': 'Bundled themes',
    'bundled.body': 'Rove keeps its bundled set deliberately small. Open Settings with <code>ctrl+a</code> <code>,</code> and pick one; nothing to install. Each preview paints the sidebar, the selected task, and a diff with that theme\'s own slots, so what you see is the contrast you\'ll actually get. Every theme also defines a light mode; the previews show dark.',
    'bundled.note': 'A selected row is filled with <code>primary</code> and its text is set to <code>selectedListItemText</code>. All thirteen themes resolve that text to their background, so a theme that spends <code>primary</code> on near-white reads as a plain inversion.',
    'note.claude': 'Warm graphite and terracotta. Rove\'s own identity, matched to the Claude Code palette.',
    'note.conductor': 'Near-black and near-white. No hue competes with your diff. The one to reach for on a projector.',
    'note.dracula': 'The one everybody already has muscle memory for. Highest-saturation set here.',
    'note.nord': 'Arctic blue-grey, low contrast by design. The calmest option for long sessions.',
    'note.opencode': 'Neutral charcoal with a sand accent. Familiar if you came from opencode.',
    'note.osaka': 'Deep jade ground with a mint signal color. The most opinionated set, and the loudest running indicator.',
    'note.tokyonight': 'Indigo night with a coral accent. Pairs with the tokyonight setup you probably already run in nvim.',
    'note.gruvbox': 'Retro groove: warm browns under a signal orange. The highest-contrast warm set, and the one most people mean by "terminal colors".',
    'note.catppuccin': 'Soft pastels on a cool grey base, mauve signature, nothing shouts. Ships Mocha for dark and Latte for light.',
    'note.rosepine': 'Low-saturation iris and rose on near-black plum. Quiet without going grey; Dawn is the light side.',
    'note.everforest': 'Desaturated forest greens, tuned for long sessions on a warm background.',
    'note.kanagawa': 'Inspired by Katsushika Hokusai\'s wave: ink blues over sumi black, lotus for light.',
    'note.solarized': 'The 2011 original that started precision terminal palettes. Both sides share one accent set.',
    'sec.hosted': 'Hosted themes',
    'dl.body': 'These live here as plain JSON instead of inside the binary, which is all a theme ever is. Copy the command, run it, restart Rove. Several of them shipped bundled in earlier versions; nothing changed about them except where they\'re stored.',
    'hosted.note': 'Click a file name to copy its install command.',
    'card.copy': 'Copy',
    'card.copied': 'Copied',
    'themes.slot': '<name>',
    'slots.h': 'Where a slot lands',
    'slots.th2': 'What it colors',
    'slots.d1': 'Selected row fill',
    'slots.d2': 'Every pane border',
    'slots.d3': 'Body text and task rows',
    'slots.d4': 'Called-out values',
    'slots.d5': 'The field behind everything',
    'slots.p1': 'A slot is a named place in the interface, not a color with a mood. Fill <span class="mono">primary</span> and you change the selected row, the focused pane indicator and the markdown headings at once, because they all read the same slot.',
    'slots.p2': 'You do not have to fill every slot. The resolver guarantees twenty-five of them, and anything left out falls through to a neighbor: <span class="mono">borderActive</span> → <span class="mono">border</span> → <span class="mono">text</span>, <span class="mono">backgroundPanel</span> → <span class="mono">background</span>, <span class="mono">diffAdded</span> → <span class="mono">success</span>. Only <span class="mono">text</span> and <span class="mono">background</span> have nothing left to fall to.',
    'slots.gcap': 'Slot groups',
    'slots.g1': 'Background',
    'slots.g2': 'Text',
    'slots.g3': 'Border',
    'slots.g4': 'Brand',
    'slots.g5': 'State',
    'slots.g6': 'Diff',
    'slots.g6tail': 'and their backgrounds',
    'write.title': 'A theme is one JSON file.',
    'write.body': 'Drop any <code>*.json</code> into <code>~/.rove/themes/</code> and it appears in the picker at next boot. Name it after a bundled theme and yours wins. You don\'t have to fill every slot. Missing ones fall through (<code>borderActive</code> → <code>border</code> → <code>text</code>), so a dozen lines is already a usable theme.',
    'write.body2': '<code>defs</code> is an optional named palette a slot can reference by name. A slot value is a hex string, a <code>defs</code> key, or a <code>{ dark, light }</code> pair. When you use the pair form, both sides are required. The <code>$schema</code> line is what gives you autocomplete in your editor.',
    'write.ex': 'Worked examples: <span class="mono">claude.json</span> fills 54 slots off 42 defs; <span class="mono">conductor.json</span> fills 35. Copy either and start deleting.',
    'fmt.note': 'The file name is the theme name. A user file with the same name as a bundled theme wins.',
    'pub.title': 'Share a URL. That\'s the whole registry.',
    'pub.body': 'There is no submission queue and no manifest to write. Installation reads a raw file over HTTPS, so anything you can link to is installable: a repo, a gist, your own host.',
    'pub.s1': 'Commit the JSON to a <b>public repo or gist</b>.',
    'pub.s2': 'Hit <b>Raw</b> on GitHub and copy the URL. It looks like <code>raw.githubusercontent.com/&lt;you&gt;/&lt;repo&gt;/main/&lt;theme&gt;.json</code>.',
    'pub.s3': 'Tell people to run <code>rove theme add &lt;raw-url&gt;</code>. It validates the JSON before writing and refuses to clobber an existing theme without <code>--force</code>.',
    'pub.s4': 'Tag the repo <code>rove-theme</code> on GitHub so it\'s findable, and open a PR against this page to get it listed with a preview.',
    'route.th1': 'Step',
    'route.th2': 'What happens',
    'route.n1': 'Raw URL',
    'route.d1': 'Any repo, gist or host.',
    'route.n2': 'Validate',
    'route.d2': 'Same rules as boot. An invalid file is refused with a one-line reason.',
    'route.n3': 'Write',
    'route.d3': '<span class="mono">~/.rove/themes/&lt;name&gt;.json</span>. An existing file of that name is refused without <span class="mono">--force</span>.',
    'route.n4': 'Next boot',
    'route.d4': 'The theme is in the picker.',
    'copy.hint': 'click to copy',
    'copy.done': 'Copied',
    'footer.plugins': 'Plugins',
    'footer.changelog': 'Changelog',
    'footer.themedocs': 'Theme docs',
    'footer.keybindings': 'Keybindings',
    'footer.copy': '© 2026 Sma1lboy. MIT license.',
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
    var label = document.getElementById('copyLabel');
    if (label) label.textContent = t('copy.hint');
    var toggle = document.getElementById('langToggle');
    if (toggle) toggle.textContent = lang === 'zh' ? 'EN' : '中文';
  }

  var toggleBtn = document.getElementById('langToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      lang = lang === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem('rove_lang', lang); } catch (e) {}
      apply();
    });
  }
  apply();
  return { t: t };
})();

// Per-card install commands (downloadable themes).
(function () {
  document.querySelectorAll('.tc-cmd').forEach(function (b) {
    var label = b.querySelector('.tc-hint');
    var timer;
    b.addEventListener('click', function () {
      try {
        if (navigator.clipboard) navigator.clipboard.writeText('rove theme add ' + b.getAttribute('data-install'));
      } catch (e) {}
      b.classList.add('is-copied');
      label.textContent = ROVE_I18N.t('card.copied');
      clearTimeout(timer);
      timer = setTimeout(function () {
        b.classList.remove('is-copied');
        label.textContent = ROVE_I18N.t('card.copy');
      }, 1600);
    });
  });
})();

(function () {
  var btn = document.getElementById('copyBtn');
  var label = document.getElementById('copyLabel');
  var timer;
  btn.addEventListener('click', function () {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText('rove theme add <raw-url>');
    } catch (e) {}
    btn.classList.add('is-copied');
    label.textContent = ROVE_I18N.t('copy.done');
    clearTimeout(timer);
    timer = setTimeout(function () {
      btn.classList.remove('is-copied');
      label.textContent = ROVE_I18N.t('copy.hint');
    }, 1800);
  });
})();

// live GitHub star count: same shape and same `rove_stars` cache key as the
// home and plugins pages, so the count paints instantly once any page has run
(function () {
  var el = document.getElementById('starCount');
  if (!el) return;
  function render(n) { el.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); }
  try { var c = JSON.parse(localStorage.getItem('rove_stars') || 'null'); if (c && typeof c.n === 'number') render(c.n); } catch (e) {}
  fetch('https://api.github.com/repos/Sma1lboy/rove')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (!d || typeof d.stargazers_count !== 'number') return; render(d.stargazers_count); try { localStorage.setItem('rove_stars', JSON.stringify({ n: d.stargazers_count })); } catch (e) {} })
    .catch(function () { if (el.textContent === '–') el.textContent = '☆'; });
})();
