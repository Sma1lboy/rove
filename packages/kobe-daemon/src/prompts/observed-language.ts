/**
 * What language the user of a task writes in, observed from their own text.
 *
 * NOT a setting. Rove already handles every prompt it delivers, so it can
 * see which language the person is writing in and keep injecting text in
 * that language — instead of asking them to find a switch and flip it. A
 * task whose user writes Chinese gets Chinese back with nothing configured.
 *
 * The detection is deliberately coarse: CJK or not. That is the whole
 * question we have to answer, and a detection library would add a dependency
 * and a class of wrong answers (short strings, code, mixed text) to decide
 * something we do not ask. Distinguishing Chinese from Japanese is not
 * needed — we ship two locales.
 *
 * The signal is CJK share, not presence: an English prompt quoting one
 * Chinese identifier is still an English prompt, and a Chinese prompt full
 * of code, paths, and CLI flags is still a Chinese one. So we compare CJK
 * characters against the letters that compete with them, and ignore
 * everything neither (digits, punctuation, whitespace, emoji), which is
 * what makes a fenced code block in a Chinese prompt harmless.
 */

/** Languages the injected-prompt text can be written in. */
export type ObservedLanguage = "en" | "zh"

/**
 * CJK ideographs plus the kana ranges. Kana counts as CJK so a Japanese
 * prompt lands on the non-English side rather than being read as English —
 * `zh` is the closest thing we ship, and it is the better wrong answer.
 */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/u
/** Latin/Cyrillic/Greek letters — the scripts that argue for "not CJK". */
const ALPHA = /[a-zA-ZÀ-ɏͰ-ϿЀ-ӿ]/u

/**
 * The language `text` is written in, or null when the text carries no
 * opinion (empty, or nothing but digits, symbols, and paths). Null means
 * "learned nothing" — the caller keeps whatever it observed before rather
 * than overwriting a real observation with a shrug.
 */
export function detectLanguage(text: string): ObservedLanguage | null {
  let cjk = 0
  let alpha = 0
  for (const ch of text) {
    if (CJK.test(ch)) cjk += 1
    else if (ALPHA.test(ch)) alpha += 1
  }
  if (cjk === 0 && alpha === 0) return null
  // One CJK character per ten Latin letters is already a text that is not
  // English prose — an English sentence borrowing a term sits far below it,
  // while Chinese prose (dense characters, few letters) sits far above.
  return cjk * 10 > alpha ? "zh" : "en"
}
