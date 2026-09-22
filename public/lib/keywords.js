// 스토리별 핵심단어: 이야기 한 편에서 '어려운' 단어 20개를 고르고, 단어마다 그 단어가 나오는 문장 하나를 붙인다.
// 고르는 순서: ① 가장 어려운 단어부터 줄 세워 후보를 넉넉히(2배) 모으고 → ② 이야기 핵심에 가까운 순으로 다시 세워 20개를 뽑는다.
// 서버·인터넷 없이 앱 안 데이터(구어 빈도·발음기호)로만 계산한다 (순수 계산 → 테스트 가능).
import { COMMON_WORDS } from './common-words.js';
import { isLoanword } from './loanwords.js';
import { lemma, rankOf, ipaOf, levelOf } from './words.js';

/** 이야기 한 편에서 뽑는 핵심단어(= 붙는 문장) 개수 */
export const KEYWORD_COUNT = 20;

// 핵심단어로 보지 않는 말: 영상 끝 '구독·댓글' 안내, 구어 추임새·속어
const SKIP = new Set(
  `subscribe subscriber comment channel notification video playlist episode share
   gonna wanna gotta kinda sorta dunno lemme gimme yeah yep nope okay hmm huh ugh whoa wow hey`.split(/\s+/),
);
const MIN_RANK = 2500; // 이보다 흔한 단어는 '어렵지 않다'고 본다
const MAX_RANK = 45000; // 빈도 목록에 없는 말(오타·이름)은 뺀다
const HARD_CAP = 20000; // 이보다 드문 단어는 더 어렵다고 쳐 주지 않는다 (희귀한 찌꺼기가 위로 오지 않게)

/**
 * 문장 → 사전형 단어 목록. 문장 중간의 대문자 단어는 이름·지명으로 보고 뺀다.
 * 문장 첫 단어는 대문자라 이름인지 알 수 없어 head 로 표시해 두고,
 * 다른 문장에서 소문자로도 나왔는지 보고 판단한다 (Sarah·Boston 처럼 늘 대문자인 말은 이름).
 */
export function tokensOf(en) {
  const out = [];
  const raw = String(en || '').match(/[A-Za-z][A-Za-z']*/g) || [];
  raw.forEach((w, k) => {
    const upper = w.length > 1 && w[0] === w[0].toUpperCase();
    if (k > 0 && upper) return;
    const bare = w.toLowerCase().replace(/'s$/, '');
    if (bare.includes("'")) return; // wasn't · you've 같은 축약형은 단어가 아니다
    const base = lemma(bare);
    if (base.length >= 3) out.push({ word: base, head: k === 0 && upper });
  });
  return out;
}

/** 문장 속 학습 대상 단어 (사전형) */
export const wordsOf = (en) => tokensOf(en).map((t) => t.word);

const POOL = 2; // ① 단계에서 모으는 후보 = 뽑을 개수 × POOL

/**
 * 파생어는 뿌리 단어만큼만 어렵다고 본다 (lovingly ← love, darkness ← dark, hopeless ← hope).
 * 드문 꼴이라도 아는 단어에 꼬리만 붙은 말은 공부할 거리가 적다.
 */
export function familiarRank(word) {
  const rank = rankOf(word);
  const roots = [];
  const m = word.match(/^(.{3,}?)(ily|ly|ness|less|ful|fully)$/);
  if (m) roots.push(m[2] === 'ily' ? m[1] + 'y' : m[1], m[1] + 'e');
  let best = rank;
  for (const r of roots) best = Math.min(best, rankOf(lemma(r)) * 4, rankOf(r) * 4);
  return best;
}

// ① 어려운 정도: 드물수록 높게 (아주 드문 말은 HARD_CAP 에서 같게 보고 반복 등장으로 가른다)
const hardOf = (c) => Math.log(Math.min(c.rank, HARD_CAP)) + Math.min(c.count, 5) * 0.05;
// ② 이야기 핵심도: 이야기 단어장에 뽑힌 핵심어 · 제목에 나온 말 · 여러 문장에 반복 · 이야기 곳곳에 퍼져 나옴
const coreOf = (c, total) =>
  (c.core ? 3 : 0) + (c.title ? 3 : 0) + Math.log2(1 + c.count) * 1.5 + (total > 1 ? ((c.at.at(-1) - c.at[0]) / total) * 1.5 : 0);

/** 예문으로 쓸 문장 고르기: 해석이 있는 것 → 아직 쓰지 않은 것 → 짧은 것 */
function pickExample(cands, sentences, used) {
  return [...cands].sort((a, b) => {
    const A = sentences[a];
    const B = sentences[b];
    return (
      Boolean(B.ko) - Boolean(A.ko) ||
      Number(used.has(a)) - Number(used.has(b)) ||
      A.en.length - B.en.length
    );
  })[0];
}

/**
 * 이야기 한 편 → 어려운 단어 20개 + 단어마다 예문 하나.
 * 뜻·품사·영어 풀이는 이야기의 단어장(lesson.vocab)이나 넘겨받은 meanings 에서 가져오고,
 * 없으면 빈 채로 둔다 (앱이 열 때 받아서 채운다).
 * @param {{videoId?:string,title?:string,sentences:Array<{i:number,en:string,ko?:string}>,vocab?:Array<object>}} lesson
 * @param {{ maxWords?: number, meanings?: Record<string, object> }} opts
 * @returns {Array<{word:string,ipa:string,pos:string,def:string,level:string,ko:string,count:number,rank:number,si:number,en:string,enKo:string}>}
 */
export function pickKeywords(lesson, opts = {}) {
  const max = opts.maxWords ?? KEYWORD_COUNT;
  const sentences = (lesson?.sentences || []).filter((s) => s?.en);
  if (!sentences.length) return [];

  // 이미 알고 있는 뜻 (이야기 단어장 → 넘겨받은 뜻 순). 이야기 단어장에 뽑힌 단어는 '핵심어'로 가점
  const known = new Map();
  const core = new Set();
  for (const v of lesson.vocab || []) {
    if (!v?.word) continue;
    core.add(v.word);
    if (v.ko) known.set(v.word, v);
  }
  for (const [w, v] of Object.entries(opts.meanings || {})) if (v?.ko && !known.has(w)) known.set(w, v);

  const titleWords = new Set(wordsOf(String(lesson.title || '').toLowerCase()));

  // ① 단어 세기 (문장 첫 단어가 이름인지 가리려고 소문자로도 쓰인 단어를 모아 둔다)
  const toks = sentences.map((s) => tokensOf(s.en));
  const lower = new Set();
  for (const list of toks) for (const t of list) if (!t.head) lower.add(t.word);

  const counts = new Map();
  toks.forEach((list, k) => {
    for (const t of new Set(list.filter((t) => !t.head || lower.has(t.word)).map((t) => t.word))) {
      if (SKIP.has(t) || t.length < 4 || COMMON_WORDS.has(t)) continue;
      if (rankOf(t) > MAX_RANK) continue;
      const rank = familiarRank(t);
      if (rank < MIN_RANK) continue;
      // 발음 사전(CMU)에 있는 진짜 단어만 — 자막 찌꺼기(wasnt · youve)나 오타는 여기서 걸러진다
      const ipa = ipaOf(t);
      if (!ipa) continue;
      // 한국어에 외래어로 굳은 말(이메일·이젤·스누즈)은 이미 아는 말이라 뺀다
      if (isLoanword(t, ipa, known.get(t)?.ko)) continue;
      const c = counts.get(t) || { word: t, count: 0, rank, core: core.has(t), title: titleWords.has(t), at: [] };
      c.count++;
      c.at.push(k);
      counts.set(t, c);
    }
  });

  // ② 가장 어려운 순으로 후보를 넉넉히 모으고 → ③ 이야기 핵심에 가까운 순으로 다시 세워 max 개를 뽑는다
  const pool = [...counts.values()].sort((a, b) => hardOf(b) - hardOf(a)).slice(0, max * POOL);
  const hardness = new Map(pool.map((c, k) => [c, k]));
  const picked = pool
    .sort((a, b) => coreOf(b, toks.length) - coreOf(a, toks.length) || hardness.get(a) - hardness.get(b))
    .slice(0, max);

  // ④ 단어마다 예문을 하나씩 붙인다 (가능하면 서로 다른 문장으로)
  const used = new Set();
  return picked.map((c) => {
    const k = pickExample(c.at, sentences, used);
    used.add(k);
    const s = sentences[k];
    const seen = known.get(c.word);
    return {
      word: c.word,
      ipa: ipaOf(c.word) || seen?.ipa || '',
      pos: seen?.pos || '',
      def: seen?.def || '',
      level: Number.isFinite(c.rank) ? levelOf(c.rank) : seen?.level || '',
      ko: seen?.ko || '',
      count: c.count,
      rank: c.rank,
      si: s.i,
      en: s.en,
      enKo: s.ko || '',
    };
  });
}
