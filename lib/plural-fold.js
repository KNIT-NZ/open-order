/**
 * Number fold for proceeding kinds only.
 * Strip "-es" after ch, sh, x, z, or ss. A single "-s" otherwise,
 * so "houses" stays "house" and "speeches" becomes "speech".
 * Committee names do not use this.
 */
export function foldPlural(word) {
  const lower = String(word ?? "").toLowerCase().replace(/'s$/i, "");
  if (lower.length > 4 && lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(lower)) return lower.slice(0, -2);
  if (lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);
  return lower;
}
