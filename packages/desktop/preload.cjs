'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if (process.platform === 'win32') {
  contextBridge.exposeInMainWorld('zenoLocalSpeech', {
    start: (id, lang, prompt = '') => ipcRenderer.invoke('zeno:speech:start', { id, lang, prompt }),
    transcribe: (id, audio) => ipcRenderer.invoke('zeno:speech:transcribe', { id, audio }),
    stop: id => ipcRenderer.invoke('zeno:speech:stop', id),
    abort: id => ipcRenderer.invoke('zeno:speech:abort', id),
    idle: () => ipcRenderer.invoke('zeno:speech:idle'),
  });
  contextBridge.exposeInMainWorld('zenoProject', {
    choose: () => ipcRenderer.invoke('zeno:project:choose'),
  });
  contextBridge.exposeInMainWorld('zenoMeeting', {
    detect: () => ipcRenderer.invoke('zeno:meeting:detect'),
  });
}
