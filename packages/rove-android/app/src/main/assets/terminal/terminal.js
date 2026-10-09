'use strict';
const terminal = new Terminal({
  cursorBlink: true, fontSize: 13, fontFamily: 'monospace', scrollback: 2000,
  theme: { background: '#141413', foreground: '#eae7df', cursor: '#cc785c' }
});
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit);
terminal.open(document.getElementById('terminal'));
terminal.onData(data => Rove.input(data));
terminal.onResize(size => Rove.resize(size.cols, size.rows));
window.roveWrite = encoded => terminal.write(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
window.roveReset = () => terminal.reset();
new ResizeObserver(() => fit.fit()).observe(document.getElementById('terminal'));
fit.fit();
Rove.ready();
