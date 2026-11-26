/* dots.js: the page's dot-matrix details, in the app's own vocabulary (its status marks and
 * cloud are dots on a grid).
 *
 *   .can > div      each feature gets a 5×5 glyph that draws itself dot by dot when the
 *                   grid scrolls into view, and ripples while its card is hovered
 *   [data-glyph]    a page's own mark beside its headline, drawn on load
 *   .dotfield       a field of dots behind a page's headline; the ones near the pointer light up
 */
(function () {
  'use strict';

  var GLYPHS = {
    branch: ['#..#.', '#..#.', '#.#..', '##...', '#....'],
    handover: ['..#..', '...#.', '#####', '...#.', '..#..'],
    fanout: ['....#', '..#..', '#.#.#', '..#..', '....#'],
    moon: ['..##.', '.##..', '.##..', '.##..', '..##.'],
    cloud: ['.....', '..##.', '.####', '#####', '.....'],
    clock: ['.###.', '#.#.#', '#.###', '#...#', '.###.'],
    tick: ['....#', '...#.', '#.#..', '.#...', '.....'],
    screen: ['#####', '#...#', '#...#', '#####', '.###.'],
    plug: ['.#.#.', '.#.#.', '#####', '.###.', '..#..'],
    swatches: ['##.##', '##.##', '.....', '##.##', '##.##'],
    list: ['#.###', '.....', '#.###', '.....', '#.###'],
  };
  /* The feature grid's marks, in page order. */
  var FEATURES = ['branch', 'handover', 'fanout', 'moon', 'cloud', 'clock', 'tick', 'screen'];

  function fill(g, name) {
    var lit = 0;
    g.setAttribute('aria-hidden', 'true');
    g.innerHTML = GLYPHS[name].join('').split('').map(function (cell, i) {
      var far = Math.hypot(i % 5 - 2, Math.floor(i / 5) - 2).toFixed(2);
      return '<b' + (cell === '#' ? ' class="on" style="--i:' + (lit++) + ';--d:' + far + '"' : ' style="--d:' + far + '"') + '></b>';
    }).join('');
  }

  [].forEach.call(document.querySelectorAll('.can > div'), function (card, n) {
    if (!FEATURES[n]) return;
    var g = document.createElement('i');
    g.className = 'glyph';
    fill(g, FEATURES[n]);
    card.insertBefore(g, card.firstChild);
  });
  /* A page's own mark, written in the HTML as <i class="glyph is-page" data-glyph="name">: drawn on load. */
  [].forEach.call(document.querySelectorAll('[data-glyph]'), function (g) {
    fill(g, g.getAttribute('data-glyph'));
    requestAnimationFrame(function () { requestAnimationFrame(function () { g.classList.add('is-in'); }); });
  });

  var grid = document.querySelector('.can');
  if (grid && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries, io) {
      if (!entries[0].isIntersecting) return;
      grid.classList.add('is-in');
      io.disconnect();
    }, { threshold: 0.25 }).observe(grid);
  } else if (grid) grid.classList.add('is-in');

  [].forEach.call(document.querySelectorAll('.dotfield'), function (hero) {
    if (!matchMedia('(hover: hover)').matches) return;
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      hero.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
})();
