/* version.js: prints the shipped version wherever a page has a [data-rev]
 * element. The version used to be hard-coded in five files and went stale
 * three times in four days, so the live value now overwrites it on load. The
 * printed value is the fallback for crawlers and blocked networks, so it must
 * still be correct at publish time.
 *
 * The source is the npm registry, not GitHub: every page already spends one of
 * the 60 unauthenticated GitHub calls an hour on the star count. The registry's
 * /dist-tags endpoint sends no CORS headers (only /latest does), so this reads
 * the package document and takes one field.
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
  /* The changelog calls a release by its patch level (revision 198 is
     v0.9.198), so that slot wants the last segment on its own. */
  var patch = v.split('.')[2];
  document.querySelectorAll('[data-rev-patch]').forEach(function (el) {
    el.textContent = patch;
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
     version mark inside it, so the page would go back to the number it was
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
