'use strict';
// iOS Theme.Terminal: espresso background on the dark tokens, the claude-theme ANSI 0-15 palette, Maple Mono NF at 13.
const ansi = ['#141413', '#d47563', '#9aca86', '#e8c96b', '#61aaf2', '#9b87f5', '#d4967e', '#a9a39a',
  '#6b665f', '#d47563', '#9aca86', '#e8c96b', '#61aaf2', '#9b87f5', '#e0ab96', '#eae7df'];
const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const theme = { background: '#141413', foreground: '#eae7df', cursor: '#cc785c', selectionBackground: 'rgba(204,120,92,0.35)' };
names.forEach((n, i) => { theme[n] = ansi[i]; theme['bright' + n[0].toUpperCase() + n.slice(1)] = ansi[i + 8]; });
const terminal = new Terminal({
  cursorBlink: true, fontSize: 13, fontFamily: "'Maple Mono NF', monospace", scrollback: 2000, theme
});
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit);
terminal.open(document.getElementById('terminal'));
terminal.onData(data => Rove.input(data));
terminal.onResize(size => Rove.resize(size.cols, size.rows));
window.roveWrite = encoded => terminal.write(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
window.roveReset = () => terminal.reset();
new ResizeObserver(() => fit.fit()).observe(document.getElementById('terminal'));
// Measure cells only after the bundled face has loaded, or the first fit uses the fallback's advance.
document.fonts.load("13px 'Maple Mono NF'").finally(() => { terminal.options.fontFamily = "'Maple Mono NF', monospace"; fit.fit(); Rove.ready(); });
