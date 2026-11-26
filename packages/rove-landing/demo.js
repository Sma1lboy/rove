/* demo.js: the hero's terminal window. A drawn copy of the Rove TUI that plays
 * scripted scenes; nothing here talks to a real agent.
 *
 *   #scenes button[data-scene]   picks a scene; the pressed one shows progress in --p
 *   #demo                        the window body this file fills
 *
 * A scene is an async function over the helpers in `kit`. Every wait goes through
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
  function build() {
    root.innerHTML =
      '<aside class="d-side">' +
        '<div class="d-brand"><b>ROVE</b> <span>INBOX <i id="dInbox">0</i></span></div>' +
        '<div class="d-nav is-strong">New task<span>n</span></div><div class="d-nav" id="dNavRoutines">Routines</div><div class="d-nav">Issues</div>' +
        '<div class="d-rows" id="dRows"></div>' +
        '<div class="d-usage" id="dUsage"></div>' +
        '<div class="d-hint">j/k move · ⏎ open</div>' +
      '</aside>' +
      '<div class="d-body"><div class="d-main" id="dMain"></div><div class="d-status">^A commands · F1 help · [settings]</div></div>';
  }

  var GLYPH = { idle: '○', work: '●', done: '✓', wait: '?' };
  function head(o) { return '<b>' + o.label + '</b>' + (o.where ? ' · ' + o.where : ''); }

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
        document.getElementById('dRows').appendChild(el('div', 'd-group', '<span>' + name + '</span>'));
      },
      row: function (o) {
        if (dry) return;
        var s = o.status || 'idle';
        var r = el('div', 'd-row' + (o.child ? ' is-child' : '') + (o.child || o.flash ? ' is-new' : ''),
          '<span class="d-dot" data-s="' + s + '">' + GLYPH[s] + '</span><span class="d-title">' + o.title + '</span>' +
          (o.tag ? '<span class="d-tag">' + o.tag + '</span>' : ''));
        r.id = 'dRow-' + o.id;
        var after = o.after && document.getElementById('dRow-' + o.after);
        var rows = document.getElementById('dRows');
        if (after) rows.insertBefore(r, after.nextSibling); else rows.appendChild(r);
      },
      status: function (rowId, s) {
        if (dry) return;
        var dot = document.querySelector('#dRow-' + rowId + ' .d-dot');
        dot.setAttribute('data-s', s);
        dot.textContent = GLYPH[s];
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
          u = el('div', 'd-use', '<span>' + name.toLowerCase() + '</span><i><b></b></i><em></em>');
          u.id = 'dUse-' + name;
          document.getElementById('dUsage').appendChild(u);
        }
        u.querySelector('b').style.width = pct + '%';
        u.querySelector('em').textContent = note || pct + '%';
        u.classList.toggle('is-full', pct >= 100);
      },
      pane: function (o) {
        if (dry) return;
        var p = el('section', 'd-pane',
          '<header>' + head(o) + '</header><div class="d-lines"></div><div class="d-input"><span>❯</span><i></i></div>');
        p.id = 'dPane-' + o.id;
        document.getElementById('dMain').appendChild(p);
      },
      paneHead: function (paneId, o) {
        if (dry) return;
        var h = document.querySelector('#dPane-' + paneId + ' header');
        h.innerHTML = head(o);
        h.classList.remove('is-new');
        void h.offsetWidth;
        h.classList.add('is-new');
      },
      /* The plain shell before the TUI opens: a prompt, a typed command, then the screen clears. */
      shell: async function (cmd) {
        var s = null;
        if (!dry && !still) {
          s = el('div', 'd-shell', '<span>~/storefront</span> <b>$</b> <i></i>');
          root.appendChild(s);
        }
        await kit.w(500);
        for (var i = 1; i <= cmd.length; i++) {
          if (s) s.querySelector('i').textContent = cmd.slice(0, i);
          await kit.w(90);
        }
        await kit.w(500);
        if (s) root.removeChild(s);
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
        var p = el('section', 'd-pane d-list', '<header><b>' + o.title + '</b> · <span id="dClock">' + o.clock + '</span></header>' +
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

  var scenes = {
    /* One agent splits a job, two others take a part each, and their reports come back. */
    dispatch: async function (k) {
      await k.shell('rove');
      k.usage('Claude', 42); k.usage('Codex', 8);
      k.group('storefront');
      k.row({ id: 'a', title: 'EU checkout tax', status: 'idle' });
      k.row({ id: 'x', title: 'Flaky cart test', status: 'done' });
      k.select('a');
      k.pane({ id: 'a', label: 'claude' });
      await k.w(600);
      await k.type('a', 'Add EU tax to checkout. Hand the tax rules to Codex and the tests to Gemini.');
      k.status('a', 'work');
      await k.think('a', 900, 'Reading the checkout code…');
      k.line('a', 'Read <u>src/checkout.ts</u>, <u>src/cart.ts</u>', 'is-dim');
      await k.w(250);
      await k.say('a', "I'll keep the checkout change and hand out the other two parts.");
      await k.w(500);
      k.line('a', '<b>rove api add</b> --title tax-rules --command codex', 'is-tool');
      await k.w(260);
      k.row({ id: 'b', title: 'tax-rules', tag: 'codex', status: 'work', child: true, after: 'a' });
      await k.w(520);
      k.line('a', '<b>rove api add</b> --title tax-tests --command gemini', 'is-tool');
      await k.w(260);
      k.row({ id: 'c', title: 'tax-tests', tag: 'gemini', status: 'work', child: true, after: 'b' });
      await k.w(1300);
      k.line('a', '<b>Update</b>(src/checkout.ts)', 'is-tool');
      await k.burst('a', [
        ['-  return { total, currency }', 'is-del'],
        ['+  const tax = regionalTax(sub, region)', 'is-add'],
        ['+  return { subtotal: sub, tax, total: sub + tax, currency }', 'is-add'],
      ]);
      await k.think('a', 1500, 'Waiting for two reports…');
      k.status('b', 'done'); k.inbox(1);
      k.line('a', '<b>tax-rules</b> (codex) reported: VAT table for 27 countries, +48 −6', 'is-report');
      await k.think('a', 1100, 'Waiting for one report…');
      k.status('c', 'done'); k.inbox(2);
      k.line('a', '<b>tax-tests</b> (gemini) reported: 12 tests, all pass', 'is-report');
      await k.w(700);
      await k.say('a', 'Both parts are back and merged into this branch. 12 tests pass.');
      k.status('a', 'done');
      await k.w(2400);
    },

    /* The agent hits its usage limit; the task moves to another agent, which reads what was done. */
    swap: async function (k) {
      k.usage('Claude', 93); k.usage('Codex', 8);
      k.group('storefront');
      k.row({ id: 'a', title: 'Refund flow', status: 'work' });
      k.row({ id: 'x', title: 'Flaky cart test', status: 'done' });
      k.select('a');
      k.pane({ id: 'a', label: 'claude' });
      k.line('a', 'Add partial refunds: API route, ledger entry, email.', 'is-prompt');
      await k.w(500);
      k.line('a', '<b>Update</b>(src/refund/route.ts)', 'is-tool');
      await k.burst('a', [['+  if (amount > order.paid) throw new RefundTooLarge()', 'is-add']]);
      k.usage('Claude', 96);
      await k.w(400);
      await k.say('a', 'Route is done. Next: the ledger entry.');
      k.usage('Claude', 99);
      await k.think('a', 900);
      k.line('a', '<b>Update</b>(src/ledger.ts)', 'is-tool');
      await k.w(450);
      k.usage('Claude', 100, 'limit');
      k.line('a', 'Usage limit reached. Resets at 14:00.', 'is-warn');
      k.status('a', 'wait'); k.inbox(1);
      await k.w(1900);
      k.line('a', 'Switch agent → <b>Codex</b>', 'is-menu');
      await k.w(900);
      k.paneHead('a', { label: 'codex' });
      k.status('a', 'work'); k.inbox(0);
      await k.think('a', 1100, 'Reading the earlier conversation…');
      k.line('a', 'Read 38 messages: 2 of 3 steps are done', 'is-dim');
      await k.w(250);
      await k.say('a', 'Picking up at the ledger entry, on the same branch.');
      k.usage('Codex', 11);
      await k.w(350);
      k.line('a', '<b>Update</b>(src/ledger.ts)', 'is-tool');
      await k.burst('a', [['+  ledger.add({ kind: "refund", orderId, amount })', 'is-add']]);
      await k.think('a', 700);
      k.line('a', '<b>Update</b>(src/email/refund.ts)', 'is-tool');
      k.usage('Codex', 14);
      await k.w(500);
      await k.say('a', 'Ledger entry and email are in. All three steps are done.');
      k.status('a', 'done');
      await k.w(2400);
    },

    /* A task whose files and commands live on another computer, started from this one. */
    machines: async function (k) {
      k.usage('Claude', 42); k.usage('Codex', 8);
      k.group('storefront');
      k.row({ id: 'x', title: 'Refund flow', status: 'done' });
      k.row({ id: 'y', title: 'Flaky cart test', tag: 'mac-mini', status: 'work' });
      k.group('ml-pipeline');
      k.row({ id: 'z', title: 'Nightly eval', tag: 'gpu-box', status: 'work' });
      k.select('x');
      k.pane({ id: 'a', label: 'claude', where: 'new task' });
      await k.w(700);
      k.line('a', 'Run on: this Mac · mac-mini · <b>gpu-box</b>', 'is-menu');
      await k.w(900);
      await k.type('a', 'Train the ranking model on the new data and report the score.');
      k.row({ id: 'a', title: 'Ranking model', tag: 'gpu-box', status: 'work', flash: true, after: 'z' });
      k.select('a');
      k.paneHead('a', { label: 'claude', where: 'files and commands on gpu-box' });
      await k.think('a', 800, 'Connecting to gpu-box…');
      k.line('a', '<b>Bash</b>(python train.py --data data/2026-11)', 'is-tool');
      await k.w(500);
      k.line('a', 'epoch 1/3  loss 0.412', 'is-dim');
      await k.w(650);
      k.line('a', 'epoch 2/3  loss 0.287', 'is-dim');
      k.status('y', 'done'); k.inbox(1);
      await k.w(650);
      k.line('a', 'epoch 3/3  loss 0.231', 'is-dim');
      await k.think('a', 800, 'Scoring…');
      await k.say('a', 'Training ran on gpu-box. NDCG@10 went from 0.61 to 0.66.');
      k.status('a', 'done'); k.inbox(2);
      await k.w(2400);
    },

    /* A prompt on a schedule: the clock reaches it, Rove starts the task, and the result lands in the inbox. */
    routine: async function (k) {
      k.usage('Claude', 42); k.usage('Codex', 8);
      k.group('storefront');
      k.row({ id: 'x', title: 'Refund flow', status: 'done' });
      k.group('ml-pipeline');
      k.row({ id: 'z', title: 'Nightly eval', tag: 'gpu-box', status: 'done' });
      k.list({ title: 'Routines', clock: '08:59', rows: [
        { name: 'Dependency check', when: 'every day 09:00', on: 'claude', state: 'in 1 min' },
        { name: 'Nightly eval', when: 'every day 02:00', on: 'codex · gpu-box', state: 'ran 02:00' },
        { name: 'Weekly changelog', when: 'Mondays 10:00', on: 'gemini', state: 'in 3 days' },
      ] });
      await k.w(1600);
      k.clock('09:00');
      k.item(0, 'running', 'is-run');
      await k.w(500);
      k.row({ id: 'a', title: 'Dependency check', status: 'work', flash: true, after: 'x' });
      k.select('a');
      await k.w(600);
      k.pane({ id: 'a', label: 'claude', where: 'started by a routine' });
      k.line('a', 'Check for outdated dependencies and open a pull request for the safe ones.', 'is-prompt');
      await k.think('a', 900);
      k.line('a', '<b>Bash</b>(bun outdated)', 'is-tool');
      await k.burst('a', [
        ['zod        3.23.8 → 3.24.1', 'is-dim'],
        ['hono       4.6.3  → 4.6.12', 'is-dim'],
        ['vitest     2.1.2  → 2.1.8', 'is-dim'],
      ]);
      await k.think('a', 1100, 'Running the tests…');
      k.line('a', '<b>Bash</b>(bun test) 212 pass', 'is-tool');
      await k.w(400);
      await k.say('a', 'Opened pull request #412: bump 3 dependencies. All tests pass.');
      k.status('a', 'done'); k.inbox(1);
      k.item(0, 'ran 09:00', 'is-ok');
      await k.w(2400);
    },

    /* One task, two panes: one agent writes the change, another reviews it. */
    split: async function (k) {
      k.usage('Claude', 42); k.usage('Codex', 8);
      k.group('storefront');
      k.row({ id: 'a', title: 'Coupon limits', status: 'work' });
      k.row({ id: 'x', title: 'Flaky cart test', status: 'done' });
      k.select('a');
      k.pane({ id: 'a', label: 'claude' });
      k.line('a', 'A coupon above 100% makes the total negative. Clamp it.', 'is-prompt');
      await k.think('a', 700);
      k.line('a', '<b>Update</b>(src/cart.ts)', 'is-tool');
      await k.burst('a', [
        ['-  return total - total * (percent / 100)', 'is-del'],
        ['+  const p = Math.min(100, Math.max(0, percent))', 'is-add'],
        ['+  return total - total * (p / 100)', 'is-add'],
      ]);
      await k.w(300);
      await k.say('a', 'Clamped to 0..100. Not tested yet.');
      await k.w(700);
      k.pane({ id: 'b', label: 'codex' });
      await k.w(600);
      await k.type('b', 'Review the uncommitted change. Bugs only.');
      await k.think('b', 600);
      k.line('b', '<b>Ran</b> git diff HEAD -- src/cart.ts', 'is-tool');
      await k.think('b', 900, 'Reviewing…');
      await k.say('b', 'A NaN percent still returns NaN: Math.max(0, NaN) is NaN.');
      await k.w(500);
      await k.say('b', 'Totals are not rounded to cents after the discount.');
      await k.think('a', 1000);
      k.line('a', '<b>Update</b>(src/cart.ts)', 'is-tool');
      await k.burst('a', [['+  if (Number.isNaN(percent)) return total', 'is-add']]);
      await k.w(300);
      await k.say('a', 'Fixed the NaN case Codex found.');
      k.status('a', 'done');
      await k.w(2400);
    },
  };

  var order = ['dispatch', 'swap', 'machines', 'routine', 'split'];
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
