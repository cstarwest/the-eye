// The window's only way out: window.gatekeeper, a few calls into the bridge in
// the main process (desktop/main.mjs). The page has no Node and no network.
const { contextBridge, ipcRenderer } = require('electron');

const streams = new Map();   // ask id -> the page's event callback
ipcRenderer.on('gk:event', (_e, id, ev) => { const fn = streams.get(id); if (fn) fn(ev); });

contextBridge.exposeInMainWorld('gatekeeper', {
  status: () => ipcRenderer.invoke('gk:status'),
  redetect: () => ipcRenderer.invoke('gk:redetect'),
  chooseRepo: () => ipcRenderer.invoke('gk:choose-repo'),
  // resolves { ok, answer } or { ok: false, error }; events (delta, tool, status) stream to onEvent meanwhile
  ask(id, question, session, onEvent) {
    streams.set(id, onEvent);
    return ipcRenderer.invoke('gk:ask', { id, question, session }).finally(() => streams.delete(id));
  },
  cancel: id => ipcRenderer.send('gk:cancel', id),
  onStatus: fn => { ipcRenderer.on('gk:status', (_e, st) => fn(st)); },
});
