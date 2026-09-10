/**
 * Pure state helpers for Ask Zeno's typed and voice conversation surfaces.
 *
 * This module has no DOM, microphone, network, approval, or provider access.
 * Keeping dispatch admission and spoken summaries here makes the boundaries
 * directly testable without simulating Electron.
 */

const DEFAULT_SEEN_LIMIT = 64;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Admit at most one active Ask request and reject replayed capture keys.
 *
 * Typed turns use a fresh key for every explicit submit, so asking the same
 * words twice remains allowed. A voice capture reuses its capture key if a speech
 * engine delivers the same final result twice, so the replay is ignored.
 */
export function createDispatchGate(seenLimit = DEFAULT_SEEN_LIMIT) {
  const limit = Number.isInteger(seenLimit) && seenLimit > 0 ? seenLimit : DEFAULT_SEEN_LIMIT;
  const seen = new Set();
  const order = [];
  let active = null;
  let serial = 0;

  function remember(key) {
    seen.add(key);
    order.push(key);
    while (order.length > limit) {
      const oldest = order.shift();
      if (oldest !== undefined) seen.delete(oldest);
    }
  }

  return Object.freeze({
    begin(rawKey) {
      const key = clean(rawKey);
      if (!key || active !== null || seen.has(key)) return null;
      const token = Object.freeze({ id: ++serial, key });
      active = token;
      remember(key);
      return token;
    },
    finish(token) {
      if (active !== null && token && token.id === active.id && token.key === active.key) {
        active = null;
        return true;
      }
      return false;
    },
    busy() {
      return active !== null;
    },
    activeKey() {
      return active?.key ?? null;
    },
  });
}

function languageRoot(value) {
  return clean(value).toLowerCase().split('-')[0] || '';
}

/**
 * Select an installed speech-synthesis voice without inventing one.
 *
 * An explicit saved voice wins. Otherwise prefer a local voice in the exact
 * locale, then any exact-locale voice, then a local voice in the same language,
 * then any same-language voice, then the first installed voice.
 */
export function chooseSystemVoice(voices, savedVoiceUri, locale = 'en-US') {
  const available = Array.isArray(voices) ? voices.filter(Boolean) : [];
  if (available.length === 0) return null;

  const saved = clean(savedVoiceUri);
  if (saved) {
    const exact = available.find(voice => clean(voice.voiceURI) === saved);
    if (exact) return exact;
  }

  const wanted = clean(locale).toLowerCase();
  const root = languageRoot(wanted);
  const score = voice => {
    const lang = clean(voice.lang).toLowerCase();
    const local = voice.localService === true ? 1 : 0;
    if (lang === wanted && local) return 5;
    if (lang === wanted) return 4;
    if (languageRoot(lang) === root && local) return 3;
    if (languageRoot(lang) === root) return 2;
    if (local) return 1;
    return 0;
  };

  return available
    .map((voice, index) => ({ voice, index, score: score(voice) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.voice ?? null;
}

function proposedCount(delegated) {
  return Array.isArray(delegated?.proposed) ? delegated.proposed.length : 0;
}

/**
 * Return only text that is safe and useful to read aloud after an Ask response.
 *
 * The function never turns a confirmation into approval. Hosted work is
 * described as waiting for the owner's on-screen click.
 */
export function spokenReply(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const parts = [];

  const answer = clean(payload.answer);
  if (answer) {
    parts.push(answer);
  } else if (clean(payload.flagged)) {
    parts.push('I could not verify that reply against your current Zeno, so I did not present it as an answer.');
  } else if (clean(payload.note)) {
    parts.push(clean(payload.note));
  } else {
    parts.push('No answer came back.');
  }

  if (payload.proposal?.relPath) {
    parts.push('A file proposal is waiting for your review on screen. Voice cannot approve it.');
  }

  const delegated = payload.delegated;
  if (delegated?.needsConfirm) {
    parts.push('A hosted agent is ready, but it has not started. Confirm it with the on-screen button. Voice cannot start or approve that hosted run.');
  } else if (delegated?.started) {
    const count = proposedCount(delegated);
    parts.push(
      count > 0
        ? String(count) + ' ' + (count === 1 ? 'change is' : 'changes are') +
          ' waiting for your review in Command. Voice cannot approve them.'
        : 'The local agent finished without proposing a file change.',
    );
  } else if (delegated && clean(delegated.note)) {
    parts.push(clean(delegated.note));
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function captureOwnerLabel(owner) {
  if (owner === 'counsel') return 'Counsel';
  if (owner === 'ask') return 'Ask Zeno voice conversation';
  if (owner === 'command') return 'Command voice';
  return clean(owner) || 'another voice surface';
}
