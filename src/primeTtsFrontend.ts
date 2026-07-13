import { customPinyin, pinyin } from "pinyin-pro";

export type PrimeTtsIds = {
  phoneIds: number[];
  toneIds: number[];
  langIds: number[];
};

const PRIME_TTS_SYMBOL_IDS: Record<string, number> = {
  _blank: 0, _pad: 1, UNK: 2, SP: 3,
  "ㄅ": 4, "ㄆ": 5, "ㄇ": 6, "ㄈ": 7, "ㄉ": 8, "ㄊ": 9, "ㄋ": 10, "ㄌ": 11, "ㄍ": 12, "ㄎ": 13, "ㄏ": 14,
  "ㄐ": 15, "ㄑ": 16, "ㄒ": 17, "ㄓ": 18, "ㄔ": 19, "ㄕ": 20, "ㄖ": 21, "ㄗ": 22, "ㄘ": 23, "ㄙ": 24,
  "ㄚ": 25, "ㄛ": 26, "ㄜ": 27, "ㄝ": 28, "ㄞ": 29, "ㄟ": 30, "ㄠ": 31, "ㄡ": 32, "ㄢ": 33, "ㄣ": 34,
  "ㄤ": 35, "ㄥ": 36, "ㄦ": 37, "ㄧ": 38, "ㄨ": 39, "ㄩ": 40,
  AA: 41, AE: 42, AH: 43, AO: 44, AW: 45, AY: 46, B: 47, CH: 48, D: 49, DH: 50, EH: 51, ER: 52,
  EY: 53, F: 54, G: 55, HH: 56, IH: 57, IY: 58, JH: 59, K: 60, L: 61, M: 62, N: 63, NG: 64,
  OW: 65, OY: 66, P: 67, R: 68, S: 69, SH: 70, T: 71, TH: 72, UH: 73, UW: 74, V: 75, W: 76,
  Y: 77, Z: 78, ZH: 79,
  ",": 80, ".": 81, "?": 82, "!": 83, "...": 84, "-": 85, "'": 86, "ㄭ": 87
};

const PRIME_TTS_PUNCT = new Set([",", ".", "?", "!", "...", "-", "'"]);
const PRIME_TTS_PINYIN_INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"] as const;
const PRIME_TTS_APICAL_I_INITIALS = new Set(["zh", "ch", "sh", "r", "z", "c", "s"]);
const PRIME_TTS_INITIAL_TO_ZHUYIN: Record<string, string> = {
  b: "ㄅ", p: "ㄆ", m: "ㄇ", f: "ㄈ", d: "ㄉ", t: "ㄊ", n: "ㄋ", l: "ㄌ", g: "ㄍ", k: "ㄎ", h: "ㄏ",
  j: "ㄐ", q: "ㄑ", x: "ㄒ", zh: "ㄓ", ch: "ㄔ", sh: "ㄕ", r: "ㄖ", z: "ㄗ", c: "ㄘ", s: "ㄙ"
};
const PRIME_TTS_FINAL_TO_ZHUYIN: Record<string, string[]> = {
  a: ["ㄚ"], o: ["ㄛ"], e: ["ㄜ"], ai: ["ㄞ"], ei: ["ㄟ"], ao: ["ㄠ"], ou: ["ㄡ"], an: ["ㄢ"], en: ["ㄣ"], ang: ["ㄤ"], eng: ["ㄥ"], er: ["ㄦ"],
  i: ["ㄧ"], ia: ["ㄧ", "ㄚ"], ie: ["ㄧ", "ㄝ"], iao: ["ㄧ", "ㄠ"], iu: ["ㄧ", "ㄡ"], ian: ["ㄧ", "ㄢ"], in: ["ㄧ", "ㄣ"], iang: ["ㄧ", "ㄤ"], ing: ["ㄧ", "ㄥ"], iong: ["ㄩ", "ㄥ"],
  u: ["ㄨ"], ua: ["ㄨ", "ㄚ"], uo: ["ㄨ", "ㄛ"], uai: ["ㄨ", "ㄞ"], ui: ["ㄨ", "ㄟ"], uan: ["ㄨ", "ㄢ"], un: ["ㄨ", "ㄣ"], uang: ["ㄨ", "ㄤ"], ueng: ["ㄨ", "ㄥ"], ong: ["ㄨ", "ㄥ"],
  v: ["ㄩ"], ve: ["ㄩ", "ㄝ"], van: ["ㄩ", "ㄢ"], vn: ["ㄩ", "ㄣ"], ue: ["ㄩ", "ㄝ"], yuan: ["ㄩ", "ㄢ"], yun: ["ㄩ", "ㄣ"], yue: ["ㄩ", "ㄝ"], yu: ["ㄩ"],
  yi: ["ㄧ"], ya: ["ㄧ", "ㄚ"], ye: ["ㄧ", "ㄝ"], yao: ["ㄧ", "ㄠ"], you: ["ㄧ", "ㄡ"], yan: ["ㄧ", "ㄢ"], yin: ["ㄧ", "ㄣ"], yang: ["ㄧ", "ㄤ"], ying: ["ㄧ", "ㄥ"], yong: ["ㄩ", "ㄥ"],
  wu: ["ㄨ"], wa: ["ㄨ", "ㄚ"], wo: ["ㄨ", "ㄛ"], wai: ["ㄨ", "ㄞ"], wei: ["ㄨ", "ㄟ"], wan: ["ㄨ", "ㄢ"], wen: ["ㄨ", "ㄣ"], wang: ["ㄨ", "ㄤ"], weng: ["ㄨ", "ㄥ"]
};

const PRIME_TTS_WORD_PHONES: Record<string, string[]> = {
  a: ["AH"], ai: ["EY", "AY"], api: ["EY", "P", "IY", "AY"], and: ["AE", "N", "D"], are: ["AA", "R"], as: ["AE", "Z"], at: ["AE", "T"],
  be: ["B", "IY"], cancip: ["K", "AE", "N", "S", "IH", "P"], chat: ["CH", "AE", "T"], code: ["K", "OW", "D"],
  file: ["F", "AY", "L"], for: ["F", "AO", "R"], from: ["F", "R", "AH", "M"], hello: ["HH", "AH", "L", "OW"], hi: ["HH", "AY"],
  is: ["IH", "Z"], key: ["K", "IY"], markdown: ["M", "AA", "R", "K", "D", "AW", "N"], model: ["M", "AA", "D", "AH", "L"],
  note: ["N", "OW", "T"], obsidian: ["AH", "B", "S", "IH", "D", "IY", "AH", "N"], of: ["AH", "V"], ok: ["OW", "K", "EY"], open: ["OW", "P", "AH", "N"],
  plugin: ["P", "L", "AH", "G", "IH", "N"], read: ["R", "IY", "D"], search: ["S", "ER", "CH"], session: ["S", "EH", "SH", "AH", "N"],
  skill: ["S", "K", "IH", "L"], system: ["S", "IH", "S", "T", "AH", "M"], thank: ["TH", "AE", "NG", "K"], thanks: ["TH", "AE", "NG", "K", "S"],
  the: ["DH", "AH"], this: ["DH", "IH", "S"], to: ["T", "UW"], tts: ["T", "IY", "T", "IY", "EH", "S"], url: ["Y", "UW", "AA", "R", "EH", "L"],
  user: ["Y", "UW", "Z", "ER"], vault: ["V", "AO", "L", "T"], with: ["W", "IH", "DH"], yes: ["Y", "EH", "S"], you: ["Y", "UW"]
};

const PRIME_TTS_LETTER_PHONES: Record<string, string[]> = {
  a: ["EY"], b: ["B", "IY"], c: ["S", "IY"], d: ["D", "IY"], e: ["IY"], f: ["EH", "F"], g: ["JH", "IY"], h: ["EY", "CH"],
  i: ["AY"], j: ["JH", "EY"], k: ["K", "EY"], l: ["EH", "L"], m: ["EH", "M"], n: ["EH", "N"], o: ["OW"], p: ["P", "IY"],
  q: ["K", "Y", "UW"], r: ["AA", "R"], s: ["EH", "S"], t: ["T", "IY"], u: ["Y", "UW"], v: ["V", "IY"], w: ["D", "AH", "B", "AH", "L", "Y", "UW"],
  x: ["EH", "K", "S"], y: ["W", "AY"], z: ["Z", "IY"]
};

const PRIME_TTS_DIGIT_PHONES: Record<string, string[]> = {
  "0": ["Z", "IY", "R", "OW"], "1": ["W", "AH", "N"], "2": ["T", "UW"], "3": ["TH", "R", "IY"], "4": ["F", "AO", "R"],
  "5": ["F", "AY", "V"], "6": ["S", "IH", "K", "S"], "7": ["S", "EH", "V", "AH", "N"], "8": ["EY", "T"], "9": ["N", "AY", "N"]
};
const PRIME_TTS_CJK_LETTER_READINGS: Record<string, string> = {
  a: "诶", e: "易", i: "一", o: "哦", u: "优", v: "微"
};

function cjkLetterWordReading(word: string, text: string, start: number, end: number): string {
  if (!word || word.length > 8) return "";
  if (!/^[aeiouv]+$/i.test(word)) return "";
  const before = text.slice(Math.max(0, start - 6), start);
  const after = text.slice(end, end + 6);
  if (!/[\u3400-\u9fff]/.test(before + after)) return "";
  return word.toLowerCase().split("").map((char) => PRIME_TTS_CJK_LETTER_READINGS[char] ?? "").join("");
}

const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;
let primeTtsCustomPinyinReady = false;
const PRIME_TTS_CUSTOM_PINYIN: Record<string, string> = {
  了解: "liao3 jie3",
  了结: "liao3 jie2",
  了却: "liao3 que4",
  了然: "liao3 ran2",
  明了: "ming2 liao3",
  为了: "wei4 le0",
  走了: "zou3 le0",
  来了: "lai2 le0",
  好了: "hao3 le0",
  完了: "wan2 le0",
  快乐: "kuai4 le4",
  乐观: "le4 guan1",
  乐趣: "le4 qu4",
  娱乐: "yu2 le4",
  可乐: "ke3 le4",
  音乐: "yin1 yue4",
  乐队: "yue4 dui4",
  乐器: "yue4 qi4",
  乐谱: "yue4 pu3",
  长大: "zhang3 da4",
  长高: "zhang3 gao1",
  长短: "chang2 duan3",
  长期: "chang2 qi1",
  银行: "yin2 hang2",
  行业: "hang2 ye4",
  行为: "xing2 wei2",
  行走: "xing2 zou3",
  重新: "chong2 xin1",
  重复: "chong2 fu4",
  重要: "zhong4 yao4"
};

export function primeTtsTextToIds(input: string): PrimeTtsIds {
  const normalized = primeTtsNormalizeText(
    looksLikeEnglishTtsText(input) ? input : normalizeChineseNumbersForPrimeTts(input)
  );
  const phoneIds: number[] = [];
  const toneIds: number[] = [];
  const langIds: number[] = [];
  const push = (symbol: string, tone = 0, lang = 0): void => {
    phoneIds.push(PRIME_TTS_SYMBOL_IDS[symbol] ?? PRIME_TTS_SYMBOL_IDS.UNK);
    toneIds.push(Math.max(0, Math.min(5, tone)));
    langIds.push(lang);
  };
  let index = 0;
  while (index < normalized.length) {
    const char = normalized[index];
    if (isCjkChar(char)) {
      let end = index + 1;
      while (end < normalized.length && isCjkChar(normalized[end])) end += 1;
      const run = normalized.slice(index, end);
      const syllables = primeTtsPinyinArray(run);
      for (let offset = 0; offset < run.length; offset += 1) {
        const syllable = syllables[offset] ?? primeTtsPinyinArray(run[offset])[0] ?? "";
        const units = pinyinSyllableToZhuyin(syllable);
        for (const unit of units.symbols) push(unit, units.tone, 0);
      }
      index = end;
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      let end = index + 1;
      while (end < normalized.length && /[A-Za-z']/.test(normalized[end])) end += 1;
      const word = normalized.slice(index, end).replace(/^'+|'+$/g, "");
      const cjkLetterReading = cjkLetterWordReading(word, normalized, index, end);
      if (cjkLetterReading) {
        const syllables = primeTtsPinyinArray(cjkLetterReading);
        for (let offset = 0; offset < cjkLetterReading.length; offset += 1) {
          const units = pinyinSyllableToZhuyin(syllables[offset] ?? "");
          for (const unit of units.symbols) push(unit, units.tone, 0);
        }
        index = end;
        continue;
      }
      const phones = englishWordToPrimePhones(word);
      for (const phone of phones) push(phone, 0, 1);
      push("SP", 0, 1);
      index = end;
      continue;
    }
    if (/\d/.test(char)) {
      for (const phone of PRIME_TTS_DIGIT_PHONES[char] ?? []) push(phone, 0, 1);
      index += 1;
      continue;
    }
    const punct = normalizePrimeTtsPunctuation(char);
    if (punct && PRIME_TTS_PUNCT.has(punct)) push(punct, 0, isCjkNeighbor(normalized, index) ? 0 : 1);
    else if (/\s/.test(char) && phoneIds.length && phoneIds[phoneIds.length - 1] !== PRIME_TTS_SYMBOL_IDS.SP) push("SP", 0, 0);
    index += 1;
  }
  return { phoneIds, toneIds, langIds };
}

function ensurePrimeTtsCustomPinyin(): void {
  if (primeTtsCustomPinyinReady) return;
  primeTtsCustomPinyinReady = true;
  try {
    customPinyin(PRIME_TTS_CUSTOM_PINYIN, { multiple: "replace", polyphonic: "replace" });
  } catch (error) {
    console.debug("Cancip PrimeTTS custom pinyin skipped", error);
  }
}

function primeTtsPinyinArray(input: string): string[] {
  ensurePrimeTtsCustomPinyin();
  try {
    return pinyin(input, { toneType: "num", type: "array", toneSandhi: true, segmentit: 2 });
  } catch {
    return pinyin(input, { toneType: "num", type: "array" });
  }
}

function normalizeChineseNumbersForPrimeTts(input: string, forceFull = false): string {
  if (!/\d/.test(input) || (!forceFull && !hasCjkText(input))) return input;
  const mode = forceFull ? "full" : chineseNumberReadingMode(input);
  if (mode === "none") return input;
  const normalizedPatterns = normalizeChineseDateTimeNumbers(input, mode);
  return normalizedPatterns.replace(/\d+(?:\.\d+)?[%％]?/g, (match, offset: number, full: string) => {
    if (isProtectedNumberToken(full, offset, match.length)) return match;
    if (mode !== "full" && !isChineseNumberContext(full, offset, match.length)) return match;
    const before = full.slice(Math.max(0, offset - 6), offset);
    const after = full.slice(offset + match.length, offset + match.length + 6);
    if (match.endsWith("%") || match.endsWith("％")) return `百分之${numberTokenToChinese(match.slice(0, -1), "value")}`;
    if (/年/.test(after.slice(0, 1)) && /^\d{2,4}$/.test(match)) return digitsToChinese(match);
    if (/[月日号时点分秒]/.test(after.slice(0, 1))) return numberTokenToChinese(match, "value");
    if (/[第]/.test(before.slice(-1)) || /[章节页条项次个]/.test(after.slice(0, 1))) return numberTokenToChinese(match, "value");
    if (/[:：]\s*$/.test(before) || /^\s*[、，,.。)]/.test(after)) return numberTokenToChinese(match, "value");
    return numberTokenToChinese(match, mode === "full" ? "auto" : "value");
  });
}

function normalizeChineseDateTimeNumbers(input: string, mode: "context" | "full"): string {
  let output = input;
  const shouldConvert = (full: string, offset: number, length: number): boolean => {
    return mode === "full" || isChineseNumberContext(full, offset, length);
  };
  output = output.replace(/(^|[^\w./\\-])(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?=$|[^\w./\\-])/g, (match, prefix: string, year: string, month: string, day: string, offset: number, full: string) => {
    if (!shouldConvert(full, offset + prefix.length, match.length - prefix.length)) return match;
    return `${prefix}${digitsToChinese(year)}年${numberTokenToChinese(month, "value")}月${numberTokenToChinese(day, "value")}日`;
  });
  output = output.replace(/(^|[^\w./\\-])(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?=$|[^\w./\\-])/g, (match, prefix: string, hour: string, minute: string, second: string | undefined, offset: number, full: string) => {
    if (!shouldConvert(full, offset + prefix.length, match.length - prefix.length)) return match;
    const secondText = second ? `${numberTokenToChinese(second, "value")}秒` : "";
    return `${prefix}${numberTokenToChinese(hour, "value")}点${numberTokenToChinese(minute, "value")}分${secondText}`;
  });
  return output;
}

function hasCjkText(input: string): boolean {
  return /[\u3400-\u9fff]/.test(input);
}

function looksLikeEnglishTtsText(input: string): boolean {
  const text = input.replace(/https?:\/\/\S+/gi, " ").replace(/`[^`]*`/g, " ").trim();
  if (!text || hasCjkText(text)) return false;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  if (latinCount < 3) return false;
  const letterCount = ([...text.matchAll(/\p{L}/gu)]).length;
  if (letterCount && latinCount / letterCount < 0.8) return false;
  const wordCount = (text.match(/[A-Za-z]{2,}/g) ?? []).length;
  return wordCount >= 1 || latinCount >= 8;
}

function chineseNumberReadingMode(input: string): "none" | "context" | "full" {
  const compact = input.replace(/\s+/g, "");
  const cjkCount = (compact.match(/[\u3400-\u9fff]/g) ?? []).length;
  const digitCount = (compact.match(/\d/g) ?? []).length;
  const latinCount = (compact.match(/[A-Za-z]/g) ?? []).length;
  if (!cjkCount || !digitCount) return "none";
  if (cjkCount >= 4 && cjkCount >= latinCount * 2) return "full";
  return "context";
}

function isProtectedNumberToken(text: string, offset: number, length: number): boolean {
  const before = text.slice(Math.max(0, offset - 16), offset);
  const after = text.slice(offset + length, offset + length + 16);
  if (/https?:\/\/\S*$/i.test(before) || /(?:^|[\s([{<])(?:[A-Za-z]:)?(?:[./\\]|[A-Za-z0-9_-]+[./\\])[\w./\\-]*$/i.test(before)) return true;
  if (/^[A-Za-z_./\\-]/.test(after) || /[A-Za-z_./\\-]$/.test(before)) return true;
  if (/\bv(?:ersion)?\.?$/i.test(before) || /^[.-]\d/.test(after)) return true;
  return false;
}

function isChineseNumberContext(text: string, offset: number, length: number): boolean {
  const before = text.slice(Math.max(0, offset - 8), offset);
  const after = text.slice(offset + length, offset + length + 8);
  if (/https?:\/\/|[A-Za-z_./\\-]$/.test(before) || /^[A-Za-z_./\\-]/.test(after)) return false;
  return /[\u3400-\u9fff年月日号点第个条项次章节页岁分秒小时分钟%％：:，,。！？、；;（）()]/.test(before + after);
}

function numberTokenToChinese(token: string, mode: "auto" | "value" | "digits" = "auto"): string {
  if (!token) return "";
  if (mode === "digits") return digitsToChinese(token);
  if (token.includes(".")) {
    const [integer, fraction = ""] = token.split(".");
    return `${integerNumberToChinese(integer)}点${digitsToChinese(fraction)}`;
  }
  if (/^0\d+/.test(token)) return integerNumberToChinese(token.replace(/^0+(?=\d)/, "") || "0");
  if (mode === "auto" && token.length === 4 && /^[12]\d{3}$/.test(token)) return digitsToChinese(token);
  return integerNumberToChinese(token);
}

function digitsToChinese(input: string): string {
  return input.split("").map((char) => CHINESE_DIGITS[Number(char)] ?? char).join("");
}

function integerNumberToChinese(input: string): string {
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value)) return input;
  if (value === 0) return "零";
  if (value < 0 || value > 99999999) return input.split("").map((char) => CHINESE_DIGITS[Number(char)] ?? char).join("");
  const units = ["", "十", "百", "千"];
  const sectionUnits = ["", "万"];
  const sections: number[] = [];
  let rest = value;
  while (rest > 0) {
    sections.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }
  let output = "";
  let needZero = false;
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index];
    if (section === 0) {
      needZero = output.length > 0;
      continue;
    }
    if (needZero || (output && section < 1000)) output += "零";
    output += sectionToChinese(section, units) + sectionUnits[index];
    needZero = section % 10 === 0;
  }
  return output.replace(/^一十/, "十").replace(/零+/g, "零").replace(/零$/g, "");
}

function sectionToChinese(section: number, units: string[]): string {
  let output = "";
  let zero = false;
  for (let index = 3; index >= 0; index -= 1) {
    const unitValue = 10 ** index;
    const digit = Math.floor(section / unitValue) % 10;
    if (digit === 0) {
      if (output) zero = true;
      continue;
    }
    if (zero) {
      output += "零";
      zero = false;
    }
    output += `${CHINESE_DIGITS[digit]}${units[index]}`;
  }
  return output;
}

function primeTtsNormalizeText(input: string): string {
  return input
    .replace(/[，、；]/g, ",")
    .replace(/[。]/g, ".")
    .replace(/[？]/g, "?")
    .replace(/[！]/g, "!")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/https?:\/\/\S+/gi, " URL ")
    .replace(/\bAPI\b/g, "api")
    .replace(/\bTTS\b/g, "tts")
    .replace(/\s+/g, " ")
    .trim();
}

function pinyinSyllableToZhuyin(raw: string): { symbols: string[]; tone: number } {
  const match = raw.toLowerCase().replace(/ü/g, "v").match(/^([a-zv]+)([0-5])?$/);
  if (!match) return { symbols: ["UNK"], tone: 0 };
  let body = match[1];
  const tone = Number(match[2] === "0" ? "5" : match[2] ?? "5");
  let initial = "";
  for (const candidate of PRIME_TTS_PINYIN_INITIALS) {
    if (body.startsWith(candidate)) {
      initial = candidate;
      body = body.slice(candidate.length);
      break;
    }
  }
  if (initial === "y" || initial === "w") {
    body = `${initial}${body}`;
    initial = "";
  }
  if ((initial === "j" || initial === "q" || initial === "x") && body.startsWith("u")) {
    body = `v${body.slice(1)}`;
  }
  if (body === "i" && PRIME_TTS_APICAL_I_INITIALS.has(initial)) {
    body = "";
  }
  if (!body && PRIME_TTS_APICAL_I_INITIALS.has(initial)) {
    const syllabic = PRIME_TTS_INITIAL_TO_ZHUYIN[initial];
    return { symbols: syllabic ? [syllabic, "ㄭ"] : ["UNK"], tone };
  }
  const symbols = [
    ...(initial && PRIME_TTS_INITIAL_TO_ZHUYIN[initial] ? [PRIME_TTS_INITIAL_TO_ZHUYIN[initial]] : []),
    ...(PRIME_TTS_FINAL_TO_ZHUYIN[body] ?? [])
  ];
  return { symbols: symbols.length ? symbols : ["UNK"], tone };
}

function englishWordToPrimePhones(word: string): string[] {
  const lower = word.toLowerCase();
  if (!lower) return [];
  const known = PRIME_TTS_WORD_PHONES[lower];
  if (known) return known;
  if (lower.length <= 2 || /^[bcdfghjklmnpqrstvwxyz]{2,}$/i.test(lower)) {
    return lower.split("").flatMap((char) => PRIME_TTS_LETTER_PHONES[char] ?? []);
  }
  const phones: string[] = [];
  let index = 0;
  while (index < lower.length) {
    const rest = lower.slice(index);
    const two = rest.slice(0, 2);
    const four = rest.slice(0, 4);
    if (four === "tion") {
      phones.push("SH", "AH", "N");
      index += 4;
    } else if (two === "th") {
      phones.push("TH");
      index += 2;
    } else if (two === "sh") {
      phones.push("SH");
      index += 2;
    } else if (two === "ch") {
      phones.push("CH");
      index += 2;
    } else if (two === "ph") {
      phones.push("F");
      index += 2;
    } else if (two === "ng") {
      phones.push("NG");
      index += 2;
    } else if (two === "oo") {
      phones.push("UW");
      index += 2;
    } else if (two === "ee" || two === "ea") {
      phones.push("IY");
      index += 2;
    } else if (two === "ai" || two === "ay") {
      phones.push("EY");
      index += 2;
    } else if (two === "ow" || two === "ou") {
      phones.push("AW");
      index += 2;
    } else {
      phones.push(...englishLetterSound(lower[index]));
      index += 1;
    }
  }
  return phones.filter((phone) => phone in PRIME_TTS_SYMBOL_IDS);
}

function englishLetterSound(char: string): string[] {
  const map: Record<string, string[]> = {
    a: ["AE"], b: ["B"], c: ["K"], d: ["D"], e: ["EH"], f: ["F"], g: ["G"], h: ["HH"], i: ["IH"], j: ["JH"], k: ["K"], l: ["L"], m: ["M"],
    n: ["N"], o: ["AA"], p: ["P"], q: ["K"], r: ["R"], s: ["S"], t: ["T"], u: ["AH"], v: ["V"], w: ["W"], x: ["K", "S"], y: ["Y"], z: ["Z"]
  };
  return map[char] ?? [];
}

function normalizePrimeTtsPunctuation(char: string): string {
  if (!char || isPrimeTtsIgnorableSymbolChar(char)) return "";
  if (char === "," || char === "，" || char === "、" || char === ";" || char === "；" || char === ":" || char === "：") return ",";
  if (char === "." || char === "。") return ".";
  if (char === "?" || char === "？") return "?";
  if (char === "!" || char === "！") return "!";
  if (char === "…" || char === "⋯" || char === "⋮") return "...";
  if (char === "-" || char === "—" || char === "–" || char === "―") return "-";
  if (char === "'" || char === "’" || char === "‘" || char === "\"" || char === "“" || char === "”") return "'";
  if (/[\p{P}\p{S}]/u.test(char)) return ",";
  return "";
}

function isPrimeTtsIgnorableSymbolChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x206f) || (code >= 0xfe00 && code <= 0xfe0f);
}

function isCjkChar(char: string): boolean {
  return /[\u3400-\u9fff]/.test(char);
}

function isCjkNeighbor(text: string, index: number): boolean {
  return isCjkChar(text[index - 1] ?? "") || isCjkChar(text[index + 1] ?? "");
}
