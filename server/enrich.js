// 문장 목록 → 한국어 해석 + 핵심 단어 + 표현
// ANTHROPIC_API_KEY 가 있으면 Claude, 없으면 무료 번역/사전 API 기반 기본 모드.

import Anthropic from '@anthropic-ai/sdk';
import { COMMON_WORDS } from './common-words.js';
import { findExpressions } from './expressions.js';
import { rankOf, lemma, levelOf } from './wordfreq.js';
import { ipaOf } from './ipa.js';

const VOCAB_MAX = 30; // 기본 모드에서 이야기 하나당 뽑는 단어 수
// 영상 끝의 '구독·댓글' 안내 문구에서 나온 단어는 학습 단어에서 뺀다
const YT_WORDS = new Set(['subscribe', 'subscriber', 'comment', 'channel', 'notification', 'video', 'playlist', 'like', 'share']);

const CHUNK = 30; // Claude 한 번에 보낼 문장 수
const PARALLEL = 3;

export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function enrich({ title, sentences }, onProgress = () => {}) {
  if (claudeEnabled()) {
    try {
      return { engine: 'claude', ...(await enrichWithClaude(title, sentences, onProgress)) };
    } catch (err) {
      console.warn('[enrich] Claude 실패 → 기본 모드로 전환:', err.message);
    }
  }
  return { engine: 'basic', ...(await enrichBasic(title, sentences, onProgress)) };
}

/* ───────────────────────── Claude ───────────────────────── */

const LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'];
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title_ko', 'translations', 'vocab', 'expressions'],
  properties: {
    title_ko: { type: 'string' },
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'ko'],
        properties: { i: { type: 'integer' }, ko: { type: 'string' } },
      },
    },
    vocab: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['word', 'pos', 'ipa', 'ko', 'def', 'level', 'i'],
        properties: {
          word: { type: 'string', description: '사전형(lemma)' },
          pos: { type: 'string', description: 'n. / v. / adj. / adv. / phr.v. 등' },
          ipa: { type: 'string', description: '미국식 IPA, 슬래시 포함' },
          ko: { type: 'string', description: '이 문맥에서의 한국어 뜻' },
          def: { type: 'string', description: '쉬운 영어 풀이 (한 줄)' },
          level: { type: 'string', enum: LEVELS },
          i: { type: 'integer', description: '이 단어가 등장한 문장 번호' },
        },
      },
    },
    expressions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'ko', 'note', 'i'],
        properties: {
          phrase: { type: 'string' },
          ko: { type: 'string' },
          note: { type: 'string', description: '쓰임새·뉘앙스 설명 (한국어, 1~2문장)' },
          i: { type: 'integer' },
        },
      },
    },
  },
};

const SYSTEM = `You are an English teacher preparing study material for Korean adult learners (intermediate level) from a YouTube story transcript.
For the numbered sentences you receive:
- translations: one natural, fluent Korean translation per sentence number (keep the story's tone; do not skip any number).
- vocab: 5–8 words worth studying (B1+ level, skip very basic words and proper nouns). Use the dictionary form, the meaning that fits this context, and the number of the sentence it appears in.
- expressions: 2–4 idioms, phrasal verbs, or useful collocations that appear verbatim in these sentences.
- title_ko: a natural Korean translation of the video title.
The transcript may come from auto-captions; silently fix obvious recognition errors in your understanding but translate what the sentence means.`;

async function enrichWithClaude(title, sentences, onProgress) {
  const client = new Anthropic();
  const chunks = [];
  for (let k = 0; k < sentences.length; k += CHUNK) chunks.push(sentences.slice(k, k + CHUNK));
  let done = 0;

  const runChunk = async (chunk) => {
    const body = chunk.map((s) => `[${s.i}] ${s.en}`).join('\n');
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Video title: ${title}\n\nSentences:\n${body}` }],
    });
    if (response.stop_reason === 'refusal') throw new Error('요청이 거절되었습니다');
    if (response.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 잘렸습니다');
    const text = response.content.find((b) => b.type === 'text')?.text;
    const parsed = JSON.parse(text);
    onProgress(++done / chunks.length);
    return parsed;
  };

  const results = await mapLimit(chunks, PARALLEL, runChunk);

  const ko = new Map();
  const vocab = new Map();
  const expressions = new Map();
  for (const r of results) {
    for (const t of r.translations) ko.set(t.i, t.ko);
    for (const v of r.vocab) {
      const key = v.word.toLowerCase();
      if (!vocab.has(key)) vocab.set(key, v);
    }
    for (const e of r.expressions) {
      const key = e.phrase.toLowerCase();
      if (!expressions.has(key)) expressions.set(key, e);
    }
  }
  return {
    titleKo: results[0]?.title_ko || '',
    sentences: sentences.map((s) => ({ ...s, ko: ko.get(s.i) || '' })),
    vocab: [...vocab.values()].map((v) => ({ ...v, example: sentences[v.i]?.en || '' })),
    expressions: [
      ...expressions.values(),
      ...findExpressions(sentences).filter((e) => !expressions.has(e.phrase.toLowerCase())),
    ]
      .slice(0, 40)
      .map((e) => ({ ...e, example: sentences[e.i]?.en || '' })),
  };
}

/* ───────────────────────── 기본 모드 ───────────────────────── */

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

async function gtxOnce(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw Object.assign(new Error(`번역 요청 실패 (${res.status})`), { status: res.status });
  const data = await res.json();
  return (data[0] || []).map((seg) => seg[0]).join('');
}

/** 두 번째 무료 번역기 (MyMemory). 짧은 단어 뜻을 채울 때만 쓴다 (IP당 하루 약 5,000자) */
async function myMemory(text) {
  const url = `https://api.mymemory.translated.net/get?langpair=en%7Cko&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const data = await res.json();
  const t = data.responseData?.translatedText || '';
  if (data.quotaFinished || /MYMEMORY WARNING|INVALID/i.test(t)) throw new Error('MyMemory 한도 초과');
  // 번역 메모리에서 문장째 가져온 엉뚱한 결과("누구도 날 멈출 수 없지.")는 버린다
  const clean = t.replace(/^[\s\-–·•]+/, '').trim();
  if (text.split(' ').length <= 3 && (clean.length > 16 || /[.!?]$/.test(clean))) return '';
  return clean;
}

/** 단어 뜻: Google(한 번에) → 실패한 것만 MyMemory로 */
async function translateWords(words) {
  const out = await translateMany(words);
  const missing = words.map((w, k) => (out[k] ? -1 : k)).filter((k) => k >= 0);
  await mapLimit(missing, 3, async (k) => {
    out[k] = await myMemory(words[k]).catch(() => '');
  });
  out.failed = out.filter((x) => !x).length;
  return out;
}

/** 여러 줄을 번역. 실패한 줄은 빈 문자열로 남기고 failed 수를 돌려준다. */
async function translateMany(lines, onProgress = () => {}) {
  // 줄바꿈으로 묶어 요청 수를 최소화 (무료 엔드포인트는 요청이 잦으면 429를 준다)
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

async function lookupOne(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const [entry] = await res.json();
    const meaning = entry.meanings?.[0];
    return {
      word: entry.word || word,
      ipa: entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '',
      pos: meaning?.partOfSpeech || '',
      def: (meaning?.definitions?.[0]?.definition || '').replace(/^\([^)]*\)\s*/, ''),
    };
  } catch {
    return null;
  }
}

/** 활용형(moved, stories, running…)이면 사전형을 찾아본다 (요청 수는 최대 3회) */
async function lookup(word) {
  const bases = [];
  if (/ies$|ied$/.test(word)) bases.push(word.slice(0, -3) + 'y');
  else if (word.endsWith('ing')) bases.push(word.slice(0, -3), word.slice(0, -3) + 'e');
  else if (word.endsWith('ed')) bases.push(word.slice(0, -2), word.slice(0, -1));
  else if (word.endsWith('es')) bases.push(word.slice(0, -2), word.slice(0, -1));
  else if (word.endsWith('s') && !word.endsWith('ss')) bases.push(word.slice(0, -1));
  for (const b of bases) {
    if (b.length < 3) continue;
    const hit = await lookupOne(b);
    if (hit) return hit;
  }
  return lookupOne(word);
}

const POS_SHORT = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.' };

async function enrichBasic(title, sentences, onProgress) {
  const ko = await translateMany([title, ...sentences.map((s) => s.en)], (p) => onProgress(p * 0.7));

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

  // 한국어 뜻은 한 번에 번역, 발음기호·영어 풀이는 사전에서 가능한 만큼만 (전체 20초 제한)
  const meaningsP = translateWords(picked.map((c) => c.word));
  const dicts = new Map();
  let done = 0;
  await Promise.race([
    mapLimit(picked, 8, async (c) => {
      dicts.set(c.word, await lookupOne(c.word));
      onProgress(0.7 + (++done / picked.length) * 0.25);
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
        ipa: ipaOf(c.word) || d?.ipa || '',
        ko: meanings[k] || '',
        def: d?.def || '',
        level: levelOf(c.rank),
        i: c.i,
        example: sentences[c.i].en,
      };
    })
    .sort((a, b) => a.i - b.i);

  const expressions = findExpressions(sentences).map((e) => ({ ...e, example: sentences[e.i].en }));

  return {
    incomplete: ko.failed > 0 || meanings.failed > 0,
    titleKo: ko[0],
    sentences: sentences.map((s, k) => ({ ...s, ko: ko[k + 1] || '' })),
    vocab,
    expressions,
  };
}

/* ───────────────────────── util ───────────────────────── */

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

/** 문장 속 아무 단어나 눌렀을 때: 사전 + 한국어 뜻 */
const defineCache = new Map();
export async function define(word) {
  const key = word.toLowerCase();
  if (defineCache.has(key)) return defineCache.get(key);
  const [dict, ko] = await Promise.all([
    lookup(key),
    gtx(key, 1).catch(() => myMemory(key).catch(() => '')),
  ]);
  const out = {
    word: dict?.word || key,
    ipa: ipaOf(dict?.word || key) || dict?.ipa || '',
    pos: POS_SHORT[dict?.pos] || dict?.pos || '',
    ko,
    def: dict?.def || '',
    level: '',
  };
  if (dict || ko) defineCache.set(key, out);
  return out;
}
