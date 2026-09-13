'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if (process.platform === 'win32') {
  contextBridge.exposeInMainWorld('zenoLocalSpeech', {
    start: (id, lang, prompt = '') => ipcRenderer.invoke('zeno:speech:start', { id, lang, prompt }),
    transcribe: (id, audio) => ipcRenderer.invoke('zeno:speech:transcribe', { id, audio }),
    stop: id => ipcRenderer.invoke('zeno:speech:stop', id),
    abort: id => ipcRenderer.invoke('zeno:speech:abort', id),
    idle: () => ipcRenderer.invoke('zeno:speech:idle'),
    // The runtime installer: nothing downloads until Settings → Voice calls
    // install(). installStatus() is a cheap disk check, safe to call often.
    installStatus: () => ipcRenderer.invoke('zeno:speech:install:status'),
    install: () => ipcRenderer.invoke('zeno:speech:install:start'),
    cancelInstall: () => ipcRenderer.invoke('zeno:speech:install:cancel'),
    onInstallProgress: callback => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('zeno:speech:install:progress', listener);
      return () => ipcRenderer.removeListener('zeno:speech:install:progress', listener);
    },
  });
  // Relayed onto `window` (not the bridge object) so bind/voice.js can pick it
  // up with the same addEventListener pattern it already uses for every other
  // cross-surface signal, rather than polling the bridge after every install.
  ipcRenderer.on('zeno:speech:install:runtime-changed', () => {
    window.dispatchEvent(new CustomEvent('zeno:speech-runtime-changed'));
  });
  contextBridge.exposeInMainWorld('zenoProject', {
    choose: () => ipcRenderer.invoke('zeno:project:choose'),
  });
  contextBridge.exposeInMainWorld('zenoMeeting', {
    detect: () => ipcRenderer.invoke('zeno:meeting:detect'),
  });
}
