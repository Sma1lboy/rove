import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../install.js', import.meta.url), 'utf8');

// A DOM/clipboard fixture: these tests do not claim rendered-browser coverage.
function fixture({ userAgent = 'Linux', lang = 'en', write } = {}) {
  class Element {
    constructor() {
      this.textContent = '';
      this.value = 'posix';
      this.attrs = {};
      this.listeners = {};
      this.classes = new Set();
      this.classList = { add: (s) => this.classes.add(s), remove: (s) => this.classes.delete(s) };
    }
    addEventListener(name, cb) { this.listeners[name] = cb; }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    querySelector() { return elements.command; }
    async fire(name) { await this.listeners[name]?.(); }
  }
  const elements = Object.fromEntries(['installOs', 'copyBtn', 'copyLabel', 'installHelp', 'installOsLabel', 'command'].map((s) => [s, new Element()]));
  const writes = [];
  const document = {
    documentElement: { lang },
    getElementById: (id) => elements[id],
    addEventListener: (name, cb) => { document[name] = cb; },
  };
  const navigator = { userAgent, clipboard: { writeText: write ?? (async (s) => { writes.push(s); }) } };
  runInNewContext(source, { document, navigator, setTimeout: () => 1, clearTimeout: () => {} });
  return { elements, document, navigator, writes, select: async (os) => { elements.installOs.value = os; await elements.installOs.fire('change'); } };
}

test('native Windows starts with npm and exposes Node + Git Bash before copying', async () => {
  const f = fixture({ userAgent: 'Mozilla Windows NT 10.0' });
  assert.equal(f.elements.installOs.value, 'windows');
  assert.match(f.elements.installHelp.textContent, /Node.js.*Git Bash.*restart/);
  await f.elements.copyBtn.fire('click');
  assert.equal(f.writes[0], 'npm install -g @sma1lboy/rove');
  assert.equal(f.elements.command.textContent, f.writes[0]);
  assert.match(f.elements.copyBtn.attrs['aria-label'], /npm install/);
});

test('manual WSL choice overrides Windows detection and uses Linux prerequisites', async () => {
  const f = fixture({ userAgent: 'Windows' });
  await f.select('wsl');
  assert.match(f.elements.installHelp.textContent, /inside your Linux distribution/);
  await f.elements.copyBtn.fire('click');
  assert.match(f.writes[0], /^curl .* \| sh$/);
  await f.select('windows');
  await f.elements.copyBtn.fire('click');
  assert.equal(f.writes[1], 'npm install -g @sma1lboy/rove');
});

test('language changes preserve selected shell and translate prerequisites', async () => {
  const f = fixture();
  await f.select('windows');
  f.document.documentElement.lang = 'zh-CN';
  f.document['rove:language']();
  assert.equal(f.elements.installOs.value, 'windows');
  assert.match(f.elements.installHelp.textContent, /原生 Windows.*Git Bash/);
  await f.elements.copyBtn.fire('click');
  assert.equal(f.elements.copyLabel.textContent, '✓ 已复制');
  assert.equal(f.writes[0], 'npm install -g @sma1lboy/rove');
});

test('clipboard failure and absence never claim successful copying', async () => {
  const f = fixture({ write: async () => { throw new Error('denied'); } });
  await f.elements.copyBtn.fire('click');
  assert.equal(f.elements.copyLabel.textContent, 'Copy manually');
  assert.equal(f.elements.copyBtn.classes.has('is-copied'), false);
  f.navigator.clipboard = undefined;
  await f.elements.copyBtn.fire('click');
  assert.equal(f.elements.copyLabel.textContent, 'Copy manually');
});

test('changing OS while copying cannot mark the new command copied', async () => {
  let resolve;
  const f = fixture({ write: () => new Promise((r) => { resolve = r; }) });
  const pending = f.elements.copyBtn.fire('click');
  await f.select('windows');
  resolve();
  await pending;
  assert.equal(f.elements.copyLabel.textContent, 'click to copy');
  assert.equal(f.elements.copyBtn.classes.has('is-copied'), false);
});

test('repeated copy clicks report the newest attempt, not a stale success', async () => {
  const pending = [];
  const f = fixture({ write: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  const first = f.elements.copyBtn.fire('click');
  const second = f.elements.copyBtn.fire('click');
  pending[1].reject(new Error('denied'));
  await second;
  pending[0].resolve();
  await first;
  assert.equal(f.elements.copyLabel.textContent, 'Copy manually');
});
