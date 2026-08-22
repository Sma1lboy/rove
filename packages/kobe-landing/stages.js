// Animated stage visuals for the three narrative primitives. Loaded after
// index.js, which owns KOBE_I18N — every string here comes from that dictionary.

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

// stage-3 peer wire: a packet crosses, then the message it carried lands in
// the thread. Alternating direction is the whole point — there is no
// coordinator, just two agents with one verb between them.
(function () {
  var root = document.getElementById('peers');
  var dot = document.getElementById('pxDot');
  var log = document.getElementById('pxLog');
  var a = document.getElementById('pxA');
  var b = document.getElementById('pxB');
  var replay = document.getElementById('pxReplay');
  if (!root || !dot || !log || !a || !b) return;

  // up = worker reporting home, down = orchestrator answering back
  var THREAD = [
    { dir: 'up', key: 'px.m1' },
    { dir: 'down', key: 'px.m2' },
    { dir: 'up', key: 'px.m3' },
  ];
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var timers = [];

  function label(step) {
    return step.dir === 'up'
      ? KOBE_I18N.t('px.b1') + ' ' + KOBE_I18N.t('px.to') + ' ' + KOBE_I18N.t('px.you')
      : KOBE_I18N.t('px.you') + ' ' + KOBE_I18N.t('px.to') + ' ' + KOBE_I18N.t('px.b1');
  }
  function row(step) {
    var p = document.createElement('p');
    p.className = 'px-line ' + step.dir;
    p.innerHTML = '<span class="dir"></span><span class="msg"></span>';
    p.querySelector('.dir').textContent = label(step);
    p.querySelector('.msg').textContent = KOBE_I18N.t(step.key);
    return p;
  }

  function play() {
    timers.forEach(clearTimeout);
    timers = [];
    log.innerHTML = '';
    root.classList.remove('live');
    a.classList.remove('hot');
    b.classList.remove('hot');

    if (still) {
      THREAD.forEach(function (step) {
        var p = row(step); p.classList.add('in'); log.appendChild(p);
      });
      return;
    }
    THREAD.forEach(function (step, i) {
      var at = 500 + i * 1500;
      timers.push(setTimeout(function () {
        root.classList.add('live');
        // the sender lights first, the wire carries, then the receiver lights
        (step.dir === 'up' ? b : a).classList.add('hot');
        dot.className = 'px-dot';
        void dot.offsetWidth;
        dot.className = 'px-dot ' + (step.dir === 'up' ? 'rev' : 'fwd');
      }, at));
      timers.push(setTimeout(function () {
        (step.dir === 'up' ? b : a).classList.remove('hot');
        (step.dir === 'up' ? a : b).classList.add('hot');
        var p = row(step);
        log.appendChild(p);
        void p.offsetWidth;
        p.classList.add('in');
      }, at + 780));
      timers.push(setTimeout(function () {
        a.classList.remove('hot'); b.classList.remove('hot');
        if (i === THREAD.length - 1) root.classList.remove('live');
      }, at + 1300));
    });
  }

  if (replay) replay.addEventListener('click', play);
  var langBtn = document.getElementById('langToggle');
  if (langBtn) langBtn.addEventListener('click', function () { setTimeout(play, 0); });

  if (still || !window.IntersectionObserver) { play(); return; }
  var started = false;
  function start() { if (started) return; started = true; io.disconnect(); play(); }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) start(); });
  }, { threshold: 0.2 });
  io.observe(root);
  setTimeout(start, 9000);
})();

// stage-2 detach/reattach: you type exit, the frame dims, and the elapsed
// clocks keep climbing — fast, because that is the only way to show 40 minutes
// of unattended work in four seconds. Then you ssh back and it lights up.
(function () {
  var root = document.getElementById('sshbox');
  var cmdEl = document.getElementById('shCmd');
  var outEl = document.getElementById('shOut');
  var rowsEl = document.getElementById('shRows');
  var noteEl = document.getElementById('shNote');
  var stateEl = document.getElementById('shState');
  var replay = document.getElementById('shReplay');
  if (!root || !cmdEl || !rowsEl || !noteEl || !stateEl) return;

  var TASKS = ['simplify-auth-a', 'flaky-e2e', 'oauth-refresh'];
  var FRAMES = '\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f';
  var START = 12, END = 41;
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var timers = [], typer = null, clock = null, spin = null, mins = START;

  function stop() {
    timers.forEach(clearTimeout); timers = [];
    [typer, clock, spin].forEach(function (t) { if (t) clearInterval(t); });
    typer = clock = spin = null;
  }
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function paintClock() {
    var els = rowsEl.querySelectorAll('.el');
    for (var i = 0; i < els.length; i++) els[i].textContent = mins + 'm';
  }
  function paintRows() {
    rowsEl.innerHTML = TASKS.map(function (t) {
      return '<p class="sh-row"><span class="sp">\u280b</span>' +
        '<span class="nm">' + t + '</span><span class="el">' + mins + 'm</span></p>';
    }).join('');
  }
  function type(text, done) {
    cmdEl.textContent = '';
    var n = 0;
    typer = setInterval(function () {
      cmdEl.textContent = text.slice(0, ++n);
      if (n >= text.length) { clearInterval(typer); typer = null; if (done) done(); }
    }, 55);
  }

  function play() {
    stop();
    mins = START;
    root.classList.remove('gone');
    stateEl.textContent = KOBE_I18N.t('sh.attached');
    cmdEl.textContent = '';
    outEl.textContent = '';
    paintRows();
    noteEl.innerHTML = KOBE_I18N.t('sh.noteLive');

    if (still) {
      mins = END; paintClock();
      cmdEl.textContent = KOBE_I18N.t('sh.back');
      outEl.textContent = KOBE_I18N.t('sh.closed');
      noteEl.innerHTML = KOBE_I18N.t('sh.noteBack');
      return;
    }
    var f = 0;
    spin = setInterval(function () {
      f = (f + 1) % FRAMES.length;
      var sps = rowsEl.querySelectorAll('.sp');
      for (var i = 0; i < sps.length; i++) sps[i].textContent = FRAMES[f];
    }, 90);

    at(700, function () {
      type(KOBE_I18N.t('sh.exit'), function () {
        at(450, function () {
          outEl.textContent = KOBE_I18N.t('sh.closed');
          root.classList.add('gone');
          stateEl.textContent = KOBE_I18N.t('sh.gone');
          noteEl.innerHTML = KOBE_I18N.t('sh.noteGone');
          // 29 unattended minutes, compressed into three seconds
          clock = setInterval(function () {
            if (mins >= END) { clearInterval(clock); clock = null; return; }
            mins++; paintClock();
          }, 3000 / (END - START));
          at(3600, function () {
            type(KOBE_I18N.t('sh.back'), function () {
              at(500, function () {
                root.classList.remove('gone');
                stateEl.textContent = KOBE_I18N.t('sh.attached');
                outEl.textContent = '';
                noteEl.innerHTML = KOBE_I18N.t('sh.noteBack');
              });
            });
          });
        });
      });
    });
  }

  if (replay) replay.addEventListener('click', play);
  var langBtn = document.getElementById('langToggle');
  if (langBtn) langBtn.addEventListener('click', function () { setTimeout(play, 0); });

  paintRows();
  noteEl.innerHTML = KOBE_I18N.t('sh.noteLive');
  stateEl.textContent = KOBE_I18N.t('sh.attached');
  if (still || !window.IntersectionObserver) { play(); return; }
  var started = false;
  function start() { if (started) return; started = true; io.disconnect(); play(); }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) start(); });
  }, { threshold: 0.2 });
  io.observe(root);
  setTimeout(start, 8000);
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
