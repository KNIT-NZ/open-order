import {
  actorClassQualificationQuery,
  dutyVersusDiscretion,
  forumIdentityMismatch,
  negativePowerWitnessScore,
  normaliseNumberWords,
  powerGrantedToDifferentBody,
  presidingOfficerAppealQuery,
  stem as genericStem,
} from "./procedural-mechanisms.js";

// OPEN ORDER v5.19 GENERAL RECOVERY CANDIDATE.
// Parent frozen selector SHA-256: acb281f9b2e6db9156275c01543a33b8f1c2e61acc43d5b209efa4cd5a1a0cf5
// Parent production selector SHA-256: bac2088da00385741a157568687bc2285e182379ff0712f2eee5d5ef4e2edd90
// Revision owner: generic relation compatibility, obligation decomposition, anaphora, and structural candidate acquisition after consumed tenth holdout.
// Runtime module path and V517-named exports are retained as compatibility identifiers.

const STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","by","at","from",
  "is","are","be","been","being","does","do","did","what","when","where","who",
  "how","why","that","this","it","its","they","them","their","if","then","another",
  "already","there","any","has","have","had","must","may","can","will","would",
  "should","could","whether","because","merely","way","up","rather","than"
]);

const PERSON_ACTORS = [
  "speaker","chair","chairperson","clerk","minister","member","members","government"
];

const REFERENT_NOISE = new Set([
  "automatically","apply","applies","asked","asking","ask","say","says","seek","seeks",
  "move","moves","moved","moving","go","goes","going","happen","happens","happening",
  "done","do","does","did","allowed","allow","permitted","permit","required","require",
  "must","may","can","should","would","could","will","only","limit","limitation",
  "limits","exception","exceptions","restriction","restrictions","purpose","time",
  "timing","day","during","without","notice","after","before","once","while","where",
  "who","what","how","which","then","first","second","third","need","needs","leave",
  "later","finally","otherwise","instead","through","whose","general","rule","often",
  "protective","steps","step","avoid","again","separately","not","no"
]);

const DISCOURSE_NOISE = new Set([
  "matter","matters","thing","things","something","anything","there","non","even",
  "later","finally","otherwise","instead","whose","miss","missed","misse"
]);

const QUESTION_META_TERMS = new Set([
  "test","tests","kind","type","form","circumstance","circumstances",
  "power","powers","deadline","right","rights","many","much","number","count",
  "obligation","obligations","force"
]);

const GRAMMATICAL_CARRIER_TERMS = new Set([
  "follow","follows","following","held","hold","taken","take","place","already",
  "despite","order","make","made","occur","occurs","occurred","occurring",
  "was","were"
]);

function isMetaOrCarrierTerm(token) {
  const c = canonicalToken(token);
  return (
    QUESTION_META_TERMS.has(token) ||
    QUESTION_META_TERMS.has(c) ||
    GRAMMATICAL_CARRIER_TERMS.has(token) ||
    GRAMMATICAL_CARRIER_TERMS.has(c)
  );
}

const EVENT_RULES = [
  [/^(conclud|consider|determin|decid|find|control|direct)/, "determine"],
  [/^(?:deal|deals|dealt|dealing)$/, "determine"],
  [/^(?:interpret|interprets|interpreted|interpreting)$/, "interpret"],
  [/^(?:elect|elected|electing|appoint|appointed|appointing|install|installed|installing)$/, "appoint"],
  [/^report/, "report"],
  [/^correct/, "correct"],
  [/^refer/, "refer"],
  [/^transfer/, "transfer"],
  [/^(send|sent)/, "refer"],
  [/^pass/, "pass"],
  [/^present/, "present"],
  [/^lodg/, "lodge"],
  [/^suspend/, "suspend"],
  [/^quot/, "quote"],
  [/^tabl/, "table"],
  [/^(allocat|assign|rout)/, "refer"],
  [/^clos/, "close"],
  [/^mov/, "move"],
  [/^ask/, "ask"],
  [/^(accept|agre|carry|carri|resolv)/, "accept"],
  [/^(release|publish)/, "release"],
  [/^put/, "put"],
  [/^adjourn/, "adjourn"],
  [/^resum/, "resume"],
  [/^withdraw/, "withdraw"],
  [/^rescind/, "rescind"],
  [/^(alter|chang)/, "change"],
  [/^(declin|refus)/, "refuse"],
  [/^notify/, "notify"],
  [/^inform/, "inform"],
  [/^interrupt/, "interrupt"],
  [/^discharg/, "discharge"],
  [/^postpon/, "postpone"],
  [/^vot/, "vote"],
  [/^certif/, "certify"],
  [/^read(?:s|ing)?$/, "read"],
  [/^begin/, "begin"],
  [/^start/, "start"],
  [/^end/, "end"],
];

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}

function canonicalToken(token) {
  const t = normalize(token);
  if (/^(?:sit|sits|sitting|sitt)$/.test(t)) return "sit";

  if (/^(?:give|gave|given|giving)$/.test(t)) return "give";
  if (/^incidents?$/.test(t)) return "matter";

  for (const [pattern, value] of EVENT_RULES) {
    if (pattern.test(t)) return value;
  }
  if (t.length > 5 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

function tokenEquivalent(a, b) {
  const alias = (value) => {
    const canonical = canonicalToken(value);
    // OPEN ORDER F5D0437 APB5: guarded procedural paraphrase equivalence.
    // These are general English expressions of liability and utterance,
    // not authority IDs or preselected answers. Ordinary scope, actor,
    // relation and predicate gates remain responsible for qualification.
    const surface = normalize(value);
    if (/^(?:sue|sues|sued|suing|su|lawsuit|lawsuits)$/.test(surface) ||
        /^liab/.test(surface) || /^liab/.test(canonical)) {
      return "civil_liability";
    }
    if (/^(?:said|say|saying|statement|statements)$/.test(surface) ||
        /^statem/.test(canonical)) {
      return "spoken_statement";
    }
    if (canonical === "speech") return "speak";
    if (canonical === "signatory") return "sign";
    if (canonical === "commence") return "start";
    if (canonical === "suspension") return "suspend";
    if (canonical === "tabling") return "table";
    if (canonical === "conclusion") return "end";
    // Alias the lexical surface before re-canonicalising a previously stemmed token.
    if (/^(?:notif|advis|advic)/.test(normalize(value))) return "notice";
    if (/^responsib/.test(canonical)) return "responsibility";
    if (/^dissatisf/.test(canonical)) return "disagree";
    return canonical;
  };

  const ca = alias(a);
  const cb = alias(b);
  if (ca === cb) return true;
  if (ca.length < 5 || cb.length < 5) return false;
  const prefix = commonPrefixLength(ca, cb);
  const minLength = Math.min(ca.length, cb.length);
  return prefix >= 5 && prefix / minLength >= 0.72;
}

function rawTokens(text) {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function tokenSet(text) {
  return new Set(rawTokens(text).map(canonicalToken));
}

function overlapRatio(left, right) {
  if (left.size === 0) return 0;
  const rightValues = [...right];
  let hit = 0;
  for (const token of left) {
    if (rightValues.some((r) => tokenEquivalent(token, r))) hit += 1;
  }
  return hit / left.size;
}

function unionSets(...sets) {
  const out = new Set();
  for (const set of sets) {
    for (const value of set) out.add(value);
  }
  return out;
}


function actorTerms(text) {
  const q = normalize(text);
  const out = new Set();
  for (const actor of PERSON_ACTORS) {
    if (new RegExp(`\\b${actor}\\b`).test(q)) {
      out.add(actor === "members" ? "member" : actor);
    }
  }
  return out;
}

function actorQualifiers(text) {
  const q = normalize(text);
  const out = new Set();
  for (const actor of PERSON_ACTORS) {
    const singular = actor === "members" ? "member" : actor;
    const patterns = [
      new RegExp(`\\bnot (?:a |an |the )?${actor}\\b`),
      new RegExp(`\\bnon ${actor}\\b`),
      new RegExp(`\\bother than (?:a |an |the )?${actor}\\b`),
      new RegExp(`\\bexcept (?:a |an |the )?${actor}\\b`),
      new RegExp(`\\bunless (?:a |an |the )?${actor}\\b`),
    ];
    if (patterns.some((p) => p.test(q))) out.add(`not:${singular}`);
  }
  return out;
}

function referentTerms(text) {
  const out = new Set();
  const q = normalize(text);
  const individualMember = /\bindividual\s+members?\b/.test(q);
  const redundantAgain = /\bneed not\b.*\bagain\b/.test(q);
  for (const token of rawTokens(text)) {
    const c = canonicalToken(token);
    if (individualMember && c === "individual") continue;
    if (redundantAgain && c === "again") continue;
    if (REFERENT_NOISE.has(token) || REFERENT_NOISE.has(c)) continue;
    if (DISCOURSE_NOISE.has(token) || DISCOURSE_NOISE.has(c)) continue;
    if (PERSON_ACTORS.includes(token) || PERSON_ACTORS.includes(c)) continue;
    if (/^\d+$/.test(c)) continue;
    out.add(c);
  }
  return out;
}

function stateTerms(text) {
  const out = new Set();
  for (const token of rawTokens(text)) {
    const c = canonicalToken(token);
    if (PERSON_ACTORS.includes(token) || PERSON_ACTORS.includes(c)) continue;
    if (DISCOURSE_NOISE.has(token) || DISCOURSE_NOISE.has(c)) continue;
    if (["if","after","before","when","while","once"].includes(c)) continue;
    out.add(c);
  }
  return out;
}


function eventTermsFromText(text) {
  const out = new Set();
  const q = normalize(text);

  for (const token of q.split(" ")) {
    const c = canonicalToken(token);
    if (EVENT_RULES.some(([, value]) => value === c)) out.add(c);
  }

  // "Go to a/select committee" is a routing expression; "go into
  // committee" is a different parliamentary operation and must not be
  // collapsed into referral.
  if (
    /\bgo(?:es|ing)?(?:\s+[a-z][a-z'-]*){0,2}\s+to\s+(?:a\s+|the\s+)?(?:select\s+)?committee\b/.test(q) ||
    /^where\b.*\bgo(?:es|ing)?\b/.test(q)
  ) {
    out.add("refer");
  }

  return out;
}

function stripDescriptiveRelativeClause(text) {
  const q = normalize(text);
  const match = q.match(
    /\b(?:that|who|which)\s+(?:the\s+|a\s+|an\s+)?(?:member|person|speaker|minister|clerk|chair|chairperson|government|party|committee|house)\s+(?!may\b|can\b|must\b|shall\b|will\b|would\b|could\b|should\b)[a-z]+\b/
  );
  if (!match || match.index === undefined) return q;
  return q.slice(0, match.index).trim();
}


function conditionalDispositionInfo(text) {
  const q = normalize(text);
  const match = q.match(
    /^what\s+happens?\s+if\s+(.+?)\s+is\s+(refused|approved)(?:\s*,?\s*including\s+(.+))?$/
  );
  if (!match) return null;
  const target = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    target.add(token);
  }
  if (match[3]) {
    for (const token of referentTerms(match[3])) {
      if (["where"].includes(token)) continue;
      if (isMetaOrCarrierTerm(token)) continue;
      target.add(token);
    }
  }
  return {
    target,
    polarity: match[2] === "refused" ? "negative" : "positive",
  };
}

function dispositionStateRelationTerms(text) {
  const q = normalize(text);
  const out = new Set();
  if (!q) return out;

  const requested = conditionalDispositionInfo(text);
  if (requested) {
    out.add(`disposition:${requested.polarity}`);
    return out;
  }

  const decisiveNegative =
    /\bdecides?\s+against\b/.test(q) ||
    /\b(?:decides?|determines?)\b.{0,120}\bshould\s+not\s+be\b/.test(q);

  const decisivePositive =
    !decisiveNegative &&
    /\b(?:decides?|determines?)\b.{0,120}\bshould\s+be\b/.test(q);

  if (decisiveNegative) out.add("disposition:negative");
  if (decisivePositive) out.add("disposition:positive");

  return out;
}


function namedProcedureIdentity(text) {
  const q = normalize(text);
  const match = q.match(
    /\bunder\s+(?:the\s+)?([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})\s+procedure\b/
  );
  if (!match) return "";
  return match[1].trim();
}

function stateRelationTerms(text) {
  const q = normalize(text);
  const out = new Set();
  if (!q) return out;

  const roles = [
    ["deputy chairperson", "deputy_chairperson"],
    ["chairperson", "chairperson"],
    ["speaker", "speaker"],
    ["clerk", "clerk"],
    ["minister", "minister"],
    ["member", "member"],
    ["committee", "committee"],
    ["house", "house"],
  ];

  for (const [phrase, key] of roles) {
    const escaped = phrase
      .split(" ")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");

    const direct = new RegExp(
      `\\b${escaped}\\b.{0,50}\\b(?:is|are|was|were)\\s+(?:not present|absent)\\b`
    );
    const absence = new RegExp(
      `\\bin the absence of (?:the )?${escaped}\\b`
    );

    if (direct.test(q) || absence.test(q)) {
      out.add(`${key}:absent`);
    }
  }

  const coordinated = q.match(
    /\b(.{0,120}?)\b(?:are|were)\s+(?:not present|absent)\b/
  );
  if (coordinated) {
    const prefix = coordinated[1];
    for (const [phrase, key] of roles) {
      const escaped = phrase
        .split(" ")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      if (new RegExp(`\\b${escaped}\\b`).test(prefix)) {
        out.add(`${key}:absent`);
      }
    }
  }

  return out;
}

function proceduralPassiveStateRelationTerms(text) {
  const q = normalize(text);
  const out = new Set();
  if (!q) return out;

  const patterns = [
    /\b(?:when|if|after|before|once)\s+(?:a|an|the)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})\s+(?:is|are|was|were|has been|have been)\s+([a-z][a-z'-]*)\b/g,
    /\b(?:a|an|the)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})\s+(?:is|are|was|were|has been|have been)\s+([a-z][a-z'-]*)\b/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(q)) !== null) {
      const event = canonicalToken(match[2]);
      if (!EVENT_RULES.some(([, value]) => value === event)) continue;

      for (const token of domainSubjectTerms(match[1])) {
        if (isMetaOrCarrierTerm(token)) continue;
        if (PERSON_ACTORS.includes(token)) continue;
        out.add(`${event}:${token}`);
      }
    }
  }

  return out;
}


function primaryPredicateText(text) {
  const q = stripDescriptiveRelativeClause(text);
  if (!q) return "";

  if (/^(if|after|before|when|while|once)\b/.test(q)) return q;

  const purposeSplit = q
    .split(/\b(?:in order to|for the purpose of)\b/, 1)[0]
    .trim();
  const split = purposeSplit.split(
    /\b(?:before|after|when|while|once|if)\b/,
    1
  );
  return split[0].trim();
}

function predicateObjectTerms(text) {
  const primary = primaryPredicateText(text);
  const refs = referentTerms(primary);
  const events = eventTermsFromText(primary);
  const out = new Set();

  for (const token of refs) {
    if (events.has(token)) continue;
    if (["about","work","still","not","behalf","absent"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function domainSubjectTerms(text) {
  const primary = primaryPredicateText(text);
  const refs = referentTerms(primary);
  const events = eventTermsFromText(primary);
  const out = new Set();

  for (const token of refs) {
    if (isMetaOrCarrierTerm(token)) continue;
    if (events.has(token) && token !== "vote") continue;
    if (
      ["about","work","still","not","no","lost","behalf","absent"].includes(token)
    ) continue;
    out.add(token);
  }

  return out;
}


// The user may state the disputed parliamentary action first, then ask how to
// respond in subjective or diplomatic terms. Those conversational terms must not
// become required statutory/procedural evidence objects for semantic qualification.
// Preserve all other questions unchanged. This does not select an authority.
// V4 generalisation: preserve the contested parliamentary proposition when a
// conversational follow-up asks for a tactic. These transforms change only
// semantic qualification, never the original user question or draft prompt.

function v4ExplicitProceduralCounterEvidence(obligation, result) {
  const corpus = String(result?.documentCorpus ?? "");
  if (!["speakers_rulings", "standing_orders"].includes(corpus)) return 0;
  return negativePowerWitnessScore({
    actor: (obligation?.actorTerms ?? []).join(" "),
    act: (obligation?.predicateEvents ?? []).join(" "),
    source: result?.sectionContent,
  });
}

function v4CommitteeSubmissionsScopeMismatch(obligation, result) {
  const asked = (obligation?.actorTerms ?? []).join(" ") || obligation?.local || "";
  return powerGrantedToDifferentBody(asked, result?.sectionContent ?? "");
}

function obligationFromPart(part, index, plannerRelations) {
  const local = String(part ?? "");
  return {
    index,
    local,
    inherited: "",
    contextual: local,
    referentTerms: [...referentTerms(local)],
    subjectTerms: [...domainSubjectTerms(local)],
    actorTerms: [...actorTerms(local)],
    actorQualifiers: [...actorQualifiers(local)],
    stateTerms: [...stateTerms(local)],
    stateRelationTerms: [],
    contextIdentity: namedProcedureIdentity(local),
    relations: [...plannerRelations],
    predicateEvents: [...eventTermsFromText(local)],
    predicateObjects: [...predicateObjectTerms(local)],
    distributedAnswerFrame: null,
    semanticFrame: null,
    sequenceFromPrior: false,
  };
}

export function deriveObligations(question, plannerRelations, parts) {
  if (!Array.isArray(plannerRelations) || plannerRelations.length === 0) {
    throw new Error("Planner relations are required; question wording cannot choose an obligation path.");
  }
  const facets = Array.isArray(parts) ? parts.map((part) => String(part ?? "").trim()).filter(Boolean) : [];
  const sources = facets.length > 0 ? facets : [String(question ?? "")];
  return sources.map((part, index) => obligationFromPart(part, index, plannerRelations));
}

function relationSignalsForText(text, heading = "") {
  const all = normalize(`${heading} ${text}`);
  const normalizedHeading = normalize(heading);
  const signals = new Set();

  if (/\bmay\b|\bcan\b|\bcannot\b|\bmay not\b|\bmust not\b|\bwill not\b|\bnot permitted\b|\bnot allowed\b|\bnot in order\b|\bout of order\b|\bis entitled\b|\bhas authority\b|\bpermitted\b|\bthere (?:is|are) no\b|\bdoes not permit\b|\bpermission\b.{0,50}\bnot required\b|\b(?:has|have|had|no|without|lacks?)\s+jurisdiction\b/.test(all)) signals.add("permission");

  if (
    /\bmay not\b|\bmust not\b|\bshall not\b|\bcannot\b|\bwill not\b|\bshould not\b|\bis not to\b|\bare not to\b|\bno right\b|\bnot permitted\b|\bnot allowed\b|\bnot in order\b|\bout of order\b|\bdoes not permit\b|\bthere (?:is|are) no\b|\bprohibited\b|\bbarred\b|\b(?:no|without|lacks?)\s+jurisdiction\b/.test(all)
  ) signals.add("prohibition");

  if (
    /\bany member\b|\ba member may\b|\bmembers may\b|\bmember .* may\b/.test(all) ||
    /\b(?:speaker|chair|chairperson|clerk|minister|government|committee|house)\b.{0,40}\b(?:may|must|shall|will|is entitled|are entitled|decides?|determines?|controls?)\b/.test(all) ||
    /\bby (?:the )?(?:speaker|chair|chairperson|clerk|minister|member)\b/.test(all) ||
    /\breferred to (?:the )?(?:speaker|chair|chairperson|clerk|minister)\b.{0,60}\bdecision is final\b/.test(all) ||
    /\bby\b.{0,50}\b(?:are|is) not counted\b/.test(all) ||
    /\b(?:has|have|had|no|without|lacks?)\s+jurisdiction\b/.test(all) ||
    /\bresponsibilit(?:y|ies)\b.{0,80}\b(?:rests?|lies?)\s+with\b/.test(all) ||
    /\b(?:is|are)\s+responsible\b/.test(all) ||
    /\bas (?:the )?(?:speaker|chair|chairperson|clerk|minister|member|committee)\b.{0,40}\b(?:directs?|controls?|determines?|decides?)\b/.test(all) ||
    /\bthrough (?:the )?(?:speaker|chair|chairperson|clerk|minister|member)\b.{0,40}\bmay\b/.test(all) ||
    /\b(?:matter|issue|question)\b.{0,80}\bis for (?:the )?(?:house|speaker|committee|chair|chairperson|minister|member|clerk)\s+to\s+(?:decide|determine)\b/.test(all)
  ) signals.add("actor_scope");

  if (
    /\bmust\b|\bshall\b|\bis required\b|\brequires?\b|\bwill not\b|\breports? to\b|\bstands referred\b|\bwill be (?:given|provided|afforded|allowed)\b|\bis to be (?:given|provided|afforded|allowed)\b|\b(?:committee|speaker|clerk|house|member|person)\s+will\b|\bafter\s+[a-z][a-z'-]*ing\b.{0,80}\bmay\b/.test(all)
  ) {
    signals.add("requirement");
    signals.add("action");
  }

  if (/\bpurpose\b|\bin order to\b|\bto enable\b|\bfor the purpose\b|\bto elucidate\b|\bto clarify\b/.test(all)) signals.add("purpose");

  if (
    /\bstands referred to\b|\bis referred to\b|\breported to\b|\bforwarded to\b|\bsent to\b|\brefers? .* to\b|\bretains? .* for examination\b|\bresum(?:e|es|ed|ing)\s+at\s+the\s+(?:point|place|stage)\b/.test(all)
  ) {
    signals.add("destination");
    signals.add("effect");
  }

  if (
    /\btakes? effect\b|\bhas effect\b|\bof no effect\b|\bdisallowed\b|\btakes precedence\b|\blapses?\b|\bstruck off\b|\bcloses?\b|\bis held\b|\bis adjourned\b|\bis discharged\b|\bset down\b|\bdeclares the result\b|\bdeclares?\b.{0,80}\b(?:elected|appointed|chosen|carried|lost|agreed|resolved)\b|\bis reported\b|\bis presented to\b|\bis published\b|\bno further action will be taken\b|\bout of order\b|\bno question is put\b|\bwill not put\b|\bdoes not stand\b|\bceases?\b|\bbecomes?\b|\bremains?\b|\bexpires?\b|\bproceeds? to\b|\bresum(?:e|es|ed|ing)\b|\breports?\b.{0,40}\bto the house\b|\b(?:is|are|was|were|will be) not [a-z]+(?:ed|en)\b/.test(all) ||
    normalizedHeading.startsWith("effect of ")
  ) signals.add("effect");

  if (
    /\blimits?\b|\blimitations?\b|\bonly\b|\bmay not\b|\bcannot\b|\bshould not\b|\bdoes not permit\b|\bwithout the right to\b|\bmay not participate\b|\bnot include\b|\bsubject always to\b|\bdoes not authori[sz]e\b|\bnot more than\b|\brestricted\b|\bnot counted\b|\bstrictly relevant\b|\bmust be succinct\b|\bmust be concise\b|\bconfined to\b|\bnot contain\b|\bmust not contain\b|\bshall not refer\b/.test(all)
  ) signals.add("limit");

  if (/\bexcept\b|\bexception\b|\bunless\b|\bdoes not apply\b|\bother than\b|\bbut not\b|\bdespite\b|\bnot required (?:where|if)\b/.test(all)) signals.add("exception");

  if (
    /\bnothing\b.{0,80}\brequires?\b|\bneed not\b|\bneeds? not\b|\b(?:is|are|was|were) not required to\b|\bdo(?:es)? not need to\b|\bdoes not require\b|\bdoes not stand referred\b/.test(all)
  ) signals.add("requirement_exclusion");

  if (
    /\bmust state\b|\bmust indicate\b|\bmust specify\b|\bmust include\b|\bmust (?:be|have)\b.{0,40}\b(?:asked|inserted|included|stated|specified|provided|contained|supplied)\b|\binclude .* appendix\b|\bas an appendix\b|\bcertificate.*must\b|\bcontains?\b|\bstate the ground\b|\bclaiming to\b|\brequesting to\b|\bgive consideration\b/.test(all)
  ) signals.add("content");

  if (
    /\b\d+(?:\.\d+)?\b/.test(all) ||
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|percent|once|twice)\b/.test(all)
  ) signals.add("quantity");

  if (
    /\bis for \d+(?:\.\d+)? (?:minutes?|hours?|days?|weeks?|months?|years?)\b/.test(all) ||
    /\bis for (?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|twenty eight|thirty) (?:minutes?|hours?|days?|weeks?|months?|years?)\b/.test(all) ||
    /\bfor \d+(?:\.\d+)? (?:minutes?|hours?|days?|weeks?|months?|years?)\b|\b\d+(?:\.\d+)? (?:minutes?|hours?|days?|weeks?|months?|years?)\b|\bperiod of\b|\buntil\b/.test(all)
  ) signals.add("duration");

  if (
    /\brelating to\b|\bconnected with\b|\blimited to\b|\bmay raise\b|\bmay include\b|\bmay cover\b|\bin respect of\b/.test(all)
  ) signals.add("scope");

  if (
    /\bnot whether\b|\bnot merely because\b|\bdoes not of itself\b|\bnot of itself\b/.test(all)
  ) signals.add("criterion_exclusion");

  if (
    /\bgrounds?\b|\bcriteria\b|\bcriterion\b|\bfactors?\b|\bon the basis of\b|\bwhether .* ought to\b|\bsatisfied that\b|\btakes? account of\b|\btakes? into account\b|\bhas regard to\b|\bhaving regard to\b|\bbalances?\b/.test(all)
  ) signals.add("criteria");

  if (
    /\bif\b|\bonly if\b|\bunless\b|\bin the case of\b|\bin accordance with\b|\bin the event of\b|\bprovided that\b|\bsubject to\b|\bwithout (?:the )?(?:authority|permission)\b|\bafter\s+[a-z][a-z'-]*ing\b|\bmay\b.{0,80}\bany\b.{0,80}\bwhich\b/.test(all)
  ) signals.add("condition");

  if (/\bwhen\b|\bbefore\b|\bafter\b|\bfollowing\b|\bwithin\b|\bby\b|\bfrom\b|\buntil\b|\bmoments?\b|\bday\b|\bhour\b|\btime\b|\bawaiting\b|\bearliest opportunity\b/.test(all)) signals.add("timing");

  if (
    normalizedHeading.includes("procedure") ||
    normalizedHeading.includes("lodging") ||
    normalizedHeading.includes("presentation") ||
    normalizedHeading.includes("application") ||
    /\bis lodged\b|\bis presented\b|\bmoves? that\b|\ba motion may be moved\b|\bmay apply\b.{0,60}\bin writing\b|\bmay invite\b.{0,80}\bauthori[sz]e\b|\bmust give\b|\bnotice\b/.test(all)
  ) signals.add("procedure");

  if (/\bon behalf of\b|\bact for\b|\bsubstitute for\b/.test(all)) signals.add("representation");

  if (
    /\bmay refer\b.{0,80}\bfor decision\b|\bappeal\b|\breview\b|\breconsider\b/.test(all)
  ) signals.add("review");

  if (/\b(?:may|must|shall)\b/.test(all) && /\b(?:move|apply|table|notify)\b/.test(all)) signals.add("method");

  if (
    /\bapplies? despite\b|\bdespite\b.{0,80}\bcontrary\b|\btakes precedence\b|\bprevails? over\b|\boverrides?\b|\bnotwithstanding\b/.test(all)
  ) signals.add("override");

  signals.add("rule");
  return signals;
}

function authorityRelationSignals(result) {
  const heading = result.heading ?? "";
  const path = (result.path ?? []).join(" ");
  const body = result.sectionContent ?? "";
  return relationSignalsForText(`${path} ${body}`, heading);
}

function authoritySegments(result) {
  const heading = String(result.heading ?? "").trim();
  const body = String(result.sectionContent ?? "");
  const rawChunks = body
    .split(/(?<=[.;:])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);

  if (rawChunks.length === 0) return [heading || body];

  const chunks = [];
  let listLead = "";

  for (const chunk of rawChunks) {
    const isLetterBullet = /^\(?[a-z]\)\s+/i.test(chunk);

    if (isLetterBullet && listLead) {
      chunks.push(`${listLead} ${chunk}`.trim());
      continue;
    }

    if (/[—–-]\s*$/.test(chunk)) {
      listLead = chunk;
      chunks.push(chunk);
      continue;
    }

    listLead = "";
    chunks.push(chunk);
  }

  return chunks.map((chunk) => `${heading} ${chunk}`.trim());
}

function relationBindingClauses(segment) {
  const normalized = normalize(segment);
  if (!normalized) return [];

  const clauses = normalized
    .split(
      /,\s+(?:and\s+)?(?=(?:[a-z][a-z'-]*\s+){0,4}(?:may|must|shall|can|cannot|will|does|do|is|are|stands?|becomes?|remains?|ceases?)\b)|\s+and\s+(?=(?:may|must|shall|can|cannot|will|does|do|is|are|stands?|becomes?|remains?|ceases?)\b)/
    )
    .map((part) => part.trim())
    .filter(Boolean);

  if (clauses.length <= 1) return clauses.length > 0 ? clauses : [normalized];

  if (/^(?:if|when|after|before|while|once)\b/.test(clauses[0])) {
    const condition = clauses[0];
    return [
      condition,
      ...clauses.slice(1).map((clause) => `${condition} ${clause}`.trim()),
    ];
  }

  return clauses;
}

function bodyClauseForBinding(clause, heading) {
  let normalizedClause = normalize(clause);
  const normalizedHeading = normalize(heading);
  if (
    normalizedHeading &&
    normalizedClause.startsWith(normalizedHeading + " ")
  ) {
    normalizedClause = normalizedClause
      .slice(normalizedHeading.length + 1)
      .trim();
  }
  return normalizedClause.replace(/^\d+\s+/, "").trim();
}

function relationClausePredicateFit(obligation, clause) {
  const requiredEvents = obligation.predicateEvents ?? [];
  const requiredObjects = obligation.predicateObjects ?? [];

  const clauseEvents = [...eventTermsFromText(clause)];
  const eventFit =
    requiredEvents.length === 0 ? 1 : setFit(requiredEvents, clauseEvents);
  const objectFit =
    requiredObjects.length === 0
      ? 1
      : semanticSetFit(requiredObjects, clause);

  if (requiredEvents.length > 0 && requiredObjects.length > 0) {
    return Math.sqrt(eventFit * objectFit);
  }
  if (requiredEvents.length > 0) return eventFit;
  if (requiredObjects.length > 0) return objectFit;
  return 1;
}


function modalActorTerms(text) {
  const q = normalize(text);
  const out = new Set();
  const pattern =
    /\b(speaker|chairperson|chair|clerk|minister|member|committee|house|government)\b(?:\s+[a-z][a-z'-]*){0,14}\s+\b(?:may|must|shall|can|will)\b/g;
  let match;
  while ((match = pattern.exec(q)) !== null) {
    out.add(canonicalToken(match[1]));
  }
  return out;
}

function modalActionEventTerms(text) {
  const q = normalize(text);
  const out = new Set();
  const pattern = /\b(?:may|must|shall|can|will)\b((?:\s+[a-z0-9][a-z0-9'-]*){1,20})/g;
  let match;
  while ((match = pattern.exec(q)) !== null) {
    for (const event of eventTermsFromText(match[1])) out.add(event);
  }
  return out;
}

function requestedRelationSupported(obligation, relation, signals) {
  if (signals.has(relation)) return true;
  if (relation === "permission") {
    if (signals.has("prohibition")) return true;
    if (
      (obligation.relations ?? []).includes("requirement") &&
      signals.has("requirement")
    ) return true;
  }
  return false;
}

function boundEvidenceProfile(obligation, result) {
  const requiredEvents = obligation.predicateEvents ?? [];
  const requiredObjects = obligation.predicateObjects ?? [];
  const requiredSubjects = obligation.subjectTerms ?? [];
  const requiredRelations = obligation.relations ?? [];
  const requiredQualifiers = obligation.actorQualifiers ?? [];
  const requiredActors = obligation.actorTerms ?? [];

  let predicateFit = requiredEvents.length === 0 && requiredObjects.length === 0 ? 1 : 0;
  let subjectFit = requiredSubjects.length === 0 ? 1 : 0;
  let boundQualifierFit = requiredQualifiers.length === 0 ? 1 : 0;
  const relationSupportByType = Object.fromEntries(
    requiredRelations.map((relation) => [relation, 0])
  );
  let bestSegment = "";
  let bestSubjectSegment = "";
  const bestRelationClauseByType = Object.fromEntries(
    requiredRelations.map((relation) => [relation, ""])
  );

  for (const segment of authoritySegments(result)) {
    const segmentEvents = [...eventTermsFromText(segment)];
    const eventFit = requiredEvents.length === 0
      ? 1
      : setFit(requiredEvents, segmentEvents);

    const objectFit = requiredObjects.length === 0
      ? 1
      : semanticSetFit(requiredObjects, segment);

    const localPredicateFit =
      requiredEvents.length > 0 && requiredObjects.length > 0
        ? Math.sqrt(eventFit * objectFit)
        : requiredEvents.length > 0
          ? eventFit
          : requiredObjects.length > 0
            ? objectFit
            : 1;

    const localSubjectFit = requiredSubjects.length === 0
      ? 1
      : semanticSetFit(requiredSubjects, segment);

    const segmentActors = semanticSetFit(requiredActors, segment);
    const segmentQualifiers = [...actorQualifiers(segment)];
    const qualifierFit = setFit(requiredQualifiers, segmentQualifiers);

    if (localPredicateFit > predicateFit) {
      predicateFit = localPredicateFit;
      bestSegment = segment;
    }

    if (localSubjectFit > subjectFit) {
      subjectFit = localSubjectFit;
      bestSubjectSegment = segment;
    }

    // Critical v4.4 change:
    // Relation cues are bound only within the microclause that carries the
    // requested procedural predicate. A modal in a sibling clause may not
    // borrow an earlier mention of that predicate.
    for (const clause of relationBindingClauses(segment)) {
      const bindingClause = bodyClauseForBinding(
        clause,
        result.heading ?? ""
      );
      // v4.8 invariant:
      // A heading may disambiguate the identity of a body clause, but it may
      // not create that identity ex nihilo. The body clause itself must carry
      // at least one witness for the requested subject/predicate before the
      // heading is allowed to strengthen the anchor.
      //
      // This prevents, for example, "Application for urgent debate" from
      // turning an unrelated written-statement deadline into timing evidence
      // about when the debate itself is held, while still allowing headings
      // such as "Financial veto certificate" to disambiguate a body clause
      // that actually says "the certificate must state ...".
      const bodyPredicateFit = relationClausePredicateFit(
        obligation,
        bindingClause
      );
      const bodySubjectFit =
        requiredSubjects.length === 0
          ? 1
          : semanticSetFit(requiredSubjects, bindingClause);

      const bodyHasIdentityWitness =
        bodyPredicateFit > 0 || bodySubjectFit > 0;

      const anchorClause = normalize(
        `${result.heading ?? ""} ${bindingClause}`
      );
      const headingAssistedPredicateFit = relationClausePredicateFit(
        obligation,
        anchorClause
      );
      const headingAssistedSubjectFit =
        requiredSubjects.length === 0
          ? 1
          : semanticSetFit(requiredSubjects, anchorClause);

      const clauseAnchor = bodyHasIdentityWitness
        ? Math.min(
            headingAssistedPredicateFit,
            headingAssistedSubjectFit
          )
        : 0;

      const clauseSignals = relationSignalsForText(
        bindingClause,
        ""
      );

      for (const relation of requiredRelations) {
        if (!requestedRelationSupported(obligation, relation, clauseSignals)) continue;

        let relationAnchor = clauseAnchor;
        if (
          relation === "effect" &&
          (obligation.stateTerms ?? []).length > 0
        ) {
          const clauseStateFit = semanticSetFit(
            obligation.stateTerms,
            anchorClause
          );
          relationAnchor *= clauseStateFit;
        }

        if (
          relation === "condition" &&
          (obligation.actorTerms ?? []).length > 0
        ) {
          const clauseActorFit = setFit(
            obligation.actorTerms,
            [...modalActorTerms(bindingClause)]
          );
          relationAnchor *= clauseActorFit;
        }

        if (
          obligation.semanticFrame === "open_action" &&
          ["requirement", "action"].includes(relation) &&
          (obligation.actorTerms ?? []).length > 0
        ) {
          const modalActors = [...modalActorTerms(bindingClause)];
          if (modalActors.length > 0) {
            relationAnchor *= setFit(
              obligation.actorTerms,
              modalActors
            );
          }
        }

        if (
          obligation.semanticFrame === "actor_action" &&
          ["permission", "actor_scope"].includes(relation) &&
          (obligation.predicateEvents ?? []).length > 0
        ) {
          relationAnchor *= setFit(
            obligation.predicateEvents,
            [...modalActionEventTerms(bindingClause)]
          );
        }

        const current = relationSupportByType[relation] ?? 0;
        if (relationAnchor > current) {
          relationSupportByType[relation] = relationAnchor;
          bestRelationClauseByType[relation] = bindingClause;
        }
      }
    }

    if (requiredQualifiers.length > 0) {
      // Qualification remains bound to the procedural predicate at segment
      // scope because actor qualifications can grammatically govern an entire
      // compound predicate ("a member who is not a Minister may move ...").
      boundQualifierFit = Math.max(
        boundQualifierFit,
        localPredicateFit * qualifierFit * segmentActors
      );
    }
  }

  const wholeBody = String(result.sectionContent ?? "");
  const wholeAuthority = `${result.heading ?? ""} ${wholeBody}`;
  const wholeSignals = relationSignalsForText(
    wholeBody,
    result.heading ?? ""
  );
  const distributedSubjectFit =
    requiredSubjects.length === 0
      ? 1
      : semanticSetFit(requiredSubjects, wholeBody);
  const distributedPredicateFit =
    relationClausePredicateFit(obligation, wholeBody);

  let usedDistributedBinding = false;

  for (const relation of requiredRelations) {
    const strongOutcomeLanguage =
      /\btakes? effect\b|\bhas effect\b|\bof no effect\b|\bis disallowed\b|\bdisallowed\b|\bis discharged\b|\bstands discharged\b|\bstands referred\b|\bis presented to\b|\bis published\b|\bno further action will be taken\b|\bout of order\b|\bno question is put\b/.test(
        normalize(wholeBody)
      );

    const wholeBodyModalActorFit =
      requiredActors.length === 0
        ? 1
        : setFit(requiredActors, [...modalActorTerms(wholeBody)]);

    const actorBoundOpenAction =
      obligation.semanticFrame === "open_action" &&
      requiredActors.length > 0 &&
      wholeBodyModalActorFit >= 1;

    const allowDistributedBinding =
      relation === "criteria" ||
      relation === "limit" ||
      relation === "prohibition" ||
      relation === "duration" ||
      relation === "override" ||
      relation === "representation" ||
      (
        relation === "content" &&
        ["content_answer", "enumerated_content_answer"].includes(
          obligation.semanticFrame
        )
      ) ||
      (
        ["requirement", "action", "condition"].includes(relation) &&
        obligation.semanticFrame === "normative_obligation"
      ) ||
      (
        ["requirement", "action"].includes(relation) &&
        actorBoundOpenAction
      ) ||
      (
        relation === "condition" &&
        ["attendance_condition", "permission_condition", "go_into_committee_condition", "constraint_bundle"].includes(
          obligation.semanticFrame
        )
      ) ||
      (
        relation === "requirement" &&
        obligation.semanticFrame === "constraint_bundle"
      ) ||
      (
        relation === "permission" &&
        obligation.semanticFrame === "permission_condition"
      ) ||
      (
        relation === "effect" &&
        (
          normalize(result.heading ?? "").startsWith("effect of ") ||
          strongOutcomeLanguage
        )
      );

    if (
      !allowDistributedBinding ||
      !requestedRelationSupported(obligation, relation, wholeSignals)
    ) {
      continue;
    }

    let distributedAnchor = Math.min(
      distributedSubjectFit,
      distributedPredicateFit
    );

    if (
      ["requirement", "action"].includes(relation) &&
      actorBoundOpenAction
    ) {
      distributedAnchor *= wholeBodyModalActorFit;
    }

    if (
      relation === "effect" &&
      (obligation.stateTerms ?? []).length > 0
    ) {
      distributedAnchor *= semanticSetFit(
        obligation.stateTerms,
        wholeAuthority
      );
    }

    if (distributedAnchor > (relationSupportByType[relation] ?? 0)) {
      relationSupportByType[relation] = distributedAnchor;
      bestRelationClauseByType[relation] = wholeBody;
      usedDistributedBinding = true;
    }
  }

  if (usedDistributedBinding) {
    subjectFit = Math.max(subjectFit, distributedSubjectFit);
    predicateFit = Math.max(predicateFit, distributedPredicateFit);
  }

  // OPEN ORDER F5D0437 APB4: a grounded denial answers a permission question.
  // A prohibition, lack of authority, or rejection of a proposed ground is
  // responsive to 'may/can X do Y?'. This is NOT a generic permission boost:
  // require a negative normative expression in the SOURCE BODY, and both the
  // requested subject and predicate within the SAME clause. No heading bridge.
  if (requiredRelations.length === 1 &&
      requiredRelations[0] === "permission" &&
      (relationSupportByType.permission ?? 0) < 0.28) {
    const body = String(result.sectionContent ?? "");
    const clauses = body.split(/[.!?]\s+/).map((c) => c.trim()).filter(Boolean);
    for (const clause of clauses) {
      const normalizedClause = normalize(clause);
      const explicitDenial =
        /\b(?:cannot|can not|may not|must not|shall not|no (?:authority|right|power|entitlement)|not (?:a|an|sufficient) ground|is not permitted|are not permitted|is not entitled|are not entitled)\b/.test(normalizedClause);
      if (!explicitDenial) continue;
      const clauseBody = bodyClauseForBinding(clause, result.heading ?? "");
      const clausePredicateFit = relationClausePredicateFit(obligation, clauseBody);
      const clauseSubjectFit = requiredSubjects.length === 0
        ? 1 : semanticSetFit(requiredSubjects, clauseBody);
      if (clausePredicateFit < 0.28 || clauseSubjectFit < 0.28) continue;
      const denialSupport = Math.min(clausePredicateFit, clauseSubjectFit);
      if (denialSupport > (relationSupportByType.permission ?? 0)) {
        relationSupportByType.permission = denialSupport;
        bestRelationClauseByType.permission = clauseBody;
      }
    }
  }

  const relationValues = Object.values(relationSupportByType);
  const boundRelationFit =
    relationValues.length === 0
      ? 1
      : relationValues.reduce((sum, value) => sum + value, 0) /
        relationValues.length;

  return {
    predicateFit,
    subjectFit,
    boundRelationFit,
    relationSupportByType,
    bestRelationClauseByType,
    boundQualifierFit,
    bestSegment,
    bestSubjectSegment,
  };
}

function setFit(requiredValues, presentValues) {
  if (requiredValues.length === 0) return 1;
  const present = new Set(presentValues);
  let hit = 0;
  for (const value of requiredValues) {
    if (present.has(value)) hit += 1;
  }
  return hit / requiredValues.length;
}

function semanticSetFit(requiredValues, text) {
  if (requiredValues.length === 0) return 1;
  return overlapRatio(new Set(requiredValues), tokenSet(text));
}

function authorityEventTerms(result) {
  const all = normalize(`${result.heading ?? ""} ${(result.path ?? []).join(" ")} ${result.sectionContent ?? ""}`);
  return eventTermsFromText(all);
}

function authorityTransitionInputEvents(result) {
  const text = normalize(result.sectionContent ?? "");
  const words = text.split(" ");
  const prefix = words.slice(0, Math.max(12, Math.ceil(words.length * 0.55))).join(" ");
  return eventTermsFromText(prefix);
}

function authorityTransitionOutputEvents(result) {
  const text = normalize(result.sectionContent ?? "");
  const words = text.split(" ");
  const suffix = words.slice(Math.floor(words.length * 0.25)).join(" ");
  return eventTermsFromText(suffix);
}

function authorityReferentProfile(result) {
  return {
    heading: referentTerms(result.heading ?? ""),
    path: referentTerms((result.path ?? []).join(" ")),
    body: referentTerms(result.sectionContent ?? ""),
  };
}

function querySupport(obligation, candidate) {
  const obligationTokens = tokenSet(obligation.contextual);
  let best = 0;
  for (const source of candidate.sources) {
    if (source.kind === "structural_adjacent") continue;
    const provenanceWeight =
      source.provenance === "planner" ? 1.0 :
      source.provenance === "user_term" ? 0.9 : 0.5;
    const positionWeight = source.position <= 10 ? 1.0 : 0.72;
    best = Math.max(
      best,
      overlapRatio(obligationTokens, tokenSet(source.query)) *
        provenanceWeight *
        positionWeight
    );
  }
  return best;
}

function asksForInterpretation(question) {
  return /\b(ruling|rulings|precedent|precedents|interpreted|interpretation|practice|has the speaker ruled|how has the speaker)\b/i.test(
    question
  );
}

// A requirement to answer a question directly can rebut an asserted freedom
// to evade it. This is an explicit textual entailment, not a relaxed lexical
// threshold: only a requirement about the adequacy of replies to questions,
// scoped to the same parliamentary actor, can activate it.
function explicitDirectReplyRequirement() {
  return 0;
}
function v4EvidenceProfile(obligation, fullQuestion, candidate) {
  const result = candidate.result;
  const authorityRef =
    obligation.semanticFrame === "notice_failure"
      ? {
          heading: tokenSet(result.heading ?? ""),
          path: tokenSet((result.path ?? []).join(" ")),
          body: tokenSet(result.sectionContent ?? ""),
        }
      : authorityReferentProfile(result);
  const requiredRef = new Set(obligation.referentTerms);

  const referentHeading = overlapRatio(requiredRef, authorityRef.heading);
  const referentPath = overlapRatio(requiredRef, authorityRef.path);
  const referentBody = overlapRatio(requiredRef, authorityRef.body);

  const relationSignals = authorityRelationSignals(result);
  const bound = boundEvidenceProfile(obligation, result);

  // Once the authority body itself contains the complete requested referent
  // and the bound body clause directly satisfies the requested proposition,
  // absence of that referent from the heading must not discount the authority.
  // Headings may disambiguate identity; they must not outrank a direct body answer.
  const boundBodyPropositionComplete =
    referentBody >= 0.999 &&
    bound.subjectFit >= 0.95 &&
    bound.boundRelationFit >= 0.95 &&
    (
      obligation.predicateEvents.length === 0 &&
      obligation.predicateObjects.length === 0
        ? true
        : bound.predicateFit >= 0.95
    );

  const referentFit = boundBodyPropositionComplete
    ? 1
    : Math.max(
        referentHeading,
        referentPath * 0.94,
        referentBody * 0.82
      );

  const routeFitForBinding = querySupport(obligation, candidate);
  const hasPredicateForBinding =
    obligation.predicateEvents.length > 0 ||
    obligation.predicateObjects.length > 0;
  const wholeBodyAnswerAnchor = Math.min(
    requiredRef.size === 0 ? 1 : referentBody,
    obligation.subjectTerms.length === 0 ? 1 : bound.subjectFit,
    hasPredicateForBinding ? bound.predicateFit : 1
  );
  const anchoredGlobalRelationSupport =
    routeFitForBinding >= 0.18 &&
    wholeBodyAnswerAnchor >= 0.28
      ? Math.min(1, 0.55 + wholeBodyAnswerAnchor * 0.45)
      : 0;

  const relationSupportByType = {};
  for (const relation of obligation.relations) {
    const globalSignal =
      requestedRelationSupported(obligation, relation, relationSignals) ? 1 : 0;
    const boundSignal = bound.relationSupportByType[relation] ?? 0;
    const boundWithGlobal =
      boundSignal * 0.86 + globalSignal * 0.14;
    const wholeAuthorityRelationAllowed =
      ["actor_scope", "requirement", "action"].includes(relation) ||
      (
        relation === "permission" &&
        (obligation.relations ?? []).includes("requirement")
      ) ||
      (
        relation === "effect" &&
        ["stage_effect", "trigger_effect"].includes(obligation.semanticFrame)
      ) ||
      (
        relation === "procedure" &&
        obligation.semanticFrame === "report_lifecycle"
      );
    const anchoredGlobal =
      globalSignal > 0 &&
      (wholeAuthorityRelationAllowed || boundSignal > 0)
        ? (
            wholeAuthorityRelationAllowed
              ? anchoredGlobalRelationSupport
              : anchoredGlobalRelationSupport * boundSignal
          )
        : 0;
    relationSupportByType[relation] = Math.max(
      0,
      Math.min(1, Math.max(boundWithGlobal, anchoredGlobal))
    );
  }

  const relationValues = Object.values(relationSupportByType);
  const relationFit =
    relationValues.length === 0
      ? 1
      : relationValues.reduce((sum, value) => sum + value, 0) /
        relationValues.length;

  const allText = `${result.heading ?? ""} ${(result.path ?? []).join(" ")} ${result.sectionContent ?? ""}`;
  const actorFit = semanticSetFit(obligation.actorTerms, allText);
  const authorityQualifiers = [...actorQualifiers(allText)];
  const globalActorQualifierFit = setFit(obligation.actorQualifiers, authorityQualifiers);
  const actorQualifierFit =
    obligation.actorQualifiers.length > 0
      ? bound.boundQualifierFit
      : globalActorQualifierFit;
  const stateFit = semanticSetFit(obligation.stateTerms, allText);
  const requiredStateRelations = obligation.stateRelationTerms ?? [];
  const authorityStateRelations = [
    ...unionSets(
      stateRelationTerms(allText),
      proceduralPassiveStateRelationTerms(allText),
      dispositionStateRelationTerms(allText)
    ),
  ];
  const stateRelationFit =
    requiredStateRelations.length === 0
      ? 1
      : setFit(requiredStateRelations, authorityStateRelations);
  const contextIdentityFit =
    obligation.contextIdentity
      ? (
          normalize(allText).includes(normalize(obligation.contextIdentity))
            ? 1
            : 0
        )
      : 1;

  const routeFit = routeFitForBinding;
  const interpretationDemand = asksForInterpretation(fullQuestion);
  const sourceDirectness =
    result.documentCorpus === "standing_orders"
      ? 1.0
      : interpretationDemand
        ? 0.92
        : 0.50;

  const structuralOnly =
    candidate.sources.every((source) => source.kind === "structural_adjacent");

  const hasPredicate =
    obligation.predicateEvents.length > 0 ||
    obligation.predicateObjects.length > 0;

  const enumeratedContentFrame =
    obligation.semanticFrame === "enumerated_content_answer";
  const referentGate =
    requiredRef.size === 0 ||
    referentFit >= (enumeratedContentFrame ? 0.28 : 0.34);
  const stateGate =
    obligation.stateTerms.length === 0 || stateFit >= 0.34;
  const stateRelationGate =
    (obligation.stateRelationTerms ?? []).length === 0 ||
    stateRelationFit >= 0.50;
  const contextIdentityGate =
    !obligation.contextIdentity || contextIdentityFit >= 1;
  const predicateGate =
    !hasPredicate || bound.predicateFit >= 0.28;
  const subjectGate =
    obligation.subjectTerms.length === 0 || bound.subjectFit >= 0.28;
  // OPEN ORDER F5D0437 APB2: permission and timing must both be evidenced.
  // A source permitting an action is not, by that fact alone, evidence that
  // the action remains available at the specific procedural stage asked about.
  // Keep all existing thresholds; require distinct temporal support only when
  // the obligation explicitly demands BOTH permission and timing.
  const relationGate =
    obligation.relations.length === 0 ||
    (obligation.relations.includes("permission") && obligation.relations.includes("timing")
      ? ["permission", "timing"].every(
          (relation) => (relationSupportByType[relation] ?? 0) >= 0.28
        )
      : Object.values(relationSupportByType).some((value) => value >= 0.28));
  const qualifierGate =
    obligation.actorQualifiers.length === 0 || actorQualifierFit >= 0.35;

  const coreEligible =
    referentGate &&
    stateGate &&
    stateRelationGate &&
    contextIdentityGate &&
    predicateGate &&
    subjectGate &&
    relationGate;

  const qualificationEligible =
    coreEligible && qualifierGate;

  const eligible = qualificationEligible;
  const directReplyEntailment = Math.max(
    explicitDirectReplyRequirement(obligation, result),
    v4ExplicitProceduralCounterEvidence(obligation, result)
  );
  const scopeMismatch = v4CommitteeSubmissionsScopeMismatch(obligation, result);

  const lexicalFit = Math.max(
    0,
    Math.min(
      1,
      referentFit * 0.32 +
        relationFit * 0.22 +
        bound.predicateFit * 0.14 +
        bound.subjectFit * 0.10 +
        stateFit * (obligation.stateTerms.length > 0 ? 0.08 : 0) +
        routeFit * 0.06 +
        sourceDirectness * 0.06 +
        actorFit * 0.03 +
        actorQualifierFit * 0.05 -
        (structuralOnly ? 0.045 : 0)
    )
  );

  return {
    eligible: !scopeMismatch && eligible,
    coreEligible: !scopeMismatch && coreEligible,
    qualificationEligible: !scopeMismatch && qualificationEligible,
    referentFit: Math.max(referentFit, directReplyEntailment),
    referentHeading,
    referentPath,
    referentBody,
    subjectFit: Math.max(bound.subjectFit, directReplyEntailment),
    subjectTerms: obligation.subjectTerms,
    relationFit: Math.max(relationFit, directReplyEntailment),
    relationSupportByType: directReplyEntailment > 0 ? {...relationSupportByType, permission: Math.max(relationSupportByType.permission ?? 0, directReplyEntailment)} : relationSupportByType,
    bestRelationClauseByType: bound.bestRelationClauseByType,
    boundRelationFit: Math.max(bound.boundRelationFit, directReplyEntailment),
    predicateFit: Math.max(bound.predicateFit, directReplyEntailment),
    predicateEvents: obligation.predicateEvents,
    predicateObjects: obligation.predicateObjects,
    bestPredicateSegment: bound.bestSegment,
    bestSubjectSegment: bound.bestSubjectSegment,
    relationSignals: [...relationSignals],
    actorFit,
    actorQualifierFit,
    globalActorQualifierFit,
    authorityQualifiers,
    stateFit,
    stateRelationFit,
    contextIdentityFit,
    routeFit,
    sourceDirectness,
    structuralOnly,
    lexicalFit: Math.max(lexicalFit, directReplyEntailment),
    authorityEvents: [...authorityEventTerms(result)],
    transitionInputEvents: [...authorityTransitionInputEvents(result)],
    transitionOutputEvents: [...authorityTransitionOutputEvents(result)],
  };
}

function addCandidate(map, result, source) {
  const key = result.sectionId;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      result,
      maxRank: result.rank,
      sources: [source],
    });
    return;
  }
  existing.maxRank = Math.max(existing.maxRank, result.rank);
  existing.sources.push(source);
  if (result.rank > existing.result.rank) existing.result = result;
}

function parseStandingOrderNumber(label) {
  const match = /^SO\s+(\d+)$/.exec(String(label ?? "").trim());
  return match ? Number(match[1]) : null;
}

function structuralCoherence(a, b) {
  if (
    a.result.documentCorpus !== "standing_orders" ||
    b.result.documentCorpus !== "standing_orders"
  ) return 0;

  const aNum = parseStandingOrderNumber(a.result.citationLabel);
  const bNum = parseStandingOrderNumber(b.result.citationLabel);
  if (aNum === null || bNum === null) return 0;

  const distance = Math.abs(aNum - bNum);
  if (distance === 1) return 0.045;
  if (distance <= 3) return 0.015;
  return 0;
}

function transitionCoherence(leftProfile, rightProfile, leftCandidate, rightCandidate) {
  if (leftCandidate.result.sectionId === rightCandidate.result.sectionId) return 0;

  const leftEvents = new Set(leftProfile.transitionOutputEvents);
  const rightEvents = new Set(rightProfile.transitionInputEvents);
  const eventBridge = overlapRatio(leftEvents, rightEvents);

  const leftRef = authorityReferentProfile(leftCandidate.result);
  const rightRef = authorityReferentProfile(rightCandidate.result);
  const leftRefAll = unionSets(leftRef.heading, leftRef.path, leftRef.body);
  const rightRefAll = unionSets(rightRef.heading, rightRef.path, rightRef.body);
  const referentBridge =
    leftRefAll.size === 0 || rightRefAll.size === 0
      ? 0
      : Math.max(
          overlapRatio(leftRefAll, rightRefAll),
          overlapRatio(rightRefAll, leftRefAll)
        );

  if (eventBridge <= 0) return 0;
  return Math.min(1, eventBridge * 0.72 + referentBridge * 0.28);
}

// OPEN ORDER APB13.1: source-body normative evidence may answer an ostensibly
// permissive question by imposing a prohibition, restriction or timing rule.
// This only rescues a candidate that the earlier lexical permission evaluator
// rejected; it never overrides an explicit scope mismatch or absent body.
// The clause must support the procedural object, not merely share a heading.
function v131MeaningfulTokens(value) {
  const stops = new Set([
    "a","an","the","to","of","in","on","at","for","from","that","this",
    "is","was","were","be","been","being","do","does","did","can","could",
    "may","would","will","must","shall","should","it","i","we","you","they",
    "their","he","she","his","her","its","about","what","when","where",
    "why","whether","there","which","who","with","by","if","so","or",
    "and","as","some","any","more","one","another","something","simply",
    "because","believe","believes","believed","result","wrong","member",
    "members","house","parliament","today","yesterday","before","after",
    "said","saying","say","sitting","sittings","committee","government"
  ]);
  const canonical = (word) => {
    if (word === "heard") return "hear";
    if (word === "raised" || word === "raising" || word === "raise") return "rais";
    if (word === "points") return "point";
    if (word === "submissions") return "submission";
    if (word === "issues") return "issue";
    if (word.length > 5 && word.endsWith("ies")) return word.slice(0,-3)+"y";
    if (word.length > 5 && word.endsWith("ing")) return word.slice(0,-3);
    if (word.length > 5 && word.endsWith("ed")) return word.slice(0,-2);
    if (word.length > 4 && word.endsWith("s")) return word.slice(0,-1);
    if (word.length > 4 && word.endsWith("e")) return word.slice(0,-1);
    return word;
  };
  return new Set(String(value ?? "").toLowerCase().match(/[a-z]{3,}/g)?.map(canonical)
    .filter((token) => token.length > 2 && !stops.has(token)) ?? []);
}
function v131NormativeEvidenceProfile(obligation, question, candidate) {
  const profile = v4EvidenceProfile(obligation, question, candidate);
  if (profile.eligible || profile.coreEligible || profile.qualificationEligible) return profile;
  if (!obligation.relations?.includes("permission") ||
      !/^(?:can|may|could|does|do|is it permissible|is it possible)\b/i.test(String(obligation.local??"")) ||
      profile.scopeMismatch || (profile.actorFit ?? 0) < 0.8 ||
      (profile.stateFit ?? 0) < 0.8 ||
      (profile.lexicalFit ?? 0) < 0.22 ||
      (profile.subjectFit ?? 0) < 0.16 ||
      (profile.referentFit ?? 0) < 0.13) return profile;
  const v11Act = v11RequestedProceduralAct(question);
  if (v11Act && !v11ActWitnessedByAuthority(v11Act, candidate.result)) return profile;
  const body = String(candidate.result.sectionContent ?? "");
  const queryTokens = v131MeaningfulTokens(obligation.local);
  if (queryTokens.size < 2 || !body.trim()) return profile;
  const temporal = /\b(?:yesterday|previous(?:ly)?|earlier|later|after|before|retrospect|today)\b/i.test(obligation.local);
  const timeRule = /\b(?:at (?:the )?time|at once|immediate\w*|retrospect\w*|go back|not later|later (?:in|than|on)|previous(?:ly)?|earlier)\b/i;
  // APB13.1: positive mandatory language inside a specialised procedure
  // does not itself restrict an individual's general permission to demand it.
  // Count explicit negative/limiting rules, or an affirmative timing duty
  // when the user's question contains the corresponding timing boundary.
  const prohibitive = /\b(?:cannot|can not|may not|must not|shall not|not\s+(?:every|all|any)|no\b|only\b|unless\b|prohibit\w*|forbidden|not entitled|no authority|has no right)\b/i;
  const timedObligation = /\b(?:must|should|shall|required|presumption|ordinarily|normally)\b/i;
  const clauses = body.split(/[.!?](?:\s+|$)|\n+/).filter(Boolean);
  const witnessed = clauses.some((clause) => {
    const negativeRule = prohibitive.test(clause);
    const expressTemporalDuty = temporal && timeRule.test(clause) &&
      timedObligation.test(clause);
    if (!negativeRule && !expressTemporalDuty) return false;
    const tokens=v131MeaningfulTokens(clause);
    let shared=0;
    for (const term of queryTokens) if (tokens.has(term)) shared++;
    if (shared < 2) return false;
    if (temporal && !timeRule.test(clause)) return false;
    return true;
  });
  if (!witnessed) return profile;
  // A real clause witnesses an explicit restriction. This does not assert that
  // an application entails a right, or that the whole question is answered.
  const supported = Math.max(profile.relationFit ?? 0, 0.43);
  return {
    ...profile,
    coreEligible: true, qualificationEligible: true, eligible: true,
    relationFit: supported,
    relationSupportByType: {
      ...(profile.relationSupportByType ?? {}),
      permission: Math.max(profile.relationSupportByType?.permission ?? 0, supported),
    },
  };
}

function buildMatrix(obligations, question, candidates) {
  return candidates.map((candidate) => ({
    candidate,
    obligationProfiles: obligations.map((obligation) =>
      v131NormativeEvidenceProfile(obligation, question, candidate)
    ),
  }));
}

function profileEligible(profile, mode = "full") {
  if (mode === "core") return Boolean(profile.coreEligible);
  if (mode === "qualification") return Boolean(profile.qualificationEligible);
  return Boolean(profile.eligible);
}

function dimensionMax(selected, obligationIndex, field, mode = "full") {
  let best = 0;
  for (const item of selected) {
    const p = item.obligationProfiles[obligationIndex];
    if (!profileEligible(p, mode)) continue;
    best = Math.max(best, p[field] ?? 0);
  }
  return best;
}

function relationRequiresQualification(obligation, relation) {
  if (!obligation.actorQualifiers || obligation.actorQualifiers.length === 0) {
    return false;
  }
  return ["actor_scope", "limit", "scope"].includes(relation);
}

function relationDimensionMax(
  selected,
  obligation,
  obligationIndex,
  relation
) {
  const mode = relationRequiresQualification(obligation, relation)
    ? "qualification"
    : "core";
  let best = 0;

  for (const item of selected) {
    const p = item.obligationProfiles[obligationIndex];
    if (!profileEligible(p, mode)) continue;
    best = Math.max(
      best,
      p.relationSupportByType?.[relation] ?? 0
    );
  }
  return best;
}


function distributedPackSemanticFit(
  selected,
  obligation,
  obligationIndex,
  requiredValues
) {
  if (
    obligation.distributedAnswerFrame !== "conditional_limit" ||
    requiredValues.length === 0
  ) {
    return 0;
  }

  const contributors = selected.filter((item) => {
    const profile = item.obligationProfiles[obligationIndex];
    if (!profile) return false;

    const carriesRequestedRelation = obligation.relations.some(
      (relation) =>
        (profile.relationSignals ?? []).includes(relation)
    );
    if (!carriesRequestedRelation) return false;

    const authorityText =
      `${item.candidate.result.heading ?? ""} ` +
      `${(item.candidate.result.path ?? []).join(" ")} ` +
      `${item.candidate.result.sectionContent ?? ""}`;

    // A distributed contributor need only establish some of the requested
    // target, because the whole point of this frame is that sibling
    // authorities can divide the proposition between them. The combined
    // pack must still clear the unchanged obligation completeness thresholds.
    return semanticSetFit(requiredValues, authorityText) > 0;
  });

  if (contributors.length < 2) return 0;

  const combined = contributors
    .map(({candidate}) =>
      `${candidate.result.heading ?? ""} ${(candidate.result.path ?? []).join(" ")} ${candidate.result.sectionContent ?? ""}`
    )
    .join(" ");

  return semanticSetFit(requiredValues, combined);
}

function obligationCoverage(selected, obligation, obligationIndex) {
  const dimensions = [];
  const hasPredicate =
    obligation.predicateEvents.length > 0 ||
    obligation.predicateObjects.length > 0;

  const distributedReferentFit = distributedPackSemanticFit(
    selected,
    obligation,
    obligationIndex,
    obligation.referentTerms
  );
  const distributedSubjectFit = distributedPackSemanticFit(
    selected,
    obligation,
    obligationIndex,
    obligation.subjectTerms
  );
  const enumeratedContentFit =
    obligation.semanticFrame === "enumerated_content_answer"
      ? relationDimensionMax(
          selected,
          obligation,
          obligationIndex,
          "content"
        )
      : 0;

  dimensions.push({
    name: "referent",
    weight: 0.25,
    value: Math.max(
      dimensionMax(selected, obligationIndex, "referentFit", "core"),
      distributedReferentFit,
      enumeratedContentFit
    ),
  });
  dimensions.push({
    name: "subject",
    weight: 0.17,
    value: Math.max(
      dimensionMax(selected, obligationIndex, "subjectFit", "core"),
      distributedSubjectFit,
      enumeratedContentFit
    ),
  });

  const relationWeightTotal = 0.31;
  const perRelationWeight =
    obligation.relations.length > 0
      ? relationWeightTotal / obligation.relations.length
      : relationWeightTotal;

  for (const relation of obligation.relations) {
    dimensions.push({
      name: `relation:${relation}`,
      weight: perRelationWeight,
      value: relationDimensionMax(
        selected,
        obligation,
        obligationIndex,
        relation
      ),
    });
  }

  if (hasPredicate) {
    const distributedPredicateFit = distributedPackSemanticFit(
      selected,
      obligation,
      obligationIndex,
      [...obligation.predicateEvents, ...obligation.predicateObjects]
    );
    dimensions.push({
      name: "predicate",
      weight: 0.18,
      value: Math.max(
        dimensionMax(selected, obligationIndex, "predicateFit", "core"),
        distributedPredicateFit
      ),
    });
  }

  if (obligation.stateTerms.length > 0) {
    const distributedStateFit = distributedPackSemanticFit(
      selected,
      obligation,
      obligationIndex,
      obligation.stateTerms
    );
    dimensions.push({
      name: "state",
      weight: 0.18,
      value: Math.max(
        dimensionMax(selected, obligationIndex, "stateFit", "core"),
        distributedStateFit
      ),
    });
  }

  if ((obligation.stateRelationTerms ?? []).length > 0) {
    dimensions.push({
      name: "state_relation",
      weight: 0.18,
      value: dimensionMax(
        selected,
        obligationIndex,
        "stateRelationFit",
        "core"
      ),
    });
  }

  if (obligation.contextIdentity) {
    dimensions.push({
      name: "context_identity",
      weight: 0.18,
      value: dimensionMax(
        selected,
        obligationIndex,
        "contextIdentityFit",
        "core"
      ),
    });
  }

  if (obligation.actorTerms.length > 0) {
    dimensions.push({
      name: "actor",
      weight: 0.08,
      value: dimensionMax(selected, obligationIndex, "actorFit", "core"),
    });
  }

  if (obligation.actorQualifiers.length > 0) {
    dimensions.push({
      name: "actor_qualification",
      weight: 0.23,
      value: dimensionMax(
        selected,
        obligationIndex,
        "actorQualifierFit",
        "qualification"
      ),
    });
  }

  dimensions.push({
    name: "directness",
    weight: 0.05,
    value: dimensionMax(selected, obligationIndex, "lexicalFit", "core"),
  });

  let weightSum = 0;
  let weighted = 0;
  for (const d of dimensions) {
    weightSum += d.weight;
    weighted += d.weight * Math.max(0, Math.min(1, d.value));
  }

  const coverage = weightSum > 0 ? weighted / weightSum : 0;
  const critical = dimensions.filter((d) =>
    d.name === "referent" ||
    d.name === "subject" ||
    d.name === "predicate" ||
    d.name === "state" ||
    d.name === "state_relation" ||
    d.name === "context_identity" ||
    d.name === "actor_qualification" ||
    d.name.startsWith("relation:")
  );

  const complete =
    critical.length > 0 &&
    critical.every((d) => d.value >= (
      d.name === "referent" ? 0.50 :
      d.name === "subject" ? 0.50 :
      d.name === "predicate" ? 0.48 :
      d.name === "state" ? 0.50 :
      d.name === "state_relation" ? 0.75 :
      d.name === "context_identity" ? 1.00 :
      d.name === "actor_qualification" ? 0.62 :
      d.name.startsWith("relation:") ? 0.55 :
      0.62
    ));

  return {coverage, complete, dimensions};
}

function obligationAssignmentFit(item, obligation, obligationIndex) {
  const p = item.obligationProfiles[obligationIndex];
  if (!p.coreEligible) return 0;

  const relationValues = obligation.relations.map((relation) => {
    if (
      relationRequiresQualification(obligation, relation) &&
      !p.qualificationEligible
    ) return 0;
    return p.relationSupportByType?.[relation] ?? 0;
  });

  const relationAverage =
    relationValues.length === 0
      ? 1
      : relationValues.reduce((sum, value) => sum + value, 0) /
        relationValues.length;

  const hasPredicate =
    obligation.predicateEvents.length > 0 ||
    obligation.predicateObjects.length > 0;

  const values = [
    [p.referentFit, 0.20],
    [p.subjectFit, 0.16],
    [relationAverage, 0.27],
    [p.stateFit, obligation.stateTerms.length > 0 ? 0.14 : 0],
    [p.actorFit, obligation.actorTerms.length > 0 ? 0.07 : 0],
    [
      p.actorQualifierFit,
      obligation.actorQualifiers.length > 0 && p.qualificationEligible ? 0.10 : 0
    ],
    [p.predicateFit, hasPredicate ? 0.16 : 0],
  ];

  let weighted = 0;
  let total = 0;
  for (const [value, weight] of values) {
    if (weight <= 0) continue;
    weighted += value * weight;
    total += weight;
  }
  return total > 0 ? weighted / total : 0;
}

function terminalEventFit(obligation, profile) {
  if (!obligation.predicateEvents || obligation.predicateEvents.length === 0) {
    return 1;
  }
  return setFit(obligation.predicateEvents, profile.transitionOutputEvents);
}

function sequentialObligationAnchorFit(previous, current) {
  const previousAnchors = unionSets(
    new Set(previous.referentTerms ?? []),
    new Set(previous.subjectTerms ?? []),
    new Set(previous.predicateEvents ?? []),
    new Set(previous.predicateObjects ?? [])
  );
  const currentAnchors = unionSets(
    new Set(current.referentTerms ?? []),
    new Set(current.subjectTerms ?? []),
    new Set(current.predicateEvents ?? []),
    new Set(current.predicateObjects ?? [])
  );

  if (previousAnchors.size === 0 || currentAnchors.size === 0) return 0;
  return Math.max(
    overlapRatio(previousAnchors, currentAnchors),
    overlapRatio(currentAnchors, previousAnchors)
  );
}

function sequenceCoverage(selected, obligations) {
  const links = [];
  let total = 0;

  for (let index = 1; index < obligations.length; index += 1) {
    if (!obligations[index].sequenceFromPrior) continue;
    if (
      sequentialObligationAnchorFit(
        obligations[index - 1],
        obligations[index]
      ) <= 0
    ) continue;

    let best = {
      value: 0,
      left: null,
      right: null,
      bridge: 0,
      leftAssignment: 0,
      rightAssignment: 0,
      terminal: 0,
    };

    for (const left of selected) {
      for (const right of selected) {
        if (left.candidate.result.sectionId === right.candidate.result.sectionId) continue;

        const leftProfile = left.obligationProfiles[index - 1];
        const rightProfile = right.obligationProfiles[index];

        const leftAssignment = obligationAssignmentFit(
          left,
          obligations[index - 1],
          index - 1
        );
        const rightAssignment = obligationAssignmentFit(
          right,
          obligations[index],
          index
        );

        if (leftAssignment < 0.48 || rightAssignment < 0.48) continue;

        const bridge = transitionCoherence(
          leftProfile,
          rightProfile,
          left.candidate,
          right.candidate
        );
        if (bridge <= 0) continue;

        const terminal = terminalEventFit(obligations[index], rightProfile);

        const value =
          leftAssignment * 0.26 +
          rightAssignment * 0.27 +
          bridge * 0.25 +
          terminal * 0.22;

        if (value > best.value) {
          best = {
            value,
            left: left.candidate.result.citationLabel,
            right: right.candidate.result.citationLabel,
            bridge,
            leftAssignment,
            rightAssignment,
            terminal,
          };
        }
      }
    }

    links.push({index, ...best});
    total += best.value;
  }

  return {total, links};
}

function utility(selected, obligations) {
  const obligationDetails = obligations.map((obligation, index) =>
    obligationCoverage(selected, obligation, index)
  );

  const coverage = obligationDetails.reduce(
    (sum, item) => sum + item.coverage * item.coverage,
    0
  );

  const completionBonus = obligationDetails.reduce(
    (sum, item) => sum + (item.complete ? 0.08 : 0),
    0
  );

  const transition = sequenceCoverage(selected, obligations);
  const transitionBonus = transition.total * 0.24;

  let coherence = 0;
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      coherence += structuralCoherence(
        selected[i].candidate,
        selected[j].candidate
      );
    }
  }

  const packPenalty = selected.length * 0.082;

  return {
    total: coverage + completionBonus + transitionBonus + coherence - packPenalty,
    coverage,
    completionBonus,
    transitionBonus,
    coherence,
    packPenalty,
    obligationDetails,
    transitionLinks: transition.links,
  };
}

function stateKey(selected) {
  return selected
    .map((item) => item.candidate.result.sectionId)
    .sort()
    .join("|");
}

function selectPack(obligations, matrix, maxAuthorities = 4) {
  const beamWidth = 64;
  let beam = [{
    selected: [],
    utility: utility([], obligations),
  }];
  let bestState = beam[0];

  for (let depth = 0; depth < maxAuthorities; depth += 1) {
    const nextByKey = new Map();

    for (const state of beam) {
      for (const item of matrix) {
        if (
          state.selected.some(
            (chosen) =>
              chosen.candidate.result.sectionId === item.candidate.result.sectionId
          )
        ) continue;

        const selected = [...state.selected, item];
        const proposedUtility = utility(selected, obligations);
        const key = stateKey(selected);
        const existing = nextByKey.get(key);

        if (!existing || proposedUtility.total > existing.utility.total) {
          nextByKey.set(key, {selected, utility: proposedUtility});
        }
      }
    }

    const next = [...nextByKey.values()]
      .sort((a, b) => b.utility.total - a.utility.total)
      .slice(0, beamWidth);

    if (next.length === 0) break;
    beam = next;
    if (beam[0].utility.total > bestState.utility.total) bestState = beam[0];
  }

  return bestState;
}

function evidenceCoreScore(utilityResult) {
  return (
    utilityResult.coverage +
    utilityResult.completionBonus +
    utilityResult.transitionBonus
  );
}

function dimensionSignature(utilityResult) {
  return utilityResult.obligationDetails.map((detail) =>
    Object.fromEntries(
      detail.dimensions.map((dimension) => [dimension.name, dimension.value])
    )
  );
}


function evidenceEquivalentRetentionPriority(item) {
  const sources = item?.candidate?.sources ?? [];

  // This priority is deliberately NOT part of semantic scoring. It is used
  // only after two candidate removals have survived every completion,
  // transition, critical-dimension, and evidence-loss guard with the same
  // evidence loss. In that true-equivalence case, retain the authority that
  // was discovered with stronger query-plan support rather than whichever
  // happens to survive iteration order.
  if (sources.some((source) => source.kind === "base")) return 3;
  if (sources.some((source) => source.kind === "structural_adjacent")) return 2;
  if (sources.some((source) => source.kind === "adaptive_widen")) return 1;
  return 0;
}

function pruneRedundantAuthorities(selected, obligations) {
  let current = [...selected];
  const pruned = [];

  while (current.length > 1) {
    const baseline = utility(current, obligations);
    const baselineCore = evidenceCoreScore(baseline);
    const baselineSignature = dimensionSignature(baseline);
    const baselineAllComplete =
      baseline.obligationDetails.length > 0 &&
      baseline.obligationDetails.every((detail) => detail.complete);
    const overcompletePack = current.length > obligations.length;
    let bestRemoval = null;

    for (let index = 0; index < current.length; index += 1) {
      const trial = current.filter((_, i) => i !== index);
      const trialUtility = utility(trial, obligations);
      const trialCore = evidenceCoreScore(trialUtility);
      const trialSignature = dimensionSignature(trialUtility);

      const completionLost = baseline.obligationDetails.some(
        (detail, obligationIndex) =>
          detail.complete &&
          !trialUtility.obligationDetails[obligationIndex].complete
      );

      const transitionLoss =
        baseline.transitionBonus - trialUtility.transitionBonus;
      const evidenceLoss = baselineCore - trialCore;

      let uniqueCriticalLoss = false;
      for (
        let obligationIndex = 0;
        obligationIndex < baselineSignature.length;
        obligationIndex += 1
      ) {
        for (const [name, baselineValue] of Object.entries(
          baselineSignature[obligationIndex]
        )) {
          if (
            !(
              name === "state" ||
              name === "actor_qualification" ||
              name.startsWith("relation:")
            )
          ) continue;

          const trialValue =
            trialSignature[obligationIndex]?.[name] ?? 0;

          if (baselineValue >= 0.55 && baselineValue - trialValue > 0.12) {
            uniqueCriticalLoss = true;
          }
        }
      }

      if (completionLost) continue;
      if (transitionLoss > 0.004) continue;

      const completionPreservingMinimality =
        baselineAllComplete &&
        overcompletePack &&
        trialUtility.obligationDetails.every((detail) => detail.complete);

      if (!completionPreservingMinimality) {
        if (uniqueCriticalLoss) continue;
        if (evidenceLoss > 0.018) continue;
      }

      const retentionPriority =
        evidenceEquivalentRetentionPriority(current[index]);

      if (
        bestRemoval === null ||
        evidenceLoss < bestRemoval.evidenceLoss - 1e-9 ||
        (
          Math.abs(evidenceLoss - bestRemoval.evidenceLoss) <= 1e-9 &&
          retentionPriority < bestRemoval.retentionPriority
        ) ||
        (
          Math.abs(evidenceLoss - bestRemoval.evidenceLoss) <= 1e-9 &&
          retentionPriority === bestRemoval.retentionPriority &&
          trial.length < bestRemoval.trial.length
        )
      ) {
        bestRemoval = {
          index,
          trial,
          evidenceLoss,
          retentionPriority,
          removedLabel: current[index].candidate.result.citationLabel,
        };
      }
    }

    if (bestRemoval === null) break;

    pruned.push({
      citationLabel: bestRemoval.removedLabel,
      evidenceLoss: bestRemoval.evidenceLoss,
    });
    current = bestRemoval.trial;
  }

  return {
    selected: current,
    pruned,
    utility: utility(current, obligations),
  };
}


const PRODUCTION_BASE_PROVENANCE = new Set([
  "planner",
  "user_term",
  "registry_expansion",
]);

function productionDimensions(searches) {
  const preferred = searches.filter((search) =>
    PRODUCTION_BASE_PROVENANCE.has(String(search?.provenance ?? ""))
  );
  const source = preferred.length > 0 ? preferred : searches;
  const seen = new Set();
  const dimensions = [];

  for (const search of source) {
    const query = String(search?.query ?? "").trim();
    if (!query) continue;
    const corpus = search?.corpus ?? null;
    const provenance = String(search?.provenance ?? "planner");
    const key = `${query}\u0000${String(corpus ?? "")}\u0000${provenance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dimensions.push({query, corpus, provenance});
  }

  return dimensions;
}

/**
 * Production entry point for the SHA-bound v5.18 semantic selector.
 *
 * Candidate acquisition reproduces the frozen harness:
 * base top-10 -> adaptive widen to 30 -> structural SO adjacency,
 * followed by deriveObligations -> buildMatrix -> selectPack -> pruning.
 *
 * Existing production SearchExecution records provide the frozen query-plan
 * dimensions and any explicit corpus constraint. Corpus-bridge/recovery
 * searches are not admitted as v5.18 base dimensions.
 */
// V4 incremental procedural coverage: distinguish a governing reply rule from
// a *different* authority that explicitly describes a parliamentary response
// and the limits on that response. Body text, not heading overlap or citation
// numbers, must support each additional proposition. This does not modify
// ordinary semantic qualification, rank weights, or existing pruning.
function v4MinisterReplyTacticalNeed(obligations) {
  return (obligations ?? []).some((obligation) =>
    (obligation.relations ?? []).includes("discretion") || (obligation.relations ?? []).includes("requirement"));
}

function v4MinisterReplyFacetEvidence(result, obligations) {
  const body = String(result?.sectionContent ?? "");
  const corpus = String(result?.documentCorpus ?? "");
  const empty = { action: false, limit: false, strongLimit: false, score: 0 };
  if (!body || body.length > 100000 || !["standing_orders", "speakers_rulings"].includes(corpus)) return empty;
  const actors = (obligations ?? []).flatMap((obligation) => obligation.actorTerms ?? []);
  const acts = (obligations ?? []).flatMap((obligation) => obligation.predicateEvents ?? []);
  if (actors.length + acts.length === 0) return empty;
  const terms = v38Terms(body);
  const present = (values) => values.length === 0 || values.some((value) => terms.has(v38Stem(value)));
  if (!present(actors) || !present(acts)) return empty;
  const relation = dutyVersusDiscretion(body);
  const strongLimit = /\b(?:cannot|may not|must not|has no power|no power)\b/i.test(body);
  return {
    action: relation === "discretion" || relation === "either",
    limit: relation === "duty" || relation === "either" || strongLimit,
    strongLimit,
    score: relation === "unspecified" && !strongLimit ? 0 : 1,
  };
}

function v4AugmentMinisterReplyPack(input) {
  const {question, matrix, obligations, initial, maxAuthorities} = input;
  if (!v4MinisterReplyTacticalNeed(obligations) || initial.selected.length === 0) return initial;
  const selected = [...initial.selected];
  const ids = new Set(selected.map((item) => item.candidate.result.sectionId));
  const covered = {action:false, limit:false};
  function absorb(item) {
    const facets = v4MinisterReplyFacetEvidence(item.candidate.result, obligations);
    covered.action ||= facets.action;
    covered.limit ||= facets.limit;
  }
  selected.forEach(absorb);
  while ((!covered.action || !covered.limit) && selected.length < maxAuthorities) {
    const choices = matrix.filter((item) => !ids.has(item.candidate.result.sectionId))
      .map((item) => {
        const facets = v4MinisterReplyFacetEvidence(item.candidate.result, obligations);
        const gain = (!covered.action && facets.action ? 1 : 0) +
          (!covered.limit && facets.limit ? 1 : 0);
        return {item, facets, gain};
      })
      .filter(({gain}) => gain > 0)
      .sort((a,b) => b.gain-a.gain ||
        Number(b.facets.strongLimit)-Number(a.facets.strongLimit) ||
        b.facets.score-a.facets.score ||
        b.item.candidate.maxRank-a.item.candidate.maxRank ||
        String(a.item.candidate.result.sectionId).localeCompare(String(b.item.candidate.result.sectionId)));
    if (!choices.length) break;
    const best = choices[0].item;
    selected.push(best);
    ids.add(best.candidate.result.sectionId);
    absorb(best);
  }
  // Crucial: the original-question pruner would erase a *separate* procedural
  // action because it is not an answer to the governing-rule proposition.
  // Preserve each additional item only because explicit source text earned it.
  return {...initial,selected,utility:utility(selected,obligations)};
}

// OPEN ORDER APB11: source-body witnesses for the requested procedural act.
// An authority is not a governing answer merely because it shares the topic.
// No citation label, section number or retrieval rank participates in this gate.
function v11RequestedProceduralAct() {
  return null;
}
function v11ActWitnessedByAuthority(act, authority) {
  const body = v38Terms(authority?.sectionContent ?? "");
  const needed = String(act ?? "").split("|").filter(Boolean);
  if (!body.size || needed.length < 2) return false;
  return needed.filter((token) => body.has(token)).length >= 2;
}

// OPEN ORDER APB v26: source-attested actor/object supplementation for
// genuinely independent questions. An eligible authority is not enough:
// the actual source must make the question's actor the applicant for the
// object at issue. No global lowering of eligibility or greedy adjacency.
function v26IndependentInterrogatives(question) {
  const original = String(question ?? "").trim();
  const split = original.match(/^([\s\S]+?)\?\s+((?:who|what|when|where|why|how|which|can|may|must|should|does|do|is|are|will|would)\b[^?]+)\?$/i);
  if (!split || split[1].includes("?") || split[2].includes("?")) return [];
  return [split[1].trim(), split[2].trim()];
}

function v26SourceApplicationWitness(questionPart, source) {
  const query = String(questionPart ?? "").toLowerCase();
  // Retain a distinct applicant and their own requested object; mere words
  // such as "witness" and "secret" elsewhere in a provision are insufficient.
  const applicant = query.match(/\b(?:a|an|the)\s+(witness|member|person|minister|petitioner|committee)\s+(?:asks?|requests?|applies|applied)\b/);
  const target = query.match(/\b(?:their|his|her|own)\s+(evidence|submission|petition|statement|application|document|report|motion|vote)\b/);
  if (!applicant || !target) return false;
  const actor = applicant[1];
  const object = target[1];
  const text = String(source?.sectionContent ?? "").toLowerCase().replace(/\s+/g, " ");
  const heading = String(source?.heading ?? "").toLowerCase();
  if (!text || !heading) return false;
  // A formal application source must say that THIS actor can apply about
  // THIS object. Prevent cases where someone asks for *other witnesses*.
  const actors = actor === "petitioner" ? ["petitioner", "person"] :
    actor === "witness" ? ["witness"] : [actor];
  const direct = actors.some((a) => {
    const re = new RegExp("\\b" + a + "\\b.{0,65}\\b(?:may|can|must|shall)\\s+(?:apply|request)\\b.{0,170}\\b" + object + "\\b");
    return re.test(text);
  });
  if (!direct) return false;
  // Verify that a material qualifier of the requested object also occurs.
  // "secret evidence" and "private evidence" are different from simply
  // referring to evidence in the context of a reputational allegation.
  const qualifiers = ["secret", "private", "written", "oral", "personal", "party", "urgent", "ministerial"];
  const stated = qualifiers.filter((word) => new RegExp("\\b" + word + "\\b").test(query));
  if (stated.length && !stated.some((word) => new RegExp("\\b" + word + "\\b").test(text))) return false;
  return true;
}

function v26SourceAttestedCompanions(question, matrix, selected, maxAuthorities) {
  const parts = v26IndependentInterrogatives(question);
  if (parts.length !== 2 || selected.length >= maxAuthorities) return [];
  const selectedKeys = new Set(selected.map((item) =>
    `${item.candidate.result.documentCorpus}:${item.candidate.result.citationLabel}`));
  const eligible = matrix.filter((item) =>
    item.obligationProfiles.length > 0 &&
    item.obligationProfiles.every((profile) => profile.eligible));
  const additions = [];
  for (const part of parts) {
    if (selected.length + additions.length >= maxAuthorities) break;
    const witnesses = eligible.filter((item) => {
      const source = item.candidate.result;
      const key = `${source.documentCorpus}:${source.citationLabel}`;
      return !selectedKeys.has(key) &&
        v26SourceApplicationWitness(part, source);
    });
    // Ambiguous equally eligible application witnesses are not resolved by
    // retrieval rank or broad lexical overlap. Keep the original pack.
    if (witnesses.length !== 1) continue;
    const item = witnesses[0];
    const source = item.candidate.result;
    const key = `${source.documentCorpus}:${source.citationLabel}`;
    selectedKeys.add(key);
    additions.push(item);
  }
  return additions;
}

// OPEN ORDER v31: a universal-entitlement question may be answered by an
// expressly narrower permission. Require independently witnessed actor,
// requested act, target, context, and narrowing condition from SOURCE BODY.
// This is NOT a general eligibility relaxation or a statement that everyone
// has the power; no citation/authority label is named in this production code.
function v31NormWords(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function v31QuantifiedQuestioningFrame(question) {
  const q = v31NormWords(question);
  const entitlement = /\b(?:every|any|all)\s+(?:mp|mps|member|members)\s+(?:is\s+|are\s+)?(?:entitled|permitted|allowed|authorised|authorized)\s+to\s+(?:question|ask\s+questions?\s+(?:to|of))\s+(?:the\s+)?(minister|speaker|chairperson|chair|member|witness)\b/.exec(q);
  if (!entitlement) return null;
  const prefix = q.slice(0, entitlement.index);
  const context = prefix.split(/\b(?:after|before|following|during|when|once|in|on|at)\b/).slice(1).join(' ').trim();
  if (!context) return null;
  const tokens = context.split(' ').filter((word) => word.length > 2 &&
    !['the','this','that','house','makes','make','made','does','did','have','has','minister','member','members','following','after','before','during'].includes(word));
  // An independently stated multiword procedural object (not generic role or
  // location nouns) is mandatory. No matching context -> leave baseline alone.
  const pairs=[];
  for(let i=0;i+1<tokens.length;i++) pairs.push(tokens[i]+' '+tokens[i+1]);
  if (pairs.length===0) return null;
  return {target:entitlement[1], contextPairs:pairs};
}
function v31SourceQualifiedQuestioningWitness(question, source) {
  const frame = v31QuantifiedQuestioningFrame(question);
  if (!frame || source?.documentCorpus !== 'standing_orders') return false;
  const body = v31NormWords(source.sectionContent);
  if (!body || !frame.contextPairs.some(pair=>body.includes(pair))) return false;
  const target = frame.target;
  const action = new RegExp('\\b(?:ask questions? (?:to|of)|question) (?:the )?'+target+'\\b');
  // The permission must be exercised by a member or a party leader, not by
  // the Minister/Speaker who is the object of the user's request.
  const starts = [...body.matchAll(/\b(?:member|members|leader)\b/g)];
  for (const start of starts) {
    const localContext=body.slice(Math.max(0,start.index-180),start.index+150);
    if (!frame.contextPairs.some(pair=>localContext.includes(pair))) continue;
    const between = body.slice(start.index, start.index+180);
    const may = /\bmay\b/.exec(between);
    if (!may || may.index > 145) continue;
    const grantPrefix=between.slice(0,may.index);
    const narrowed = /\b(?:authorised|authorized|designated|appointed|specified|only|if|unless|provided|by leave)\b|\bwith\b.{0,65}\b(?:or more|at least|approval|consent)\b/.test(grantPrefix);
    if (!narrowed) continue;
    const permitted = body.slice(start.index+may.index+3,start.index+may.index+3+220);
    if (action.test(permitted)) return true;
  }
  return false;
}
function v31ConditionalEntitlementComplement(question, matrix, selected, maxAuthorities) {
  // With an existing qualified governing pack, do not disturb it.
  if (selected.length!==0 || maxAuthorities<1 || !v31QuantifiedQuestioningFrame(question)) return [];
  const witnessed=matrix.filter(item=>v31SourceQualifiedQuestioningWitness(question,item.candidate.result));
  // One unambiguous, source-attested restricted grant; otherwise fail closed.
  return witnessed.length===1 ? [witnessed[0]] : [];
}


// OPEN ORDER v33: compositional, source-body evidence completeness.
// This code does not modify the ordinary eligibility or claim-entailment scores.
// It operates only on already retrieved and semantically profiled candidates.
function v33ComparisonFrame(question) {
  const q = normalize(question);
  if (!/\b(?:same\b.{0,55}\bas|differ\w*\b.{0,55}\bfrom|compar\w*\b.{0,55}\bwith|versus|vs)\b/.test(q)) return null;
  const end = /\b(?:as|from|with|versus|vs)\s+(?:the\s+)?([a-z]{3,})\s+([a-z]{3,})\b/g;
  let match;
  while ((match = end.exec(q)) !== null) {
    const right = match[1], head = match[2];
    if (STOPWORDS.has(right) || STOPWORDS.has(head) || right === head) continue;
    const prior = q.slice(0, match.index);
    const before = [...prior.matchAll(new RegExp('\\b([a-z]{3,})\\s+' + head + '\\b', 'g'))]
      .map((item) => item[1])
      .filter((word) => !STOPWORDS.has(word) && word !== right);
    const afterHead = [...prior.matchAll(new RegExp('\\b' + head + '\\b(?:\\s+[a-z]{2,}){0,4}\\s+(?:in|as|under)\\s+([a-z]{3,})\\b', 'g'))]
      .map((item) => item[1])
      .filter((word) => !STOPWORDS.has(word) && word !== right);
    const left = [...before, ...afterHead].at(-1);
    if (!left || left === right) continue;
    const afterStage = /\b(?:after|following|once|until|before)\b/.test(q);
    const effect = /\b(?:confidential\w*|disclos\w*|releas\w*|publish\w*|custody|protect\w*|withhold\w*|available)\b/.test(q);
    return {type:'comparison', head, arms:[left,right], afterStage, effect};
  }
  return null;
}

function v33ApplicationFrame(question) {
  const q = normalize(question);
  const actor = /\b(?:can|may|could)\s+(?:a|an|the)\s+([a-z]{3,})\s+(?:[a-z]+\s+){0,3}(?:ask|request|apply|seek)\b/.exec(q);
  const missing = /\bwithout\s+(?:(?:giving|providing|stating|supplying|offering|obtaining|seeking)\s+)?(?:any|a|an|the|their|his|her)?\s*([a-z]{3,})\b/.exec(q);
  if (!actor || !missing) return null;
  const requestedMode = /\b(?:in|as)\s+(?:a\s+)?([a-z]{3,})\b/g;
  const modeMatches = [...q.matchAll(requestedMode)].map((m)=>m[1]);
  const mode = modeMatches.filter((w)=>!['the','house','committee','parliament','time','order'].includes(w)).at(-1) ?? null;
  const durative = /\b(?:halfway|midway|partway|while|during|already|mid|started)\b/.test(q);
  const object = /\b(evidence|testimony|submission|petition|statement|document|application|report|motion|vote|speech)\b/.exec(q)?.[1] ?? null;
  return {type:'qualified_application', actor:actor[1], condition:canonicalToken(missing[1]), mode, object, durative};
}

function v33AlternativeFrame(question) {
  const q = normalize(question);
  if (!/\b(?:rather than|instead of|as opposed to)\b/.test(q) ||
      !/\b(?:must|have to|required|obliged|only|always)\b/.test(q)) return null;
  const parts = q.split(/\b(?:rather than|instead of|as opposed to)\b/);
  if (parts.length !== 2 || !parts[1]) return null;
  const events = [...eventTermsFromText(parts[1])];
  if (events.length !== 1) return null;
  const subject = /\b(?:an?|the)\s+([a-z]{3,})\s+(?:result|record|decision|statement|report|motion)\b/.exec(q)?.[1] ??
    /\b(?:result|record|decision|statement|report|motion)\s+of\s+(?:a|an|the)\s+([a-z]{3,})\b/.exec(q)?.[1] ?? null;
  if (!subject) return null;
  const repeated = /\b(?:again|repeat\w*|retak\w*|second|another)\b/.test(parts[0]);
  if (!repeated) return null;
  const qualifier = /\b(?:inaccurat\w*|incorrect\w*|wrong\w*|mistak\w*)\b/.test(q);
  return {type:'alternative', object:subject, alternative:events[0], repeated, qualifier};
}

function v33BodyComparisonWitness(frame, result) {
  const raw = String(result?.sectionContent ?? '');
  if (!raw) return [];
  // Check subsection-sized propositions. A source mentioning two evidence
  // classes only to tell a witness about them does not itself govern both.
  const units = raw.split(/(?=\(\d+[A-Za-z]?\)\s+)/).map(normalize).filter(Boolean);
  return frame.arms.flatMap((arm) => {
    const witnessed = units.some((part) => {
      const linked = new RegExp('\\b' + arm + '\\s+' + frame.head + '\\b').test(part) ||
        new RegExp('\\b' + frame.head + '\\b(?:\\s+[a-z]{2,}){0,5}\\s+(?:in|as|under)\\s+' + arm + '\\b').test(part);
      if (!linked) return false;
      if (frame.afterStage && !/\b(?:report\w*|conclud\w*|terminat\w*)\b/.test(part)) return false;
      if (frame.effect && !/\b(?:confidential\w*|disclos\w*|available|release\w*|custody|publish\w*|protect\w*|withhold\w*)\b/.test(part)) return false;
      if (/\b(?:witness|person)\b.{0,60}\b(?:will|must|may)\s+be\s+informed\b/.test(part)) return false;
      // A direct operative consequence, not contextual discussion about one.
      return /\b(?:is|are|may|must|shall|cannot|will)\b/.test(part);
    });
    return witnessed ? [{role:'comparator', facet:arm + ' ' + frame.head, witness:'subsection-body-operative-effect'}] : [];
  });
}

function v33BodyApplicationWitness(frame, result) {
  const raw = String(result?.sectionContent ?? '');
  if (!raw || !frame.object) return [];
  const clauses = raw.split(/(?=\(\d+[A-Za-z]?\)\s*)|[.!?](?:\s+|$)/).map(normalize).filter(Boolean);
  const actors = frame.actor === 'mp' ? ['member'] : [frame.actor];
  // Modal grant must be syntactically adjacent to the requested actor, in
  // the SAME source proposition. 'A witness ... the committee may apply'
  // and 'a person may ask further witnesses' are not witness permissions.
  const grant = clauses.some((clause) => actors.some((actor) => {
    const linked = new RegExp('\\b' + actor + '\\s+(?:may|can|is entitled to)\\s+(?:ask|request|apply|seek)\\b.{0,195}\\b' + frame.object + '\\b').test(clause);
    if (!linked) return false;
    if (frame.mode && !new RegExp('\\b' + frame.mode + '\\b').test(clause)) return false;
    if (frame.durative && !/\b(?:while|during|at any time|once\s+\w+\s+begins?)\b/.test(clause)) return false;
    return true;
  }));
  if (!grant) return [];
  const reasonFamily = frame.condition.startsWith('reason') ? '(?:reason\\w*|ground\\w*|justification\\w*)' :
    frame.condition.startsWith('notic') ? '(?:notic\\w*|notification\\w*)' :
    frame.condition.replace(/[^a-z]/g,'') + '\\w*';
  const mandatory = clauses.some((clause) => actors.some((actor) =>
    new RegExp('\\b' + actor + '\\s+(?:must|shall|is required to|has to)\\b.{0,65}\\b' + reasonFamily + '\\b').test(clause)));
  return mandatory ? [
    {role:'governing',facet:'actor-application-stage',witness:'source-body-actor-may-apply'},
    {role:'qualification',facet:'mandatory-'+frame.condition,witness:'source-body-same-actor-duty'},
  ] : [];
}

function v33BodyAlternativeWitness(frame, result) {
  const body = normalize(result?.sectionContent);
  if (!body || !new RegExp('\\b' + frame.object + '\\b').test(body)) return [];
  // One rule must supply both the contingency and its corrective alternative.
  // A generic permission to correct a different object fails this test.
  const event = frame.alternative.replace(/[^a-z]/g,'');
  const alternative = new RegExp('\\b(?:may|can|shall|must)\\b.{0,75}\\b' + event + '\\w*\\b').test(body);
  const repeated = new RegExp('\\b(?:second|another|further|repeat\\w*|retak\\w*)\\s+(?:\\w+\\s+){0,2}' + frame.object + '\\b').test(body) ||
    new RegExp('\\b' + frame.object + '\\b.{0,65}\\b(?:again|repeat\\w*|retak\\w*)\\b').test(body);
  const conditional = /\b(?:if|unless|otherwise|except|provided that)\b/.test(body);
  if (!alternative || !repeated || !conditional) return [];
  if (frame.qualifier && !/\b(?:inaccurat\w*|incorrect\w*|error\w*|mistak\w*)\b/.test(body)) return [];
  // Tie the alternative permission to the questioned object within the
  // same local proposition; correcting some unrelated record is not enough.
  const object = frame.object.replace(/[^a-z]/g,'');
  const linked = new RegExp('\\b(?:result|record|decision|statement|report|motion|error)\\b.{0,35}\\b(?:of\\s+)?(?:a\\s+|the\\s+)?' + object + '\\b.{0,135}\\b(?:may|can|shall|must)\\s+' + event + '\\w*\\s+(?:it|the\\s+(?:result|record|decision|statement|report|motion|' + object + '))\\b').test(body) ||
    new RegExp('\\b' + object + '\\s+(?:result|record|decision|statement|report|motion)\\b.{0,135}\\b(?:may|can|shall|must)\\s+' + event + '\\w*\\s+(?:it|the\\s+(?:result|record|decision|statement|report|motion|' + object + '))\\b').test(body);
  const objectEffect = linked;
  return objectEffect ? [
    {role:'operational_alternative',facet:'corrective-action',witness:'source-body-conditional-correction'},
    {role:'exception',facet:'repeat-only-as-fallback',witness:'source-body-two-outcomes'},
  ] : [];
}

function v33Witnesses(frame, source) {
  if (!['standing_orders','speakers_rulings'].includes(String(source?.documentCorpus))) return [];
  if (frame.type === 'comparison') return v33BodyComparisonWitness(frame, source);
  if (frame.type === 'qualified_application') return v33BodyApplicationWitness(frame, source);
  if (frame.type === 'alternative') return v33BodyAlternativeWitness(frame, source);
  return [];
}

function v33CompleteEvidencePack(question, matrix, selected, maxAuthorities) {
  const frames = [v33ComparisonFrame(question),v33ApplicationFrame(question),v33AlternativeFrame(question)].filter(Boolean);
  if (!frames.length || !matrix.length || maxAuthorities < 1) return {selected, evidence:[]};
  const current = [...selected];
  const evidence = [];
  for (const frame of frames) {
    const required = frame.type === 'comparison' ? frame.arms.map((arm)=> arm + ' ' + frame.head) :
      frame.type === 'qualified_application' ? ['actor-application-stage','mandatory-'+frame.condition] :
      ['corrective-action','repeat-only-as-fallback'];
    const withEvidence = matrix.map((item) => ({item, witnesses:v33Witnesses(frame,item.candidate.result)}))
      .filter(({witnesses}) => witnesses.length > 0);
    const covered = new Set(current.flatMap((item) => v33Witnesses(frame,item.candidate.result).map((w)=>w.facet)));
    const additions = [];
    for (const facet of required) {
      if (covered.has(facet)) continue;
      const options = withEvidence.filter(({witnesses}) =>
        witnesses.some((w)=>w.facet===facet));
      if (!options.length) continue;
      // Only a unique independent body witness is an admissible new source.
      // If several genuinely compete, preserve incompleteness rather than use rank.
      const unique = options.filter(({item}) => !current.some((x)=>x.candidate.result.sectionId===item.candidate.result.sectionId) &&
          !additions.some((x)=>x.candidate.result.sectionId===item.candidate.result.sectionId));
      if (unique.length !== 1) continue;
      const winning = unique[0];
      additions.push(winning.item);
      winning.witnesses.forEach((w)=>covered.add(w.facet));
    }
    // A strongly witnessed single-authority application/alternative answer can
    // replace an irrelevant generic match. It may NOT displace a second facet.
    const singleComplete = frame.type !== 'comparison' &&
      (String(question).match(/\?/g) ?? []).length === 1 &&
      v26IndependentInterrogatives(question).length === 0 && additions.length === 1 &&
      required.every((facet)=> covered.has(facet)) &&
      current.every((item)=>v33Witnesses(frame,item.candidate.result).length === 0);
    if (singleComplete) {
      current.splice(0,current.length);
    }
    for (const item of additions) {
      if (current.length >= maxAuthorities) break;
      if (!current.some((x)=>x.candidate.result.sectionId===item.candidate.result.sectionId)) current.push(item);
    }
    for (const item of current) {
      for (const witness of v33Witnesses(frame,item.candidate.result)) {
        evidence.push({citationLabel:item.candidate.result.citationLabel, ...witness});
      }
    }
  }
  return {selected:current,evidence};
}

// OPEN ORDER v37: source-attested request/decision and operative exception closure.
// These narrowly bounded completions do not relax the primary eligibility,
// source-body grounding, semantic coverage scores, or citation validation.
function v37RequestDecisionFrame(question) {
  const q = normalize(question);
  const request = /\b(?:a|an|the)\s+(witness|member|person|petitioner|minister|applicant)\s+(?:asks?|requests?|appl(?:y|ies|ied)|seeks?)\b/.exec(q);
  const decision = /\b(?:must|shall|will)\s+(?:the|a|an)\s+(committee|speaker|chairperson|chair|house|minister)\s+(?:grant|allow|approve|accept|permit|authorise|authorize)\b/.exec(q) ||
    /\b(?:the|a|an)\s+(committee|speaker|chairperson|chair|house|minister)\s+(?:is|are)\s+(?:required|obliged)\s+to\s+(?:grant|allow|approve|accept|permit|authorise|authorize)\b/.exec(q);
  const object = /\b(evidence|testimony|submission|petition|statement|application|document|motion|vote|request)\b/.exec(q)?.[1] ?? null;
  const mode = /\b(?:in|as)\s+(?:a\s+)?(secret|private|written|oral)\b/.exec(q)?.[1] ?? null;
  const stage = /\b(?:halfway|midway|partway|while|during|already|once|after)\b/.test(q);
  const reason = /\b(?:reasons?|grounds?|justifications?)\b/.test(q);
  if (!request || !decision || !object || !mode || !reason) return null;
  const applicant = request[1];
  const decider = decision[1];
  if (applicant === decider) return null;
  return {applicant, decider, object, mode, stage, condition:'reason'};
}

function v37DecisionWitness(frame, result) {
  const source = String(result?.sectionContent ?? '');
  if (!source) return false;
  const units = source.split(/(?=\(\d+[a-z]?\)\s*)|[.!?](?:\s+|$)/i).map(normalize).filter(Boolean);
  const actor = frame.decider.replace(/[^a-z]/g, '');
  const object = frame.object.replace(/[^a-z]/g, '');
  const mode = frame.mode.replace(/[^a-z]/g, '');
  const empowered = new RegExp('\\b(?:select\\s+)?' + actor + '\\s+may\\b.{0,90}\\b(?:declare|grant|approve|accept|permit|allow|authoris\\w*)\\b.{0,85}\\b' + object + '\\b');
  return units.some((unit) => empowered.test(unit) &&
    !new RegExp('\\b(?:select\\s+)?' + actor + '\\s+may\\s+not\\b').test(unit) &&
    new RegExp('\\b' + mode + '\\b').test(unit) &&
    !new RegExp('\\b' + actor + '\\s+must\\b.{0,90}\\b(?:grant|approve|declare|allow)\\b').test(unit));
}

function v37CompleteRequestDecision(question, candidates, obligations, current, maxAuthorities) {
  const frame = v37RequestDecisionFrame(question);
  if (!frame || maxAuthorities < 1 || (String(question).match(/\?/g) ?? []).length !== 1 ||
      v26IndependentInterrogatives(question).length > 0) return current;
  const applicationFrame = {type:'qualified_application',actor:frame.applicant,condition:frame.condition,
    mode:frame.mode,object:frame.object,durative:frame.stage};
  const eligibleSource = (candidate) => ['standing_orders','speakers_rulings'].includes(String(candidate.result?.documentCorpus)) &&
    Boolean(candidate.result?.sectionId) && String(candidate.result?.sectionContent ?? '').length > 12;
  const applications = candidates.filter((item) => eligibleSource(item) &&
    v33BodyApplicationWitness(applicationFrame,item.result).length === 2);
  const decisions = candidates.filter((item) => eligibleSource(item) &&
    v37DecisionWitness(frame,item.result));
  // One unambiguous source per role. Merely retrieving related headings cannot
  // grant or compel anything, and multiple competing sources are not guessed at.
  if (applications.length !== 1 || decisions.length !== 1) return current;
  const pair = [...new Map([applications[0],decisions[0]].map((item) => [item.result.sectionId,item])).values()];
  if (pair.length > maxAuthorities) return current;
  // This is a single-question, two-role proposition with both roles uniquely
  // witnessed. Replace unrelated lexical selections; do not retain a source
  // that merely shares background vocabulary with the requested procedure.
  // The explicit independent-interrogatives gate above protects multipart QA.
  return buildMatrix(obligations,question,pair);
}

function v37OperativeExceptionReferences(question, candidates, obligations, current, maxAuthorities) {
  const q = normalize(question);
  if (!/\b(?:except|unless|without|other than|ever|circumstances|only|sole)\b/.test(q) ||
      !/\b(?:disclos\w*|publish\w*|releas\w*|share|withhold\w*)\b/.test(q)) return current;
  const selected = [...current];
  for (const sourceItem of current) {
    if (selected.length >= maxAuthorities) break;
    const source = sourceItem.candidate.result;
    if (source.documentCorpus !== 'standing_orders') continue;
    const units = String(source.sectionContent ?? '').split(/(?=\(\d+[a-z]?\)\s+)/i).map(normalize).filter(Boolean);
    const refs=[];
    for (const unit of units) {
      if (!/\b(?:may not|must not|shall not|cannot)\b.{0,80}\b(?:disclos\w*|publish\w*|releas\w*|share|withhold\w*)\b/.test(unit)) continue;
      const ref=/(?:except\s+to\s+give\s+effect\s+to|subject\s+to|unless\s+(?:otherwise\s+)?provided\s+(?:in|by))\s+(?:standing\s+order|so)\s+(\d+[a-z]*)\b/g;
      for(const match of unit.matchAll(ref)) refs.push('SO '+match[1].toUpperCase());
    }
    if (refs.length !== 1) continue;
    const refLabel=refs[0];
    if (selected.some((item)=>item.candidate.result.citationLabel===refLabel)) continue;
    const targets=candidates.filter((candidate)=>candidate.result.documentCorpus==='standing_orders' &&
      candidate.result.citationLabel===refLabel && String(candidate.result.sectionContent??'').trim().length>=12);
    if (targets.length !== 1) continue;
    // The source explicitly names the exception; the target must be an actual
    // fetched authority with its own text, not a citation manufactured by us.
    const companion=buildMatrix(obligations,question,targets)[0];
    if (companion) selected.push({...companion, candidate:targets[0]});
  }
  return selected;
}

// OPEN ORDER v38 — source-witness admission and contrastive procedural identity.
// This path is a bounded supplement to the semantic selector, not a replacement
// for source-body evidence, citation validation or the qualification veto.
const V38_STOP = new Set([
  'any','the','and','for','from','that','this','with','when','which','what',
  'where','while','rather','after','before','until','under','their','there',
  'they','them','were','was','are','been','have','has','had','does','did',
  'can','may','must','would','will','should','could','simply','always','every',
  'only','never','without','first','then','later','even','also','than','still',
  'some','another','person','personally','member','members','parliament',
  'house','committee','select','motion','question','decision','procedure',
  'procedural','rule','rules','standing','speaker','speech','themselves',
  'immediately','automatically','theirs','itself','theyre','about','against',
  'whether','indeed','regardless','entirely','thing','things','matter','matters',
  'been','being','into','make','made','take','taken','regarding','during',
  'ordinary','normal','full','of','in','on','at','to','as','by','a','an','or',
  'i','we','he','she','if','so','not','no','is','it','mp','mps'
]);
function v38Stem(word) {
  return genericStem(normaliseNumberWords(String(word ?? "")));
}
function v38Terms(text) {
  const q = String(text ?? '').toLowerCase().replace(/[-–—]/g,' ');
  const raw = q.match(/[a-z]+|\d+/g) ?? [];
  return new Set(raw.map(v38Stem).filter((x)=>x.length>2 && !V38_STOP.has(x)));
}
function v38Intersection(left,right) {
  let found=0;
  for(const item of left) if(right.has(item)) found++;
  return found;
}
function v38Stage(text) {
  const q = normalize(text);
  const found = /\b(?:first|second|third)\s+reading\b/.exec(q);
  return found?.[0] ?? '';
}
function actorClassSourceQualifies(actor, result) {
  const actorTokens = v38Terms(actor);
  const bodyTokens = v38Terms(result?.sectionContent ?? "");
  const overlap = [...actorTokens].some((token) => bodyTokens.has(token));
  return overlap && /\b(?:only|except|unless|must not|may not|other than)\b/.test(normalize(result?.sectionContent ?? ""));
}
function v38Identity(question,result) {
  const q = normalize(question);
  const title = normalize(String(result?.heading ?? ''));
  const body = normalize(String(result?.sectionContent ?? ''));
  const identity = namedProcedureIdentity(question);
  if (identity) {
    const requested = v38Terms(identity);
    const titled = v38Terms(title);
    const embodied = v38Terms(body);
    if (requested.size > 0 && ![...requested].some((token) => titled.has(token) || embodied.has(token))) return false;
    if (forumIdentityMismatch(identity, [title])) return false;
  }
  const stage = v38Stage(q);
  const titleStage=v38Stage(title);
  if (stage && titleStage && stage!==titleStage) return false;
  return true;
}
function v38NormativeSource(text) {
  const body=normalize(text);
  return /\b(?:may|must|shall|cannot|not|only|unless|required|prohibited|except|permitted|allowed|stands|entitled|right|fair|no|does|is|are|whichever)\b/.test(body);
}
function selectorRejectionReason(question, result, obligations) {
  const identity = namedProcedureIdentity(question);
  const title = normalize(String(result?.heading ?? ""));
  if (identity && forumIdentityMismatch(identity, [title])) return "forum-identity";
  const originalQ = normalize(question);
  const originalBody = normalize(String(result?.sectionContent ?? ""));
  if (/\b(?:require|compel|direct)\b/.test(originalQ)
      && /\b(?:may|can)\s+(?:ask|request|seek)\b/.test(originalBody)
      && !/\b(?:require|compel|direct|must)\b/.test(originalBody)) return "compulsion";
  const remedy = originalQ.match(/\b(recover|restore|rescind|revoke|annul|correct)\w*/);
  if (remedy && originalBody && !originalBody.includes(v38Stem(remedy[1]))) return "remedy";
  if ((obligations ?? []).some((obligation) => v4ExplicitProceduralCounterEvidence(obligation, result) > 0)) {
    return "counter-evidence";
  }
  return null;
}
function v38DirectWitness(question,result) {
  if (!result || !['standing_orders','speakers_rulings'].includes(result.documentCorpus) ||
      !String(result.sectionId ?? '').trim() ||
      String(result.sectionContent ?? '').trim().length<35 ||
      !v38Identity(question,result) || !v38NormativeSource(result.sectionContent)) return null;
  const q=v38Terms(question), title=v38Terms(result.heading), body=v38Terms(result.sectionContent);
  const originalQ=normalize(question);
  const originalBody=normalize(result.sectionContent);
  // Source text must govern the *requested act*, not merely its setting.
  // A question about compelling a different member cannot be answered by a
  // source solely about whether a member may object to leave or seek it for
  // somebody else. Likewise a remedy for lost time requires a source that
  // actually addresses time compensation, not just points of order.
  const asksCompulsion = /\b(?:require|compel|direct)\b/.test(originalQ);
  const sourceIsOnlyRequest = /\b(?:may|can)\s+(?:ask|request|seek)\b/.test(originalBody)
    && !/\b(?:require|compel|direct|must)\b/.test(originalBody);
  if (asksCompulsion && sourceIsOnlyRequest) return null;
  const remedy = originalQ.match(/\b(recover|restore|rescind|revoke|annul|correct)\w*/);
  if (remedy && !originalBody.includes(v38Stem(remedy[1]))) return null;
  if (q.size<2) return null;
  const headings=v38Intersection(q,title);
  const witness=v38Intersection(q,body);
  // Some numbered Speaker's Rulings live under broad chapter headings.
  // Allow a body-only exception only with a distinctive operative appeal
  // and the *same* named presiding officer in both question and source.
  const qNorm=normalize(question);
  const sourceNorm=normalize(result.sectionContent);
  const bodyOnlyAppeal=headings===0 && result.documentCorpus==='speakers_rulings' &&
    witness>=3 && /\bappeal\b/.test(qNorm) && /\bappeal\b/.test(sourceNorm) &&
    /\b(?:speaker|chair|chairperson|presiding)\b/.test(qNorm) &&
    /\b(?:speaker|chair|chairperson|presiding)\b/.test(sourceNorm);
  if ((headings<1 && !bodyOnlyAppeal) || witness<2) return null;
  const titleCoverage=headings/Math.max(1,Math.min(5,title.size));
  const bodyCoverage=witness/Math.max(2,Math.min(10,q.size));
  const score=bodyOnlyAppeal ? 0.2+bodyCoverage*0.8 :
    titleCoverage*0.45+bodyCoverage*0.55 + Math.min(0.06,headings*0.015);
  // A heading and one generic word are not enough to grant a permission.
  // Direct source text must account for a substantial part of the user's act.
  const active=/(?:can|may|must|not|without|never|always|automatically|entitled|require|only|does)/.test(qNorm);
  if (!active || score<0.39 || (headings===1 && witness<3 && score<0.58)) return null;
  return {score,headings,witness, titleCoverage,bodyCoverage};
}
function v38EvidenceAdmission(question,candidates,obligations,current) {
  const sourceItems = candidates.map((item)=>({
    candidate:item,
    witness:v38DirectWitness(question,item.result),
  })).filter((item)=>item.witness);
  sourceItems.sort((a,b)=> b.witness.score-a.witness.score ||
    b.witness.headings-a.witness.headings ||
    b.witness.witness-a.witness.witness ||
    b.candidate.maxRank-a.candidate.maxRank ||
    String(a.candidate.result.sectionId).localeCompare(String(b.candidate.result.sectionId)));
  // An inapplicable named procedure must not survive simply because no
  // verified replacement is available. This is a safe abstention, not an
  // endorsement of an adjacent (but wrong) procedural framework.
  const identityMismatch=current.length>0 && current.every((item)=>
    !v38Identity(question,item.candidate.result));
  if (!sourceItems.length) return {selected:identityMismatch?[]:current,
    reason:identityMismatch?'identity_conflict_no_witness':'no_direct_witness'};
  let selected=[...current];
  const relevantSelected=selected.filter((item)=>v38DirectWitness(question,item.candidate.result));
  // Recovery is justified only for an empty or demonstrably wrong-procedure
  // pack, not by a small rank difference that could destabilise a valid pack.
  if (selected.length===0 || identityMismatch) {
    const best=sourceItems[0];
    const runner=sourceItems[1];
    const sufficientlyDistinct=!runner ||
      (best.witness.score-runner.witness.score>=0.09) ||
      (best.witness.headings>=runner.witness.headings+2 &&
       best.witness.score>=runner.witness.score-0.03);
    if (!sufficientlyDistinct || (best.witness.score<0.49 &&
        !(best.witness.score>=0.40 && best.witness.headings>=1 && best.witness.witness>=5))) {
      return {selected:identityMismatch?[]:current,
        reason:identityMismatch?'identity_conflict_ambiguous_witness':'ambiguous_direct_witness'};
    }
    selected=buildMatrix(obligations,question,[best.candidate]);
  } else if (!relevantSelected.length) {
    // A selected source may be useful context without being responsive.
    // Retain it and report that no source-attested replacement was certified.
    return {selected:current,reason:'no_safe_replacement'};
  }
  return {selected,reason: identityMismatch?'contrastive_replaced':
    current.length===0?'direct_source_recovered':'unchanged'};
}


// OPEN ORDER v39: admit a uniquely witnessed operative source when the normal
// semantic pack is empty. Do not convert a stray heading or numerical coincidence
// into a procedural authority. This path never enlarges an already grounded pack.
function v39OperativeSourceWitness(question, result) {
  if (!result || !['standing_orders','speakers_rulings'].includes(result.documentCorpus) ||
      !String(result.sectionId ?? '').trim() ||
      String(result.sectionContent ?? '').trim().length < 40 ||
      !v38Identity(question,result)) return null;
  const q = normalize(question);
  const body = normalize(result.sectionContent);
  const title = normalize(result.heading ?? '');
  // A source about an unrelated actor or a different procedural stage cannot
  // qualify on shared generic words (e.g. a six-month Government response).
  if (/\bselect committee\b/.test(q) &&
      !/\bselect committee\b/.test(title+' '+body)) return null;
  if (/\bbusiness committee\b/.test(q) &&
      !/\bbusiness committee\b/.test(title+' '+body)) return null;
  const requestedStage = v38Stage(q);
  if (requestedStage && !new RegExp('\\b'+requestedStage.replace(/ /g,'\\s+')+'\\b').test(title+' '+body)) return null;
  const asked = v38Terms(question);
  const bodyTerms = v38Terms(result.sectionContent);
  const titleTerms = v38Terms(result.heading);
  const overlap = v38Intersection(asked,bodyTerms);
  const headingOverlap = v38Intersection(asked,titleTerms);
  if (asked.size < 4 || overlap < 4 || overlap/asked.size < 0.43) return null;
  const subsections = String(result.sectionContent).split(/(?=\(\d+[a-z]?\)\s)/i)
    .map((part)=>part.trim()).filter(Boolean);
  const units = subsections.length ? subsections : [String(result.sectionContent)];
  // Each prospective witness must be an operative clause, rather than a list
  // of matching words scattered across unrelated paragraphs.
  const witnessedUnits = units.map((part)=>({
    part,
    overlap:v38Intersection(asked,v38Terms(part)),
  })).filter((unit)=>unit.overlap>=3 && v38NormativeSource(unit.part));
  if (!witnessedUnits.length) return null;
  const clauseOverlap = Math.max(...witnessedUnits.map((unit)=>unit.overlap));
  if (clauseOverlap < 4 && (clauseOverlap < 3 || headingOverlap < 2)) return null;
  // When the question binds an act to a numbered reading, the witness must
  // bind it to that same reading. A first-reading amendment restriction cannot
  // silently govern a second-reading question merely because the source also
  // mentions that the bill later proceeds to second reading.
  const hasRequestedReading = /\b(?:first|second|third)\s+reading\b/.test(requestedStage);
  if (hasRequestedReading && /\bamendment\b/.test(q)) {
    const local = witnessedUnits.some((unit)=> {
      const raw = normalize(unit.part);
      if (!/\bamendment\b/.test(raw) || !raw.includes(requestedStage)) return false;
      const otherStage = [...raw.matchAll(/\b(?:first|second|third)\s+reading\b/g)]
        .some((match)=>match[0]!==requestedStage);
      return !otherStage;
    });
    if (!local) return null;
  }
  const score = 0.65*(overlap/asked.size) +
    0.25*(clauseOverlap/Math.min(6,asked.size)) +
    0.10*(headingOverlap>0 ? 1:0);
  if (score < 0.55) return null;
  return {score, overlap, headingOverlap, clauseOverlap};
}
// v39.1: source-hierarchy context disambiguation for *tied* operative rules.
// Two provisions can contain the same governing sentence but apply to
// different named proceedings. Prefer neither by section number, corpus rank,
// or bare shared text. The question must independently name a distinctive
// context supported in one candidate's heading/path, not the other's.
function v391SourceContextTerms(result) {
  const path=Array.isArray(result.path) ? result.path : [];
  const parts=[String(result.heading ?? ''), ...path.map((value)=>String(value))];
  const words=v38Terms(parts.join(' '));
  const generic=new Set(['chapter','procedur','procedure','legislativ','financial',
    'general','provision','bill','rule','stand','source','reading',
    'government','non','miscellaneous','time','report','select','committee',
    'member','speaker','decision','motion','question','relevan','stage',
    'process','notice','result','action','debate','authority','official',
    'period','require','permission','condition','application','effect']);
  return new Set([...words].filter((word)=>!generic.has(word) &&
    !/^\d+[a-z]?$/.test(word)));
}
function v391ContextualTieWitness(question, contenders) {
  if (contenders.length<2) return null;
  const q=v38Terms(question);
  const contexts=contenders.map(({candidate})=>v391SourceContextTerms(candidate.result));
  // Require a user-supplied scope term that uniquely identifies the
  // source hierarchy, not a word shared by all candidates.
  const scores=contexts.map((context,i)=>{
    const exclusive=[...context].filter((word)=>q.has(word) &&
      contexts.every((other,j)=>i===j || !other.has(word)));
    return {index:i,exclusive};
  });
  const matches=scores.filter((item)=>item.exclusive.length>0);
  // If more than one tied rule matches a different named context, the
  // evidence still does not resolve which governs; preserve abstention.
  if (matches.length!==1) return null;
  return contenders[matches[0].index];
}
function v39EvidenceAdmission(question,candidates,obligations,current,maxAuthorities) {
  if (maxAuthorities < 1) return {selected:current,reason:'no_capacity'};
  const possible=candidates.map((candidate)=>({
    candidate, witness:v39OperativeSourceWitness(question,candidate.result)
  })).filter((entry)=>entry.witness)
    .sort((a,b)=>b.witness.score-a.witness.score ||
      b.witness.clauseOverlap-a.witness.clauseOverlap ||
      String(a.candidate.result.sectionId).localeCompare(String(b.candidate.result.sectionId)));
  if (current.length>0 && current.some((item)=>v38Identity(question,item.candidate.result))) {
    // v39.1: An already selected source is ordinarily immutable. The only
    // exception is when a *single* selected source and another candidate
    // have independently witnessed the same asked act with tied scores, but
    // one alone has a distinct named procedure matched in the question.
    // This resolves an otherwise misleading cross-procedure rule without
    // treating an arbitrary heading or a retrieval rank as legal authority.
    if (current.length===1 && possible.length>=2) {
      const best=possible[0];
      const tied=possible.filter((entry)=>best.witness.score-entry.witness.score<0.075);
      const held=tied.some((entry)=>entry.candidate.result.sectionId===current[0].candidate.result.sectionId);
      const scoped=held && tied.length>=2 ? v391ContextualTieWitness(question,tied) : null;
      if (scoped && scoped.candidate.result.sectionId!==current[0].candidate.result.sectionId) {
        const matrix=buildMatrix(obligations,question,[scoped.candidate]);
        if (matrix.length===1) return {selected:matrix,reason:'v39_1_scope_replaced'};
      }
    }
    return {selected:current,reason:'existing_pack_preserved'};
  }
  if (!possible.length) return {selected:current,reason:'no_operative_witness'};
  const best=possible[0],runner=possible[1];
  // A tie is evidence of unresolved source competition, not permission to guess.
  let governing=best;
  let admissionReason='v39_unique_operative_source';
  if (runner && best.witness.score-runner.witness.score<0.075) {
    // Rank only the operative-source candidates that are already within
    // the ambiguity margin. Resolve the tie with a *unique* question-linked
    // heading/path identity, never with source numbering or retrieval rank.
    const tied=possible.filter((entry)=>best.witness.score-entry.witness.score<0.075);
    const scoped=v391ContextualTieWitness(question,tied);
    if (!scoped) return {selected:current,reason:'ambiguous_operative_witness'};
    governing=scoped;
    admissionReason='v39_1_scope_disambiguated';
  }
  const matrix=buildMatrix(obligations,question,[governing.candidate]);
  if (matrix.length!==1) return {selected:current,reason:'operative_matrix_unavailable'};
  return {selected:matrix,reason:admissionReason};
}

export async function selectV517AuthorityPack(input) {
  const subQuestions = Array.isArray(input.situation?.subQuestions) ? input.situation.subQuestions : undefined;
  const obligations = deriveObligations(input.question, input.plannerRelations, subQuestions);
  const narratedContextDetached = new WeakSet();
  // OPEN ORDER F5D0437 APB7: narrated facts are not authority text requirements.
  // A report of what a third party announced is an object of the procedural
  // question, not itself a condition every governing authority must recite.
  // Preserve input.question and the original contextual statement; narrow ONLY
  // the literal identity/state tokens required for a distinct modal question.
  // Explicit dependent timing/conditional questions are excluded.
  for (const obligation of obligations) {
    const background = normalize(obligation.inherited ?? "");
    const local = normalize(obligation.local ?? "");
    const announcedEvent = /\b(?:announced|reported|published|released|revealed|disclosed)\b/.test(background);
    const distinctModal = /^(?:can|may|could)\b/.test(local);
    const deicticObject = /\b(?:it|this|that)\b/.test(local);
    const conditionInRequest = /\b(?:after|before|when|once|unless|until|since|only if|as soon as)\b/.test(local);
    // OPEN ORDER F5D0437 APB7.3: narrative context can carry binding scope.
    // A publication outside Parliament, an exclusive forum, or a procedural
    // before/after condition must not be detached as incidental narration.
    // Conservatively retain the whole background if any scope boundary occurs.
    const scopeBoundary =
      /\b(?:outside|inside|within|without|only|solely|exclusively|except|unless|before|after|not|never|prior|subsequent)\b/.test(background) ||
      /\b(?:in|at|during)\s+(?:the\s+)?(?:house|parliament|committee|court|chamber|sitting|session)\b/.test(background);
    if (!announcedEvent || scopeBoundary || !distinctModal || !deicticObject || conditionInRequest ||
        obligation.relations?.length !== 1 || obligation.relations[0] !== "permission") continue;
    const localWords = new Set(local.split(/\s+/).filter(Boolean));
    const incidental = new Set((obligation.stateTerms ?? []).filter(
      (term) => !localWords.has(String(term))
    ));
    if (incidental.size === 0) continue;
    for (const field of ["referentTerms", "subjectTerms", "predicateObjects"]) {
      if (!Array.isArray(obligation[field])) continue;
      const retained = obligation[field].filter((term) => !incidental.has(term));
      if (retained.length > 0) obligation[field] = retained;
    }
    obligation.stateTerms = (obligation.stateTerms ?? []).filter((term) => !incidental.has(term));
    const operativeActors = [...actorTerms(obligation.local ?? "")];
    if (operativeActors.length > 0) obligation.actorTerms = operativeActors;
    narratedContextDetached.add(obligation);
  }
  // OPEN ORDER F5D0437 APB3: epistemic stance is not procedural identity.
  // In a permission claim grounded solely in someone's belief that an outcome
  // is wrong, the belief and evaluative words do not identify the procedure
  // governed by a source. Keep the requested action and entitlement language,
  // the ORIGINAL question, and all procedural-state/relation gates intact.
  // This recognises rules governing objective error without treating a person's
  // assertion of error as proof that an error actually occurred.
  const epistemicIdentityNoise = new Set([
    "simply", "merely", "believe", "belief", "think", "assume", "feel",
    "wrong", "incorrect", "mistaken", "invalid", "was",
  ]);
  for (const obligation of obligations) {
    const local = normalize(obligation.local ?? "");
    const permissionOnly = obligation.relations?.length === 1 &&
      obligation.relations[0] === "permission";
    const claimedError = /\b(?:believe|think|assume|feel)\b/.test(local) &&
      /\b(?:wrong|incorrect|mistaken|invalid)\b/.test(local);
    if (!permissionOnly || !claimedError) continue;
    for (const field of ["referentTerms", "subjectTerms", "predicateObjects"]) {
      if (!Array.isArray(obligation[field])) continue;
      const retained = obligation[field].filter((term) =>
        !epistemicIdentityNoise.has(String(term))
      );
      if (retained.length > 0) obligation[field] = retained;
    }
  }
  const dimensions = productionDimensions(input.searches ?? []);
  const appealQuery = presidingOfficerAppealQuery(input.situation);
  if (appealQuery && !dimensions.some((dimension) => normalize(dimension.query) === normalize(appealQuery))) {
    dimensions.push({ query: appealQuery, corpus: "speakers_rulings", provenance: "semantic_expansion" });
  }
  const baseCandidates = new Map();

  for (const dimension of dimensions) {
    const response = await input.searchProceduralAuthorities({
      q: dimension.query,
      corpus: dimension.corpus,
      limit: 10,
      offset: 0,
      includeDebug: false,
    });

    response.results.forEach((result, index) => {
      addCandidate(baseCandidates, result, {
        kind: "base",
        query: dimension.query,
        provenance: dimension.provenance,
        position: index + 1,
      });
    });
  }

  const enrichedCandidates = new Map(baseCandidates);

  for (const dimension of dimensions) {
    const widened = await input.searchProceduralAuthorities({
      q: dimension.query,
      corpus: dimension.corpus,
      limit: 30,
      offset: 0,
      includeDebug: false,
    });

    if (Number(widened.total) <= 10) continue;

    widened.results.slice(10).forEach((result, index) => {
      addCandidate(enrichedCandidates, result, {
        kind: "adaptive_widen",
        query: dimension.query,
        provenance: dimension.provenance,
        position: index + 11,
      });
    });
  }

  const baseList = [...baseCandidates.values()];
  const provisionalMatrix = buildMatrix(obligations, input.question, baseList);
  const neighbourSeeds = new Set();

  for (
    let obligationIndex = 0;
    obligationIndex < obligations.length;
    obligationIndex += 1
  ) {
    const ranked = [...provisionalMatrix]
      .filter(
        (item) =>
          item.candidate.result.documentCorpus === "standing_orders" &&
          parseStandingOrderNumber(item.candidate.result.citationLabel) !== null
      )
      .sort(
        (a, b) =>
          b.obligationProfiles[obligationIndex].lexicalFit -
          a.obligationProfiles[obligationIndex].lexicalFit
      )
      .slice(0, 2);

    for (const item of ranked) {
      const number = parseStandingOrderNumber(item.candidate.result.citationLabel);
      if (number === null) continue;
      neighbourSeeds.add(number - 1);
      neighbourSeeds.add(number + 1);
    }
  }

  const explicitCorpora = new Set(
    dimensions
      .map((dimension) => dimension.corpus)
      .filter((corpus) => corpus !== null)
  );
  const structuralCorpus =
    explicitCorpora.size === 1 ? [...explicitCorpora][0] : null;

  if (structuralCorpus !== "speakers_rulings") {
    for (const number of neighbourSeeds) {
      if (!Number.isInteger(number) || number < 1) continue;

      const lookup = await input.searchProceduralAuthorities({
        q: `SO ${number}`,
        corpus: structuralCorpus,
        limit: 3,
        offset: 0,
        includeDebug: false,
      });

      const exact = lookup.results.find(
        (result) => result.citationLabel === `SO ${number}`
      );
      if (!exact) continue;

      addCandidate(enrichedCandidates, exact, {
        kind: "structural_adjacent",
        query: `SO ${number}`,
        provenance: "structural",
        position: 1,
      });
    }
  }

  // Generic same-heading recovery for Speakers' Rulings. A sibling inherits
  // the ordinary query routes that exposed its heading; no citation labels or
  // expected authorities are used.
  const rulingHeadingSeeds = new Map();
  for (const candidate of baseCandidates.values()) {
    if (
      candidate.result.documentCorpus !== "speakers_rulings" ||
      !String(candidate.result.heading ?? "").trim()
    ) continue;

    const heading = String(candidate.result.heading).trim();
    const key = normalize(heading);
    const routes = candidate.sources.filter(
      (source) => source.kind !== "structural_adjacent"
    );
    if (routes.length === 0) continue;

    const existing = rulingHeadingSeeds.get(key);
    if (!existing) {
      rulingHeadingSeeds.set(key, { heading, routes: [...routes] });
    } else {
      existing.routes.push(...routes);
    }
  }

  for (const { heading, routes } of rulingHeadingSeeds.values()) {
    const lookup = await input.searchProceduralAuthorities({
      q: heading,
      corpus: "speakers_rulings",
      limit: 10,
      offset: 0,
      includeDebug: false,
    });

    lookup.results
      .filter(
        (result) =>
          normalize(result.heading ?? "") === normalize(heading)
      )
      .forEach((result, index) => {
        for (const route of routes) {
          addCandidate(enrichedCandidates, result, {
            kind: "heading_sibling",
            query: route.query,
            provenance: route.provenance,
            position: Math.max(route.position ?? 1, index + 1),
          });
        }
      });
  }

  // OPEN ORDER F5D0437 APB1: candidate-only secondary evidence.
  // Corpus-bridge and legacy-recovery results are already retrieved by the
  // route, but those searches must NOT become new semantic base dimensions:
  // a heading breadcrumb can be spurious. Admit at most six existing results
  // per secondary search, only when an independent body-text predicate witness
  // matches the user-derived obligation. The ordinary buildMatrix eligibility
  // gates and authority-pack optimizer still decide whether to select them.
  for (const search of input.searches ?? []) {
    const provenance = String(search?.provenance ?? "");
    if (provenance !== "corpus_bridge" && provenance !== "recovery") continue;
    const results = Array.isArray(search?.results) ? search.results.slice(0, 6) : [];
    for (const [index, result] of results.entries()) {
      const body = String(result?.sectionContent ?? "");
      if (!result?.sectionId || body.trim().length < 12) continue;
      const bodyTokens = tokenSet(body);
      const bodyEvents = [...eventTermsFromText(body)];
      const independentBodyWitness = obligations.some((obligation) => {
        const events = obligation.predicateEvents ?? [];
        const objects = obligation.predicateObjects ?? [];
        const subjects = obligation.subjectTerms ?? [];
        const eventFit = events.length > 0 ? setFit(events, bodyEvents) : 0;
        const objectFit = objects.length > 0
          ? overlapRatio(new Set(objects), bodyTokens) : 0;
        const subjectFit = subjects.length > 0
          ? overlapRatio(new Set(subjects), bodyTokens) : 0;
        // The predicate must be present in the BODY; headings and discovery
        // promotions cannot create a witness. A bare domain noun is not enough.
        const predicateWitness = events.length > 0
          ? eventFit >= 0.5
          : objects.length > 0 && objectFit >= 0.7 &&
            subjects.length > 0 && subjectFit >= 0.5;
        return predicateWitness &&
          (subjectFit >= 0.25 || objectFit >= 0.5 ||
           (subjects.length === 0 && eventFit >= 0.5));
      });
      if (!independentBodyWitness) continue;
      addCandidate(enrichedCandidates, result, {
        kind: "secondary_body_witness",
        query: String(search.query ?? ""),
        provenance,
        position: index + 1,
      });
    }
  }

  const candidates = [...enrichedCandidates.values()];
  // OPEN ORDER F5D0437 APB7.1: initiating debate is distinct from attending it.
  // When narrated context was detached from a demand to compel immediate action,
  // a source describing a routinely scheduled debate is not sufficient. Require
  // an actor-linked procedure for seeking/initiating that debate in the body.
  // Do not infer an enforceable entitlement merely from an application pathway.
  let matrix = buildMatrix(obligations, input.question, candidates).filter((item) =>
    obligations.every((obligation, index) => {
      if (!narratedContextDetached.has(obligation) ||
          !/\b(?:force|compel|insist|demand|require)\b/.test(normalize(obligation.local ?? "")) ||
          !/\bdebate\b/.test(normalize(obligation.local ?? "")) ||
          !item.obligationProfiles[index]?.eligible) return true;
      const body = String(item.candidate.result.sectionContent ?? "");
      return body.split(/[.!?]\s+|\n+/).some((rawClause) => {
        const clause = normalize(rawClause);
        return (
        /\b(?:member|members|person|persons|minister|committee|chairperson)\b/.test(clause) &&
        /\bdebate\b/.test(clause) &&
        (// An application to the presiding authority: desire + required written submission.
         /\b(?:wishes|seeks)\b.{0,100}\bdebate\b.{0,150}\b(?:must|shall|may)\b.{0,50}\b(?:give|submit|lodge|send)\b.{0,70}\b(?:statement|application|notice)\b/.test(clause) ||
         // Or an express entitlement to initiate the debate, not merely speak in it.
         /\b(?:may|can|must|shall)\b.{0,50}\b(?:request|apply for|move for|demand|require|compel)\b\s+(?:(?:that|the|a|an|this|house|to|hold|holding|of|urgent|general|immediate|immediately|for|be|held)\s+){0,12}debate\b/.test(clause))
        );
      });
    })
  );
  // OPEN ORDER APB11: require source-body evidence of the requested act,
  // rather than allowing shared background nouns to dominate pack utility.
  // An application for an urgent debate is deliberately *not* a compulsory
  // entitlement gate: existing v7.3 logic handles relevant partial evidence.
  const v11Act = v11RequestedProceduralAct(input.question, input.plannerRelations);
  if (v11Act) {
    matrix = matrix.filter((item) =>
      v11ActWitnessedByAuthority(v11Act, item.candidate.result)
    );
  }
  const requestedMax = Number.isInteger(input.maxAuthorities)
    ? input.maxAuthorities
    : 4;
  const maxAuthorities = Math.max(1, Math.min(requestedMax, 4));
  const rawSelection = selectPack(obligations, matrix, maxAuthorities);
  const initialSelection = pruneRedundantAuthorities(rawSelection.selected, obligations);
  const selection = v4AugmentMinisterReplyPack({
    question: input.question, matrix, obligations,
    initial: initialSelection, maxAuthorities,
  });

  // OPEN ORDER APB v22: qualify a primary Standing Order with one independent
  // Speaker's ruling only where the selector already admits both for the same
  // question, the corpus headings agree, and the ruling states an actual limit.
  // This is an auxiliary authority, not an eligibility bypass or a claim that
  // the main obligation is complete. No generic neighbouring-rule promotion.
  const ooAssembled = [...selection.selected];
  const ooSelectedKeys = new Set(ooAssembled.map((item) =>
    `${item.candidate.result.documentCorpus}:${item.candidate.result.citationLabel}`));
  const ooSupplementalLabels = [];
  if (v11Act && ooAssembled.length < maxAuthorities) {
    for (const primary of selection.selected) {
      if (ooAssembled.length >= maxAuthorities) break;
      const source = primary.candidate.result;
      if (source.documentCorpus !== "standing_orders" ||
          !v11ActWitnessedByAuthority(v11Act, source)) continue;
      const heading = normalize(String(source.heading ?? ""));
      if (heading.split(/\s+/).filter(Boolean).length < 2) continue;
      const peers = matrix.filter((item) => {
        const candidate = item.candidate.result;
        const key = `${candidate.documentCorpus}:${candidate.citationLabel}`;
        const text = String(candidate.sectionContent ?? "").toLowerCase().replace(/\s+/g, " ");
        return candidate.documentCorpus === "speakers_rulings" &&
          !ooSelectedKeys.has(key) &&
          normalize(String(candidate.heading ?? "")) === heading &&
          item.obligationProfiles.length === obligations.length &&
          item.obligationProfiles.every((profile) => profile.eligible) &&
          v11ActWitnessedByAuthority(v11Act, candidate) &&
          /\b(?:in the absence of|no authority|not a ground|cannot|must not|may not|unless|not entitled|no right)\b/.test(text);
      });
      // Ambiguous clusters are left untouched rather than ranked by headings.
      if (peers.length !== 1) continue;
      const peer = peers[0];
      const peerKey = `${peer.candidate.result.documentCorpus}:${peer.candidate.result.citationLabel}`;
      ooSelectedKeys.add(peerKey);
      ooAssembled.push(peer);
      ooSupplementalLabels.push(peer.candidate.result.citationLabel);
    }
  }
  // OPEN ORDER APB v26: preserve the baseline governing rule, then add a
  // uniquely source-attested application authority for an independently
  // asked procedural step. The ordinary pack utility/eligibility is intact.
  const ooV26Companions = v26SourceAttestedCompanions(
    input.question, matrix, ooAssembled, maxAuthorities);
  for (const ooV26Item of ooV26Companions) ooAssembled.push(ooV26Item);
  // OPEN ORDER v31: source-proven limited grant is evidence against a
  // supposed universal entitlement. Existing eligible selections win.
  const ooV31Companions = v31ConditionalEntitlementComplement(input.question, matrix, ooAssembled, maxAuthorities);
  for(const ooV31Item of ooV31Companions) ooAssembled.push(ooV31Item);
  const v33Completeness = v33CompleteEvidencePack(input.question, matrix, ooAssembled, maxAuthorities);
  ooAssembled.splice(0, ooAssembled.length, ...v33Completeness.selected);
  // v37: a request is not a decision. Independently witness each procedural
  // role before admitting a source-grounded request/decision pair.
  const v37Decisions = v37CompleteRequestDecision(
    input.question, candidates, obligations, ooAssembled, maxAuthorities);
  ooAssembled.splice(0, ooAssembled.length, ...v37Decisions);
  // A selected rule's express exception can cite a separate governing rule.
  // Only follow a unique, body-attested operative reference already retrieved.
  const v37References = v37OperativeExceptionReferences(
    input.question, candidates, obligations, ooAssembled, maxAuthorities);
  ooAssembled.splice(0, ooAssembled.length, ...v37References);
  // v38: one bounded source-only adjacent check for actor restrictions when
  // the user is expressly asking about a non-Minister/backbench member. The
  // normal candidate search may miss a separate neighbouring limitation.
  // Neither the neighbouring number nor its content is assumed to govern:
  // an exact returned source and the body-level restrictive witness are required.
  const actorClassQuery = actorClassQualificationQuery(input.situation?.actor ?? "");
  if (actorClassQuery) {
    const knownIds = new Set(candidates.map((item) => item.result.sectionId));
    const response = await input.searchProceduralAuthorities({
      q: actorClassQuery, corpus: "standing_orders", limit: 5, offset: 0, includeDebug: false,
    });
    for (const result of response.results ?? []) {
      if (knownIds.has(result.sectionId)) continue;
      if (!actorClassSourceQualifies(input.situation?.actor ?? "", result)) continue;
      knownIds.add(result.sectionId);
      candidates.push({ result, maxRank: result.rank, sources: [{
        kind: "actor_class_qualification", query: actorClassQuery, provenance: "structural", position: 1,
      }] });
    }
  }
  // v38: source-body-only direct witness admission and actor-scope closure.
  // Never promotes a wrong named procedure or a source without an operative rule.
  const v38Admission = v38EvidenceAdmission(
    input.question, candidates, obligations, ooAssembled);
  ooAssembled.splice(0, ooAssembled.length, ...v38Admission.selected);
  // v39 fallback is deliberately post-v38 and refuses to replace an
  // applicable, selected source. It admits one source only on a unique,
  // independently witnessed operative-clause match.
  const v39Admission = v39EvidenceAdmission(
    input.question, candidates, obligations, ooAssembled, maxAuthorities);
  ooAssembled.splice(0, ooAssembled.length, ...v39Admission.selected);
  const prePruneLabels = rawSelection.selected.map(
    (item) => item.candidate.result.citationLabel
  );
  const selectedLabels = ooAssembled.map(
    (item) => item.candidate.result.citationLabel
  );
  // OPEN ORDER F5D0437 APB7.2: application evidence is not compulsory entitlement.
  // Only the specific narrated-context/compulsory-debate obligation needs
  // independent body evidence to be marked complete. The authority remains
  // eligible for partial, carefully bounded answers; coverage is not inflated.
  const compulsoryDebateEntailment = () => selection.selected.some((item) => {
    const body = String(item.candidate.result.sectionContent ?? "");
    return body.split(/[.!?]\s+|\n+/).some((rawClause) => {
      const clause = normalize(rawClause);
      const actor = /\b(?:member|members|opposition|person|persons|minister)\b/.test(clause);
      const compulsoryDebate = /\b(?:force|compel|require)\s+(?:(?:that|the|a|an|this|house|to|hold|holding|of|on|for|urgent|general|immediate|immediately|be|held|upon|it|will|must|shall|should|any|proposed|sitting|matter)\s+){0,12}debate\b/.test(clause);
      const normative = /\b(?:can|may|shall|must|cannot|can not|may not|must not|shall not|no right to|no power to|not entitled to|has no right to|does not have the power to)\b/.test(clause);
      return actor && compulsoryDebate && normative;
    });
  });
  const obligationDetails = selection.utility.obligationDetails.map((detail, index) => {
    const obligation = obligations[index];
    const local = normalize(obligation?.local ?? "");
    const strongClaim = /\b(?:force|compel|insist|demand|require)\b/.test(local) &&
      /\bdebate\b/.test(local);
    return {
      coverage: detail.coverage,
      complete: detail.complete &&
        (!narratedContextDetached.has(obligation) || !strongClaim ||
          compulsoryDebateEntailment()),
    };
  });
  const minObligationCoverage =
    obligationDetails.length > 0
      ? Math.min(...obligationDetails.map((detail) => detail.coverage))
      : 0;
  const allObligationsComplete =
    obligationDetails.length > 0 &&
    obligationDetails.every((detail) => detail.complete);

  const selectedIds = new Set(ooAssembled.map((item) => item.candidate.result.sectionId));
  const rejectedAuthorities = [];
  const seenRejection = new Set();
  for (const candidate of candidates) {
    const result = candidate.result;
    if (!result?.sectionId || selectedIds.has(result.sectionId) || seenRejection.has(result.sectionId)) continue;
    const reason = selectorRejectionReason(input.question, result, obligations);
    if (!reason) continue;
    seenRejection.add(result.sectionId);
    rejectedAuthorities.push({
      sectionId: result.sectionId,
      citationLabel: result.citationLabel,
      documentCorpus: result.documentCorpus,
      reason,
    });
  }

  return {
    finalAuthorities: ooAssembled.map((item) => item.candidate.result),
    prePruneLabels,
    selectedLabels,
    prunedRedundant: selection.pruned,
    minObligationCoverage,
    allObligationsComplete,
    obligationDetails,
    candidateCount: candidates.length,
    evidenceAdmission: ['v39_unique_operative_source','v39_1_scope_disambiguated','v39_1_scope_replaced'].includes(v39Admission.reason)
      ? v39Admission.reason : v38Admission.reason,
    rejectedAuthorities,
  };
}
