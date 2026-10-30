/* Rove marketplace: the plugin list and the hash-routed detail view.
   Loaded by plugins.html after ROVE_I18N is defined. Classic script (no module),
   so it also runs from file:// while iterating locally. */
(function () {
  var grid = document.getElementById('grid');
  var countEl = document.getElementById('count');
  var qEl = document.getElementById('q');
  var sortEl = document.getElementById('sort');
  var headSec = document.getElementById('top');
  var listSec = document.getElementById('marketplace');
  var pubSec = document.getElementById('publish');
  var detailSec = document.getElementById('detail');
  if (!grid) return;

  // The first-party plugins live in subdirectories of one repo. Subdirectories can
  // never carry a GitHub topic, so they are seeded here. The parent repo, which DOES
  // carry the topic, is dropped from the community results below (it would be a
  // seventh card duplicating these six) after lending them its stars and push date.
  var FIRST_PARTY_REPO = 'Sma1lboy/rove-plugins';
  var SEED = [
    { ref: 'Sma1lboy/rove-plugins/notify', name: 'notify', owner: 'Sma1lboy', firstParty: true,
      desc: { en: 'Desktop or ntfy notifications when an agent finishes a turn or needs your input.', zh: '代理跑完一轮或需要你介入时，发桌面通知 / ntfy 推送。' } },
    { ref: 'Sma1lboy/rove-plugins/github-start', name: 'github-start', owner: 'Sma1lboy', firstParty: true,
      desc: { en: 'Start a Rove task straight from a GitHub issue or pull request.', zh: '直接从一个 GitHub issue 或 PR 起一个 Rove 任务。' } },
    { ref: 'Sma1lboy/rove-plugins/worktree-include', name: 'worktree-include', owner: 'Sma1lboy', firstParty: true,
      desc: { en: 'Copy gitignored files matching .worktreeinclude into every new worktree.', zh: '把 .worktreeinclude 匹配到的 gitignore 文件复制进每个新建的 worktree。' } },
    { ref: 'Sma1lboy/rove-plugins/linear-start', name: 'linear-start', owner: 'Sma1lboy', firstParty: true,
      desc: { en: 'Pick a Linear issue (fzf) and start a Rove task on its branch with the issue as the prompt.', zh: '用 fzf 选一个 Linear issue，在它的分支上起一个 Rove 任务，issue 内容作为首条提示词。' } },
    { ref: 'Sma1lboy/rove-plugins/lazygit', name: 'lazygit', owner: 'Sma1lboy', firstParty: true,
      desc: { en: 'Open lazygit on the task worktree as a terminal-tab pane in the running TUI.', zh: '在运行中的 TUI 里以终端 tab 面板打开任务 worktree 的 lazygit。' } },
    { ref: 'Sma1lboy/rove-plugins/browser', name: 'browser', owner: 'Sma1lboy', firstParty: true,
      desc: { en: 'A real Chromium browser rendered as terminal cells (carbonyl) in a pane tab.', zh: '真 Chromium 以终端字符渲染（carbonyl）跑在 pane tab 里。' } },
  ];

  var items = [];
  var readmes = {}; // ref -> rendered html, or false once the fetch has failed

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function repoOf(it) { return it.ref.split('/').slice(0, 2).join('/'); }
  function subdirOf(it) { return it.ref.split('/').slice(2).join('/'); }
  function urlOf(it) {
    var sub = subdirOf(it);
    return 'https://github.com/' + repoOf(it) + (sub ? '/tree/HEAD/' + sub : '');
  }
  function descOf(it) { return typeof it.desc === 'string' ? it.desc : (it.desc[ROVE_I18N.lang()] || it.desc.en); }
  function starsOf(it) { return typeof it.stars === 'number' ? it.stars.toLocaleString() : '–'; }

  function relTime(iso) {
    if (!iso) return '';
    var days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    var loc = ROVE_I18N.lang() === 'zh' ? 'zh-CN' : 'en';
    try {
      var rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
      if (Math.abs(days) < 31) return rtf.format(-days, 'day');
      if (Math.abs(days) < 365) return rtf.format(-Math.round(days / 30), 'month');
      return rtf.format(-Math.round(days / 365), 'year');
    } catch (e) { return days + 'd'; }
  }

  function fromApi(r) {
    return {
      ref: r.full_name,
      // only follow github.com links, whatever the API hands back
      url: /^https:\/\/github\.com\//.test(r.html_url || '') ? r.html_url : 'https://github.com/' + r.full_name,
      name: r.name,
      owner: (r.owner && r.owner.login) || String(r.full_name || '').split('/')[0],
      desc: r.description || '',
      stars: r.stargazers_count,
      lang: r.language,
      pushed: r.pushed_at,
      created: r.created_at,
    };
  }

  function ratingHtml(it) {
    var n = starsOf(it);
    return '<span class="rating" title="' + esc(n + ' ' + ROVE_I18N.t('mk.stars')) + '">★' + esc(n) + '</span>';
  }

  // first party, language, relative push date: every part optional
  function metaRow(it) {
    var parts = [];
    if (it.firstParty) parts.push(ROVE_I18N.t('mk.firstParty'));
    if (it.lang) parts.push(it.lang);
    if (it.pushed) parts.push(relTime(it.pushed));
    return parts.map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('');
  }

  function card(it) {
    var cmd = 'rove plugin install ' + it.ref;
    var meta = metaRow(it);
    return '<article class="card" data-ref="' + esc(it.ref) + '">' +
      '<div class="card-top">' +
        '<a class="card-name" href="#' + esc(it.ref) + '">' +
          '<span class="owner">' + esc(it.owner) + '/</span>' + esc(it.name) + '</a>' +
        ratingHtml(it) +
      '</div>' +
      '<p class="card-desc">' + esc(descOf(it)) + '</p>' +
      (meta ? '<div class="card-meta">' + meta + '</div>' : '') +
      '<button class="card-install" type="button" data-install="' + esc(cmd) + '" title="' + esc(ROVE_I18N.t('mk.copy')) + '">' +
        '<span class="ps" aria-hidden="true">$</span><span class="cmd">' + esc(cmd) + '</span></button>' +
    '</article>';
  }

  function renderList() {
    var q = (qEl.value || '').trim().toLowerCase();
    var mode = sortEl.value;
    var list = items.filter(function (it) {
      return !q || (it.ref + ' ' + descOf(it)).toLowerCase().indexOf(q) !== -1;
    });
    var key = mode === 'pushed' ? 'pushed' : mode === 'newest' ? 'created' : 'stars';
    list.sort(function (a, b) {
      var av = key === 'stars' ? (a.stars || 0) : Date.parse(a[key] || 0) || 0;
      var bv = key === 'stars' ? (b.stars || 0) : Date.parse(b[key] || 0) || 0;
      return bv - av || a.ref.localeCompare(b.ref);
    });
    countEl.textContent = list.length + ' ' + ROVE_I18N.t(list.length === 1 ? 'mk.count1' : 'mk.count');
    grid.innerHTML = list.length
      ? list.map(card).join('')
      : '<p class="empty">' + esc(ROVE_I18N.t('mk.none')) + '</p>';
  }

  // ── minimal markdown → html (headings, paragraphs, fenced code, inline code, links, lists) ──
  function mdInline(src) {
    var codes = [];
    var s = String(src).replace(/`([^`]+)`/g, function (m, c) { codes.push(c); return '\uE000' + (codes.length - 1) + '\uE001'; });
    s = esc(s);
    s = s.replace(/!?\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, function (m, text, href) {
      return /^https?:\/\//.test(href)
        ? '<a href="' + href + '" target="_blank" rel="noopener nofollow">' + text + '</a>'
        : text;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s.replace(/\uE000(\d+)\uE001/g, function (m, i) { return '<code>' + esc(codes[i]) + '</code>'; });
  }

  var BLOCK_START = /^(?:```|#{1,6}\s|\s*(?:[-*+]|\d+[.)])\s|\s*(?:---+|===+|\*\*\*+)\s*$)/;

  function md(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push('<pre class="md-pre"><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { out.push('<h' + h[1].length + '>' + mdInline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
      if (/^\s*(?:---+|===+|\*\*\*+)\s*$/.test(line)) { out.push('<hr class="md-hr">'); i++; continue; }
      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
        var ordered = /^\s*\d/.test(line), li = [];
        while (i < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i]) && ordered === /^\s*\d/.test(lines[i])) {
          li.push('<li>' + mdInline(lines[i++].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')) + '</li>');
        }
        var tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + ' class="md-list">' + li.join('') + '</' + tag + '>');
        continue;
      }
      if (!line.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) para.push(lines[i++]);
      out.push('<p>' + mdInline(para.join(' ')) + '</p>');
    }
    return out.join('');
  }

  // ── detail view ──
  function readmeUrl(it) {
    var sub = subdirOf(it);
    return 'https://raw.githubusercontent.com/' + repoOf(it) + '/HEAD/' + (sub ? sub + '/' : '') + 'README.md';
  }

  function readmeFallback(it) {
    return '<p class="md-fail">' + esc(ROVE_I18N.t('det.readmeFail')) +
      ' <a href="' + esc(urlOf(it)) + '" target="_blank" rel="noopener">' + esc(ROVE_I18N.t('det.viewGithub')) + ' ↗</a></p>';
  }

  function loadReadme(it) {
    var host = detailSec.querySelector('.det-readme-body');
    if (!host) return;
    if (readmes[it.ref] !== undefined) {
      host.innerHTML = readmes[it.ref] || readmeFallback(it);
      return;
    }
    fetch(readmeUrl(it))
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
      .then(function (text) {
        readmes[it.ref] = md(text);
        if (currentRef() === it.ref) host.innerHTML = readmes[it.ref];
      })
      .catch(function () {
        readmes[it.ref] = false;
        if (currentRef() === it.ref) host.innerHTML = readmeFallback(it);
      });
  }

  function detailHtml(it) {
    var cmd = 'rove plugin install ' + it.ref;
    var facts = [ratingHtml(it)];
    if (it.firstParty) facts.push('<span>' + esc(ROVE_I18N.t('mk.firstParty')) + '</span>');
    if (it.lang) facts.push('<span>' + esc(it.lang) + '</span>');
    if (it.pushed) facts.push('<span>' + esc(ROVE_I18N.t('det.pushed')) + ' ' + esc(relTime(it.pushed)) + '</span>');
    facts.push('<a class="det-gh" href="' + esc(urlOf(it)) + '" target="_blank" rel="noopener">' + esc(ROVE_I18N.t('det.viewGithub')) + ' ↗</a>');
    return '<a class="det-back" href="#">' + esc(ROVE_I18N.t('det.back')) + '</a>' +
      '<h2 class="det-name"><span class="owner">' + esc(it.owner) + '/</span>' + esc(it.name) + '</h2>' +
      '<p class="det-desc">' + esc(descOf(it)) + '</p>' +
      '<div class="det-facts">' + facts.join('') + '</div>' +
      '<button class="card-install det-install" type="button" data-install="' + esc(cmd) + '" title="' + esc(ROVE_I18N.t('mk.copy')) + '">' +
        '<span class="ps" aria-hidden="true">$</span><span class="cmd">' + esc(cmd) + '</span></button>' +
      '<div class="det-readme"><div class="det-readme-body md"><p class="md-fail">' + esc(ROVE_I18N.t('det.readmeLoading')) + '</p></div></div>';
  }

  function currentRef() { try { return decodeURIComponent((location.hash || '').slice(1)); } catch (e) { return ''; } }

  function showList() {
    detailSec.hidden = true;
    headSec.hidden = false; listSec.hidden = false; pubSec.hidden = false;
    document.title = ROVE_I18N.t('meta.title');
    renderList();
  }

  function showDetail(it) {
    headSec.hidden = true; listSec.hidden = true; pubSec.hidden = true;
    detailSec.hidden = false;
    detailSec.innerHTML = detailHtml(it);
    document.title = it.owner + '/' + it.name + ' | Rove';
    loadReadme(it);
  }

  function route(scroll) {
    var ref = currentRef();
    var it = ref && items.filter(function (x) { return x.ref === ref; })[0];
    if (it) { showDetail(it); if (scroll) window.scrollTo(0, 0); }
    else showList();
  }

  qEl.addEventListener('input', renderList);
  sortEl.addEventListener('change', renderList);
  ROVE_I18N.onChange(function () { if (items.length) route(false); });
  window.addEventListener('hashchange', function () { route(true); });

  // whole card opens the detail view; the install button copies instead
  grid.addEventListener('click', function (e) {
    if (!e.target.closest || e.target.closest('.card-install') || e.target.closest('a')) return;
    var art = e.target.closest('.card');
    if (art) location.hash = art.getAttribute('data-ref');
  });

  // copy an install command (delegated on document: list and detail both render buttons)
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.card-install');
    if (!btn) return;
    var cmd = btn.getAttribute('data-install');
    try { if (navigator.clipboard) navigator.clipboard.writeText(cmd); } catch (err) {}
    var label = btn.querySelector('.cmd');
    label.textContent = ROVE_I18N.t('mk.copied');
    setTimeout(function () { label.textContent = cmd; }, 1500);
  });

  // Seed-only listings get their own notice, and the community disclaimer is
  // hidden: nothing community-published is on screen to disclaim.
  function seedNotice(key, isErr) {
    var host = document.getElementById('disclaimer');
    host.hidden = true;
    var n = document.createElement('p');
    n.className = isErr ? 'notice err' : 'notice';
    function say() { n.textContent = ROVE_I18N.t(key); }
    say();
    ROVE_I18N.onChange(say);
    host.insertAdjacentElement('beforebegin', n);
  }

  function searchTopic(topic) {
    return fetch('https://api.github.com/search/repositories?q=topic:' + topic + '&sort=stars&order=desc&per_page=100')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { return (d && d.items) || []; })
      .catch(function () { return null; });
  }

  searchTopic('rove-plugin')
    .then(function (found) {
      if (found === null) throw new Error('topic search failed');
      var parent = null;
      var community = found.map(fromApi).filter(function (r) {
        if (r.ref !== FIRST_PARTY_REPO) return true;
        parent = r; // the seeds already cover it: keep its numbers, drop the card
        return false;
      });
      if (parent) {
        SEED.forEach(function (s) { s.stars = parent.stars; s.pushed = parent.pushed; s.created = parent.created; });
      }
      items = SEED.concat(community);
      if (!found.length) seedNotice('mk.empty', false);
      // nothing community-published on screen, so nothing for the disclaimer to disclaim
      else if (!community.length) document.getElementById('disclaimer').hidden = true;
      route(false);
    })
    .catch(function () { items = SEED; seedNotice('mk.offline', true); route(false); });
})();
