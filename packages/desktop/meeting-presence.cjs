'use strict';

const { createHash } = require('node:crypto');

const MAX_WINDOW_TITLE = 160;
const MAX_CANDIDATES = 8;
const MAX_SOURCES_INSPECTED = 512;

/**
 * Window titles are the only signal Electron exposes without capturing the
 * window. Keep the matcher deliberately narrow: a generic Teams, Zoom, Slack,
 * or Discord window is an application window, not proof of a meeting.
 */
const PROVIDERS = [
  {
    provider: 'Zoom',
    patterns: [
      /^zoom meeting(?:$|\s+[|–—-]\s+.+)/i,
      /^(?=.*\bmeeting\b).+\s+[|–—-]\s+zoom(?: workplace)?$/i,
    ],
  },
  {
    provider: 'Microsoft Teams',
    patterns: [
      /^(?=.*\b(?:meeting|call)\b).+\s+[|–—-]\s+microsoft teams$/i,
      /^.+\s+[|–—-]\s+microsoft teams (?:meeting|call)$/i,
    ],
  },
  {
    provider: 'Google Meet',
    patterns: [
      /^meet\s*-\s*[a-z0-9]{3,}(?:-[a-z0-9]{3,}){2}$/i,
      /^.+\s+[|–—-]\s+google meet$/i,
    ],
  },
  {
    provider: 'Slack',
    patterns: [
      /^(?=.*\b(?:huddle|call)\b).+\s+[|–—-]\s+slack$/i,
    ],
  },
  {
    provider: 'Discord',
    patterns: [
      /^(?=.*\b(?:voice|call|stage)\b).+\s+[|–—-]\s+discord$/i,
    ],
  },
  {
    provider: 'Webex',
    patterns: [
      /^(?=.*\b(?:meeting|call)\b).+\s+[|–—-]\s+webex$/i,
    ],
  },
];

function cleanTitle(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_WINDOW_TITLE);
}

function classifyMeetingTitle(value) {
  const title = cleanTitle(value);
  if (!title) return null;
  for (const entry of PROVIDERS) {
    if (entry.patterns.some((pattern) => pattern.test(title))) return entry.provider;
  }
  return null;
}

function meetingCandidate(value) {
  const title = cleanTitle(value);
  const provider = classifyMeetingTitle(title);
  if (!provider) return null;
  const key = createHash('sha256')
    .update(`${provider}\0${title.toLocaleLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
  return { key, provider, title };
}

function unavailable(reason) {
  return {
    supported: false,
    status: 'unavailable',
    basis: 'capturable-window-title',
    candidates: [],
    reason,
  };
}

/**
 * Enumerate names only. thumbnailSize 0x0 and fetchWindowIcons:false prevent
 * screenshots and icons from entering this process. The renderer receives only
 * allowlisted matches, never Electron source ids or the full window inventory.
 */
async function detectMeetingPresence(desktopCapturer) {
  if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') {
    return unavailable('Meeting-window detection is not available on this desktop.');
  }
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
  } catch {
    return unavailable('Meeting-window detection could not read local window names.');
  }
  const candidates = [];
  const seen = new Set();
  for (const source of Array.isArray(sources) ? sources.slice(0, MAX_SOURCES_INSPECTED) : []) {
    const candidate = meetingCandidate(source && source.name);
    if (!candidate || seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    candidates.push(candidate);
    if (candidates.length === MAX_CANDIDATES) break;
  }
  return {
    supported: true,
    status: candidates.length > 0 ? 'detected' : 'none',
    basis: 'capturable-window-title',
    candidates,
    checkedAt: new Date().toISOString(),
  };
}

function createMeetingPresenceHandler({ desktopCapturer, trustedFrame }) {
  if (typeof trustedFrame !== 'function') throw new TypeError('trustedFrame is required');
  return async (event) => {
    if (!trustedFrame(event)) {
      return unavailable('Meeting-window detection is unavailable in this window.');
    }
    return detectMeetingPresence(desktopCapturer);
  };
}

module.exports = {
  MAX_CANDIDATES,
  classifyMeetingTitle,
  cleanTitle,
  createMeetingPresenceHandler,
  detectMeetingPresence,
  meetingCandidate,
};
