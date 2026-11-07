/* copy.js: copy-on-click for every [data-cmd] button except the install
 * button, which install.js owns.
 *
 *   [data-cmd]   the text to copy
 *   [data-hint]  inside the button; its text becomes "Copied" for 2.2 s
 */
(function () {
  'use strict';

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

  function words() {
    return document.documentElement.lang === 'zh-CN'
      ? { done: '已复制', failed: '请手动复制' }
      : { done: 'Copied', failed: 'Copy manually' };
  }

  function boot() {
    var timers = new WeakMap();
    var originals = new WeakMap();
    document.querySelectorAll('[data-cmd]:not([data-install-copy])').forEach(function (btn) {
      var hint = btn.querySelector('[data-hint]');
      /* The hint is re-translated on a language switch, so the text to restore
         is whatever it said when the click happened, not at load. */
      function flash(text, cls) {
        if (!hint) return;
        if (!timers.has(btn)) originals.set(btn, hint.textContent);
        hint.textContent = text;
        if (cls) btn.classList.add(cls);
      }
      function schedule() {
        clearTimeout(timers.get(btn));
        timers.set(btn, setTimeout(function () {
          timers.delete(btn);
          btn.classList.remove('is-copied');
          if (hint) hint.textContent = originals.get(btn);
        }, 2200));
      }
      btn.addEventListener('click', function () {
        write(btn.getAttribute('data-cmd')).then(function () {
          btn.classList.add('is-copied');
          flash(words().done);
          schedule();
        }).catch(function () {
          flash(words().failed);
          schedule();
        });
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
