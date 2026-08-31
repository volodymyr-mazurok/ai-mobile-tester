/**
 * Oracles for user-facing COPY - the text an app shows a person.
 *
 * Separate from the element oracles in test/support/explore.ts because these
 * take a string and nothing else: a spec can assert with them, and the
 * exploratory sweep can run them over every text node on a screen.
 */

/**
 * The longest immediately-repeated phrase in a sentence, or null.
 *
 * ⚠️ CHECKS PHRASES, NOT JUST WORDS, and that distinction is the whole point.
 * A first attempt at this compared each word with the next one - which catches
 * "the the" and completely misses "Are you sure **you sure** you want to
 * logout?", because no two ADJACENT words there are equal. The duplication is a
 * repeated bigram.
 *
 * The test using it passed, green, against a build that visibly had the defect.
 * An assertion that cannot fail for the reason you wrote it is worse than none:
 * it converts an open question into a false answer.
 *
 * Longest first, so "you sure you sure" reports the bigram rather than fixating
 * on a single word inside it.
 */
export function repeatedPhrase(sentence: string, maxWords = 4): string | null {
  const words = sentence
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean);

  for (let n = Math.min(maxWords, Math.floor(words.length / 2)); n >= 1; n--) {
    for (let i = 0; i + 2 * n <= words.length; i++) {
      const first = words.slice(i, i + n).join(" ");
      const second = words.slice(i + n, i + 2 * n).join(" ");
      if (first === second) return first;
    }
  }
  return null;
}

/**
 * The sentence with an immediately-repeated phrase removed, or unchanged.
 *
 * Exists so a spec can assert on COPY AS TEXT rather than against `null`:
 *
 *   expect(message).toBe(withoutRepeatedPhrase(message));
 *
 * Semantically identical to `expect(repeatedPhrase(message)).toBeNull()` - it
 * changes the string only when the defect is present - but the failure reads
 *
 *   Expected: "Are you sure you want to logout?"
 *   Received: "Are you sure you sure you want to logout?"
 *
 * instead of `expect(received).toBeNull()  Received: "you sure"`. The two
 * sentences side by side are what somebody pastes into a ticket; the phrase on
 * its own has to be explained first.
 *
 * ⚠️ WORKS ON THE ORIGINAL TOKENS, not on the normalised ones repeatedPhrase
 * compares. Comparison has to ignore case and punctuation; the sentence handed
 * back to a human must not lose them.
 */
export function withoutRepeatedPhrase(sentence: string, maxWords = 4): string {
  const tokens = sentence.split(/(\s+)/).filter((t) => t.trim());
  const norm = tokens.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));

  for (let n = Math.min(maxWords, Math.floor(tokens.length / 2)); n >= 1; n--) {
    for (let i = 0; i + 2 * n <= tokens.length; i++) {
      const first = norm.slice(i, i + n).join(" ");
      const second = norm.slice(i + n, i + 2 * n).join(" ");
      if (first && first === second) {
        return [...tokens.slice(0, i + n), ...tokens.slice(i + 2 * n)].join(" ");
      }
    }
  }
  return sentence;
}
