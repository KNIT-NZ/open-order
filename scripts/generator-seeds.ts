/**
 * Domain seeds that the corpus cannot derive.
 * Only the generators import this module. Runtime reads lib/domain-vocabulary-data.js.
 */

/** Matrix v1.2 forum words. Phrase extraction uses these and nothing else. */
export const FORUM_WORDS = ["committee", "committees", "house", "chamber"] as const;

/**
 * Proceeding head nouns. The phrases are derived from headings; the heads are not.
 * Runtime reads the emitted corpusProceedingHeads list.
 */
export const PROCEEDING_HEAD_NOUNS = [
  "amendment", "debate", "motion", "petition", "question", "reading", "reply", "statement", "vote",
] as const;

/**
 * Words that introduce a body ("Functions of …", "Meetings of …").
 * Emitted through generation. A prefix is removed only when a name token remains.
 */
export const HEADING_PREFIX_SEED = [
  "function", "basis", "purpose", "determination", "membership", "meeting",
  "power", "proceeding", "establishment", "life", "chairperson", "opinion",
  "report", "referral", "arrangement", "instruction", "consideration",
  "presence", "motion", "naming", "interruption", "question", "time",
] as const;

/** Generic reference words. A name made only of these and class words is generic. */
export const COMMITTEE_REFERENCE_SEED = ["relevant", "appropriate", "responsible", "same", "similar"] as const;

/**
 * Domain words dropped before dossier overlap. Grammatical stops come from
 * the closed-class module. These are the forms left after the ranker's suffix trim.
 */
/**
 * Domain words the selector drops before a proceeding-identity check.
 * Grammatical stops come from the closed-class module.
 */
export const IDENTITY_DOMAIN_STOP_SEED = [
  "automatically", "committee", "decision", "entirely", "first", "full", "house",
  "immediately", "made", "make", "matter", "matters", "member", "members",
  "motion", "mp", "mps", "normal", "ordinary", "parliament", "person",
  "personally", "procedural", "procedure", "question", "regardless", "rule",
  "rules", "select", "simply", "speaker", "speech", "standing", "take", "taken",
  "theyre", "thing", "things",
] as const;

export const DOSSIER_DOMAIN_STOP_SEED = [
  "house", "member", "members", "order", "parliament", "parliamentary",
  "procedure", "proceeding", "proceedings", "rule", "rules", "ruling", "speaker",
] as const;
