/**
 * Standard English closed classes. These are grammatical, not scenario lists.
 * Domain words (committee, house, proceeding heads) stay in the generators.
 */

export const ARTICLES = ["a", "an", "the"];

export const DEMONSTRATIVES = ["this", "that", "these", "those"];

export const QUANTIFIERS = [
  "all", "any", "both", "each", "either", "enough", "every", "few", "fewer",
  "least", "less", "little", "many", "more", "most", "much", "neither", "no",
  "none", "several", "some",
];

/** Prepositions. Complement linkers used by committee names are of, on, and for. */
export const PREPOSITIONS = [
  "aboard", "about", "above", "across", "after", "against", "along", "amid",
  "among", "around", "as", "at", "before", "behind", "below", "beneath",
  "beside", "besides", "between", "beyond", "by", "concerning", "despite",
  "down", "during", "except", "for", "from", "in", "inside", "into", "like",
  "near", "of", "off", "on", "onto", "out", "outside", "over", "past", "per",
  "regarding", "since", "than", "through", "throughout", "till", "to", "toward",
  "towards", "under", "underneath", "until", "unto", "up", "upon", "via",
  "with", "within", "without",
];

export const CONJUNCTIONS = [
  "and", "or", "nor", "but", "yet", "so", "although", "though", "because",
  "if", "unless", "whereas", "whether", "while", "once", "when", "whenever",
  "where", "wherever",
];

/** Prepositions that link a head noun to its complement: Committee of/on/for X. */
export const COMPLEMENT_PREPOSITIONS = ["of", "on", "for"];

/** "on" introduces a topic after a class heading ("committees on lanterns"). */
export const TOPIC_PREPOSITION = "on";

export const CLOSED_CLASS = new Set([
  ...ARTICLES,
  ...DEMONSTRATIVES,
  ...QUANTIFIERS,
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
