/* demo.js: the hero's app window. A drawn copy of the Rove web client, whose panes are
 * terminals running each agent's own TUI. It plays scripted scenes; nothing here talks
 * to a real agent.
 *
 *   #scenes button[data-scene]   picks a scene; the pressed one shows progress in --p
 *   #demo                        the window body this file fills
 *
 * The scenes themselves are in demo-scenes.js, loaded first. A scene is an async function over the helpers in `kit`. Every wait goes through
 * `kit.w`, so one dry run sums a scene's length and reduced motion skips to its end.
 */
(function () {
  'use strict';

  var root = document.getElementById('demo');
  var tabs = document.getElementById('scenes');
  if (!root || !tabs) return;

  /** Every wait is scaled by this; lower plays faster. */
  var SPEED = 0.55;
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var run = 0;          // bumped on every scene start; a stale scene stops at its next wait
  var visible = true;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  var NAMES = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini' };
  function icon(name) {
    return '<svg class="d-ic d-ic-' + name + '" aria-hidden="true"><use href="#ic-' + name + '"/></svg>';
  }
  /* A row's status as the web client's 3×3 dot mark, ported from packages/rove-core/src/lib/status-dots.ts
     (after ELYTerminal's session orb, MIT). Every mark steps on one 80 ms clock: work ripples out
     from the centre, a wait dips twice a round, a settled state draws its shape dot by dot and holds. */
  var STEP_MS = 80;
  var SHAPE = { done: { dots: [3, 7, 5, 2], bright: 1 }, idle: { dots: [1, 2, 5, 8, 7, 6, 3, 0], bright: 0.6 } };
  function dotLevels(look, step, held, slow) {
    var levels = [], dot;
    if (look === 'work') {
      var t = step * STEP_MS / 1000 / slow;
      for (dot = 0; dot < 9; dot++) {
        var lag = Math.hypot(dot % 3 - 1, Math.floor(dot / 3) - 1) * 0.3;
        levels.push(0.35 + 0.65 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (t - lag) / 1.2)));
      }
      return levels;
    }
    if (look === 'wait') {
      var dip = [0, 1, 4, 5].indexOf(Math.floor(step / slow) % 20) >= 0;
      for (dot = 0; dot < 9; dot++) levels.push(dip ? 0.25 : 1);
      return levels;
    }
    for (dot = 0; dot < 9; dot++) levels.push(0.12);
    SHAPE[look].dots.forEach(function (d, rank) {
      var lit = Math.min(Math.max(held - rank, 0), 2) / 2;
      levels[d] = SHAPE[look].bright * lit + 0.12 * (1 - lit);
    });
    return levels;
  }
  function dots(look) {
    return '<span class="d-dots" data-s="' + look + '" data-began="' + Math.floor(performance.now() / STEP_MS) +
      '"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
  }
  setInterval(function () {
    if (!visible) return;
    var step = Math.floor(performance.now() / STEP_MS);
    [].forEach.call(root.querySelectorAll('.d-dots'), function (m) {
      var held = still ? Infinity : step - Number(m.getAttribute('data-began'));
      dotLevels(m.getAttribute('data-s'), step, held, still ? 3 : 1).forEach(function (level, i) {
        m.children[i].style.opacity = level.toFixed(3);
      });
    });
  }, STEP_MS);

  /* The small cloud the web rail puts on a task that lives on another machine (rove-core/src/lib/cloud-dots.ts). */
  var CLOUD = ['..##..', '##..#.', '#....#', '.####.'].map(function (row, y) {
    return row.split('').map(function (cell, x) {
      return cell === '#' ? '<circle cx="' + (x * 2 + 0.75) + '" cy="' + (y * 2 + 0.75) + '" r=".75"/>' : '';
    }).join('');
  }).join('');
  function cloud(machine) {
    return '<svg class="d-cloud" viewBox="0 0 11.5 7.5" aria-hidden="true"><title>' + machine + '</title>' + CLOUD + '</svg>';
  }

  function build() {
    root.innerHTML =
      '<aside class="d-side">' +
        '<div class="d-brand"><b><em>[</em> rove <em>]</em></b><span>inbox <i id="dInbox">0</i></span></div>' +
        '<div class="d-nav">New task<span>+</span></div><div class="d-nav" id="dNavRoutines">Routines</div>' +
        '<div class="d-rows" id="dRows"></div>' +
        '<div class="d-usage" id="dUsage"></div>' +
      '</aside>' +
      '<div class="d-main" id="dMain"></div>';
  }
  /* `machine` adds the chip that says where the task's files and commands are; a machine other than this one is `remote`. */
  function head(o) {
    return icon(o.label) + '<b>' + NAMES[o.label] + '</b>' + (o.where ? '<span>' + o.where + '</span>' : '') +
      (o.machine ? '<em class="d-chip' + (o.remote ? ' is-remote' : '') + '">' + cloud(o.machine) + o.machine + '</em>' : '');
  }

  function makeKit(id, dry) {
    var total = 0;
    var kit = {
      total: function () { return total; },
      w: function (ms) {
        ms *= SPEED;
        total += ms;
        if (dry || still) return Promise.resolve();
        return new Promise(function (resolve, reject) {
          var left = ms;
          var last = performance.now();
          (function tick() {
            if (id !== run) return reject(new Error('stale'));
            var now = performance.now();
            if (visible) { left -= now - last; kit.onTime(now - last); }
            last = now;
            if (left <= 0) resolve(); else setTimeout(tick, 40);
          })();
        });
      },
      onTime: function () {},
      group: function (name) {
        if (dry) return;
        document.getElementById('dRows').appendChild(el('div', 'd-group', name));
      },
      row: function (o) {
        if (dry) return;
        var s = o.status || 'idle';
        var r = el('div', 'd-row' + (o.child ? ' is-child' : '') + (o.child || o.flash ? ' is-new' : ''),
          (o.child ? '<span class="d-guide"></span>' : '') +
          icon(o.icon || (NAMES[o.tag] ? o.tag : 'claude')) + '<span class="d-title">' + o.title + '</span>' +
          (o.tag && !NAMES[o.tag] ? cloud(o.tag) : '') +
          dots(s));
        r.id = 'dRow-' + o.id;
        var after = o.after && document.getElementById('dRow-' + o.after);
        var rows = document.getElementById('dRows');
        if (after) rows.insertBefore(r, after.nextSibling); else rows.appendChild(r);
      },
      status: function (rowId, s) {
        if (dry) return;
        document.querySelector('#dRow-' + rowId + ' .d-dots').outerHTML = dots(s);
      },
      select: function (rowId) {
        if (dry) return;
        [].forEach.call(root.querySelectorAll('.d-row'), function (r) {
          r.classList.toggle('is-on', r.id === 'dRow-' + rowId);
        });
      },
      inbox: function (n) { if (!dry) document.getElementById('dInbox').textContent = n; },
      usage: function (name, pct, note) {
        if (dry) return;
        var u = document.getElementById('dUse-' + name);
        if (!u) {
          u = el('div', 'd-use', '<span>' + name + '</span><i><b></b></i><em></em>');
          u.id = 'dUse-' + name;
          document.getElementById('dUsage').appendChild(u);
        }
        u.querySelector('b').style.width = pct + '%';
        u.querySelector('em').textContent = note || pct + '%';
        u.classList.toggle('is-full', pct >= 100);
      },
      pane: function (o) {
        if (dry) return;
        // `is-<engine>` picks that engine's own TUI look: its prompt, bullets, spinner and footer.
        var p = el('section', 'd-pane is-' + o.label,
          '<header>' + head(o) + '</header><div class="d-lines"></div><div class="d-input"><i></i></div><div class="d-foot"></div>');
        p.id = 'dPane-' + o.id;
        document.getElementById('dMain').appendChild(p);
      },
      /* The Browser panel of the web and desktop clients, showing the page a task's dev server serves. */
      web: function (url) {
        if (dry) return;
        var p = el('section', 'd-pane d-web', '<header><b>Browser</b><span>' + url + '</span></header><div class="d-page" id="dPage"></div>');
        document.getElementById('dMain').appendChild(p);
      },
      page: function (html, cls) {
        if (dry) return;
        var pg = document.getElementById('dPage');
        pg.appendChild(el('div', 'd-pg ' + (cls || ''), html));
        pg.scrollTop = pg.scrollHeight;
      },
      card: function (name, price) {
        if (dry) return;
        document.querySelector('#dPage .is-cards').appendChild(el('div', 'd-card', '<i></i><b>' + name + '</b><span>' + price + '</span>'));
      },
      pageStyle: function () { if (!dry) document.getElementById('dPage').classList.add('is-styled'); },
      /* Bring one pane (and its sidebar row) to the front; the others keep running out of view. */
      show: function (ids) {
        if (dry) return;
        [].forEach.call(root.querySelectorAll('.d-pane'), function (p) {
          var on = ids.indexOf(p.id.slice(6)) >= 0;
          // A pane coming back fades in; replaying its opening animation would make the row jump.
          if (on && p.hidden) p.style.animation = 'd-fade .3s both';
          p.hidden = !on;
        });
        [].forEach.call(root.querySelectorAll('.d-row'), function (r) {
          r.classList.toggle('is-on', ids.indexOf(r.id.slice(5)) >= 0);
        });
      },
      /* A spinner that does not hold the script: it stays until the returned function is called. */
      spin: function (paneId, label) {
        if (dry || still) return function () {};
        var box = document.querySelector('#dPane-' + paneId + ' .d-lines');
        var p = el('p', 'd-line is-think', '<i></i>' + (label || 'Working…'));
        box.appendChild(p);
        return function () { if (p.parentNode) p.parentNode.removeChild(p); };
      },
      paneHead: function (paneId, o) {
        if (dry) return;
        var h = document.querySelector('#dPane-' + paneId + ' header');
        h.innerHTML = head(o);
        h.parentNode.className = 'd-pane is-' + o.label;
        var ic = document.querySelector('#dRow-' + paneId + ' .d-ic');
        if (ic) ic.outerHTML = icon(o.label);
        h.classList.remove('is-new');
        void h.offsetWidth;
        h.classList.add('is-new');
      },
      /* The machine menu under the pane's chip: the highlight walks down to `chosen`, then the menu closes. */
      pick: async function (paneId, items, chosen) {
        var m = null;
        if (!dry && !still) {
          m = el('div', 'd-menu', items.map(function (it) {
            return '<p>' + cloud(it[0]) + '<b>' + it[0] + '</b><span>' + it[1] + '</span></p>';
          }).join(''));
          document.getElementById('dPane-' + paneId).appendChild(m);
        }
        await kit.w(500);
        for (var i = 0; i <= chosen; i++) {
          if (m) [].forEach.call(m.children, function (p, n) { p.classList.toggle('is-on', n === i); });
          await kit.w(i === chosen ? 550 : 260);
        }
        if (m) m.parentNode.removeChild(m);
      },
      line: function (paneId, html, cls) {
        if (dry) return;
        var box = document.querySelector('#dPane-' + paneId + ' .d-lines');
        box.appendChild(el('p', 'd-line ' + (cls || ''), html));
        box.scrollTop = box.scrollHeight;
      },
      /* The Routines page: a pane-sized list of schedules, each with a state cell on the right. */
      list: function (o) {
        if (dry) return;
        var p = el('section', 'd-pane d-list', '<header><b>' + o.title + '</b><span id="dClock">' + o.clock + '</span></header>' +
          o.rows.map(function (r, i) {
            return '<div class="d-item" id="dItem-' + i + '"><b>' + r.name + '</b><span>' + r.when + '</span><span>' + r.on +
              '</span><em>' + r.state + '</em></div>';
          }).join(''));
        document.getElementById('dMain').appendChild(p);
        document.getElementById('dNavRoutines').classList.add('is-on');
      },
      item: function (i, state, cls) {
        if (dry) return;
        var it = document.getElementById('dItem-' + i);
        it.className = 'd-item ' + (cls || '');
        it.querySelector('em').textContent = state;
      },
      clock: function (text) { if (!dry) document.getElementById('dClock').textContent = text; },
      /* A line that arrives word by word, the way an agent's reply streams in. */
      say: async function (paneId, text, cls) {
        var words = text.split(' ');
        var p = null;
        if (!dry) {
          var box = document.querySelector('#dPane-' + paneId + ' .d-lines');
          p = el('p', 'd-line ' + (cls || 'is-say'), '');
          box.appendChild(p);
        }
        for (var i = 1; i <= words.length; i++) {
          if (p) { p.textContent = words.slice(0, i).join(' '); p.parentNode.scrollTop = p.parentNode.scrollHeight; }
          await kit.w(38);
        }
      },
      /* Several lines in quick succession: a tool's output landing. */
      burst: async function (paneId, lines) {
        for (var i = 0; i < lines.length; i++) {
          kit.line(paneId, lines[i][0], lines[i][1]);
          await kit.w(120);
        }
      },
      /* The agent is busy: a spinner line holds the pause, then gives way to what comes next. */
      think: async function (paneId, ms, label) {
        var p = null;
        if (!dry && !still) {
          var box = document.querySelector('#dPane-' + paneId + ' .d-lines');
          p = el('p', 'd-line is-think', '<i></i>' + (label || 'Working…'));
          box.appendChild(p);
          box.scrollTop = box.scrollHeight;
        }
        try { await kit.w(ms); } finally { if (p && p.parentNode) p.parentNode.removeChild(p); }
      },
      type: async function (paneId, text) {
        var box = dry ? null : document.querySelector('#dPane-' + paneId + ' .d-input i');
        // Three characters a step: one wait cannot be shorter than the 40 ms tick in `w`.
        for (var i = 3; i < text.length + 3; i += 3) {
          if (box) box.textContent = text.slice(0, i);
          await kit.w(40);
        }
        await kit.w(300);
        if (box) box.textContent = '';
        kit.line(paneId, text, 'is-prompt');
      },
    };
    return kit;
  }

  var scenes = window.RoveDemoScenes.scenes;

  var order = window.RoveDemoScenes.order;
  var lengths = {};
  order.forEach(function (name) {
    var k = makeKit(-1, true);
    scenes[name](k);          // dry: no wait sleeps, so the sum is complete a few microtasks later
    lengths[name] = k;
  });

  function play(name) {
    var id = ++run;
    root.classList.remove('is-out');
    build();
    var pressed;
    [].forEach.call(tabs.querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-scene') === name;
      b.setAttribute('aria-pressed', String(on));
      b.style.setProperty('--p', '0');
      if (on) pressed = b;
    });
    root.setAttribute('data-scene', name);
    document.dispatchEvent(new CustomEvent('rove:scene', { detail: name }));
    var k = makeKit(id, false);
    var spent = 0;
    k.onTime = function (ms) {
      spent += ms;
      if (pressed) pressed.style.setProperty('--p', String(Math.min(1, spent / lengths[name].total())));
    };
    scenes[name](k).then(function () {
      if (still || id !== run) return;
      root.classList.add('is-out');
      setTimeout(function () {
        if (id === run) play(order[(order.indexOf(name) + 1) % order.length]);
      }, 320);
    }, function () {});
  }

  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) play(b.getAttribute('data-scene'));
  });
  if ('IntersectionObserver' in window) {
    var inView = true;
    var sync = function () { visible = inView && !document.hidden; };
    new IntersectionObserver(function (entries) { inView = entries[0].isIntersecting; sync(); }).observe(root);
    document.addEventListener('visibilitychange', sync);
  }

  play(order[0]);
})();
