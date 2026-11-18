#!/usr/bin/env bash
# Requires agent-browser's Chromium. Run from packages/rove-web against a Vite dev server.
set -euo pipefail
session="term-input-$$"
trap 'agent-browser --session "$session" close >/dev/null' EXIT
agent-browser --session "$session" open "${1:-http://127.0.0.1:5197}"
agent-browser --session "$session" eval --stdin <<'JS'
(async () => {
  const { mountTerminal } = await import('/src/term-mount.ts');
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;width:900px;height:450px;z-index:99999';
  document.body.append(el);
  const calls = [];
  const client = {
    on: () => () => {},
    onOpen: fn => { queueMicrotask(fn); return () => {}; },
    request: async (op, payload) => {
      calls.push({ op, ...payload });
      return op === 'term.attach'
        ? { stream: 'regression::tab-1', alive: true, replay: btoa('ready\r\n') }
        : {};
    },
  };
  const handle = mountTerminal({ client, el, taskId: 'regression', tabId: 'tab-1',
    setNotice() {}, onScrolled() {}, onFocusChange() {}, onExit() {},
    copyText: async () => true, pasteImage: async () => {}, focusOnMount: true });
  const write = data => new Promise(resolve => handle.term.write(data, resolve));
  await new Promise(resolve => setTimeout(resolve, 1200));
  await write(Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join(''));
  handle.scrollToTop();
  await write("\x1b[3J" + Array.from({ length: 100 }, (_, i) => `repaint ${i}\r\n`).join(""));
  const area = handle.term.textarea;
  area.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'draft' }));
  area.value = 'draft';
  area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'draft' }));
  if (handle.term.buffer.active.viewportY >= handle.term.buffer.active.baseY)
    throw new Error('fixture must start in scrollback');
  calls.length = 0;
  window.regression = { handle, calls, write };
})();
JS
agent-browser --session "$session" press Shift+Enter
agent-browser --session "$session" eval --stdin <<'JS'
(async () => {
  const { handle, calls, write } = window.regression;
  const assertFollowing = () => {
    const { viewportY, baseY } = handle.term.buffer.active;
    if (viewportY !== baseY) throw new Error(`still scrolled back: ${viewportY}/${baseY}`);
  };
  assertFollowing();
  const data = calls.filter(c => c.op === 'term.input').map(c => c.data);
  if (JSON.stringify(data) !== JSON.stringify(['\x1b[27;2;13~']))
    throw new Error(`unexpected input: ${JSON.stringify(data)}`);
  if (!calls.some(c => c.op === 'term.resize')) throw new Error('typing did not claim size');
  if (handle.term.textarea.value !== '') throw new Error(`dictation run was not ended: ${JSON.stringify(handle.term.textarea.value)}`);
  await write('\x1b[3J' + Array.from({ length: 100 }, (_, i) => `output ${i}\r\n`).join(''));
  assertFollowing();
  return 'PASS: Shift+Enter clears held scrollback, follows output, claims size, ends dictation, and sends one newline';
})();
JS
agent-browser --session "$session" press Enter
agent-browser --session "$session" eval --stdin <<'JS'
const data = window.regression.calls.filter(c => c.op === 'term.input').map(c => c.data);
if (JSON.stringify(data) !== JSON.stringify(['\x1b[27;2;13~', '\r']))
  throw new Error(`ordinary Enter changed: ${JSON.stringify(data)}`);
window.regression.handle.dispose();
JS
