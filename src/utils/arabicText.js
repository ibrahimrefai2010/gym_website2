// Minimal Arabic shaping + visual reordering for engines that do not shape or
// apply the bidi algorithm themselves (pdfkit). It maps Arabic letters to their
// contextual presentation forms (U+FE7x..U+FEFx), handles the lam-alef
// ligatures, then reverses the string for right-to-left display while keeping
// runs of Latin letters / digits / their inner punctuation in reading order.
//
// This is not a full Unicode Bidi implementation. It is aimed at invoice and
// report fields: predominantly-Arabic text with embedded numbers, dates, and
// the odd Latin token. For pure-Latin text it is a no-op.

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

// letter: [isolated, final, initial, medial]. `dual` = joins on both sides.
// Letters without `dual` only join to the preceding letter (right-joining).
const LETTERS = {
  "ء": { forms: ["ﺀ", "ﺀ", "ﺀ", "ﺀ"] }, // hamza
  "آ": { forms: ["ﺁ", "ﺂ", "ﺁ", "ﺂ"] }, // alef madda
  "أ": { forms: ["ﺃ", "ﺄ", "ﺃ", "ﺄ"] }, // alef hamza above
  "ؤ": { forms: ["ﺅ", "ﺆ", "ﺅ", "ﺆ"] }, // waw hamza
  "إ": { forms: ["ﺇ", "ﺈ", "ﺇ", "ﺈ"] }, // alef hamza below
  "ئ": { forms: ["ﺉ", "ﺊ", "ﺋ", "ﺌ"], dual: true }, // yeh hamza
  "ا": { forms: ["ﺍ", "ﺎ", "ﺍ", "ﺎ"] }, // alef
  "ب": { forms: ["ﺏ", "ﺐ", "ﺑ", "ﺒ"], dual: true }, // beh
  "ة": { forms: ["ﺓ", "ﺔ", "ﺓ", "ﺔ"] }, // teh marbuta
  "ت": { forms: ["ﺕ", "ﺖ", "ﺗ", "ﺘ"], dual: true }, // teh
  "ث": { forms: ["ﺙ", "ﺚ", "ﺛ", "ﺜ"], dual: true }, // theh
  "ج": { forms: ["ﺝ", "ﺞ", "ﺟ", "ﺠ"], dual: true }, // jeem
  "ح": { forms: ["ﺡ", "ﺢ", "ﺣ", "ﺤ"], dual: true }, // hah
  "خ": { forms: ["ﺥ", "ﺦ", "ﺧ", "ﺨ"], dual: true }, // khah
  "د": { forms: ["ﺩ", "ﺪ", "ﺩ", "ﺪ"] }, // dal
  "ذ": { forms: ["ﺫ", "ﺬ", "ﺫ", "ﺬ"] }, // thal
  "ر": { forms: ["ﺭ", "ﺮ", "ﺭ", "ﺮ"] }, // reh
  "ز": { forms: ["ﺯ", "ﺰ", "ﺯ", "ﺰ"] }, // zain
  "س": { forms: ["ﺱ", "ﺲ", "ﺳ", "ﺴ"], dual: true }, // seen
  "ش": { forms: ["ﺵ", "ﺶ", "ﺷ", "ﺸ"], dual: true }, // sheen
  "ص": { forms: ["ﺹ", "ﺺ", "ﺻ", "ﺼ"], dual: true }, // sad
  "ض": { forms: ["ﺽ", "ﺾ", "ﺿ", "ﻀ"], dual: true }, // dad
  "ط": { forms: ["ﻁ", "ﻂ", "ﻃ", "ﻄ"], dual: true }, // tah
  "ظ": { forms: ["ﻅ", "ﻆ", "ﻇ", "ﻈ"], dual: true }, // zah
  "ع": { forms: ["ﻉ", "ﻊ", "ﻋ", "ﻌ"], dual: true }, // ain
  "غ": { forms: ["ﻍ", "ﻎ", "ﻏ", "ﻐ"], dual: true }, // ghain
  "ف": { forms: ["ﻑ", "ﻒ", "ﻓ", "ﻔ"], dual: true }, // feh
  "ق": { forms: ["ﻕ", "ﻖ", "ﻗ", "ﻘ"], dual: true }, // qaf
  "ك": { forms: ["ﻙ", "ﻚ", "ﻛ", "ﻜ"], dual: true }, // kaf
  "ل": { forms: ["ﻝ", "ﻞ", "ﻟ", "ﻠ"], dual: true }, // lam
  "م": { forms: ["ﻡ", "ﻢ", "ﻣ", "ﻤ"], dual: true }, // meem
  "ن": { forms: ["ﻥ", "ﻦ", "ﻧ", "ﻨ"], dual: true }, // noon
  "ه": { forms: ["ﻩ", "ﻪ", "ﻫ", "ﻬ"], dual: true }, // heh
  "و": { forms: ["ﻭ", "ﻮ", "ﻭ", "ﻮ"] }, // waw
  "ى": { forms: ["ﻯ", "ﻰ", "ﻯ", "ﻰ"] }, // alef maksura
  "ي": { forms: ["ﻱ", "ﻲ", "ﻳ", "ﻴ"], dual: true } // yeh
};

// lam + alef variants -> ligature. [whenIsolated, whenPrevConnects]
const LAM_ALEF = {
  "آ": ["ﻵ", "ﻶ"],
  "أ": ["ﻷ", "ﻸ"],
  "إ": ["ﻹ", "ﻺ"],
  "ا": ["ﻻ", "ﻼ"]
};

const TRANSPARENT_RE = /[ً-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/; // harakat

function isArabicText(value) {
  return ARABIC_RE.test(String(value || ""));
}

function shapeArabic(input) {
  const chars = Array.from(String(input));
  const out = [];

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];

    if (TRANSPARENT_RE.test(ch)) {
      // Drop combining marks — Amiri would stack them but our reversal below is
      // grapheme-naive, so leaving them out avoids visual corruption.
      continue;
    }

    const letter = LETTERS[ch];
    if (!letter) {
      out.push(ch);
      continue;
    }

    const prev = findAdjacent(chars, i, -1);
    const next = findAdjacent(chars, i, 1);
    const prevConnects = prev.letter && prev.letter.dual;

    // lam-alef ligature
    if (ch === "ل" && next.char && LAM_ALEF[next.char]) {
      out.push(LAM_ALEF[next.char][prevConnects ? 1 : 0]);
      i = next.index; // consume the alef
      continue;
    }

    const nextConnects = Boolean(next.letter);
    let formIndex;
    if (prevConnects && nextConnects && letter.dual) formIndex = 3; // medial
    else if (prevConnects && letter.dual === undefined && nextConnects) formIndex = 1;
    else if (prevConnects && nextConnects && !letter.dual) formIndex = 1; // final (can't start)
    else if (prevConnects) formIndex = 1; // final
    else if (nextConnects && letter.dual) formIndex = 2; // initial
    else formIndex = 0; // isolated

    out.push(letter.forms[formIndex]);
  }

  return out.join("");
}

function findAdjacent(chars, index, direction) {
  let j = index + direction;
  while (j >= 0 && j < chars.length && TRANSPARENT_RE.test(chars[j])) {
    j += direction;
  }
  const char = j >= 0 && j < chars.length ? chars[j] : null;
  return { char, index: j, letter: char ? LETTERS[char] : null };
}

// Reverse for RTL display, but keep Latin/digit runs (and their inner
// punctuation/spaces) left-to-right.
const LTR_RUN_RE = /[0-9A-Za-zÀ-ɏ][0-9A-Za-zÀ-ɏ .,:/\\@#%+_-]*/g;

function reorderForRtl(shaped) {
  const tokens = [];
  let lastIndex = 0;
  let match;
  LTR_RUN_RE.lastIndex = 0;
  while ((match = LTR_RUN_RE.exec(shaped))) {
    if (match.index > lastIndex) {
      tokens.push({ ltr: false, text: shaped.slice(lastIndex, match.index) });
    }
    tokens.push({ ltr: true, text: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < shaped.length) {
    tokens.push({ ltr: false, text: shaped.slice(lastIndex) });
  }

  return tokens
    .reverse()
    .map((token) => (token.ltr ? token.text : Array.from(token.text).reverse().join("")))
    .join("")
    .trim();
}

/**
 * Prepare a string for direct rendering by pdfkit. Arabic text is shaped and
 * visually reordered RTL; non-Arabic text is returned unchanged.
 */
function prepareForPdf(value) {
  const text = value == null ? "" : String(value);
  if (!isArabicText(text)) {
    return text;
  }
  return reorderForRtl(shapeArabic(text));
}

module.exports = { isArabicText, shapeArabic, reorderForRtl, prepareForPdf };
