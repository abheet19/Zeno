/**
 * The GENERAL prompt: what Command asks the local model when the owner's
 * question is not about their own Zeno at all.
 *
 * `buildAssistantPrompt` (prompt.ts) is deliberately narrow: it hands the model
 * a clipped snapshot of REAL local facts and forbids it from using anything
 * else, because a confidently wrong answer about the owner's own machine is
 * worse than a refusal. That rule must never relax.
 *
 * But it also means an ordinary question with nothing to cite — "what's a
 * good regex for an email address?", "explain what a closure is" — has no fact
 * behind it and dead-ends on the same refusal every time, which reads as
 * broken rather than careful. This is the OTHER prompt, used only after the
 * grounded one has already failed: no FACTS block, no citation rule, and the
 * model is told PLAINLY that this is a general-knowledge answer rather than a
 * reading of the owner's Zeno — so whatever comes back is rendered by the
 * caller labelled as exactly that, never dressed up as a grounded fact.
 *
 * Pure, like the rest of this package: a string in, a string out.
 */
import { QUESTION_MAX } from './prompt.js';

/**
 * Build the general-knowledge prompt for one question.
 *
 * The question is clipped the same way `buildAssistantPrompt` clips it —
 * same constant, same reason: an enormous paste must not be handed to the
 * model whole just because this path carries no other budget to blow.
 */
export function buildGeneralPrompt(question: string, maxQuestion = QUESTION_MAX): string {
  const cap = Math.max(1, Math.floor(maxQuestion));
  const flat = question.replace(/\s+/g, ' ').trim();
  const asked = flat.length > cap ? flat.slice(0, cap - 1).trimEnd() + '…' : flat;

  return [
    "You are Zeno, the owner's local assistant, answering a GENERAL question — one that is",
    'not about their own Zeno installation, and not something you were shown any local state for.',
    '',
    'RULES',
    "1. You were NOT shown the owner's approvals, receipts, work items, repository, memory, or",
    '   devices for this answer. Say nothing about any of them, real or guessed.',
    '2. Answer from general knowledge, plainly and as briefly as the question allows.',
    "3. If you are not sure, say so instead of guessing confidently — this answer carries no",
    '   citation and nobody will check it against a fact.',
    '4. You cannot approve, commit, run, send, or change anything, on this machine or anywhere',
    '   else. Never say you have done any of those things.',
    '5. No preamble, no apology, no restating the question.',
    '',
    'QUESTION',
    asked,
    '',
    'ANSWER',
  ].join('\n');
}
