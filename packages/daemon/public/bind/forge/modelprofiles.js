/** Relative product guidance for the live picker, never a benchmark claim. */
const named = {
  'claude-code:opus': [96, 97, 48],
  'claude-code:sonnet': [90, 90, 78],
  'claude-code:haiku': [72, 66, 96],
  'codex:gpt-6-astra': [97, 97, 54],
  'codex:gpt-5.6-sol': [93, 91, 72],
  'codex:gpt-5.6-terra': [87, 85, 84],
  'codex:gpt-5.6-luna': [79, 76, 96],
};

function localScores(model) {
  const size = /(?:^|[-_:])(\d+(?:\.\d+)?)b(?:$|[-_:])/i.exec(model)?.[1];
  const billions = size ? Number(size) : Number.NaN;
  if (!Number.isFinite(billions)) return [58, 58, 78];
  if (billions <= 4) return [46, 46, 96];
  if (billions <= 8) return [62, 60, 86];
  if (billions <= 14) return [74, 70, 62];
  if (billions <= 32) return [82, 81, 44];
  return [86, 86, 30];
}

export function scoreLabel(score) {
  if (score >= 90) return 'excellent';
  if (score >= 78) return 'strong';
  if (score >= 62) return 'balanced';
  if (score >= 46) return 'basic';
  return 'limited';
}

export function modelCapabilityProfile(agentId, model = '') {
  const key = `${agentId}:${String(model).toLowerCase()}`;
  let scores = named[key];
  if (!scores && agentId === 'local') scores = localScores(String(model));
  if (!scores && agentId === 'claude-code') scores = [86, 86, 72];
  if (!scores && agentId === 'codex') scores = [88, 87, 72];
  if (!scores) scores = [65, 65, 65];
  const [code, reasoning, speed] = scores;
  return {
    code, reasoning, speed,
    summary: `Code ${scoreLabel(code)} · reasoning ${scoreLabel(reasoning)} · speed ${scoreLabel(speed)}`,
    note: 'Curated relative guidance — not a live benchmark or quality guarantee.',
  };
}
