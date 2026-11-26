/* demo-scenes.js: what the hero's app window plays. Each scene is an async function over the
 * helpers demo.js passes in as `k`; it only says what happens and when, never how it is drawn.
 * `order` is the order the scenes play in, and the names match #scenes button[data-scene].
 */
window.RoveDemoScenes = {
  order: ['dispatch', 'preview', 'swap', 'machines', 'routine', 'split'],
  scenes: {
      /* One agent splits a feature into a backend and a frontend part, two others build them,
         and the two children run side by side before the reports come back. */
      dispatch: async function (k) {
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
        var MACHINES = [['This Mac', 'here'], ['mac-mini', 'online'], ['gpu-box', 'online'], ['E2B sandbox', 'new sandbox']];
        k.usage('Claude', 42); k.usage('Codex', 8);
        k.group('storefront');
        k.row({ id: 'x', title: 'Refund flow', status: 'done' });
        k.row({ id: 'y', title: 'Flaky cart test', tag: 'mac-mini', status: 'work' });
        k.group('ml-pipeline');
        k.row({ id: 'z', title: 'Nightly eval', icon: 'codex', tag: 'gpu-box', status: 'work' });
        k.select('x');
        k.pane({ id: 'a', label: 'claude', where: 'new task', machine: 'This Mac' });
        await k.w(500);
        await k.pick('a', MACHINES, 2);
        k.paneHead('a', { label: 'claude', where: 'new task', machine: 'gpu-box', remote: true });
        await k.w(500);
        await k.type('a', 'Train the ranking model on the new data and report the score.');
        k.row({ id: 'a', title: 'Ranking model', tag: 'gpu-box', status: 'work', flash: true, after: 'z' });
        k.select('a');
        k.paneHead('a', { label: 'claude', where: 'ssh', machine: 'gpu-box', remote: true });
        await k.think('a', 800, 'Connecting to gpu-box…');
        k.line('a', '<b>Bash</b>(python train.py --data data/2026-11)', 'is-tool');
        await k.w(400);
        k.line('a', 'epoch 1/3  loss 0.412', 'is-out');
        await k.w(450);
        k.line('a', 'epoch 2/3  loss 0.287', 'is-out');
        k.status('y', 'done'); k.inbox(1);
        await k.w(450);
        k.line('a', 'epoch 3/3  loss 0.231', 'is-out');
        await k.think('a', 600, 'Scoring…');
        await k.say('a', 'Done on gpu-box. NDCG@10 improved from 0.61 to 0.66.');
        k.status('a', 'done'); k.inbox(2);
        await k.w(1400);

        // A second task, this time in a sandbox that exists only for the run.
        k.pane({ id: 'b', label: 'claude', where: 'new task', machine: 'This Mac' });
        k.show(['b']);
        await k.w(500);
        await k.pick('b', MACHINES, 3);
        k.paneHead('b', { label: 'claude', where: 'new task', machine: 'E2B sandbox', remote: true });
        await k.w(500);
        await k.type('b', 'Run the whole end-to-end suite somewhere clean and tell me what fails.');
        k.row({ id: 'b', title: 'E2E suite', tag: 'E2B sandbox', status: 'work', flash: true, after: 'y' });
        k.show(['b']);
        k.paneHead('b', { label: 'claude', where: 'sandbox', machine: 'E2B sandbox', remote: true });
        await k.think('b', 900, 'Starting a sandbox…');
        k.line('b', 'Sandbox ready: Ubuntu 24.04, repo cloned at this branch', 'is-dim');
        await k.w(300);
        k.line('b', '<b>Bash</b>(bun install &amp;&amp; bunx playwright test)', 'is-tool');
        await k.w(400);
        k.line('b', 'Running 48 tests using 4 workers', 'is-out');
        await k.w(600);
        k.line('b', '47 passed, 1 failed (1.2m)', 'is-out');
        await k.think('b', 700);
        await k.say('b', 'One failure: checkout.spec.ts times out on the tax step. Nothing ran on this Mac.');
        k.status('b', 'done'); k.inbox(3);
        await k.w(2400);
      },

      /* A prompt on a schedule: the clock reaches it, Rove starts the task, and the result lands in the inbox. */
      routine: async function (k) {
        k.usage('Claude', 42); k.usage('Codex', 8);
        k.group('storefront');
        k.row({ id: 'x', title: 'Refund flow', status: 'done' });
        k.group('ml-pipeline');
        k.row({ id: 'z', title: 'Nightly eval', icon: 'codex', tag: 'gpu-box', status: 'done' });
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
          k.card(items[i][0], items[i][1]);
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
  },
};
