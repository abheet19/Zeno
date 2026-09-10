'use strict';

// Keep the workbench usable from a laptop display through a large monitor.
// Electron's menu is hidden, so browser-default zoom accelerators are not a
// discoverable or stable contract; this tiny controller owns the three normal
// editor shortcuts and clamps them to a readable range.
const ZOOM_LEVELS = Object.freeze([0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);

function nextLevel(current, direction) {
  const epsilon = 0.001;
  if (direction > 0) return ZOOM_LEVELS.find(level => level > current + epsilon) ?? ZOOM_LEVELS.at(-1);
  return [...ZOOM_LEVELS].reverse().find(level => level < current - epsilon) ?? ZOOM_LEVELS[0];
}

function installWorkbenchZoom(webContents) {
  if (!webContents || typeof webContents.on !== 'function') return () => {};
  const onInput = (event, input = {}) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const key = String(input.key || '').toLowerCase();
    const increase = key === '+' || key === '=' || key === 'add';
    const decrease = key === '-' || key === '_' || key === 'subtract';
    const reset = key === '0' || key === 'num0';
    if (!increase && !decrease && !reset) return;
    event.preventDefault();
    const current = Number(webContents.getZoomFactor?.()) || 1;
    webContents.setZoomFactor(reset ? 1 : nextLevel(current, increase ? 1 : -1));
  };
  webContents.on('before-input-event', onInput);
  return () => webContents.removeListener?.('before-input-event', onInput);
}

module.exports = { ZOOM_LEVELS, installWorkbenchZoom, nextLevel };
