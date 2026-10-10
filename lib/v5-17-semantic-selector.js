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

function rawAtomicClauses(question) {
  const clean = String(question ?? "").trim().replace(/\?+\s*$/, "");

  const sentenceAware = clean
    .replace(
      /[.!]\s+(?=(?:what|when|where|who|whose|how|which|can|may|does|do|is|are|will|in what|by what|by when|on what|under what|for what)\b)/gi,
      " ||| "
    )
    .replace(
      /;\s*(?:and\s+)?(?=(?:(?:after|if|before|while|once)\b[^;?]{0,180}\b(?:what|when|where|who|whose|how|which|can|may|does|do|is|are|will|must|should|would|could|by when)\b|(?:what|when|where|who|whose|how|which|can|may|does|do|is|are|will|must|should|would|could|by when)\b))/gi,
      " ||| "
    )
    .replace(
      /;\s*(?:and\s+)?(?=(?:for|as to|in relation to)\b[^;?]{0,120},\s*(?:what|when|where|who|whose|how|which|can|may|does|do|is|are|will|must|should|would|could|by when)\b)/gi,
      " ||| "
    )
    .replace(
      /,\s*(?:and\s+)?(?=(?:after|if|before|while|once)\b[^,?]{0,160}\b(?:what|when|where|who|whose|how|which|can|may|does|do|is|are|will|by when)\b)/gi,
      " ||| "
    );

  const raw = sentenceAware
    .split(/\s*\|\|\|\s*/)
    .flatMap((sentence) =>
      sentence.split(
        /,\s*(?:and\s+)?(?=(?:what|when|where|who|whose|how|which|can|may|does|do|is|are|will|in what|by what|by when|on what|under what|for what)\b)/i
      )
    )
    .flatMap((part) => {
      if (/\bhow\s+and\s+by what\b/i.test(part)) return [part];
      return part.split(
        /\band\s+(?=(?:what|when|where|who|whose|how|which|can|may|does|do|is|are|will|in what|by what|by when|on what|under what|for what)\b)/i
      );
    })
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const branch = part.match(
        /^what\s+happens?\s+if\s+(.+?)\s+is\s+(refused|approved)\s+or\s+(refused|approved)(,\s*including\s+.+)?$/i
      );
      if (!branch) return [part];
      const suffix = branch[4] ?? "";
      return [
        `what happens if ${branch[1]} is ${branch[2]}`,
        `what happens if ${branch[1]} is ${branch[3]}${suffix}`,
      ];
    })
    .map((part) => {
      const embedded = part.match(
        /^(after|if|before|while|once)\s+(.+?)\s+((?:what|when|where|who|whose|how|which|by when)\b.+)$/i
      );
      if (!embedded) return part;
      return `${embedded[3]} ${embedded[1]} ${embedded[2]}`.trim();
    })
    .flatMap((part) => {
      const match = part.match(
        /^(what(?:\s+[a-z][a-z'-]*){0,4}\s+rules?\s+govern)\s+(.+)$/i
      );
      if (!match) return [part];
      let listText = match[2].trim();
      let trailingContext = "";
      const contextMatch = listText.match(/\s+((?:once|when|if|after|before|while)\b.+)$/i);
      if (contextMatch && contextMatch.index !== undefined) {
        trailingContext = contextMatch[1];
        listText = listText.slice(0, contextMatch.index).trim();
      }
      const items = listText
        .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
        .map((item) => item.trim())
        .filter(Boolean);
      if (items.length < 2) return [part];
      return items.map((item) =>
        `${match[1]} ${item}${trailingContext ? ` ${trailingContext}` : ""}`.trim()
      );
    });

  const merged = [];
  for (let index = 0; index < raw.length; index += 1) {
    const clause = raw[index];

    if (
      /^(how|what|when|where|who|whose|which)$/i.test(clause) &&
      index + 1 < raw.length
    ) {
      merged.push(`${clause} and ${raw[index + 1]}`);
      index += 1;
      continue;
    }

    const shortModalScaffold = clause.match(
      /^(what|who|which)\s+(may|can|must|shall|will|should|would|could|is|are|does|do)$/i
    );
    if (
      shortModalScaffold &&
      index + 1 < raw.length &&
      new RegExp(`^${shortModalScaffold[2]}\\s+not\\b`, "i").test(raw[index + 1])
    ) {
      merged.push(`${clause} and ${raw[index + 1]}`);
      index += 1;
      continue;
    }

    if (
      merged.length > 0 &&
      isLeadingContextClause(clause) &&
      index + 1 < raw.length &&
      !isLeadingContextClause(raw[index + 1])
    ) {
      let nextClause = raw[index + 1];
      const contextMatch = normalize(clause).match(
        /^(?:for|as to|in relation to)\s+(?:a|an|the)?\s*(.+)$/
      );
      if (contextMatch && /\bit\b/i.test(nextClause)) {
        nextClause = nextClause.replace(
          /\bit\b/i,
          contextMatch[1]
        );
      } else {
        nextClause = `${nextClause} ${clause}`;
      }
      merged.push(nextClause);
      index += 1;
      continue;
    }

    if (
      merged.length > 0 &&
      /^do\s+to\b/i.test(clause)
    ) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} and ${clause}`;
      continue;
    }

    merged.push(clause);
  }
  return merged.length > 0 ? merged : [clean];
}

function isLeadingContextClause(clause) {
  const q = normalize(clause);
  if (!q) return false;

  if (/^(if|after|before|while|once)\b/.test(q)) return true;

  if (/^when\b/.test(q)) {
    return !/^when\s+(?:is|are|can|may|does|do|will|must|should|would|could)\b/.test(q);
  }

  if (/^where\b/.test(q)) {
    return !/^where\s+(?:is|are|can|may|does|do|will|must|should|would|could)\b/.test(q);
  }

  if (/^(?:on|under|for|by|in) what\b/.test(q)) return false;
  if (/^by when\b/.test(q)) return false;

  return !/^(?:what|when|where|who|whose|how|which|can|may|does|do|is|are|will|must|should|would|could|by when)\b/.test(q);
}

function needsAntecedent(clause) {
  const q = normalize(clause);
  return (
    /\b(it|its|that|this|they|them|those|these)\b/.test(q) ||
    /\bthat member\b/.test(q) ||
    /\bthe matter\b/.test(q) ||
    /\bthe bill\b/.test(q) ||
    /\bthe certificate\b/.test(q) ||
    /\bwhat are the exceptions\b/.test(q) ||
    /\bwhat is it for\b/.test(q) ||
    /\bwhere does .* go\b/.test(q) ||
    /\bwhat (?:kind|type|form) of\b/.test(q) ||
    /\bin what circumstances\b/.test(q) ||
    /\bwhat is the .*deadline\b/.test(q) ||
    /\bis there any power\b/.test(q) ||
    /\bthe application\b/.test(q) ||
    /\bany response\b/.test(q) ||
    /\bthat count\b/.test(q)
  );
}

function isSequentialFollowup(clause) {
  const q = normalize(clause);
  return (
    /\bthen\b/.test(q) ||
    /\bwhere does .* (?:then )?go\b/.test(q) ||
    /\bfollows?\b/.test(q) ||
    /\bfollowing\b/.test(q) ||
    /\bsubsequently\b/.test(q) ||
    /\bwhat (?:kind|type|form) of .* next\b/.test(q)
  );
}

function isOutputTypeFollowup(text) {
  const q = normalize(text);
  return (
    /\bwhat (?:kind|type|form) of\b/.test(q) &&
    /\b(follows?|following|next)\b/.test(q)
  );
}

function isDeadlineQuestion(text) {
  const q = normalize(text);
  return /\bdeadline\b/.test(q);
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

function localStateTerms(text) {
  const q = normalize(text);
  if (!q) return new Set();

  const out = new Set();
  const pattern = /\b(if|while|when|after|before|once)\b/g;
  let match;

  while ((match = pattern.exec(q)) !== null) {
    // A leading "when" is normally an interrogative timing request rather than
    // a state precondition ("when may X happen?").
    if (match.index === 0 && match[1] === "when") continue;

    const tail = q.slice(match.index + match[0].length).trim();
    if (!tail) continue;

    const bounded = tail.split(/\b(?:and what|and how|and where|and can|, and)\b/, 1)[0];
    for (const token of stateTerms(bounded)) out.add(token);
  }

  if (/\b(?:at|by) the (?:end|conclusion)\b/.test(q)) {
    out.add("end");
  }

  for (const match of q.matchAll(
    /\bon\s+(?:a|an|any|the)\s+(sitting|working|calendar)\s+(?:day|year)\b/g
  )) {
    out.add(canonicalToken(match[1]));
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

function relativeConditionTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /\b(?:that|who|which)\s+(?:the\s+|a\s+|an\s+)?(?:member|person|speaker|minister|clerk|chair|chairperson|government|party|committee|house)\s+(?!may\b|can\b|must\b|shall\b|will\b|would\b|could\b|should\b)(.+)$/
  );
  if (!match) return new Set();

  const out = new Set();
  const tail = match[1];

  for (const event of eventTermsFromText(tail)) out.add(event);
  for (const token of referentTerms(tail)) {
    if (isMetaOrCarrierTerm(token)) continue;
    if (PERSON_ACTORS.includes(token)) continue;
    out.add(token);
  }
  return out;
}

function passiveSubjectTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /\b(?:may|can|must|shall|will|would|could|should|is|are)\s+(?:an?\s+|the\s+)?(.+?)\s+be\s+(?:presented|lodged|accepted|held|asked|referred|reported|released|suspended|moved|put|read)\b/
  );
  if (!match) return new Set();

  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    if (["not","no"].includes(token)) continue;
    out.add(token);
  }
  return out;
}

function contentTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /^what\s+(?:must|should|does|do|can|may)\s+(.+?)\s+(?:say|state|claim|indicate|specify|identify|contain|include)\b/
  );
  if (!match) return new Set();

  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}



function modifiedHeadEntityTerms(text) {
  const q = normalize(text);
  if (!q) return new Set();

  const match = q.match(
    /\b(?:a|an|the)\s+([a-z][a-z0-9'-]*)\s+(?:relating to|concerning|about)\b/
  );
  if (!match) return new Set();

  const token = canonicalToken(match[1]);
  if (
    !token ||
    isMetaOrCarrierTerm(token) ||
    PERSON_ACTORS.includes(token)
  ) {
    return new Set();
  }

  return new Set([token]);
}


function eligibilityTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(/^what\s+makes?\s+(.+?)\s+(?:eligible|qualified|admissible)\b(.*)$/);
  if (!match) return new Set();
  const source = `${match[1]} ${match[2] ?? ""}`
    .replace(/\b(?:to be\s+)?treated as\b/g, " ")
    .replace(/\b(?:eligible|qualified|admissible)\b/g, " ");
  const out = new Set();
  for (const token of referentTerms(source)) {
    if (["make","treat","as"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function prerequisiteEventTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /^what\s+(.+?)\s+(?:must|should|needs? to)\s+have\s+(?:occurred|happened|been given|been provided|been made)\b/
  );
  if (!match) return new Set();

  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (["prior", "advance", "earlier", "previous"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function governedRuleTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /^what(?:\s+[a-z][a-z'-]*){0,4}\s+rules?\s+govern\s+(.+?)(?:\s+(?:once|when|if|after|before|while)\b.*)?$/
  );
  if (!match) return new Set();

  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (["special", "further", "rule", "govern"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isConditionalActorChoiceQuestion(text) {
  const q = normalize(text);
  return (
    /\bwho\b/.test(q) &&
    /\b(?:if|unless|provided)\b/.test(q) &&
    /\b(?:may|can|entitled|continue|act|speak|move|decide|determine)\w*\b/.test(q)
  );
}

function isStageEffectQuestion(text) {
  const q = normalize(text);
  return /^what\s+happens?\s+(?:at|on|after|before)\s+(?:its|the|a|an)?\s*(?:first|second|third|final)\s+(?:reading|stage|vote|consideration)\b/.test(q);
}

function isTriggerEffectQuestion(text) {
  const q = normalize(text);
  return (
    /^when\s+(?:does|do|is|are)\b/.test(q) &&
    /\b(?:authority|status|effect|right|duty|obligation|publication|protection)\b/.test(q) &&
    /\b(?:arise|begin|start|apply|attach|become|take effect)\b/.test(q)
  );
}

function isDeadlineFailureQuestion(text) {
  const q = normalize(text);
  return (
    /^what\s+happens?\s+if\b/.test(q) &&
    /\b(?:cannot|cant|fails? to|does not)\b/.test(q) &&
    /\b(?:report|file|submit|present|deliver|complete)\b/.test(q) &&
    /\b(?:by then|deadline|due|by)\b/.test(q)
  );
}

function isCriteriaQuestion(text) {
  const q = normalize(text);
  return (
    /^(?:on|under|by|for|in) what (?:basis|grounds|criteria|factors)\b/.test(q) ||
    /^what (?:grounds|criteria|factors|basis|considerations?)\b/.test(q) ||
    /^how\s+is\b.*\b(?:judged|assessed|evaluated)\b/.test(q) ||
    /^what\b.*\bconsider\b.*\b(?:deciding|determining)\s+whether\b/.test(q)
  );
}

function criteriaTargetTerms(text) {
  if (!isCriteriaQuestion(text)) return new Set();
  const q = normalize(text);

  let target = q;
  const judged = q.match(/^how\s+is\s+(.+?)\s+(?:judged|assessed|evaluated)\b/);
  const guide = q.match(/^what\s+considerations?\s+guide\s+(.+)$/);
  const whether = q.match(/\bwhether\s+(.+)$/);

  if (judged) target = judged[1];
  else if (guide) target = guide[1];
  else if (whether) target = whether[1];

  const out = new Set();
  for (const token of referentTerms(target)) {
    if ([
      "basis","ground","grounds","criteria","criterion","factor","factors",
      "consideration","considerations","ought","judge","assess","evaluate"
    ].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isConcessiveOutcomeQuestion(text) {
  const q = normalize(text);
  return /^what\s+(?:must|should|will|would|does|do|can|may)?\s*happen\b.*\beven if\b/.test(q);
}


function isContentAnswerQuestion(text) {
  const q = normalize(text);
  return /^what\s+(?:must|should|does|do|can|may)\b.*\b(?:say|state|claim|indicate|specify|identify|include|contain)\b/.test(q);
}

function isEnumeratedContentAnswerQuestion(text) {
  const q = normalize(text);
  return /^what\s+(?:[a-z][a-z'-]*\s+){0,6}(?:must|should|may|can)\s+be\s+(?:asked|inserted|included|stated|specified|provided|contained|supplied)\b/.test(q);
}

function isActorContentAnswerQuestion(text) {
  const q = normalize(text);
  return /^what\s+(?:must|should|does|do|can|may)\s+(?:a|an|the)?\s*(?:member|witness|person|minister|speaker|chair|chairperson|clerk)\b.*\b(?:say|state|claim|indicate|specify|identify)\b/.test(q);
}

function isConditionalEffectQuestion(text) {
  const q = normalize(text);
  return /^what\s+(?:can\s+|may\s+|will\s+|would\s+)?happens?\s+if\b/.test(q);
}

function isDecisionAuthorityQuestion(text) {
  const q = normalize(text);
  return /^who\b.*\b(?:decides?|determines?|controls?)\b/.test(q);
}

function decisionAuthorityTargetTerms(text) {
  if (!isDecisionAuthorityQuestion(text)) return new Set();
  const out = new Set();
  for (const token of referentTerms(text)) {
    if (["decide","determine","control","exist","about"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isReviewQuestion(text) {
  const q = normalize(text);
  return /^what\s+review\b/.test(q);
}

function reviewTargetTerms(text) {
  if (!isReviewQuestion(text)) return new Set();
  const q = normalize(text);
  const match = q.match(/\b(?:if|when)\b\s+(.+)$/);
  const source = match ? match[1] : q;
  const out = new Set();
  for (const token of referentTerms(source)) {
    if (["review","available","disagree"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isActorExclusionQuestion(text) {
  const q = normalize(text);
  return /^whose\b.*\b(?:excluded|not counted|does not count)\b/.test(q);
}

function actorExclusionTargetTerms(text) {
  if (!isActorExclusionQuestion(text)) return new Set();
  const out = new Set();
  for (const token of referentTerms(text)) {
    if (/^exclud/.test(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}


function isOpenActionQuestion(text) {
  const q = normalize(text);
  return (
    /^what\s+(?:may|can|must|should|could|would)\b.+\bdo\b/.test(q) &&
    !/\bdo to\b/.test(q)
  );
}

function isActorActionQuestion(text) {
  const q = normalize(text);
  return /^who\s+(?:may|can|must|shall|will)\b/.test(q);
}

function actorActionEventTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /^who\s+(?:may|can|must|shall|will)\s+([a-z][a-z'-]*)\b/
  );
  if (!match) return new Set();
  return eventTermsFromText(match[1]);
}

function requiredAccompanimentTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(/^what\s+must\s+accompany\s+(.+)$/);
  if (!match) return new Set();

  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function restrictionTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(/^what\s+restrictions?\s+apply\s+to\s+(.+)$/);
  if (!match) return new Set();
  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (["those","these"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function demonstrativeLimitTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(/^what\s+limits?\s+apply\s+to\s+(?:those|these)\s+(.+)$/);
  if (!match) return new Set();
  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function statusTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(/^what\s+is\s+the\s+status\s+of\s+(.+)$/);
  if (!match) return new Set();
  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function requiredProtectionTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /^what\s+protection\s+must\s+be\s+given\s+to\s+(.+?)(?:\s+before\b|$)/
  );
  if (!match) return new Set();
  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (["protection","give"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isMixedConsiderationQuestion(text) {
  const q = normalize(text);
  return /^what\s+(?:may\s+and\s+must|must\s+and\s+may)\b.*\bconsider\b/.test(q);
}

function constraintBundleTargetTerms(text) {
  const q = normalize(text);
  if (
    !/^what\b.*\bconditions?\b.*\brequirement\b.*\brestriction\b.*\bapply\s+to\b/.test(q)
  ) return new Set();
  const match = q.match(/\bapply\s+to\s+(.+)$/);
  if (!match) return new Set();
  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isPostEventOutcomeQuestion(text) {
  const q = normalize(text);
  return /^what\s+follows?\s+after\b/.test(q);
}

function acknowledgementTargetTerms(text) {
  const q = normalize(text);
  if (!/^how\s+do\b.*\backnowledg/.test(q)) return new Set();
  return new Set(["acknowledge"]);
}

function isAttendanceConditionQuestion(text) {
  const q = normalize(text);
  return /^when\s+must\b.*\battend\b/.test(q);
}

function isNoticeFailureQuestion(text) {
  const q = normalize(text);
  return /^what\s+happens?\s+if\b.*\brequired\s+notice\b.*\bnot\s+given\b/.test(q);
}

function isGoIntoCommitteeConditionQuestion(text) {
  const q = normalize(text);
  return /^when\s+may\b.*\bgo\s+into\s+committee\b/.test(q);
}

function isAnaphoricDeadlineQuestion(text) {
  const q = normalize(text);
  return /^by\s+when\s+must\s+(?:it|this|that|they)\b/.test(q);
}

function isPermissionConditionQuestion(text) {
  const q = normalize(text);
  if (!/^when\s+may\b/.test(q)) return false;
  if (/\bwithout (?:the )?permission\b/.test(q)) return true;
  if (/\bgive evidence\b/.test(q)) return true;
  return false;
}

function remainingLimitTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(/^what\s+(.+?)\s+limits?\s+remain$/);
  if (!match) return new Set();
  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (["constitutional"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
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

function suchEntityTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(/^what\s+happens?\s+to\s+such\s+(?:a|an|the)?\s*([a-z][a-z'-]*)\b/);
  if (!match) return new Set();
  return new Set([canonicalToken(match[1])]);
}

function isOptionListQuestion(text) {
  const q = normalize(text);
  return (
    /^what\b.+\b(?:steps?|options?|measures?|actions?)\b/.test(q) &&
    /\b(?:considered|available|taken|used|adopted)\b/.test(q)
  );
}

function isSatisfactionCriteriaQuestion(text) {
  const q = normalize(text);
  return (
    /^what\s+must\s+satisfy\b/.test(q) ||
    /^what\s+must\b.+\bbe satisfied\b/.test(q) ||
    /^what\s+(?:criteria|conditions?)\b.+\bsatisf(?:y|ied)\b/.test(q)
  );
}

function isReferralExclusionQuestion(text) {
  const q = normalize(text);
  return (
    /\bavoid(?:s|ed|ing)?\s+being\s+referred\b/.test(q) ||
    /\bdoes not stand referred\b/.test(q) ||
    /\bneed not be referred\b/.test(q) ||
    /\bnot be referred again\b/.test(q)
  );
}

function referralExclusionTargetTerms(text) {
  if (!isReferralExclusionQuestion(text)) return new Set();
  const q = normalize(text);
  const head = q.split(/\b(?:avoid(?:s|ed|ing)?\s+being|need not be|not be|does not stand)\s+referred\b/, 1)[0];
  const out = new Set();
  for (const token of referentTerms(head)) {
    if (isMetaOrCarrierTerm(token)) continue;
    if (["when","does","replacement"].includes(token)) continue;
    out.add(token);
  }
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


function takesEffectTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /^when\s+does\s+(.+?)\s+take\s+effect\b/
  );
  if (!match) return new Set();

  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isTemporalApplicationQuestion(text) {
  const q = normalize(text);
  return (
    /^when\s+does\b.*\b(?:begin|start)\b.*\b(?:end|cease|finish)\b/.test(q) ||
    /^when\s+(?:does|is)\b.*\b(?:begin|start|end|cease)\b/.test(q)
  );
}

function temporalApplicationTargetTerms(text) {
  if (!isTemporalApplicationQuestion(text)) return new Set();
  const q = normalize(text);
  const forMatch = q.match(/\bfor\s+(.+)$/);
  const source = forMatch ? forMatch[1] : q;
  const out = new Set();
  for (const token of referentTerms(source)) {
    if (["begin","start","end","cease","finish"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isOverrideForceQuestion(text) {
  const q = normalize(text);
  return (
    /^what\s+force\b.*\b(?:contrary|override|prevail|precedence)\b/.test(q) ||
    /^what\s+effect\b.*\b(?:despite|contrary|override|prevail|precedence)\b/.test(q)
  );
}

function isNormativeObligationQuestion(text) {
  const q = normalize(text);
  return /^what\b.*\bobligation\b.*\b(?:applies?|arises?|exists?)\b/.test(q);
}

function normativeObligationTargetTerms(text) {
  if (!isNormativeObligationQuestion(text)) return new Set();
  const q = normalize(text);
  const condition = q.match(/\bif\s+(.+)$/);
  const source = condition ? condition[1] : q;
  const out = new Set();
  for (const token of referentTerms(source)) {
    if (["obligation","substantive"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isDurationQuestion(text) {
  const q = normalize(text);
  return /\bhow long\b|\bfor how long\b|\bwhat (?:period|duration)\b/.test(q);
}

function durationTargetTerms(text) {
  if (!isDurationQuestion(text)) return new Set();
  const out = new Set();
  for (const token of referentTerms(text)) {
    if (["long","last","duration","period"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}

function isScopeQuestion(text) {
  const q = normalize(text);
  return (
    /\bwhat subjects?\b.*\bcover\b/.test(q) ||
    /\bwhat\b.*\bmay\b.*\braise\b/.test(q) ||
    /\bwhat\b.*\bmay\b.*\binclude\b/.test(q)
  );
}

function scopeTargetTerms(text) {
  const q = normalize(text);
  if (!isScopeQuestion(q)) return new Set();

  let target = q;
  const cover = q.match(/\bwhat subjects?\b.*?\bmay\b(.+?)\bcover\b/);
  if (cover) target = cover[1];

  const out = new Set();
  for (const token of referentTerms(target)) {
    if (["subject","cover","raise","include"].includes(token)) continue;
    if (isMetaOrCarrierTerm(token)) continue;
    out.add(token);
  }
  return out;
}


function conditionalLimitTargetTerms(text) {
  const q = normalize(text);
  if (
    !/^(?:what|which)\s+(?:limits?|limitations?|restrictions?)\b/.test(q)
  ) {
    return new Set();
  }

  const match = q.match(/\b(?:if|when|where)\b\s+(.+)$/);
  if (!match) return new Set();

  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (isMetaOrCarrierTerm(token)) continue;
    if (PERSON_ACTORS.includes(token)) continue;
    out.add(token);
  }
  return out;
}

function isRoutingQuestion(text) {
  const q = normalize(text);
  return (
    /^how\b.*\b(?:allocated|assigned|routed|referred)\b/.test(q) ||
    /\bwhere\b.*\b(?:go|referred|sent)\b/.test(q)
  );
}

function routingTargetTerms(text) {
  const q = normalize(text);
  const howMatch = q.match(
    /^how\s+(?:is|are|may|can)\s+(.+?)\s+(?:be\s+)?(?:allocated|assigned|routed|referred)\b/
  );
  const whereMatch = q.match(
    /^where\s+(?:does|do|is|are)\s+(.+?)\s+(?:go|(?:get\s+)?referred|sent)\b/
  );
  const match = howMatch ?? whereMatch;
  if (!match) return new Set();

  const out = new Set();
  for (const token of domainSubjectTerms(match[1])) {
    if (["between","initially","then"].includes(token)) continue;
    out.add(token);
  }
  return out;
}

function isProhibitedActionsQuestion(text) {
  const q = normalize(text);
  return /\bwhat\b.*\b(?:barred|prohibited|prevented)\s+from\b/.test(q);
}

function isConditionalOutcomeQuestion(text) {
  const q = normalize(text);
  return /^how does\b.*\baffect whether\b/.test(q);
}

function conditionalOutcomeTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(/\baffect whether\s+(.+)$/);
  if (!match) return new Set();

  const out = new Set();
  for (const token of referentTerms(match[1])) {
    if (["affect"].includes(token)) continue;
    out.add(token);
  }
  return out;
}

function isCausalOrderQuestion(text) {
  const q = normalize(text);
  return /\bout of order\b.*\bbecause\b/.test(q);
}

function causalOrderTargetTerms(text) {
  const q = normalize(text);
  const match = q.match(
    /^(?:is|are|can|may)\s+(.+?)\s+out of order\b.*?\bbecause\s+(.+)$/
  );
  if (!match) return new Set();

  const out = new Set();
  for (const part of [match[1], match[2]]) {
    for (const token of referentTerms(part)) {
      if (["out","introduce"].includes(token)) continue;
      if (isMetaOrCarrierTerm(token)) continue;
      out.add(token);
    }
  }
  return out;
}

function isReportContentQuestion(text) {
  const q = normalize(text);
  return /\bwhat must\b.*\bdo in (?:its|the) report\b/.test(q);
}

function isNegativeModal(text) {
  const q = normalize(text);
  return (
    /\bcannot\b/.test(q) ||
    /\b(?:must|shall|may|can|will)\b(?:\s+(?:it|they|them|he|she|this|that|the|a|an|member|person|committee|house|speaker|chair|chairperson)){0,4}\s+not\b/.test(q)
  );
}

function isTemporalCarrierEvent(event, text) {
  const q = normalize(text);
  if (event === "end" && /\b(?:at|by) the end\b/.test(q)) return true;
  if (event === "start" && /\bat the start\b/.test(q)) return true;
  return false;
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

function conditionDomainTerms(text) {
  const out = new Set();
  for (const token of localStateTerms(text)) {
    if (isMetaOrCarrierTerm(token)) continue;
    if (
      ["if","after","before","when","while","once","no","not","cannot","still","lost","dur","start"].includes(token)
    ) continue;
    out.add(token);
  }
  return out;
}

function isResponsibilityAuthorityQuestion(text) {
  const q = normalize(text);
  return (
    /^(?:who|where)\b/.test(q) &&
    /\b(?:responsibility|responsibilities|responsible)\b/.test(q)
  );
}

function relationTypes(localText) {
  const q = normalize(localText);
  const out = new Set();
  const outputTypeFollowup = isOutputTypeFollowup(q);
  const asksOverride =
    /\bdespite\b|\bexception\b|\bpower to (?:allow|permit|accept)\b/.test(q);
  const asksQuantity =
    /\bhow many\b|\bhow much\b|\bwhat number\b|\bnumber of\b/.test(q);
  const conditionalEffect = isConditionalEffectQuestion(q);
  const contentAnswer = isContentAnswerQuestion(q);
  const enumeratedContentAnswer = isEnumeratedContentAnswerQuestion(q);
  const actorContentAnswer = isActorContentAnswerQuestion(q);
  const decisionAuthority = isDecisionAuthorityQuestion(q);
  const reviewQuestion = isReviewQuestion(q);
  const actorExclusion = isActorExclusionQuestion(q);
  const responsibilityQuestion = isResponsibilityAuthorityQuestion(q);
  const openAction = isOpenActionQuestion(q);
  const optionList = isOptionListQuestion(q);
  const satisfactionCriteria = isSatisfactionCriteriaQuestion(q);
  const referralExclusion = isReferralExclusionQuestion(q);
  const takesEffect = takesEffectTargetTerms(q).size > 0;
  const temporalApplication = isTemporalApplicationQuestion(q);
  const overrideForce = isOverrideForceQuestion(q);
  const normativeObligation = isNormativeObligationQuestion(q);
  const conditionalActorChoice = isConditionalActorChoiceQuestion(q);
  const temporalCue =
    /\b(?:first|before|after|within|day|days|time|until|following|once|calendar|year)\b/.test(q);
  const proceduralStageTiming =
    /^when\s+(?:may|can)\b.*\b(?:presented|lodged|filed|submitted|delivered|introduced|tabled|reported|moved|read|asked|referred|released|published)\b/.test(q);
  const permissionCondition =
    /^when\s+(?:may|can)\b/.test(q) &&
    !temporalCue &&
    !proceduralStageTiming;
  const negativeModal = isNegativeModal(q);

  if (isDurationQuestion(q)) out.add("duration");
  if (temporalApplication && !conditionalActorChoice) out.add("timing");
  if (conditionalActorChoice) {
    out.add("condition");
    out.add("actor_scope");
  }
  if (overrideForce) out.add("override");

  if (
    /\bneed not\b|\bneeds? not\b|\b(?:is|are|was|were) not required to\b|\bdo(?:es)? not need to\b|\bno need to\b/.test(q)
  ) out.add("requirement_exclusion");

  if (
    !conditionalEffect &&
    !optionList &&
    !satisfactionCriteria &&
    !referralExclusion &&
    !normativeObligation &&
    !conditionalEffect &&
    (
      /\b(can|may|entitled|allowed|permitted|allows?)\b/.test(q) ||
      /\bpower to (?:allow|permit|accept|move|suspend|present|release)\b/.test(q)
    )
  ) out.add("permission");

  if (permissionCondition) out.add("condition");

  if (
    !conditionalEffect &&
    (
      negativeModal ||
      /\bbarred\b|\bprohibited\b|\bforbidden\b/.test(q)
    )
  ) out.add("prohibition");

  if (
    (/\bwho\b/.test(q) && /\b(can|may|must|ask|move|decide|determine|control)\w*\b/.test(q)) ||
    decisionAuthority ||
    actorExclusion ||
    responsibilityQuestion
  ) {
    out.add("actor_scope");
  }

  if (
    (
      !actorContentAnswer &&
      !conditionalEffect &&
      !satisfactionCriteria &&
      !optionList &&
      !negativeModal &&
      /\b(must|required|shall)\b/.test(q)
    ) ||
    normativeObligation
  ) {
    out.add("requirement");
    out.add("action");
  }

  if (normativeObligation && /\bif\b/.test(q)) {
    out.add("condition");
  }

  if (contentAnswer || enumeratedContentAnswer) out.add("content");
  if (optionList) out.add("content");
  if (satisfactionCriteria) out.add("criteria");
  if (referralExclusion) {
    out.add("requirement_exclusion");
    out.add("effect");
  }
  if (conditionalEffect) out.add("effect");
  if (reviewQuestion) out.add("review");
  if (actorExclusion) out.add("limit");

  if (/\bwhat is it for\b|\bpurpose\b|\bwhy\b/.test(q)) out.add("purpose");

  if (
    !responsibilityQuestion &&
    (
      /\bwhere\b|\bwhere does\b|\bgo\b/.test(q) ||
      isRoutingQuestion(q)
    )
  ) {
    out.add("destination");
    if (/\bwhere\b|\bgo\b/.test(q)) out.add("effect");
  }

  if (
    /\bwhat happens\b|\bwhat is the result\b|\bwhat are the results\b|\beffect\b|\bconsequence\b/.test(q) ||
    outputTypeFollowup
  ) out.add("effect");

  if (
    !temporalApplication &&
    (
      /\blimits?\b|\blimitations?\b/.test(q) ||
      (!asksOverride && /\brestrictions?\b/.test(q)) ||
      /\bwhat .* may seek\b/.test(q)
    )
  ) out.add("limit");

  if (
    /\bexception\b|\bexceptions\b|\bunless\b|\bexcept\b|\bnot apply\b|\bdoes .* not apply\b|\bdespite\b/.test(q)
  ) out.add("exception");

  if (
    /\bwhat .* say\b|\bwhat .* contain\b|\bwhat .* state\b/.test(q) ||
    isReportContentQuestion(q)
  ) out.add("content");

  if (asksQuantity || /\bhow often\b/.test(q)) out.add("quantity");
  if (isScopeQuestion(q)) out.add("scope");
  if (isCriteriaQuestion(q)) out.add("criteria");
  if (isCausalOrderQuestion(q)) out.add("criterion_exclusion");

  const asksConditionTests =
    /^(?:what|which)\s+(?:tests?|conditions?|criteria)\b/.test(q);

  const startsWhere = /^where\b/.test(q);
  const howWhileState = /^how\b/.test(q) && /\bwhile\b/.test(q);

  const openActionSequenceContext =
    openAction &&
    /\bmust\b/.test(q) &&
    /\b(?:before|after)\b/.test(q);

  if (
    !enumeratedContentAnswer &&
    !isDurationQuestion(q) &&
    !optionList &&
    !satisfactionCriteria &&
    !referralExclusion &&
    !conditionalEffect &&
    !startsWhere &&
    !howWhileState &&
    !openActionSequenceContext &&
    (
      (
        /\bwhen\b|\bby when\b|\bby what time\b|\bdeadline\b|\bwhile\b/.test(q) &&
        !permissionCondition
      ) ||
      (!asksConditionTests && /\bbefore\b|\bafter\b/.test(q))
    )
  ) out.add("timing");

  const asksHowProcedure =
    !isRoutingQuestion(q) &&
    /^how\b/.test(q) &&
    /\b(lodg|present|file|submit|deliver|move|give|notify|apply|seek|make|rescind|transfer|authori[sz])\w*\b/.test(q);

  if (
    asksHowProcedure ||
    /\bprocedure\b|\bprocess\b|\bwithout notice\b/.test(q)
  ) out.add("procedure");

  if (/\bon behalf of\b/.test(q)) out.add("representation");

  if (/\bwhat can\b.*\bdo to\b/.test(q) || /\bhow can\b/.test(q)) {
    out.add("method");
  }

  if (openAction && negativeModal) {
    out.delete("permission");
    out.add("prohibition");
  }

  if (out.size === 0) out.add("rule");
  return out;
}

function deriveObligations(question) {
  const clauses = rawAtomicClauses(question);
  let leadingContext = "";
  let obligationClauses = clauses;

  if (clauses.length > 1 && isLeadingContextClause(clauses[0])) {
    leadingContext = clauses[0];
    obligationClauses = clauses.slice(1);
  }

  if (obligationClauses.length === 0) obligationClauses = [question];

  const obligations = [];
  let rootReferent = referentTerms(leadingContext);
  let priorActors = actorTerms(leadingContext);
  let priorQualifiers = actorQualifiers(leadingContext);
  let priorPredicateEvents = eventTermsFromText(primaryPredicateText(leadingContext));
  let priorPredicateObjects = predicateObjectTerms(leadingContext);
  let priorSubjectTerms = domainSubjectTerms(leadingContext);

  for (let index = 0; index < obligationClauses.length; index += 1) {
    const local = obligationClauses[index];
    const q = normalize(local);
    const localReferent = referentTerms(local);
    const contextReferent = referentTerms(leadingContext);
    const antecedentNeeded = needsAntecedent(local);
    const outputTypeFollowup = isOutputTypeFollowup(local);
    const deadlineQuestion = isDeadlineQuestion(local);
    const contentTarget = contentTargetTerms(local);
    const passiveSubject = passiveSubjectTerms(local);

    const durationTarget = durationTargetTerms(local);
    const scopeTarget = scopeTargetTerms(local);
    const routingTarget = routingTargetTerms(local);
    const conditionalOutcomeTarget = conditionalOutcomeTargetTerms(local);
    const causalOrderTarget = causalOrderTargetTerms(local);
    const criteriaTarget = criteriaTargetTerms(local);
    const eligibilityTarget = eligibilityTargetTerms(local);
    const prerequisiteEventTarget = prerequisiteEventTargetTerms(local);
    const governedRuleTarget = governedRuleTargetTerms(local);
    const conditionalLimitTarget = conditionalLimitTargetTerms(local);
    const decisionAuthorityTarget = decisionAuthorityTargetTerms(local);
    const reviewTarget = reviewTargetTerms(local);
    const actorExclusionTarget = actorExclusionTargetTerms(local);
    const referralExclusionTarget = referralExclusionTargetTerms(local);
    const takesEffectTarget = takesEffectTargetTerms(local);
    const temporalApplicationTarget = temporalApplicationTargetTerms(local);
    const normativeObligationTarget = normativeObligationTargetTerms(local);
    const requiredAccompanimentTarget = requiredAccompanimentTargetTerms(local);
    const restrictionTarget = restrictionTargetTerms(local);
    const demonstrativeLimitTarget = demonstrativeLimitTargetTerms(local);
    const statusTarget = statusTargetTerms(local);
    const requiredProtectionTarget = requiredProtectionTargetTerms(local);
    const constraintBundleTarget = constraintBundleTargetTerms(local);
    const acknowledgementTarget = acknowledgementTargetTerms(local);
    const suchEntityTarget = suchEntityTargetTerms(local);
    const dispositionInfo = conditionalDispositionInfo(local);
    const remainingLimitTarget = remainingLimitTargetTerms(local);

    const responsibilityAuthorityFrame = isResponsibilityAuthorityQuestion(local);
    const durationFrame = durationTarget.size > 0;
    const scopeFrame = scopeTarget.size > 0;
    const routingFrame = isRoutingQuestion(local);
    const prohibitedActionsFrame = isProhibitedActionsQuestion(local);
    const conditionalOutcomeFrame = isConditionalOutcomeQuestion(local);
    const causalOrderFrame = causalOrderTarget.size > 0;
    const criteriaFrame = criteriaTarget.size > 0;
    const eligibilityFrame = eligibilityTarget.size > 0;
    const prerequisiteEventFrame = prerequisiteEventTarget.size > 0;
    const governedRuleFrame = governedRuleTarget.size > 0;
    const stageEffectFrame = isStageEffectQuestion(local);
    const triggerEffectFrame = isTriggerEffectQuestion(local);
    const deadlineFailureFrame = isDeadlineFailureQuestion(local);
    const reportContextFrame =
      rootReferent.has("report") ||
      priorSubjectTerms.has("report") ||
      localReferent.has("report");
    const reportLifecycleFrame =
      reportContextFrame &&
      /\b(?:presented|presentation|published|publication|announced|announcement)\b/.test(q);
    const conditionalLimitFrame = conditionalLimitTarget.size > 0;
    const conditionalEffectFrame = isConditionalEffectQuestion(local);
    const decisionAuthorityFrame = decisionAuthorityTarget.size > 0;
    const reviewFrame = reviewTarget.size > 0;
    const actorExclusionFrame = actorExclusionTarget.size > 0;
    const openActionFrame = isOpenActionQuestion(local);
    const optionListFrame = isOptionListQuestion(local);
    const satisfactionCriteriaFrame = isSatisfactionCriteriaQuestion(local);
    const referralExclusionFrame = referralExclusionTarget.size > 0;
    const takesEffectFrame = takesEffectTarget.size > 0;
    const temporalApplicationFrame = isTemporalApplicationQuestion(local);
    const overrideForceFrame = isOverrideForceQuestion(local);
    const normativeObligationFrame = normativeObligationTarget.size > 0;
    const actorActionFrame = isActorActionQuestion(local);
    const requiredAccompanimentFrame = requiredAccompanimentTarget.size > 0;
    const restrictionFrame = restrictionTarget.size > 0;
    const demonstrativeLimitFrame = demonstrativeLimitTarget.size > 0;
    const statusFrame = statusTarget.size > 0;
    const requiredProtectionFrame = requiredProtectionTarget.size > 0;
    const mixedConsiderationFrame = isMixedConsiderationQuestion(local);
    const constraintBundleFrame = constraintBundleTarget.size > 0;
    const postEventOutcomeFrame = isPostEventOutcomeQuestion(local);
    const acknowledgementFrame = acknowledgementTarget.size > 0;
    const attendanceConditionFrame = isAttendanceConditionQuestion(local);
    const noticeFailureFrame = isNoticeFailureQuestion(local);
    const goIntoCommitteeConditionFrame = isGoIntoCommitteeConditionQuestion(local);
    const anaphoricDeadlineFrame = isAnaphoricDeadlineQuestion(local);
    const permissionConditionFrame = isPermissionConditionQuestion(local);
    const remainingLimitFrame = remainingLimitTarget.size > 0;
    const conditionalDispositionFrame = dispositionInfo !== null;
    const suchEntityFrame = suchEntityTarget.size > 0;
    const concessiveOutcomeFrame = isConcessiveOutcomeQuestion(local);
    const reportContentFrame = isReportContentQuestion(local);
    const modifiedHeadTarget =
      antecedentNeeded && /\bit\b/.test(q)
        ? modifiedHeadEntityTerms(leadingContext)
        : new Set();

    if (index === 0) {
      rootReferent = unionSets(rootReferent, localReferent, contextReferent);
    }

    let referent = localReferent;
    if (antecedentNeeded || referent.size <= 1) {
      referent = unionSets(rootReferent, localReferent);
    }
    if (referent.size === 0) referent = rootReferent;

    const primaryLocalPredicate = primaryPredicateText(local);
    let actors = actorTerms(primaryLocalPredicate);
    let qualifiers = actorQualifiers(primaryLocalPredicate);

    if (
      antecedentNeeded &&
      (/\bthat member\b|\bthey\b|\bthem\b/.test(q))
    ) {
      actors = unionSets(priorActors, actorTerms(leadingContext), actors);
      qualifiers = unionSets(
        priorQualifiers,
        actorQualifiers(leadingContext),
        qualifiers
      );
    }

    if (index === 0) {
      actors = unionSets(actorTerms(leadingContext), actors);
      qualifiers = unionSets(actorQualifiers(leadingContext), qualifiers);
    }

    if (
      /\bthat\s+(?:member|minister|speaker|chair|chairperson|clerk|person)\b/.test(q)
    ) {
      actors = unionSets(priorActors, actorTerms(leadingContext), actors);
      qualifiers = unionSets(
        priorQualifiers,
        actorQualifiers(leadingContext),
        qualifiers
      );
    }

    const relations = relationTypes(local);

    if (requiredProtectionFrame) {
      relations.delete("permission");
      relations.delete("actor_scope");
      relations.add("requirement");
      relations.add("action");
      if (/\bbefore\b/.test(q)) relations.add("timing");
    }

    if (mixedConsiderationFrame) {
      relations.clear();
      relations.add("criteria");
    }

    if (constraintBundleFrame) {
      relations.clear();
      relations.add("condition");
      relations.add("requirement");
      relations.add("limit");
    }

    if (postEventOutcomeFrame) {
      relations.clear();
      relations.add("effect");
      relations.add("timing");
    }

    if (acknowledgementFrame) {
      relations.clear();
      relations.add("rule");
    }

    if (attendanceConditionFrame) {
      relations.delete("timing");
      relations.add("condition");
      relations.add("requirement");
      relations.add("action");
    }

    if (noticeFailureFrame) {
      relations.clear();
      relations.add("effect");
    }

    if (goIntoCommitteeConditionFrame) {
      relations.clear();
      relations.add("condition");
      relations.add("timing");
    }

    if (permissionConditionFrame) {
      relations.clear();
      relations.add("permission");
      relations.add("condition");
    }

    if (remainingLimitFrame) {
      relations.clear();
      relations.add("limit");
    }

    if (conditionalDispositionFrame) {
      relations.clear();
      relations.add("effect");
      relations.add(
        dispositionInfo.polarity === "negative"
          ? "prohibition"
          : "permission"
      );
    }

    if (suchEntityFrame) {
      relations.add("effect");
      if (/\bafter\b/.test(q)) relations.add("timing");
    }

    let predicateEvents = eventTermsFromText(primaryPredicateText(local));
    let predicateObjects = predicateObjectTerms(local);

    if (actorActionFrame) {
      const modalActionEvents = actorActionEventTerms(local);
      if (modalActionEvents.size > 0) {
        predicateEvents = modalActionEvents;
      }
    }
    let localDomain = domainSubjectTerms(local);
    if (antecedentNeeded && /\b(?:it|they|them|that|those|this)\b/.test(q)) {
      const antecedentDomain =
        priorSubjectTerms.size > 0 ? priorSubjectTerms : rootReferent;
      if (antecedentDomain.size > 0) {
        localDomain = unionSets(antecedentDomain, localDomain);
      }
    }
    const conditionDomain = conditionDomainTerms(local);
    const relativeState = relativeConditionTerms(local);

    for (const event of [...predicateEvents]) {
      if (isTemporalCarrierEvent(event, local)) predicateEvents.delete(event);
    }

    let explicitFrameTarget = new Set();

    if (modifiedHeadTarget.size > 0) {
      explicitFrameTarget = new Set(modifiedHeadTarget);
      localDomain = new Set(modifiedHeadTarget);
      predicateObjects = new Set(modifiedHeadTarget);
    }

    if (durationFrame) {
      explicitFrameTarget = new Set(durationTarget);
      localDomain = new Set(durationTarget);
      predicateObjects = new Set(durationTarget);
      predicateEvents = new Set();
    }

    if (takesEffectFrame) {
      explicitFrameTarget = new Set(takesEffectTarget);
      localDomain = new Set(takesEffectTarget);
      predicateObjects = new Set(takesEffectTarget);
      predicateEvents = new Set();
    }

    if (temporalApplicationFrame) {
      const temporalTarget =
        temporalApplicationTarget.size > 0
          ? new Set(temporalApplicationTarget)
          : localDomain.size > 0
            ? new Set(localDomain)
            : new Set(rootReferent);
      explicitFrameTarget = temporalTarget;
      localDomain = new Set(temporalTarget);
      predicateObjects = new Set(temporalTarget);
      predicateEvents = new Set();
    }

    if (normativeObligationFrame) {
      explicitFrameTarget = new Set(normativeObligationTarget);
      localDomain = new Set(normativeObligationTarget);
      predicateObjects = new Set(normativeObligationTarget);
      predicateEvents = new Set();
    }

    if (requiredAccompanimentFrame) {
      explicitFrameTarget = new Set(requiredAccompanimentTarget);
      localDomain = new Set(requiredAccompanimentTarget);
      predicateObjects = new Set(requiredAccompanimentTarget);
      predicateEvents = new Set();
    }

    if (restrictionFrame) {
      explicitFrameTarget = new Set(restrictionTarget);
      localDomain = new Set(restrictionTarget);
      predicateObjects = new Set(restrictionTarget);
    }

    if (demonstrativeLimitFrame) {
      explicitFrameTarget = new Set(demonstrativeLimitTarget);
      localDomain = new Set(demonstrativeLimitTarget);
      predicateObjects = new Set(demonstrativeLimitTarget);
      predicateEvents = new Set();
    }

    if (statusFrame) {
      explicitFrameTarget = new Set(statusTarget);
      localDomain = new Set(statusTarget);
      predicateObjects = new Set(statusTarget);
      predicateEvents = new Set();
    }

    if (requiredProtectionFrame) {
      explicitFrameTarget = new Set(requiredProtectionTarget);
      localDomain = new Set(requiredProtectionTarget);
      predicateObjects = new Set(requiredProtectionTarget);
      predicateEvents = new Set();
    }

    if (mixedConsiderationFrame) {
      const considerationTarget =
        priorSubjectTerms.size > 0
          ? new Set(priorSubjectTerms)
          : new Set(rootReferent);
      explicitFrameTarget = considerationTarget;
      localDomain = new Set(considerationTarget);
      predicateObjects = new Set(considerationTarget);
      predicateEvents = new Set();
    }

    if (constraintBundleFrame) {
      explicitFrameTarget = new Set(constraintBundleTarget);
      localDomain = new Set(constraintBundleTarget);
      predicateObjects = new Set(constraintBundleTarget);
      predicateEvents = new Set();
    }

    if (postEventOutcomeFrame) {
      const outcomeTarget =
        priorPredicateEvents.size > 0
          ? new Set(priorPredicateEvents)
          : priorSubjectTerms.size > 0
            ? new Set(priorSubjectTerms)
            : new Set(rootReferent);
      explicitFrameTarget = outcomeTarget;
      localDomain = new Set(outcomeTarget);
      predicateObjects = new Set(outcomeTarget);
      predicateEvents = new Set();
    }

    if (acknowledgementFrame) {
      explicitFrameTarget = new Set(acknowledgementTarget);
      localDomain = new Set(acknowledgementTarget);
      predicateObjects = new Set(acknowledgementTarget);
      predicateEvents = new Set();
    }

    if (noticeFailureFrame) {
      explicitFrameTarget = new Set(["notice"]);
      localDomain = new Set(["notice"]);
      predicateObjects = new Set(["notice"]);
      predicateEvents = new Set();
    }

    if (goIntoCommitteeConditionFrame) {
      const committeeTarget = new Set();
      for (const token of domainSubjectTerms(local)) {
        if (["into","read"].includes(token)) continue;
        if (isMetaOrCarrierTerm(token)) continue;
        committeeTarget.add(token);
      }
      explicitFrameTarget = committeeTarget;
      localDomain = new Set(committeeTarget);
      predicateObjects = new Set(committeeTarget);
      predicateEvents = new Set();
    }

    if (anaphoricDeadlineFrame && priorSubjectTerms.size > 0) {
      explicitFrameTarget = new Set(priorSubjectTerms);
      localDomain = new Set(priorSubjectTerms);
      predicateObjects = new Set(priorSubjectTerms);
      predicateEvents = new Set();
    }

    if (permissionConditionFrame) {
      const permissionTarget = new Set();
      for (const token of domainSubjectTerms(local)) {
        if (["permission","house","court"].includes(token)) continue;
        if (isMetaOrCarrierTerm(token)) continue;
        permissionTarget.add(token);
      }
      if (permissionTarget.size > 0) {
        explicitFrameTarget = permissionTarget;
        localDomain = new Set(permissionTarget);
        predicateObjects = new Set(permissionTarget);
      }
    }

    if (remainingLimitFrame) {
      explicitFrameTarget = new Set(remainingLimitTarget);
      localDomain = new Set(remainingLimitTarget);
      predicateObjects = new Set(remainingLimitTarget);
      predicateEvents = new Set();
    }

    if (conditionalDispositionFrame) {
      explicitFrameTarget = new Set(dispositionInfo.target);
      localDomain = new Set(dispositionInfo.target);
      predicateObjects = new Set(dispositionInfo.target);
      predicateEvents = new Set();
    }

    if (suchEntityFrame) {
      explicitFrameTarget = new Set(suchEntityTarget);
      localDomain = new Set(suchEntityTarget);
      predicateObjects = new Set(suchEntityTarget);
      predicateEvents = new Set();
    }

    if (scopeFrame) {
      explicitFrameTarget = new Set(scopeTarget);
      localDomain = new Set(scopeTarget);
      predicateObjects = new Set(scopeTarget);
      predicateEvents = new Set();
    }

    if (routingFrame) {
      const resolvedRoutingTarget =
        routingTarget.size > 0
          ? new Set(routingTarget)
          : priorSubjectTerms.size > 0
            ? new Set(priorSubjectTerms)
            : contextReferent.size > 0
              ? new Set(contextReferent)
              : new Set(rootReferent);

      if (resolvedRoutingTarget.size > 0) {
        explicitFrameTarget = resolvedRoutingTarget;
        localDomain = new Set(resolvedRoutingTarget);
        predicateObjects = new Set(resolvedRoutingTarget);
      }
      predicateEvents = new Set(["refer"]);
    }

    if (conditionalOutcomeFrame) {
      const inheritedTarget =
        priorSubjectTerms.size > 0
          ? priorSubjectTerms
          : rootReferent;
      explicitFrameTarget = unionSets(
        inheritedTarget,
        conditionalOutcomeTarget
      );
      localDomain = new Set(explicitFrameTarget);
      predicateObjects = new Set(explicitFrameTarget);
      const localEvents = eventTermsFromText(local);
      predicateEvents = localEvents.size > 0
        ? localEvents
        : new Set(priorPredicateEvents);
    }

    if (causalOrderFrame) {
      explicitFrameTarget = new Set(causalOrderTarget);
      localDomain = new Set(causalOrderTarget);
      predicateObjects = new Set(causalOrderTarget);
      predicateEvents = new Set();
    }

    if (criteriaFrame) {
      explicitFrameTarget = new Set(criteriaTarget);
      localDomain = new Set(criteriaTarget);
      predicateObjects = new Set(criteriaTarget);
      predicateEvents = new Set();
    }

    if (eligibilityFrame) {
      explicitFrameTarget = new Set(eligibilityTarget);
      localDomain = new Set(eligibilityTarget);
      predicateObjects = new Set(eligibilityTarget);
      predicateEvents = new Set();
    }

    if (prerequisiteEventFrame) {
      relations.clear();
      relations.add("condition");
      relations.add("timing");
      explicitFrameTarget = new Set(prerequisiteEventTarget);
      localDomain = new Set(prerequisiteEventTarget);
      predicateObjects = new Set(prerequisiteEventTarget);
      predicateEvents = new Set();
    }

    if (governedRuleFrame) {
      relations.clear();
      relations.add("rule");
      explicitFrameTarget = new Set(governedRuleTarget);
      localDomain = new Set(governedRuleTarget);
      predicateObjects = new Set(governedRuleTarget);
      predicateEvents = eventTermsFromText([...governedRuleTarget].join(" "));
    }

    if (stageEffectFrame) {
      relations.clear();
      relations.add("effect");
      const stageTarget =
        priorSubjectTerms.size > 0
          ? new Set(priorSubjectTerms)
          : new Set(rootReferent);
      if (stageTarget.size > 0) {
        explicitFrameTarget = stageTarget;
        localDomain = new Set(stageTarget);
        predicateObjects = new Set(stageTarget);
      }
      predicateEvents = eventTermsFromText(local);
    }

    if (deadlineFailureFrame) {
      relations.clear();
      relations.add("exception");
      relations.add("timing");
      const deadlineTarget = unionSets(
        rootReferent,
        priorSubjectTerms,
        new Set(["report"])
      );
      explicitFrameTarget = new Set(deadlineTarget);
      localDomain = new Set(deadlineTarget);
      predicateObjects = new Set(deadlineTarget);
      predicateEvents = eventTermsFromText(local);
    }

    if (triggerEffectFrame) {
      relations.clear();
      relations.add("effect");
      const triggerTarget =
        priorSubjectTerms.size > 0
          ? new Set(priorSubjectTerms)
          : rootReferent.size > 0
            ? new Set(rootReferent)
            : new Set(localReferent);
      explicitFrameTarget = new Set(triggerTarget);
      localDomain = new Set(triggerTarget);
      predicateObjects = new Set(triggerTarget);
      predicateEvents = new Set();
    }

    if (reportLifecycleFrame && !triggerEffectFrame) {
      const reportTarget = new Set(["report"]);
      explicitFrameTarget = reportTarget;
      localDomain = new Set(reportTarget);
      predicateObjects = new Set(reportTarget);
      const lifecycleEvents = eventTermsFromText(local);
      predicateEvents =
        lifecycleEvents.size > 0 ? lifecycleEvents : new Set();
    }

    if (overrideForceFrame) {
      const overrideTarget = unionSets(
        priorSubjectTerms,
        new Set(
          [...localReferent].filter(
            (token) => !["against","contrary","force"].includes(token)
          )
        )
      );
      if (overrideTarget.size > 0) {
        explicitFrameTarget = new Set(overrideTarget);
        localDomain = new Set(overrideTarget);
        predicateObjects = new Set(overrideTarget);
      }
      predicateEvents = new Set();
    }

    if (conditionalLimitFrame) {
      explicitFrameTarget = new Set(conditionalLimitTarget);
      localDomain = new Set(conditionalLimitTarget);
      predicateObjects = new Set(conditionalLimitTarget);
      predicateEvents = new Set();
    }

    if (
      conditionalEffectFrame &&
      !conditionalDispositionFrame &&
      !noticeFailureFrame
    ) {
      const conditionTarget = conditionDomainTerms(local);
      const pronounCondition =
        antecedentNeeded &&
        /\b(?:they|them)\b/.test(q) &&
        priorSubjectTerms.size > 0;
      let inheritedTarget = pronounCondition
        ? new Set(priorSubjectTerms)
        : new Set(conditionTarget);

      if (
        antecedentNeeded &&
        !pronounCondition &&
        conditionTarget.size <= 1
      ) {
        inheritedTarget = unionSets(
          leadingContext ? contextReferent : rootReferent,
          priorSubjectTerms,
          conditionTarget
        );
      } else if (inheritedTarget.size === 0) {
        inheritedTarget =
          priorSubjectTerms.size > 0
            ? new Set(priorSubjectTerms)
            : new Set(rootReferent);
      }

      explicitFrameTarget = new Set(inheritedTarget);
      localDomain = new Set(inheritedTarget);
      predicateObjects = new Set(inheritedTarget);
      predicateEvents = new Set();
    }

    if (decisionAuthorityFrame) {
      explicitFrameTarget = new Set(decisionAuthorityTarget);
      localDomain = new Set(decisionAuthorityTarget);
      predicateObjects = new Set(decisionAuthorityTarget);
      predicateEvents = new Set(["determine"]);
    }

    if (reviewFrame) {
      explicitFrameTarget = new Set(reviewTarget);
      localDomain = new Set(reviewTarget);
      predicateObjects = new Set(reviewTarget);
      predicateEvents = new Set(["refer"]);
    }

    if (actorExclusionFrame) {
      explicitFrameTarget = new Set(actorExclusionTarget);
      localDomain = new Set(actorExclusionTarget);
      predicateObjects = new Set(actorExclusionTarget);
      predicateEvents = new Set();
    }

    if (openActionFrame) {
      const openTarget = unionSets(
        conditionDomain,
        relativeState,
        antecedentNeeded ? priorSubjectTerms : new Set()
      );
      if (openTarget.size > 0) {
        explicitFrameTarget = new Set(openTarget);
        localDomain = new Set(openTarget);
        predicateObjects = new Set(openTarget);
      }
      predicateEvents = new Set();
    }

    if (optionListFrame) {
      const optionTarget = unionSets(
        contextReferent,
        conditionDomain,
        relativeState
      );
      if (optionTarget.size > 0) {
        explicitFrameTarget = new Set(optionTarget);
        localDomain = new Set(optionTarget);
        predicateObjects = new Set(optionTarget);
      }
      predicateEvents = new Set();
    }

    if (satisfactionCriteriaFrame) {
      const criteriaEntity =
        priorSubjectTerms.size > 0
          ? new Set(priorSubjectTerms)
          : rootReferent.size > 0
            ? new Set(rootReferent)
            : new Set(contextReferent);
      if (criteriaEntity.size > 0) {
        explicitFrameTarget = criteriaEntity;
        localDomain = new Set(criteriaEntity);
        predicateObjects = new Set(criteriaEntity);
      }
      predicateEvents = new Set();
    }

    if (referralExclusionFrame) {
      explicitFrameTarget = new Set(referralExclusionTarget);
      localDomain = new Set(referralExclusionTarget);
      predicateObjects = new Set(referralExclusionTarget);
    }

    if (concessiveOutcomeFrame) {
      const inheritedTarget =
        priorSubjectTerms.size > 0
          ? priorSubjectTerms
          : rootReferent;
      explicitFrameTarget = new Set(inheritedTarget);
      localDomain = new Set(inheritedTarget);
      predicateObjects = new Set(inheritedTarget);
      predicateEvents = new Set();
      actors = unionSets(priorActors, actorTerms(leadingContext));
      qualifiers = unionSets(priorQualifiers, actorQualifiers(leadingContext));
    }

    if (prohibitedActionsFrame) {
      const inheritedTarget =
        priorSubjectTerms.size > 0
          ? priorSubjectTerms
          : rootReferent;
      explicitFrameTarget = new Set(inheritedTarget);
      localDomain = new Set(inheritedTarget);
      predicateObjects = new Set(inheritedTarget);
      predicateEvents =
        priorPredicateEvents.size > 0
          ? new Set(priorPredicateEvents)
          : eventTermsFromText(leadingContext);
    }

    if (reportContentFrame) {
      const reportTarget = unionSets(
        rootReferent,
        priorSubjectTerms,
        new Set(["report"])
      );
      explicitFrameTarget = new Set(reportTarget);
      localDomain = new Set(reportTarget);
      predicateObjects = new Set(reportTarget);
      predicateEvents = new Set(["report"]);
    }

    if (responsibilityAuthorityFrame) {
      const responsibilityTarget = new Set(
        [...localReferent].filter(
          (token) => !["responsibility", "responsible", "lie"].includes(token)
        )
      );
      if (responsibilityTarget.size > 0) {
        explicitFrameTarget = new Set(responsibilityTarget);
        localDomain = new Set(responsibilityTarget);
        predicateObjects = new Set(responsibilityTarget);
      }
      predicateEvents = new Set();
    }

    if (contentTarget.size > 0) {
      explicitFrameTarget = new Set(contentTarget);
      predicateEvents = new Set();
      predicateObjects = new Set(contentTarget);
      localDomain = new Set(contentTarget);
    }

    if (passiveSubject.size > 0 && explicitFrameTarget.size === 0) {
      localDomain = unionSets(localDomain, passiveSubject);
      predicateObjects = unionSets(predicateObjects, passiveSubject);
    }

    if (deadlineQuestion && !anaphoricDeadlineFrame) {
      explicitFrameTarget = unionSets(
        priorSubjectTerms,
        localDomain,
        eventTermsFromText(primaryPredicateText(local))
      );
      localDomain = new Set(explicitFrameTarget);
      predicateObjects = unionSets(
        priorSubjectTerms,
        predicateObjects,
        localDomain
      );
    }

    if (outputTypeFollowup && localDomain.size > 0) {
      explicitFrameTarget = new Set(localDomain);
      predicateObjects = new Set(localDomain);
    }

    if (
      relations.has("effect") &&
      predicateObjects.size === 0 &&
      conditionDomain.size > 0
    ) {
      predicateObjects = new Set(conditionDomain);
    }

    const genericOrEmptyObject =
      predicateObjects.size === 0 ||
      [...predicateObjects].every((token) => isMetaOrCarrierTerm(token));

    const hasExplicitLocalAnswerTarget =
      explicitFrameTarget.size > 0 ||
      outputTypeFollowup ||
      deadlineQuestion ||
      contentTarget.size > 0 ||
      passiveSubject.size > 0 ||
      (
        relations.has("effect") &&
        conditionDomain.size > 0
      );

    if (
      index > 0 &&
      !hasExplicitLocalAnswerTarget &&
      (
        antecedentNeeded ||
        relations.has("exception") ||
        relations.has("limit") ||
        genericOrEmptyObject
      )
    ) {
      if (
        antecedentNeeded &&
        predicateEvents.size === 0 &&
        priorPredicateEvents.size > 0
      ) {
        predicateEvents = new Set(priorPredicateEvents);
      }
      if (
        (antecedentNeeded || relations.has("exception") || relations.has("limit")) &&
        genericOrEmptyObject &&
        priorPredicateObjects.size > 0
      ) {
        predicateObjects = new Set(priorPredicateObjects);
      }
    }

    if (predicateObjects.size === 0) {
      let fallback = new Set(localDomain);
      if (fallback.size === 0 && conditionDomain.size > 0) {
        fallback = new Set(conditionDomain);
      }
      if (fallback.size === 0 && antecedentNeeded && priorSubjectTerms.size > 0) {
        fallback = new Set(priorSubjectTerms);
      }
      if (fallback.size === 0) fallback = new Set(contextReferent);
      predicateObjects = fallback;
    }

    let subjectTerms;

    if (explicitFrameTarget.size > 0) {
      subjectTerms = new Set(explicitFrameTarget);
    } else if (contentTarget.size > 0) {
      subjectTerms = new Set(contentTarget);
    } else if (deadlineQuestion) {
      subjectTerms = unionSets(priorSubjectTerms, localDomain);
    } else if (passiveSubject.size > 0) {
      subjectTerms = new Set(passiveSubject);
    } else if (hasExplicitLocalAnswerTarget && localDomain.size > 0) {
      subjectTerms = new Set(localDomain);
    } else if (
      relations.has("effect") &&
      conditionDomain.size > 0
    ) {
      subjectTerms = new Set(conditionDomain);
    } else if (index === 0) {
      subjectTerms =
        localDomain.size > 0
          ? new Set(localDomain)
          : predicateObjects.size > 0
            ? new Set(predicateObjects)
            : contextReferent.size > 0
              ? new Set(contextReferent)
              : new Set(referent);
    } else if (
      antecedentNeeded &&
      priorSubjectTerms.size > 0 &&
      localDomain.size === 0
    ) {
      subjectTerms = new Set(priorSubjectTerms);
    } else {
      subjectTerms =
        localDomain.size > 0
          ? new Set(localDomain)
          : predicateObjects.size > 0
            ? new Set(predicateObjects)
            : new Set(referent);
    }

    const sequenceFromPrior = index > 0 && isSequentialFollowup(local);
    const leadingState = stateTerms(leadingContext);
    const localAnchorsForContext = unionSets(
      localDomain,
      predicateObjects,
      predicateEvents,
      localStateTerms(local)
    );
    const leadingContextOverlap =
      leadingContext &&
      leadingState.size > 0 &&
      overlapRatio(
        leadingState,
        new Set(localAnchorsForContext)
      ) >= 0.33;
    const inheritedState =
      leadingContext &&
      (
        index === 0 ||
        (
          !sequenceFromPrior &&
          (antecedentNeeded || leadingContextOverlap)
        )
      )
        ? leadingState
        : new Set();

    const localState = localStateTerms(local);
    const suppressPronounConditionalState =
      conditionalEffectFrame &&
      antecedentNeeded &&
      /\b(?:they|them)\b/.test(q) &&
      priorSubjectTerms.size > 0;

    const cleanedLocalState = new Set(
      [...localState].filter((token) =>
        !isMetaOrCarrierTerm(token) &&
        !["rather", "than"].includes(token) &&
        !(satisfactionCriteriaFrame && token === "one") &&
        !suppressPronounConditionalState &&
        !(
          conditionalDispositionFrame ||
          postEventOutcomeFrame
        )
      )
    );
    let cleanedInheritedState = new Set(
      [...inheritedState].filter((token) => !isMetaOrCarrierTerm(token))
    );

    if (anaphoricDeadlineFrame) {
      cleanedInheritedState = new Set();
    }

    // When an anaphoric answer frame has an explicit entity target, inherited
    // context remains useful only insofar as it identifies that entity or its
    // operation. Incidental selectors such as "first time", a rule number, or
    // other upstream conditions must not disqualify a downstream effect rule.
    if (
      explicitFrameTarget.size > 0 &&
      index > 0 &&
      antecedentNeeded
    ) {
      const stateAnchors = unionSets(
        explicitFrameTarget,
        predicateEvents,
        priorPredicateEvents
      );
      cleanedInheritedState = new Set(
        [...cleanedInheritedState].filter((token) =>
          [...stateAnchors].some((anchor) => tokenEquivalent(token, anchor))
        )
      );
    }

    const state = unionSets(
      cleanedInheritedState,
      cleanedLocalState,
      relativeState
    );

    const firstRoutingPassiveState =
      index === 0 &&
      relations.has("destination") &&
      predicateEvents.has("refer")
        ? proceduralPassiveStateRelationTerms(leadingContext)
        : new Set();

    const structuredState = unionSets(
      stateRelationTerms(local),
      dispositionStateRelationTerms(local),
      (
        index === 0 || cleanedInheritedState.size > 0
          ? stateRelationTerms(leadingContext)
          : new Set()
      ),
      firstRoutingPassiveState
    );
    const contextIdentity = namedProcedureIdentity(leadingContext);

    let refinedReferent;
    if (explicitFrameTarget.size > 0) {
      refinedReferent = new Set(explicitFrameTarget);
    } else if (outputTypeFollowup) {
      refinedReferent = unionSets(
        subjectTerms,
        predicateObjects,
        priorPredicateObjects
      );
    } else {
      refinedReferent = new Set();
      for (const token of referent) {
        const retainedByRole =
          subjectTerms.has(token) ||
          predicateObjects.has(token);
        const transient =
          state.has(token) ||
          (
            predicateEvents.has(token) &&
            !retainedByRole
          ) ||
          isMetaOrCarrierTerm(token);

        if (!transient || retainedByRole) refinedReferent.add(token);
      }
      refinedReferent = unionSets(
        refinedReferent,
        subjectTerms,
        predicateObjects
      );
    }

    if (refinedReferent.size > 0) referent = refinedReferent;

    const inheritedParts = [];
    if (leadingContext) inheritedParts.push(leadingContext);
    if (index > 0 && antecedentNeeded) {
      inheritedParts.push(obligationClauses[index - 1]);
    }

    const inherited = inheritedParts.join("; ");
    const contextual = inherited ? `${inherited}; ${local}` : local;

    obligations.push({
      index,
      local,
      inherited,
      contextual,
      referentTerms: [...referent],
      subjectTerms: [...subjectTerms],
      actorTerms: [...actors],
      actorQualifiers: [...qualifiers],
      stateTerms: [...state],
      stateRelationTerms: [...structuredState],
      contextIdentity,
      relations: [...relations],
      predicateEvents: [...predicateEvents],
      predicateObjects: [...predicateObjects],
      distributedAnswerFrame:
        conditionalLimitFrame ? "conditional_limit" : null,
      semanticFrame:
        conditionalDispositionFrame ? "conditional_disposition" :
        postEventOutcomeFrame ? "post_event_outcome" :
        noticeFailureFrame ? "notice_failure" :
        deadlineFailureFrame ? "deadline_failure" :
        conditionalEffectFrame ? "conditional_effect" :
        takesEffectFrame ? "takes_effect" :
        temporalApplicationFrame ? "temporal_application" :
        overrideForceFrame ? "override_force" :
        normativeObligationFrame ? "normative_obligation" :
        actorActionFrame ? "actor_action" :
        requiredAccompanimentFrame ? "required_accompaniment" :
        statusFrame ? "status_target" :
        requiredProtectionFrame ? "required_protection" :
        mixedConsiderationFrame ? "mixed_consideration" :
        constraintBundleFrame ? "constraint_bundle" :
        acknowledgementFrame ? "acknowledgement" :
        attendanceConditionFrame ? "attendance_condition" :
        goIntoCommitteeConditionFrame ? "go_into_committee_condition" :
        anaphoricDeadlineFrame ? "anaphoric_deadline" :
        permissionConditionFrame ? "permission_condition" :
        remainingLimitFrame ? "remaining_limit" :
        suchEntityFrame ? "such_entity" :
        decisionAuthorityFrame ? "decision_authority" :
        reviewFrame ? "review" :
        actorExclusionFrame ? "actor_exclusion" :
        openActionFrame ? "open_action" :
        optionListFrame ? "option_list" :
        satisfactionCriteriaFrame ? "satisfaction_criteria" :
        referralExclusionFrame ? "referral_exclusion" :
        prerequisiteEventFrame ? "prerequisite_event" :
        governedRuleFrame ? "governed_rule" :
        triggerEffectFrame ? "trigger_effect" :
        stageEffectFrame ? "stage_effect" :
        reportLifecycleFrame ? "report_lifecycle" :
        eligibilityFrame ? "eligibility_criteria" :
        criteriaFrame ? "criteria" :
        responsibilityAuthorityFrame ? "responsibility_authority" :
        isContentAnswerQuestion(local) ? "content_answer" :
        isEnumeratedContentAnswerQuestion(local) ? "enumerated_content_answer" :
        null,
      sequenceFromPrior,
    });

    if (referent.size > 0) {
      rootReferent =
        explicitFrameTarget.size > 0
          ? new Set(referent)
          : unionSets(rootReferent, referent);
    }
    if (actors.size > 0) priorActors = actors;
    if (qualifiers.size > 0) priorQualifiers = qualifiers;
    if (predicateEvents.size > 0) priorPredicateEvents = predicateEvents;
    if (predicateObjects.size > 0) priorPredicateObjects = predicateObjects;
    if (subjectTerms.size > 0) priorSubjectTerms = subjectTerms;
  }

  return obligations;
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

  if (
    /\bon a point of order\b|\bby leave\b|\bby motion\b|\bmotion on notice\b|\bon motion with notice\b|\ba motion may be moved\b|\bwith the agreement\b|\bwith agreement\b/.test(all) ||
    /\bmay invite\b.{0,80}\bauthori[sz]e\b/.test(all) ||
    /\bindicate to\b.{0,50}\bsupport\b/.test(all) ||
    /\bmake a public statement\b|\bmake .* available\b|\bauthori[sz].*statement\b/.test(all)
  ) signals.add("method");

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
  const relationGate =
    obligation.relations.length === 0 ||
    Object.values(relationSupportByType).some((value) => value >= 0.28);
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
    eligible,
    coreEligible,
    qualificationEligible,
    referentFit,
    referentHeading,
    referentPath,
    referentBody,
    subjectFit: bound.subjectFit,
    subjectTerms: obligation.subjectTerms,
    relationFit,
    relationSupportByType,
    bestRelationClauseByType: bound.bestRelationClauseByType,
    boundRelationFit: bound.boundRelationFit,
    predicateFit: bound.predicateFit,
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
    lexicalFit,
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

function buildMatrix(obligations, question, candidates) {
  return candidates.map((candidate) => ({
    candidate,
    obligationProfiles: obligations.map((obligation) =>
      v4EvidenceProfile(obligation, question, candidate)
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

function bestCandidateForField(selected, obligationIndex, field) {
  let best = null;
  let bestValue = -1;
  for (const item of selected) {
    const p = item.obligationProfiles[obligationIndex];
    if (!p.eligible) continue;
    const value = p[field] ?? 0;
    if (value > bestValue) {
      bestValue = value;
      best = item;
    }
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

function recall(required, selected) {
  const selectedSet = new Set(selected);
  const found = required.filter((label) => selectedSet.has(label));
  return {
    found,
    missing: required.filter((label) => !selectedSet.has(label)),
    recall: required.length === 0 ? 1 : found.length / required.length,
  };
}

function precisionProxy(required, selected) {
  if (selected.length === 0) return required.length === 0 ? 1 : 0;
  const requiredSet = new Set(required);
  return selected.filter((label) => requiredSet.has(label)).length / selected.length;
}

function setEqual(a, b) {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((x) => bs.has(x));
}

function candidateStatus(candidate) {
  if (!candidate) return "ABSENT";
  if (candidate.sources.some((source) => source.kind === "base")) return "BASE_TOP10";
  if (candidate.sources.some((source) => source.kind === "adaptive_widen")) return "WIDENED_11_30";
  if (candidate.sources.some((source) => source.kind === "structural_adjacent")) return "STRUCTURAL_ADJACENT";
  return "OTHER";
}

function rankForObligation(matrix, candidate, obligationIndex) {
  const ranked = [...matrix].sort(
    (a, b) =>
      b.obligationProfiles[obligationIndex].lexicalFit -
      a.obligationProfiles[obligationIndex].lexicalFit
  );
  return ranked.findIndex(
    (item) => item.candidate.result.sectionId === candidate.result.sectionId
  ) + 1;
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
export async function selectV517AuthorityPack(input) {
  const obligations = deriveObligations(input.question);
  const dimensions = productionDimensions(input.searches ?? []);
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

  const candidates = [...enrichedCandidates.values()];
  const matrix = buildMatrix(obligations, input.question, candidates);
  const requestedMax = Number.isInteger(input.maxAuthorities)
    ? input.maxAuthorities
    : 4;
  const maxAuthorities = Math.max(1, Math.min(requestedMax, 4));
  const rawSelection = selectPack(obligations, matrix, maxAuthorities);
  const selection = pruneRedundantAuthorities(rawSelection.selected, obligations);

  const prePruneLabels = rawSelection.selected.map(
    (item) => item.candidate.result.citationLabel
  );
  const selectedLabels = selection.selected.map(
    (item) => item.candidate.result.citationLabel
  );
  const obligationDetails = selection.utility.obligationDetails.map((detail) => ({
    coverage: detail.coverage,
    complete: detail.complete,
  }));
  const minObligationCoverage =
    obligationDetails.length > 0
      ? Math.min(...obligationDetails.map((detail) => detail.coverage))
      : 0;
  const allObligationsComplete =
    obligationDetails.length > 0 &&
    obligationDetails.every((detail) => detail.complete);

  return {
    finalAuthorities: selection.selected.map((item) => item.candidate.result),
    prePruneLabels,
    selectedLabels,
    prunedRedundant: selection.pruned,
    minObligationCoverage,
    allObligationsComplete,
    obligationDetails,
    candidateCount: candidates.length,
  };
}
