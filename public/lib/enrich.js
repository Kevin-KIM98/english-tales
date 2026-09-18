// 문장 목록 → 한국어 해석 + 학습 단어 + 표현 (휴대폰 안에서 실행)
// 해석: Google 번역(무료 공개 엔드포인트) → 단어 뜻은 실패 시 MyMemory로 보충
// 단어·발음기호·난이도·표현: 앱에 들어 있는 오프라인 데이터

import { http } from './net.js';
import { llmTranslate, engineReady, engineModel } from './llm.js';
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

/* ── 번역 ──
   무료 공개 번역 엔드포인트는 요청이 몰리면 잠시 거부(429)한다. 한 번 거부당했다고
   해석이 통째로 비지 않도록 네 겹으로 막는다.
   ① 서비스별로 요청 줄을 세워 보낸다 — 잘 될 때는 여러 개를 나란히, 거부당한 뒤에는 하나씩 천천히
   ② 거부당하면 잠깐 쉬었다가 다시 보낸다
   ③ 묶음이 실패하면 반으로 쪼개 되살린다
   ④ 그래도 빈 줄만 두 번째 번역기(MyMemory)로 채운다 */
const pace = {
  lanes: 3, // 잘 될 때 동시에 보내는 요청 수
  gap: 120, // 잘 될 때 요청 사이 간격
  slowGap: 500, // 거부당한 뒤 요청 사이 간격 (이때는 한 번에 하나씩)
  retry: 600, // 실패 후 다시 보내기까지 (시도할수록 길어진다)
  cooldowns: [4000, 12000, 25000], // 거부를 연달아 맞을 때 쉬는 시간
  maxWait: 30000, // 한 번에 기다려 주는 최대 시간 (이보다 길면 기다리지 않고 넘어간다)
  budget: 30000, // 한 번 받아 오는 동안 거부를 기다려 주는 시간 (넘으면 기다리지 않고 두 번째 번역기로)
};
/** 테스트에서 기다리는 시간을 줄일 때만 쓴다 */
export function setPacing(patch) {
  Object.assign(pace, patch);
}
const BATCH_CHARS = 1800; // 한 요청에 담는 글자 수 (주소가 너무 길면 거부당한다)
const BATCH_LINES = 40; // 한 요청에 담는 줄 수 (실패해도 잃는 양을 줄인다)
const SPLIT_DEPTH = 4; // 실패한 묶음을 반으로 쪼개 보는 횟수
const MYMEMORY_MAX = 80; // 두 번째 번역기는 하루 한도가 작아 조금만 쓴다

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gate = { restUntil: 0, strikes: 0 };
/** 거부당한 적 없이 잘 돌아가는 중인가 */
const healthy = () => gate.strikes === 0 && gate.restUntil <= Date.now();

/**
 * 한 서비스로 가는 요청 줄. 동시 요청 수와 간격을 상황에 따라 정한다.
 * (잘 될 때는 나란히 보내 빠르게, 거부당한 뒤에는 하나씩 천천히)
 */
function makeLane(limit, gapOf) {
  const st = { active: 0, last: 0, waiting: [], timer: 0 };
  const pump = () => {
    while (st.waiting.length && st.active < limit()) {
      const wait = st.last + gapOf() - Date.now();
      if (wait > 0) {
        if (!st.timer) st.timer = setTimeout(() => ((st.timer = 0), pump()), wait);
        return;
      }
      const job = st.waiting.shift();
      st.active++;
      st.last = Date.now();
      Promise.resolve()
        .then(job.run)
        .then(job.ok, job.fail)
        .finally(() => {
          st.active--;
          pump();
        });
    }
  };
  return (run) =>
    new Promise((ok, fail) => {
      st.waiting.push({ run, ok, fail });
      pump();
    });
}

// 번역기마다 따로 줄을 세운다 (한쪽이 느려도 다른 쪽은 기다리지 않는다)
const gtxLane = makeLane(
  () => (healthy() ? pace.lanes : 1),
  () => (healthy() ? pace.gap : pace.slowGap),
);
const mmLane = makeLane(
  () => pace.lanes,
  () => pace.gap,
);

/** 거부(429·503)당하면 점점 더 오래 쉰다 — 다른 번역 요청도 함께 기다린다 */
function rest(status) {
  if (status !== 429 && status !== 503) return;
  gate.restUntil = Date.now() + pace.cooldowns[Math.min(gate.strikes, pace.cooldowns.length - 1)];
  gate.strikes++;
}

async function gtxOnce(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=' + encodeURIComponent(text);
  const res = await gtxLane(() => http(url, { timeout: 12000 }));
  if (!res.ok) {
    rest(res.status);
    throw Object.assign(new Error(`번역 요청 실패 (${res.status})`), { status: res.status });
  }
  let segs;
  try {
    segs = res.json()[0];
  } catch {
    segs = null;
  }
  if (!Array.isArray(segs)) throw new Error('번역 응답을 읽지 못했습니다');
  gate.strikes = 0;
  return segs;
}

/**
 * 번역 조각 [번역, 원문] 목록을 받는다. 거부당하면 쉬었다 다시.
 * @param {{ waitUntil: number }} run 이번에 받아 오는 동안 기다려 줄 시각 (넘으면 기다리지 않는다)
 */
async function gtx(text, run, tries = 3) {
  for (let n = 1; ; n++) {
    // 쉬는 시간이 넉넉히 지났으면 처음부터 다시 — 한 번 거부당했다고 계속 안 보내면 안 된다
    if (gate.restUntil && Date.now() > gate.restUntil + pace.cooldowns[0]) {
      gate.restUntil = 0;
      gate.strikes = 0;
    }
    const wait = gate.restUntil - Date.now();
    if (wait > 0) {
      // 거부가 오래 이어지면 마냥 기다리지 않는다 — 곧장 두 번째 번역기로 넘어가는 편이 낫다
      if (wait > pace.maxWait || Date.now() > run.waitUntil) throw new Error('번역 서비스가 바빠요');
      await sleep(wait);
    }
    try {
      return await gtxOnce(text);
    } catch (err) {
      if (n >= tries) throw err;
      if (gate.restUntil <= Date.now()) await sleep(pace.retry * n);
    }
  }
}

/**
 * 번역 결과를 원래 줄에 맞춰 나눈다.
 * 응답 조각에는 원문이 함께 들어 있어, 줄바꿈 개수로 어느 줄인지 정확히 찾을 수 있다.
 * (줄 수가 맞지 않으면 엉뚱한 줄에 붙이지 않고 null 을 돌려준다)
 * @returns {string[] | null} 줄별 번역 (확신 없는 줄은 빈 문자열)
 */
export function alignSegments(segs, lines) {
  if (!Array.isArray(segs)) return null;
  const out = new Array(lines.length).fill('');
  const unsure = new Set();
  let li = 0;
  for (const seg of segs) {
    if (!seg) continue;
    const orig = String(seg[1] ?? '');
    const trans = String(seg[0] ?? '');
    const oParts = orig.split('\n');
    const tParts = trans.split('\n');
    const fits = oParts.length === tParts.length;
    for (let k = 0; k < oParts.length; k++) {
      if (li >= lines.length) return loose(segs, lines); // 줄이 넘친다 = 조각으로는 못 맞춘다
      if (fits) out[li] += tParts[k];
      else unsure.add(li); // 한 조각이 여러 줄에 걸쳐 나뉘지 않았다 → 그 줄들은 버린다
      if (k < oParts.length - 1) li++;
    }
  }
  if (li !== lines.length - 1) return loose(segs, lines); // 조각으로 못 맞추면 줄바꿈만 보고 나눠 본다
  return out.map((t, i) => (unsure.has(i) ? '' : t.trim()));
}

/** 번역을 통째로 이어 붙여 줄바꿈으로만 나눠 본다 (줄 수가 맞을 때만 쓴다) */
function loose(segs, lines) {
  const parts = segs
    .map((seg) => String(seg?.[0] ?? ''))
    .join('')
    .split('\n');
  return parts.length === lines.length ? parts.map((t) => t.trim()) : null;
}

/** 두 번째 무료 번역기 (MyMemory). Google 이 거부한 줄만 채운다 */
async function myMemory(text, { word = false } = {}) {
  const url = `https://api.mymemory.translated.net/get?langpair=en%7Cko&q=${encodeURIComponent(text.slice(0, 480))}`;
  const res = await mmLane(() => http(url, { timeout: 8000 }));
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const data = res.json();
  const t = data.responseData?.translatedText || '';
  if (data.quotaFinished || /MYMEMORY WARNING|INVALID/i.test(t)) throw new Error('MyMemory 한도 초과');
  // 번역 메모리에서 문장째 가져온 엉뚱한 결과는 버린다
  const clean = t.replace(/^[\s\-–·•]+/, '').trim();
  if (!/[가-힣]/.test(clean)) return ''; // 한국어가 아닌 결과("Multipart" 등)는 버린다
  if (word && text.split(' ').length <= 3 && (clean.length > 16 || /[.!?]$/.test(clean))) return '';
  return clean;
}

/** 묶음 번역 → 실패한 줄은 반으로 쪼개 다시 (out 에 채워 넣는다) */
async function translateBatch(lines, batch, out, run, depth = 0) {
  if (!batch.length) return;
  let aligned = null;
  try {
    const texts = batch.map((i) => lines[i]);
    aligned = alignSegments(await gtx(texts.join('\n'), run), texts);
  } catch (err) {
    console.warn('[translate]', err.message);
  }
  if (aligned) batch.forEach((i, k) => aligned[k] && (out[i] = aligned[k]));
  const left = batch.filter((i) => !out[i]);
  if (!left.length || depth >= SPLIT_DEPTH) return;
  if (batch.length === 1) return; // 한 줄만 물었는데도 비었다 = 다시 물어도 같다
  if (left.length === 1) {
    await translateBatch(lines, left, out, run, depth + 1);
    return;
  }
  const mid = Math.ceil(left.length / 2);
  await translateBatch(lines, left.slice(0, mid), out, run, depth + 1);
  await translateBatch(lines, left.slice(mid), out, run, depth + 1);
}

/** 번역할 줄을 글자 수·줄 수 기준으로 묶는다 */
function makeBatches(lines, idxs) {
  const batches = [];
  let cur = [];
  let len = 0;
  for (const i of idxs) {
    if (cur.length && (len + lines[i].length > BATCH_CHARS || cur.length >= BATCH_LINES)) {
      batches.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(i);
    len += lines[i].length + 1;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * 여러 줄을 번역한다. 실패한 줄은 빈 문자열로 두고 개수를 failed 에 담는다.
 * @param {string[]} lines
 * @param {(p:number)=>void} onProgress
 * @param {{ word?: boolean }} opts 단어 뜻을 받을 때는 word: true
 */
export async function translateMany(lines, onProgress = () => {}, opts = {}) {
  const src = lines.map((l) => String(l ?? '').replace(/\s*\n\s*/g, ' ').trim());
  const out = new Array(src.length).fill('');
  const todo = src.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);

  // ① 해석 엔진(LLM)이 켜져 있으면 문맥까지 보고 먼저 번역한다
  let byLlm = 0;
  if (engineReady()) {
    const ko = await llmTranslate(
      todo.map((i) => src[i]),
      opts,
      (p) => onProgress(p * 0.9),
    );
    todo.forEach((i, k) => {
      if (!ko[k]) return;
      out[i] = ko[k];
      byLlm++;
    });
  }

  // ② LLM 이 없거나 받아 내지 못한 줄만 무료 번역기로
  const batches = makeBatches(
    src,
    todo.filter((i) => !out[i]),
  );

  // 묶음을 나란히 보낸다 (실제 동시 요청 수·간격은 요청 줄이 형편에 맞게 조절한다)
  const run = { waitUntil: Date.now() + pace.budget }; // 이번 한 번에 거부를 기다려 줄 한도
  let done = 0;
  await mapLimit(batches, pace.lanes + 1, async (batch) => {
    await translateBatch(src, batch, out, run);
    onProgress(++done / (batches.length + 1));
  });

  // 그래도 빈 줄은 두 번째 번역기로 채운다 (하루 한도가 작아 일부만)
  const missing = todo.filter((i) => !out[i]);
  if (missing.length) {
    await mapLimit(missing.slice(0, MYMEMORY_MAX), pace.lanes + 1, async (i) => {
      out[i] = await myMemory(src[i], opts).catch(() => '');
    });
  }
  onProgress(1);
  out.failed = todo.filter((i) => !out[i]).length;
  out.llm = byLlm; // 해석 엔진이 해낸 줄 수 (나머지는 무료 번역기)
  return out;
}

async function translateWords(words, title = '') {
  return translateMany(words, () => {}, { word: true, title });
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
  const ko = await translateMany([title, ...sentences.map((s) => s.en)], (p) => onProgress(p * 0.65), { title });

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
  const meaningsP = translateWords(picked.map((c) => c.word), title);
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
  const lesson = {
    // 해석 엔진이 절반 넘게 해냈을 때만 그 이름을 남긴다 (한도 초과로 무료 번역기가 대신했으면 'basic')
    engine: engineReady() && ko.llm > ko.length / 2 ? engineModel() : 'basic',
    titleKo: ko[0] || '',
    sentences: sentences.map((s, k) => ({ ...s, ko: ko[k + 1] || '' })),
    vocab,
    expressions,
  };
  lesson.incomplete = missingCount(lesson).total > 0;
  return lesson;
}

/** 해석이 비어 있는 곳이 몇 군데인지 (제목·문장·단어 뜻) */
export function missingCount(lesson) {
  const sentences = lesson.sentences?.filter((s) => !s.ko).length || 0;
  const vocab = lesson.vocab?.filter((v) => !v.ko).length || 0;
  const title = lesson.titleKo ? 0 : 1;
  return { title, sentences, vocab, total: title + sentences + vocab };
}

/**
 * 비어 있는 해석만 다시 받아 채운다 (이미 받아 둔 해석·단어·표현은 그대로 둔다).
 * @returns {Promise<{ lesson: object, filled: number, left: number }>}
 */
export async function fillMissing(lesson, onProgress = () => {}) {
  const before = missingCount(lesson);
  if (!before.total) return { lesson, filled: 0, left: 0 };

  // 제목 + 빈 문장을 한 번에, 빈 단어 뜻은 그다음에 (단어는 다른 규칙으로 걸러 낸다)
  const holes = [];
  if (!lesson.titleKo) holes.push({ text: lesson.title, put: (ko) => (lesson.titleKo = ko) });
  for (const s of lesson.sentences || []) if (!s.ko) holes.push({ text: s.en, put: (ko) => (s.ko = ko) });
  const words = (lesson.vocab || []).filter((v) => !v.ko);

  const share = holes.length && words.length ? 0.8 : 1;
  if (holes.length) {
    const ko = await translateMany(
      holes.map((h) => h.text),
      (p) => onProgress(p * share),
      { title: lesson.title },
    );
    holes.forEach((h, k) => ko[k] && h.put(ko[k]));
  }
  if (words.length) {
    const ko = await translateWords(
      words.map((v) => v.word),
      lesson.title,
    );
    words.forEach((v, k) => ko[k] && (v.ko = ko[k]));
  }

  const after = missingCount(lesson);
  lesson.incomplete = after.total > 0;
  onProgress(1);
  return { lesson, filled: before.total - after.total, left: after.total };
}

/**
 * 이미 만든 이야기를 해석 엔진(LLM)으로 다시 해석한다 (문장 + 단어 뜻).
 * 받아 내지 못한 줄은 지금 해석을 그대로 둔다 — 다시 해석했다고 빈칸이 생기지 않는다.
 * @returns {Promise<{ lesson: object, changed: number }>}
 */
export async function retranslate(lesson, onProgress = () => {}) {
  if (!engineReady()) throw new Error('해석 엔진이 꺼져 있어요');
  const title = lesson.title || '';
  const ko = await llmTranslate([title, ...lesson.sentences.map((s) => s.en)], { title }, (p) => onProgress(p * 0.85));
  if (ko[0]) lesson.titleKo = ko[0];
  lesson.sentences.forEach((s, k) => ko[k + 1] && (s.ko = ko[k + 1]));

  const words = lesson.vocab || [];
  if (words.length) {
    const wordKo = await llmTranslate(
      words.map((v) => v.word),
      { title, word: true },
      (p) => onProgress(0.85 + p * 0.15),
    );
    words.forEach((v, k) => wordKo[k] && (v.ko = wordKo[k]));
  }

  lesson.engine = engineModel();
  lesson.incomplete = missingCount(lesson).total > 0;
  onProgress(1);
  return { lesson, changed: ko.filter(Boolean).length };
}

/** 문장 속 아무 단어나 눌렀을 때: 발음기호 + 한국어 뜻 + 영어 풀이 */
const defineCache = new Map();
export async function define(word) {
  await loadWordData();
  const key = word.toLowerCase();
  if (defineCache.has(key)) return defineCache.get(key);
  const base = lemma(key);
  const [dict, ko] = await Promise.all([
    lookup(base),
    translateMany([base], () => {}, { word: true }).then((r) => r[0] || ''),
  ]);
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
