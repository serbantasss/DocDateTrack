/** Lower case without diacritics, so a search for "stefan" finds "Ștefan". */
function foldText(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** True when every word of `query` appears in at least one of `values` (see foldText). */
function matchesAllWords(query, values) {
  const haystack = foldText(values.filter(Boolean).join(' '));
  return foldText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

module.exports = { foldText, matchesAllWords };
