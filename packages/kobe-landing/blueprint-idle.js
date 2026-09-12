/* blueprint-idle.js — shared behaviour for every sheet in the set.
 *
 * Two halves:
 *   1. CONSTRUCTION — figures draw themselves in when scrolled to, the install
 *      line copies on click and a revision cloud scallops around what changed.
 *      (Same contract on all four sheets.)
 *   2. IDLE — the sheet is not finished. Stop touching it and a pen travels to
 *      something in view, takes a dimension off it, holds the reading, then
 *      lifts. Zone markers track what is on screen, centre lines march in the
 *      figure you are looking at, and the newest revision keeps announcing
 *      itself. Any interaction puts the pen down instantly.
 *
 * Markup contract:
 *   .fig                       a figure that constructs itself
 *   [data-draw]                a stroke inside it, drawn in order
 *   .fade                      an annotation that arrives after the strokes
 *   [data-cmd]                 copy-on-click; [data-hint] inside it is the label
 *   #installWrap + #cloudPath  the revision cloud around the primary command
 *   [data-measure="READING"]   the pen may take a dimension off this element
 *     [data-measure-axis="x|y"]  which way to measure (default x)
 *   .reread > .r               alternative true readings of one value, cycled
 *   .tri.newest                the revision triangle that breathes
 *   [data-elapsed]             filled with how long the sheet has been open
 */
(function () {
  'use strict';

  /* Everything below reads the DOM on the way in, so it must not run before the
     body exists. The pages load this deferred, but a deferred tag stops being
     deferred the moment someone inlines the file — which is exactly how the whole
     sheet went still once. Wait for the document either way. */
  function boot() {

  var reduceQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduce = reduceQ.matches;
  var root = document.documentElement;

  /* ══ 1. CONSTRUCTION ══════════════════════════════════════════════════ */

  var figs = [].slice.call(document.querySelectorAll('.fig'));

  function primeFigures() {
    figs.forEach(function (fig) {
      var strokes = fig.querySelectorAll('[data-draw]');
      strokes.forEach(function (el, i) {
        var len = 0;
        try { len = el.getTotalLength(); } catch (e) { len = 0; }
        if (!len) return;
        el.style.strokeDasharray = len;
        el.style.strokeDashoffset = len;
        el.style.transitionDelay = (i * 0.045) + 's';
      });
      var after = strokes.length * 0.045 + 0.28;
      fig.querySelectorAll('.fade').forEach(function (el, i) {
        el.style.transitionDelay = (after + i * 0.009) + 's';
      });
    });
  }

  function drawFigure(fig) {
    fig.classList.add('drawn');
    fig.querySelectorAll('[data-draw]').forEach(function (el) {
      el.style.strokeDashoffset = '0';
    });
  }

  if (!reduce && 'IntersectionObserver' in window) {
    primeFigures();
    var drawIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        drawFigure(e.target);
        drawIO.unobserve(e.target);
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    figs.forEach(function (f) { drawIO.observe(f); });

    /* The threshold above is tuned for a figure scrolling up into frame. A figure
       already on screen when the sheet opens never crosses it from a standing
       start, so the first one sat there as an unfinished outline until you
       happened to scroll. Draw those at boot, one frame later so the primed
       state paints first and the stroke still travels. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        figs.forEach(function (f) {
          var r = f.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) {
            drawFigure(f);
            drawIO.unobserve(f);
          }
        });
      });
    });

    /* a figure on screen keeps its centre lines marching */
    var liveIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        e.target.classList.toggle('in-view', e.isIntersecting);
      });
    }, { threshold: 0.25 });
    figs.forEach(function (f) { liveIO.observe(f); });
  } else {
    figs.forEach(drawFigure);
  }

  /* ── copy on click ─────────────────────────────────────────────────── */

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function write(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text) ? Promise.resolve() : Promise.reject();
      });
    }
    return legacyCopy(text) ? Promise.resolve() : Promise.reject();
  }

  /* The revision cloud belongs to whichever copy button lives inside the install
     wrapper — gated on containment, not on a fixed id, because a page may have to
     keep an id a shared script already binds to (index.js binds #copyBtn with no
     null guard, so that id cannot be renamed). */
  var wrap = document.getElementById('installWrap');
  var cloudPath = wrap ? wrap.querySelector('#cloudPath') : null;
  var cloudSvg = wrap ? wrap.querySelector('.rev-cloud') : null;
  var cloudLen = 0;

  function buildCloud() {
    if (!cloudPath || !cloudSvg) return;
    var box = cloudSvg.getBoundingClientRect();
    var w = Math.round(box.width), h = Math.round(box.height);
    if (!w || !h) return;
    var r = 9, target = 17, d = ['M' + r + ' ' + r];
    function run(len, ax, ay) {
      var n = Math.max(1, Math.round(Math.abs(len) / target));
      var step = len / n;
      for (var i = 0; i < n; i++) {
        d.push('a' + r + ' ' + r + ' 0 0 1 ' +
          (ax ? step.toFixed(2) : 0) + ' ' + (ay ? step.toFixed(2) : 0));
      }
    }
    run(w - 2 * r, 1, 0); run(h - 2 * r, 0, 1);
    run(-(w - 2 * r), 1, 0); run(-(h - 2 * r), 0, 1);
    d.push('Z');
    cloudSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    cloudPath.setAttribute('d', d.join(' '));
    try { cloudLen = cloudPath.getTotalLength(); } catch (e) { cloudLen = 0; }
    if (cloudLen && !reduce) {
      cloudPath.style.transition = 'none';
      cloudPath.style.strokeDasharray = cloudLen;
      cloudPath.style.strokeDashoffset = wrap.classList.contains('is-copied') ? 0 : cloudLen;
      void cloudPath.getBoundingClientRect();
      cloudPath.style.transition = 'stroke-dashoffset .7s cubic-bezier(.22,.61,.36,1)';
    }
  }
  buildCloud();

  var copyTimers = new WeakMap();
  document.querySelectorAll('[data-cmd]').forEach(function (btn) {
    var hint = btn.querySelector('[data-hint]');
    var original = hint ? hint.textContent : null;
    btn.addEventListener('click', function () {
      write(btn.getAttribute('data-cmd')).then(function () {
        btn.classList.add('is-copied');
        if (hint) hint.textContent = 'Copied';
        if (wrap && wrap.contains(btn)) {
          wrap.classList.add('is-copied');
          if (cloudPath && cloudLen && !reduce) cloudPath.style.strokeDashoffset = '0';
        }
        clearTimeout(copyTimers.get(btn));
        copyTimers.set(btn, setTimeout(function () {
          btn.classList.remove('is-copied');
          if (hint && original) hint.textContent = original;
          if (wrap && wrap.contains(btn)) {
            wrap.classList.remove('is-copied');
            if (cloudPath && cloudLen && !reduce) cloudPath.style.strokeDashoffset = cloudLen;
          }
        }, 2200));
      }).catch(function () {
        if (!hint) return;
        hint.textContent = 'Copy manually';
        clearTimeout(copyTimers.get(btn));
        copyTimers.set(btn, setTimeout(function () { hint.textContent = original; }, 2200));
      });
    });
  });

  /* ══ 2. IDLE ══════════════════════════════════════════════════════════ */

  if (reduce) { markNewestRevision(); fillElapsed(true); return; }
  root.classList.add('bp-idle-ok');

  /* ── zone markers track the viewport ───────────────────────────────── */

  var sideZones = [].slice.call(document.querySelectorAll('.zone-side span'));
  var topZones = [].slice.call(document.querySelectorAll('.zone-top span'));
  var zoneSections = [].slice.call(document.querySelectorAll('section[data-zone]'));

  function trackZones() {
    if (!zoneSections.length) return;
    var mid = window.innerHeight * 0.42, active = null;
    zoneSections.forEach(function (s) {
      var r = s.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) active = s.getAttribute('data-zone');
    });
    sideZones.forEach(function (z) {
      z.classList.toggle('lit', !!active && z.textContent.trim() === active);
    });
    if (topZones.length) {
      var frac = Math.min(1, Math.max(0, window.scrollY /
        Math.max(1, document.body.scrollHeight - window.innerHeight)));
      var idx = Math.min(topZones.length - 1, Math.round(frac * (topZones.length - 1)));
      topZones.forEach(function (z, i) { z.classList.toggle('lit', i === idx); });
    }
  }

  /* ── alternative readings of one dimension ─────────────────────────── */

  document.querySelectorAll('.reread').forEach(function (host) {
    var items = [].slice.call(host.querySelectorAll('.r'));
    if (items.length < 2) return;
    /* reserve the widest reading so the line never reflows */
    var widest = 0;
    items.forEach(function (el) {
      el.hidden = false;
      widest = Math.max(widest, el.getBoundingClientRect().width);
    });
    host.style.setProperty('--w', Math.ceil(widest) + 'px');
    items.forEach(function (el, i) { el.hidden = i !== 0; });
    var at = 0;
    setInterval(function () {
      if (document.hidden) return;
      var r = host.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      items[at].hidden = true;
      at = (at + 1) % items.length;
      items[at].hidden = false;
    }, 3400);
  });

  /* ── the newest revision breathes ──────────────────────────────────── */

  function markNewestRevision() {
    var tris = document.querySelectorAll('.tri');
    if (tris.length) tris[tris.length - 1].classList.add('newest');
  }
  markNewestRevision();

  /* ── how long the sheet has been open ──────────────────────────────── */

  function fillElapsed(staticOnly) {
    var fields = document.querySelectorAll('[data-elapsed]');
    if (!fields.length) return;
    var t0 = Date.now();
    function paint() {
      var s = Math.floor((Date.now() - t0) / 1000);
      var txt = String(Math.floor(s / 60)).padStart(2, '0') + ':' +
                String(s % 60).padStart(2, '0');
      fields.forEach(function (f) { f.textContent = txt; });
    }
    paint();
    if (!staticOnly) setInterval(paint, 1000);
  }
  fillElapsed(false);

  /* ── the pen ───────────────────────────────────────────────────────── */

  var IDLE_MS = 5000;     // how long you must leave it alone
  var HOLD_MS = 2900;     // how long a reading stays up
  var GAP_MS = 2600;      // pause between two measurements

  var pen = document.createElement('div');
  pen.className = 'pen';
  pen.setAttribute('aria-hidden', 'true');
  pen.innerHTML =
    '<svg viewBox="0 0 34 34" width="34" height="34">' +
      '<g class="nibwrap">' +
        '<circle class="nib" cx="17" cy="17" r="5.2"/>' +
        '<circle class="nib" cx="17" cy="17" r="1.3"/>' +
      '</g>' +
      '<path class="hair" d="M17 0v9M17 25v9M0 17h9M25 17h9"/>' +
    '</svg>';

  var gauge = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gauge.setAttribute('class', 'measure');
  gauge.setAttribute('aria-hidden', 'true');
  gauge.setAttribute('width', '100%');
  gauge.setAttribute('height', '100%');
  gauge.style.cssText = 'width:100vw;height:100vh';

  document.body.appendChild(gauge);
  document.body.appendChild(pen);

  var idleTimer = null, seq = [], lastKey = null, running = false;

  function candidates() {
    var out = [];
    document.querySelectorAll('[data-measure]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      var visible = r.top < window.innerHeight - 60 && r.bottom > 60 &&
                    r.width > 90 && r.height > 24;
      if (visible) out.push({ el: el, rect: r });
    });
    return out;
  }

  function clearGauge() {
    while (gauge.firstChild) gauge.removeChild(gauge.firstChild);
    gauge.classList.remove('on', 'off');
  }

  function svgEl(name, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* an architect's tick: a short 45° slash, not an arrowhead — correct for a
     dimension this small, and it stays crisp at one hairline. */
  function tick(x, y, vertical) {
    return svgEl('line', vertical
      ? { x1: x - 3.5, y1: y + 3.5, x2: x + 3.5, y2: y - 3.5 }
      : { x1: x - 3.5, y1: y + 3.5, x2: x + 3.5, y2: y - 3.5 });
  }

  function measure(target) {
    var r = target.rect;
    var axis = target.el.getAttribute('data-measure-axis') || 'x';
    var reading = target.el.getAttribute('data-measure') || '';
    clearGauge();

    var g = svgEl('g', {});
    var lead, tx, ty, anchor = 'middle';

    if (axis === 'y') {
      var x = Math.min(window.innerWidth - 16, r.right + 22);
      var y1 = r.top + 4, y2 = r.bottom - 4;
      g.appendChild(svgEl('line', { x1: r.right + 4, y1: y1, x2: x + 6, y2: y1, class: 'ext' }));
      g.appendChild(svgEl('line', { x1: r.right + 4, y1: y2, x2: x + 6, y2: y2, class: 'ext' }));
      lead = svgEl('line', { x1: x, y1: y1, x2: x, y2: y2, class: 'lead' });
      g.appendChild(lead);
      g.appendChild(tick(x, y1, true));
      g.appendChild(tick(x, y2, true));
      tx = x + 9; ty = (y1 + y2) / 2; anchor = 'start';
    } else {
      var y = Math.min(window.innerHeight - 18, r.bottom + 20);
      var x1 = r.left + 2, x2 = r.right - 2;
      g.appendChild(svgEl('line', { x1: x1, y1: r.bottom + 3, x2: x1, y2: y + 6, class: 'ext' }));
      g.appendChild(svgEl('line', { x1: x2, y1: r.bottom + 3, x2: x2, y2: y + 6, class: 'ext' }));
      lead = svgEl('line', { x1: x1, y1: y, x2: x2, y2: y, class: 'lead' });
      g.appendChild(lead);
      g.appendChild(tick(x1, y));
      g.appendChild(tick(x2, y));
      tx = (x1 + x2) / 2; ty = y - 6;
    }

    var label = svgEl('text', { x: tx, y: ty, class: 'val', 'text-anchor': anchor });
    label.textContent = reading;
    g.appendChild(label);
    gauge.appendChild(g);

    var len = axis === 'y' ? Math.abs(r.height - 8) : Math.abs(r.width - 4);
    lead.style.setProperty('--len', len);

    /* fly the pen to where the line starts, dip the nib, then draw */
    var px = axis === 'y' ? Math.min(window.innerWidth - 16, r.right + 22) : r.left + 2;
    var py = axis === 'y' ? r.top + 4 : Math.min(window.innerHeight - 18, r.bottom + 20);
    pen.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
    pen.classList.add('down');

    setTimeout(function () {
      if (!running) return;
      pen.classList.add('inking');
      gauge.classList.add('on');
      /* the pen rides the line it is drawing */
      var ex = axis === 'y' ? px : r.right - 2;
      var ey = axis === 'y' ? r.bottom - 4 : py;
      pen.style.transition = 'transform .52s cubic-bezier(.22,.61,.36,1),opacity .3s ease';
      pen.style.transform = 'translate3d(' + ex + 'px,' + ey + 'px,0)';
    }, 1060);

    setTimeout(function () {
      if (!running) return;
      lift();
      setTimeout(function () { if (running) next(); }, GAP_MS);
    }, 1060 + HOLD_MS);
  }

  function lift() {
    pen.classList.remove('down', 'inking');
    pen.style.transition = '';
    gauge.classList.remove('on');
    gauge.classList.add('off');
    setTimeout(clearGauge, 380);
  }

  function next() {
    if (!running) return;
    var pool = candidates();
    if (!pool.length) { running = false; return; }
    if (pool.length > 1 && lastKey !== null) {
      pool = pool.filter(function (c) { return c.el.getAttribute('data-measure') !== lastKey; });
      if (!pool.length) pool = candidates();
    }
    var pick = pool[Math.floor(Math.random() * pool.length)];
    lastKey = pick.el.getAttribute('data-measure');
    measure(pick);
  }

  function startIdle() {
    if (running) return;
    running = true;
    next();
  }

  function stopIdle() {
    if (!running) { return; }
    running = false;
    lift();
  }

  function poke() {
    stopIdle();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(startIdle, IDLE_MS);
  }

  ['scroll', 'pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']
    .forEach(function (ev) {
      window.addEventListener(ev, poke, { passive: true });
    });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopIdle(); clearTimeout(idleTimer); }
    else poke();
  });

  var zoneRaf = 0;
  window.addEventListener('scroll', function () {
    if (zoneRaf) return;
    zoneRaf = requestAnimationFrame(function () { zoneRaf = 0; trackZones(); });
  }, { passive: true });

  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    stopIdle();
    resizeT = setTimeout(function () { buildCloud(); trackZones(); poke(); }, 150);
  });

  /* a reader who turns motion off mid-visit gets the pen taken away */
  if (reduceQ.addEventListener) {
    reduceQ.addEventListener('change', function (e) {
      if (!e.matches) return;
      stopIdle();
      clearTimeout(idleTimer);
      root.classList.remove('bp-idle-ok');
    });
  }

  trackZones();
  poke();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
