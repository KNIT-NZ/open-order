/**
 * Standard English closed classes. These are grammatical, not scenario lists.
 * Domain words (committee, house, proceeding heads) stay in the generator seeds.
 */

export const THE = "the";

export const ARTICLES = ["a", "an", THE];

export const DEMONSTRATIVES = ["this", "that", "these", "those"];

export const DETERMINERS = [
  "another", "her", "his", "its", "my", "other", "our", "such", "their",
  "what", "whatever", "which", "whichever", "whose", "your",
];

export const QUANTIFIERS = [
  "all", "any", "both", "each", "either", "enough", "every", "few", "fewer",
  "least", "less", "little", "many", "more", "most", "much", "neither", "no",
  "none", "several", "some",
];

export const PRONOUNS = [
  "he", "her", "hers", "herself", "him", "himself", "his", "i", "it", "its",
  "itself", "me", "mine", "my", "myself", "one", "oneself", "our", "ours",
  "ourselves", "she", "their", "theirs", "them", "themselves", "they", "us",
  "we", "who", "whom", "whomever", "whoever", "you", "your", "yours",
  "yourself", "yourselves",
];

export const AUXILIARIES = [
  "am", "are", "be", "been", "being", "did", "do", "does", "doing", "had",
  "has", "have", "having", "is", "was", "were",
];

export const MODALS = [
  "can", "could", "may", "might", "must", "shall", "should", "will", "would",
];

export const NEGATION = ["not"];

export const WH_ADVERBS = ["how", "why"];

/** Prepositions. The complement linkers are the named exports below. */
export const OF = "of";
export const ON = "on";
export const FOR = "for";

export const PREPOSITIONS = [
  "aboard", "about", "above", "across", "after", "against", "along", "amid",
  "among", "around", "as", "at", "before", "behind", "below", "beneath",
  "beside", "besides", "between", "beyond", "by", "concerning", "despite",
  "down", "during", "except", FOR, "from", "in", "inside", "into", "like",
  "near", OF, "off", ON, "onto", "out", "outside", "over", "past", "per",
  "regarding", "since", "than", "through", "throughout", "till", "to", "toward",
  "towards", "under", "underneath", "until", "unto", "up", "upon", "via",
  "with", "within", "without",
];

export const CONJUNCTIONS = [
  "although", "and", "because", "but", "if", "lest", "nor", "once", "or",
  "since", "so", "than", "though", "unless", "until", "when", "whenever",
  "where", "wherever", "whereas", "whether", "while", "whilst", "yet",
];

/** Number words. "one" is also a pronoun; for a committee name it is not content. */
export const NUMERALS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
];

/**
 * Words that do not name a committee. Pronouns, auxiliaries and modals are
 * closed-class for name boundaries, and they still count as content here.
 */
export const NAMED_NONCONTENT = new Set([
  ...ARTICLES,
  ...DEMONSTRATIVES,
  ...DETERMINERS,
  ...QUANTIFIERS,
  ...NUMERALS,
  ...PREPOSITIONS,
  ...CONJUNCTIONS,
]);

export function isNamedNonContent(word) {
  return NAMED_NONCONTENT.has(word);
}

/** Prepositions that link a head noun to its complement: Committee of/on/for X. */
export const COMPLEMENT_PREPOSITIONS = [OF, ON, FOR];

/** "on" introduces a topic after a class heading ("committees on lanterns"). */
export const TOPIC_PREPOSITION = ON;

export const CLOSED_CLASS = new Set([
  ...ARTICLES,
  ...DEMONSTRATIVES,
  ...DETERMINERS,
  ...QUANTIFIERS,
  ...PRONOUNS,
  ...AUXILIARIES,
  ...MODALS,
  ...NEGATION,
  ...WH_ADVERBS,
  ...PREPOSITIONS,
  ...CONJUNCTIONS,
]);

export function isClosedClass(word) {
  return CLOSED_CLASS.has(word);
}

export function isComplementPreposition(word) {
  return COMPLEMENT_PREPOSITIONS.includes(word);
}

export function isTopicPreposition(word) {
  return word === TOPIC_PREPOSITION;
}

export function isArticle(word) {
  return ARTICLES.includes(word);
}
