// 문장 목록 → 한국어 해석 + 학습 단어 + 표현 (휴대폰 안에서 실행)
// 해석: Google 번역(무료 공개 엔드포인트) → 단어 뜻은 실패 시 MyMemory로 보충
// 단어·발음기호·난이도·표현: 앱에 들어 있는 오프라인 데이터

import { http } from './net.js';
import { COMMON_WORDS } from './common-words.js';
import { findExpressions } from './expressions.js';
import { loadWordData, rankOf, lemma, levelOf, ipaOf } from './words.js';

const VOCAB_MAX = 30;
// 영상 끝의 '구독·댓글' 안내 문구에서 나온 단어는 학습 단어에서 뺀다
const YT_WORDS = new Set(['subscribe', 'subscriber', 'comment', 'channel', 'notification', 'video', 'playlist', 'like', 'share']);
const POS_SHORT = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.' };

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/* ── 번역 ── */
async function gtxOnce(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=' + encodeURIComponent(text);
  const res = await http(url, { timeout: 12000 });
  if (!res.ok) throw Object.assign(new Error(`번역 요청 실패 (${res.status})`), { status: res.status });
  return (res.json()[0] || []).map((seg) => seg[0]).join('');
}

async function gtx(text, tries = 3) {
  for (let n = 1; ; n++) {
    try {
      return await gtxOnce(text);
    } catch (err) {
      if (n >= tries) throw err;
      await new Promise((r) => setTimeout(r, (err.status === 429 ? 4000 : 800) * n));
    }
  }
}

/** 두 번째 무료 번역기 (MyMemory). 짧은 단어 뜻을 채울 때만 쓴다 */
async function myMemory(text) {
  const url = `https://api.mymemory.translated.net/get?langpair=en%7Cko&q=${encodeURIComponent(text)}`;
  const res = await http(url, { timeout: 8000 });
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const data = res.json();
  const t = data.responseData?.translatedText || '';
  if (data.quotaFinished || /MYMEMORY WARNING|INVALID/i.test(t)) throw new Error('MyMemory 한도 초과');
  // 번역 메모리에서 문장째 가져온 엉뚱한 결과는 버린다
  const clean = t.replace(/^[\s\-–·•]+/, '').trim();
  if (!/[가-힣]/.test(clean)) return ''; // 한국어가 아닌 결과("Multipart" 등)는 버린다
  if (text.split(' ').length <= 3 && (clean.length > 16 || /[.!?]$/.test(clean))) return '';
  return clean;
}

/** 여러 줄을 번역 (줄바꿈으로 묶어 요청 수 최소화). 실패한 줄은 빈 문자열, failed 에 개수 */
export async function translateMany(lines, onProgress = () => {}) {
  const out = new Array(lines.length).fill('');
  const batches = [];
  let cur = [];
  let len = 0;
  lines.forEach((line, idx) => {
    if (len + line.length > 3500 && cur.length) {
      batches.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(idx);
    len += line.length + 1;
  });
  if (cur.length) batches.push(cur);

  let failed = 0;
  for (const [n, batch] of batches.entries()) {
    try {
      const translated = (await gtx(batch.map((i) => lines[i]).join('\n'))).split('\n');
      if (translated.length === batch.length) batch.forEach((i, k) => (out[i] = translated[k].trim()));
      else for (const i of batch) out[i] = (await gtx(lines[i])).trim();
    } catch (err) {
      console.warn('[translate]', err.message);
      failed += batch.length;
    }
    onProgress((n + 1) / batches.length);
  }
  out.failed = failed;
  return out;
}

async function translateWords(words) {
  const out = await translateMany(words);
  const missing = words.map((w, k) => (out[k] ? -1 : k)).filter((k) => k >= 0);
  await mapLimit(missing, 3, async (k) => {
    out[k] = await myMemory(words[k]).catch(() => '');
  });
  out.failed = out.filter((x) => !x).length;
  return out;
}

/* ── 영어 풀이 (무료 사전 API, 가능한 만큼만) ── */
async function lookup(word) {
  try {
    const res = await http(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { timeout: 7000 });
    if (!res.ok) return null;
    const [entry] = res.json();
    const meaning = entry.meanings?.[0];
    return {
      word: entry.word || word,
      pos: meaning?.partOfSpeech || '',
      def: (meaning?.definitions?.[0]?.definition || '').replace(/^\([^)]*\)\s*/, ''),
    };
  } catch {
    return null;
  }
}

/** 레슨 만들기: 해석 + 단어 + 표현 */
export async function enrich({ title, sentences }, onProgress = () => {}) {
  await loadWordData();
  const ko = await translateMany([title, ...sentences.map((s) => s.en)], (p) => onProgress(p * 0.65));

  // 학습 단어: 구어 빈도 순위로 '너무 쉽지도, 너무 희귀하지도 않은' 단어를 고른다
  const cands = new Map();
  for (const s of sentences) {
    for (const raw of s.en.match(/[A-Za-z][a-z']+/g) || []) {
      if (raw[0] === raw[0].toUpperCase() && !s.en.startsWith(raw)) continue; // 고유명사 제외
      const w = raw.toLowerCase().replace(/'s$/, '');
      if (w.length < 4 || w.includes("'")) continue;
      const base = lemma(w);
      const rank = rankOf(base);
      if (rank < 1200 || rank > 40000 || COMMON_WORDS.has(base) || YT_WORDS.has(base)) continue;
      const e = cands.get(base) || { word: base, rank, n: 0, i: s.i };
      e.n++;
      cands.set(base, e);
    }
  }
  // 점수: 적당히 어려운(2천~2만위) 단어 + 이야기 속 반복 등장
  const score = (c) => Math.log(Math.min(c.rank, 20000)) + c.n * 0.6;
  const picked = [...cands.values()].sort((a, b) => score(b) - score(a)).slice(0, VOCAB_MAX);

  // 한국어 뜻은 한 번에 번역, 영어 풀이는 사전에서 가능한 만큼만 (전체 20초 제한)
  const meaningsP = translateWords(picked.map((c) => c.word));
  const dicts = new Map();
  let done = 0;
  await Promise.race([
    mapLimit(picked, 6, async (c) => {
      dicts.set(c.word, await lookup(c.word));
      onProgress(0.65 + (++done / picked.length) * 0.3);
    }),
    new Promise((r) => setTimeout(r, 20000)),
  ]);
  const meanings = await meaningsP;
  const vocab = picked
    .map((c, k) => {
      const d = dicts.get(c.word);
      return {
        word: c.word,
        pos: POS_SHORT[d?.pos] || d?.pos || '',
        ipa: ipaOf(c.word),
        ko: meanings[k] || '',
        def: d?.def || '',
        level: levelOf(c.rank),
        i: c.i,
        example: sentences[c.i].en,
      };
    })
    .sort((a, b) => a.i - b.i);

  const expressions = findExpressions(sentences).map((e) => ({ ...e, example: sentences[e.i].en }));
  onProgress(1);
  return {
    engine: 'basic',
    incomplete: ko.failed > 0 || meanings.failed > 0,
    titleKo: ko[0],
    sentences: sentences.map((s, k) => ({ ...s, ko: ko[k + 1] || '' })),
    vocab,
    expressions,
  };
}

/** 문장 속 아무 단어나 눌렀을 때: 발음기호 + 한국어 뜻 + 영어 풀이 */
const defineCache = new Map();
export async function define(word) {
  await loadWordData();
  const key = word.toLowerCase();
  if (defineCache.has(key)) return defineCache.get(key);
  const base = lemma(key);
  const [dict, ko] = await Promise.all([lookup(base), gtx(base, 1).catch(() => myMemory(base).catch(() => ''))]);
  const out = {
    word: dict?.word || base,
    ipa: ipaOf(dict?.word || base),
    pos: POS_SHORT[dict?.pos] || dict?.pos || '',
    ko,
    def: dict?.def || '',
    level: Number.isFinite(rankOf(base)) ? levelOf(rankOf(base)) : '',
  };
  if (dict || ko) defineCache.set(key, out);
  return out;
}
