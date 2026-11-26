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
      isDry: dry,
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
        // `is-<engine>` picks that engine's own TUI look: its prompt, bullets, spinner and footer.
        var p = el('section', 'd-pane is-' + o.label,
          '<header>' + head(o) + '</header><div class="d-lines"></div><div class="d-input"><i></i></div><div class="d-foot"></div>');
        p.id = 'dPane-' + o.id;
        document.getElementById('dMain').appendChild(p);
      },
      /* The Browser panel of the web and desktop clients, showing the page a task's dev server serves. */
      web: function (url) {
        if (dry) return;
        var p = el('section', 'd-pane d-web', '<header><b>Browser</b> · ' + url + '</header><div class="d-page" id="dPage"></div>');
        document.getElementById('dMain').appendChild(p);
      },
      page: function (html, cls) {
        if (dry) return;
        var pg = document.getElementById('dPage');
        pg.appendChild(el('div', 'd-pg ' + (cls || ''), html));
        pg.scrollTop = pg.scrollHeight;
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
    /* One agent splits a feature into a backend and a frontend part, two others build them,
       and the two children run side by side before the reports come back. */
    dispatch: async function (k) {
      await k.shell('rove');
      k.usage('Claude', 42); k.usage('Codex', 8);
      k.group('storefront');
      k.row({ id: 'a', title: 'Wishlist', status: 'idle' });
      k.row({ id: 'x', title: 'Flaky cart test', status: 'done' });
      k.select('a');
      k.pane({ id: 'a', label: 'claude' });
      await k.w(600);
      await k.type('a', 'Add a wishlist: save items from the product page, list them at /wishlist. Split the work.');
      k.status('a', 'work');
      await k.think('a', 900, 'Reading the codebase…');
      k.line('a', '<b>Read</b>(src/api/routes.ts)', 'is-tool');
      k.line('a', 'Read 142 lines', 'is-out');
      await k.w(300);
      k.line('a', '<b>Read</b>(web/pages/product.tsx)', 'is-tool');
      k.line('a', 'Read 88 lines', 'is-out');
      await k.w(300);
      await k.say('a', "The API and the page don't share files. I'll hand out both and wire them together.");
      await k.w(400);
      k.line('a', '<b>rove api add</b> --title wishlist-api --command claude', 'is-tool');
      await k.w(260);
      k.row({ id: 'b', title: 'wishlist-api', tag: 'claude', status: 'work', child: true, after: 'a' });
      await k.w(450);
      k.line('a', '<b>rove api add</b> --title wishlist-ui --command codex', 'is-tool');
      await k.w(260);
      k.row({ id: 'c', title: 'wishlist-ui', tag: 'codex', status: 'work', child: true, after: 'b' });
      await k.think('a', 1100, 'Waiting for two reports…');

      // Both children on screen at once, each in its own agent's terminal, lines landing in turn.
      k.pane({ id: 'b', label: 'claude', where: 'wishlist-api' });
      k.pane({ id: 'c', label: 'codex', where: 'wishlist-ui' });
      k.show(['b', 'c']);
      k.line('b', 'Add GET, POST and DELETE /api/wishlist on a new wishlist table.', 'is-prompt');
      k.line('c', 'Build the /wishlist page and a save button on the product page.', 'is-prompt');
      var sb = k.spin('b'), sc = k.spin('c');
      await k.w(900);
      sb(); k.line('b', '<b>Bash</b>(bun run db:generate wishlist)', 'is-tool');
      k.line('b', 'created migrations/0014_wishlist.sql', 'is-out');
      sb = k.spin('b');
      await k.w(450);
      sc(); k.line('c', '<b>Edited</b> web/pages/wishlist.tsx (+38 -0)', 'is-tool');
      k.line('c', '+  const { data: items } = useQuery(["wishlist"], fetchWishlist)', 'is-add');
      await k.w(300);
      k.line('c', '+  return &lt;ProductGrid items={items} /&gt;', 'is-add');
      sc = k.spin('c');
      await k.w(450);
      sb(); k.line('b', '<b>Write</b>(src/api/wishlist.ts)', 'is-tool');
      k.line('b', "+  app.get('/api/wishlist', auth, list)", 'is-add');
      await k.w(250);
      k.line('b', "+  app.post('/api/wishlist', auth, add)", 'is-add');
      await k.w(250);
      sc(); k.line('c', '<b>Edited</b> web/pages/product.tsx (+4 -1)', 'is-tool');
      k.line('c', '+  &lt;SaveButton productId={product.id} /&gt;', 'is-add');
      sc = k.spin('c');
      k.line('b', "+  app.delete('/api/wishlist/:id', auth, remove)", 'is-add');
      sb = k.spin('b');
      await k.w(800);
      sc(); k.line('c', '<b>Ran</b> bun run typecheck', 'is-tool');
      k.line('c', 'no errors', 'is-out');
      await k.w(350);
      sb(); k.line('b', '<b>Bash</b>(bun test src/api/wishlist)', 'is-tool');
      k.line('b', '9 pass, 0 fail', 'is-out');
      await k.w(350);
      await k.say('c', 'The page and the save button are in.');
      k.status('c', 'done'); k.inbox(1);
      await k.say('b', 'Three routes are in and tested.');
      k.status('b', 'done'); k.inbox(2);
      await k.w(1100);

      k.show(['a']);
      k.line('a', '<b>wishlist-api</b> (claude) reported: 3 routes, 9 tests, +84 −0', 'is-report');
      await k.w(450);
      k.line('a', '<b>wishlist-ui</b> (codex) reported: page and save button, +42 −1', 'is-report');
      await k.think('a', 900, 'Wiring the page to the API…');
      k.line('a', '<b>Update</b>(web/lib/api.ts)', 'is-tool');
      await k.burst('a', [["+  export const fetchWishlist = () => get('/api/wishlist')", 'is-add']]);
      await k.w(300);
      k.line('a', '<b>Bash</b>(bun test)', 'is-tool');
      k.line('a', '231 pass, 0 fail', 'is-out');
      await k.w(300);
      await k.say('a', 'Both parts are merged into this branch and the page loads saved items.');
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
      await k.think('a', 1100, 'Reading previous transcript…');
      k.line('a', 'Read 38 messages: route done, ledger interrupted', 'is-dim');
      await k.w(250);
      await k.say('a', 'Picking up at the ledger entry on the same branch.');
      k.usage('Codex', 11);
      await k.w(350);
      k.line('a', '<b>Update</b>(src/ledger.ts)', 'is-tool');
      await k.burst('a', [['+  ledger.add({ kind: "refund", orderId, amount })', 'is-add']]);
      await k.think('a', 700);
      k.line('a', '<b>Update</b>(src/email/refund.ts)', 'is-tool');
      k.usage('Codex', 14);
      await k.w(500);
      await k.say('a', 'Ledger entry and email are in. Partial refunds complete.');
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
      k.paneHead('a', { label: 'claude', where: 'ssh · gpu-box' });
      await k.think('a', 800, 'Connecting to gpu-box…');
      k.line('a', '<b>Bash</b>(python train.py --data data/2026-11)', 'is-tool');
      await k.w(500);
      k.line('a', 'epoch 1/3  loss 0.412', 'is-out');
      await k.w(650);
      k.line('a', 'epoch 2/3  loss 0.287', 'is-out');
      k.status('y', 'done'); k.inbox(1);
      await k.w(650);
      k.line('a', 'epoch 3/3  loss 0.231', 'is-out');
      await k.think('a', 800, 'Scoring…');
      await k.say('a', 'Done on gpu-box. NDCG@10 improved from 0.61 to 0.66.');
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
      k.pane({ id: 'a', label: 'claude', where: 'routine · 09:00' });
      k.line('a', 'Check for outdated dependencies and open a pull request for the safe ones.', 'is-prompt');
      await k.think('a', 900);
      k.line('a', '<b>Bash</b>(bun outdated)', 'is-tool');
      await k.burst('a', [
        ['zod        3.23.8 → 3.24.1', 'is-out'],
        ['hono       4.6.3  → 4.6.12', 'is-out'],
        ['vitest     2.1.2  → 2.1.8', 'is-out'],
      ]);
      await k.think('a', 1100, 'Running the tests…');
      k.line('a', '<b>Bash</b>(bun test)', 'is-tool');
      k.line('a', '212 pass, 0 fail', 'is-out');
      await k.w(400);
      await k.say('a', 'Opened PR #412 (bump 3 dependencies). 212 tests pass.');
      k.status('a', 'done'); k.inbox(1);
      k.item(0, 'ran 09:00', 'is-ok');
      await k.w(2400);
    },

    /* An agent builds a page while the Browser panel beside it shows the page growing. */
    preview: async function (k) {
      k.usage('Claude', 42); k.usage('Codex', 8);
      k.group('storefront');
      k.row({ id: 'a', title: 'Summer sale page', status: 'idle' });
      k.row({ id: 'x', title: 'Wishlist', status: 'done' });
      k.select('a');
      k.pane({ id: 'a', label: 'claude' });
      await k.w(500);
      await k.type('a', 'Build a page for the summer sale: a headline, three products, an email signup.');
      k.status('a', 'work');
      await k.think('a', 700);
      k.line('a', '<b>Bash</b>(bun run dev)', 'is-tool');
      k.line('a', 'ready on http://localhost:5173', 'is-out');
      await k.w(500);
      k.web('localhost:5173/sale');
      await k.w(900);
      k.line('a', '<b>Write</b>(web/sale.html)', 'is-tool');
      await k.burst('a', [
        ['+  &lt;h1&gt;Summer sale&lt;/h1&gt;', 'is-add'],
        ['+  &lt;p&gt;Up to 40% off until Sunday.&lt;/p&gt;', 'is-add'],
      ]);
      k.page('<h4>Summer sale</h4><p>Up to 40% off until Sunday.</p>', 'is-hero');
      await k.think('a', 900);
      k.line('a', '<b>Update</b>(web/sale.html)', 'is-tool');
      k.page('', 'is-cards');
      var items = [['Linen shirt', '$39'], ['Canvas tote', '$24'], ['Sun hat', '$19']];
      for (var i = 0; i < items.length; i++) {
        k.line('a', '+  &lt;Product name="' + items[i][0] + '" price="' + items[i][1] + '" /&gt;', 'is-add');
        if (!k.isDry) document.querySelector('#dPage .is-cards').appendChild(
          el('div', 'd-card', '<i></i><b>' + items[i][0] + '</b><span>' + items[i][1] + '</span>'));
        await k.w(550);
      }
      await k.think('a', 700);
      k.line('a', '<b>Update</b>(web/sale.html)', 'is-tool');
      await k.burst('a', [['+  &lt;form&gt;&lt;input type="email"&gt;&lt;button&gt;Notify me&lt;/button&gt;&lt;/form&gt;', 'is-add']]);
      k.page('<i>you@example.com</i><b>Notify me</b>', 'is-form');
      await k.think('a', 900, 'Styling…');
      k.line('a', '<b>Write</b>(web/sale.css)', 'is-tool');
      k.line('a', 'Wrote 48 lines', 'is-out');
      k.pageStyle();
      await k.w(900);
      await k.say('a', 'The page is up at localhost:5173/sale.');
      k.status('a', 'done'); k.inbox(1);
      await k.w(2600);
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
      k.line('b', '1 file changed, 2 insertions(+), 1 deletion(-)', 'is-out');
      await k.think('b', 900, 'Reviewing…');
      await k.say('b', 'NaN slips through: Math.max(0, NaN) is NaN.');
      await k.w(500);
      await k.say('b', "Discounted total isn't rounded to whole cents.");
      await k.think('a', 1000);
      k.line('a', '<b>Update</b>(src/cart.ts)', 'is-tool');
      await k.burst('a', [
        ['+  if (!Number.isFinite(percent)) return total', 'is-add'],
        ['+  return Math.round(total - total * (p / 100))', 'is-add'],
      ]);
      await k.w(300);
      await k.say('a', 'Fixed non-finite input and rounded to cents.');
      k.status('a', 'done');
      await k.w(2400);
    },
  };

  var order = ['dispatch', 'preview', 'swap', 'machines', 'routine', 'split'];
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
    // The Browser panel belongs to the desktop and web clients, so that scene's window says so.
    var bar = document.querySelector('.appwin-bar span');
    if (bar) bar.textContent = name === 'preview' ? 'Rove (desktop app)' : 'rove — ~/storefront';
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
