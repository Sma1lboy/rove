/* The version stamp.
 *
 * Every sheet prints the shipped version in its header, title block and
 * revision table. It was hard-coded in five files and went stale three times in
 * four days (0.9.191 -> .192 -> .196 -> .198), because nothing tied it to the
 * package. The printed value is the fallback — it is what a crawler and a
 * blocked network see, so it still has to be correct at publish time — and the
 * live one overwrites it on load.
 *
 * Source is the npm registry, not GitHub: every sheet already spends one of the
 * 60 unauthenticated GitHub calls an hour on the star count, and the version is
 * not worth the second one. The registry's smaller /dist-tags endpoint sends no
 * CORS headers — only /latest does — so this reads the package document and
 * takes one field.
 *
 * Separate from blueprint-idle.js on purpose: that file owns what the drawing
 * DOES — strokes constructing, the pen taking a measurement. This owns where
 * one number printed on it comes from. They share nothing.
 */
(function () {
  'use strict';

var liveRev = null;

function paintVersion() {
  var v = liveRev;
  if (!v) return;
  document.querySelectorAll('[data-rev]').forEach(function (el) {
    el.textContent = el.hasAttribute('data-rev-v') ? 'v' + v : v;
  });
  /* The changelog calls a release by its patch level — revision 198 is
     v0.9.198 — so that slot wants the last segment on its own. */
  var patch = v.split('.')[2];
  document.querySelectorAll('[data-rev-patch]').forEach(function (el) {
    el.textContent = patch;
  });
  document.querySelectorAll('[data-measure]').forEach(function (el) {
    var r = el.getAttribute('data-measure');
    if (/^CURRENT REV /.test(r)) el.setAttribute('data-measure', 'CURRENT REV ' + v);
  });
}

function stampVersion() {
  if (!document.querySelector('[data-rev]') || !window.fetch) return;
  fetch('https://registry.npmjs.org/@sma1lboy/rove/latest')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var v = d && d.version;
      if (!v || !/^\d+\.\d+\.\d+/.test(v)) return;
      liveRev = v;
      paintVersion();
      document.dispatchEvent(new CustomEvent('rove:version', { detail: v }));
    })
    .catch(function () {});

  /* Translating a paragraph replaces its innerHTML, which throws away any
     version mark inside it — so the sheet would go back to the number it was
     published with on the first language switch. Repaint after each one. */
  var toggle = document.getElementById('langToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      requestAnimationFrame(function () { requestAnimationFrame(paintVersion); });
    });
  }
}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', stampVersion, { once: true });
  } else {
    stampVersion();
  }
})();
