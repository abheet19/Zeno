/** Zeno Counsel — a cited, honest meeting summary from a consented transcript. Public surface. */
//
// REMOVED DELIBERATELY: the live-assist feature (`suggest`, `renderSuggestion`,
// `src/assist.ts`). Counsel takes notes and nothing more — it does not whisper
// answers to the owner during a call. This is a product decision by the owner,
// not an oversight and not a stub. Do not re-add it.
//
export {
  emptyTranscript,
  transcriptOf,
  append,
  sliceByTime,
  type Speaker,
  type Utterance,
  type Transcript,
} from './transcript.js';
export {
  summarize,
  type Lifecycle,
  type Decision,
  type Action,
  type OpenQuestion,
  type KeyPoint,
  type MeetingSummary,
} from './extract.js';
export { renderSummary, renderPartial, tooShortToSummarize } from './render.js';
export { keywords, sentencesOf, firstSentence, norm } from './text.js';
export { serializeMeeting, parseMeeting, type Meeting, type ParsedMeeting } from './meeting.js';
export { Meetings, type MeetingStore, type Hit, type Failure } from './library.js';
export {
  buildAnswerPrompt,
  groundedAnswer,
  NOT_FOUND,
  DEFAULT_MAX_CHARS,
  type Grounding,
  type PromptOptions,
} from './ask.js';
export { nodeMeetingStore } from './counsel-node.js';
