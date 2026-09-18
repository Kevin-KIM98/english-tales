// 단어 단위 자막 → 학습용 문장 목록 (시작/끝 시각 포함)

const TAG_RE = /\[[^\]]*\]|\([^)]*(music|applause|laughter)[^)]*\)|>>|♪/gi;
const ABBREV = /^(mr|mrs|ms|dr|st|jr|sr|vs|etc|e\.g|i\.e|u\.s|a\.m|p\.m)\.$/i;
const MAX_WORDS = 32;

export function buildSentences(words) {
  // 1) 토큰화: 태그 제거, 공백 정리
  const tokens = [];
  for (const w of words) {
    const clean = w.text.replace(TAG_RE, ' ');
    for (const part of clean.split(/\s+/)) {
      if (part) tokens.push({ t: w.t, text: part });
    }
  }

  // 2) 문장 경계로 자르기
  const raw = [];
  let cur = [];
  const flush = () => {
    if (cur.length) raw.push(cur);
    cur = [];
  };
  tokens.forEach((tok, i) => {
    cur.push(tok);
    const next = tokens[i + 1];
    const ends = /[.!?]["'”’)]*$/.test(tok.text) && !ABBREV.test(tok.text);
    if (ends && (!next || /^["'“‘(]?[A-Z0-9]/.test(next.text))) flush();
  });
  flush();

  // 3) 너무 긴 문장은 쉼표/접속사 근처에서 나눈다 (자동 자막은 마침표가 누락되기도 함)
  const pieces = [];
  for (const s of raw) {
    let rest = s;
    while (rest.length > MAX_WORDS) {
      const mid = Math.floor(rest.length / 2);
      let cut = -1;
      for (let d = 0; d < mid - 4 && cut < 0; d++) {
        for (const i of [mid + d, mid - d]) {
          if (/[,;:]$/.test(rest[i]?.text)) {
            cut = i + 1;
            break;
          }
          if (/^(and|but|so|because|when|while|which|then)$/i.test(rest[i]?.text)) {
            cut = i;
            break;
          }
        }
      }
      if (cut <= 3) cut = mid;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    pieces.push(rest);
  }

  // 4) 한 단어짜리 조각은 앞 문장에 붙인다
  const merged = [];
  for (const p of pieces) {
    if (p.length < 2 && merged.length) merged.at(-1).push(...p);
    else merged.push(p);
  }

  return merged.map((p, i) => {
    const next = merged[i + 1];
    const start = p[0].t;
    const end = next ? next[0].t : p.at(-1).t + 2000;
    const en = p
      .map((x) => x.text)
      .join(' ')
      .replace(/\s+([,.!?;:])/g, '$1');
    return { i, en: en.charAt(0).toUpperCase() + en.slice(1), start, end };
  });
}
