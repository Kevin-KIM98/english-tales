// 주제별 핵심단어: 저장해 둔 이야기들을 훑어 주제를 나누고, 주제마다 핵심단어와 그 단어가 나오는 문장을 모은다.
// 서버·인터넷 없이 앱 안 데이터(빈도·발음기호)와 주제 씨앗 단어만으로 계산한다 (순수 계산 → 테스트 가능).
import { COMMON_WORDS } from './common-words.js';
import { lemma, rankOf, ipaOf, levelOf } from './words.js';

/** 주제마다 뽑는 핵심단어 개수 */
export const TOPIC_WORDS = 20;

/** 주제 씨앗 단어: 이 단어가 들어 있는 문장을 그 주제로 본다 (사전형·소문자) */
export const TOPICS = [
  {
    id: 'family',
    name: '가족·관계',
    emoji: '👨‍👩‍👧',
    seeds: `family mother father mom dad parent son daughter child kid sister brother sibling wife husband
      spouse marriage married wedding divorce engagement fiance boyfriend girlfriend grandmother grandfather
      grandma grandpa aunt uncle cousin nephew niece stepmother stepfather relative baby pregnant birth
      adopt adoption household twin`,
  },
  {
    id: 'emotion',
    name: '감정·마음',
    emoji: '💭',
    seeds: `angry anger upset hurt guilt guilty shame ashamed proud pride jealous jealousy anxious anxiety
      nervous relieved relief furious rage resentment grateful gratitude betray betrayal embarrassed
      frustrated frustration worried sorry apology apologize forgive forgiveness regret grief lonely
      loneliness sadness fear afraid scared shocked sympathy empathy trust hate affection tears cry laugh`,
  },
  {
    id: 'money',
    name: '돈·재산',
    emoji: '💰',
    seeds: `money payment paid debt loan rent mortgage salary wage bill cost afford expensive cheap bank
      account savings budget invest investment inheritance inherit insurance refund deposit credit cash
      income tax expense owe borrow lend rich wealthy broke fortune price purchase profit finance financial
      dollar cent wallet`,
  },
  {
    id: 'work',
    name: '일·직장',
    emoji: '💼',
    seeds: `job boss manager office career hire hired fired quit interview resume promotion shift colleague
      coworker client customer meeting deadline contract employee employer company business staff team
      project overtime retire retirement intern workplace assignment department salary`,
  },
  {
    id: 'home',
    name: '집·이웃',
    emoji: '🏠',
    seeds: `house home apartment kitchen bedroom bathroom garage yard garden driveway furniture couch
      neighbor neighborhood lease landlord tenant basement attic porch fence roof laundry dish chore
      repair renovation property owner mailbox closet hallway backyard`,
  },
  {
    id: 'law',
    name: '법·갈등',
    emoji: '⚖️',
    seeds: `lawyer attorney court judge police sue lawsuit legal illegal evidence crime criminal arrest
      custody trial witness fraud threat threaten stolen theft blame accuse accusation argue argument fight
      confront revenge justice innocent violation punishment jail prison settlement proof lying truth`,
  },
  {
    id: 'school',
    name: '학교·배움',
    emoji: '🎓',
    seeds: `school college university student teacher class classroom exam test grade degree tuition
      homework graduate graduation scholarship semester professor campus course library education knowledge
      textbook major dorm principal diploma essay`,
  },
  {
    id: 'health',
    name: '건강·병원',
    emoji: '🏥',
    seeds: `hospital doctor nurse sick illness pain painful surgery medicine medical injury injured therapy
      therapist diagnosis cancer treatment health healthy blood exhausted recovery recover symptom patient
      emergency ambulance disease clinic appointment prescription stress weight exercise death funeral`,
  },
  {
    id: 'travel',
    name: '여행·이동',
    emoji: '✈️',
    seeds: `airport flight plane airline ticket trip hotel truck train bus road travel luggage suitcase
      vacation station traffic highway passenger passport mile journey destination cruise taxi parking
      route arrival depart driving`,
  },
  {
    id: 'food',
    name: '음식·식사',
    emoji: '🍽️',
    seeds: `dinner restaurant meal cook cooking breakfast lunch menu recipe grocery bake cake bread wine
      beer hungry taste delicious chef snack sandwich pizza fruit vegetable milk sugar salt coffee
      dessert plate`,
  },
];

// 영상 끝 '구독·댓글' 안내에서 나오는 단어는 핵심단어로 보지 않는다
const SKIP = new Set(['subscribe', 'subscriber', 'comment', 'channel', 'notification', 'video', 'playlist', 'episode', 'story', 'share']);

let seedIndex = null; // 사전형 단어 → 주제 id 목록
function seeds() {
  // lemma() 는 앱 데이터(빈도표)가 있어야 제대로 도니, 처음 쓸 때 만든다
  if (seedIndex) return seedIndex;
  seedIndex = new Map();
  for (const t of TOPICS)
    for (const raw of t.seeds.split(/\s+/).filter(Boolean)) {
      for (const w of new Set([raw, lemma(raw)])) {
        const list = seedIndex.get(w) || [];
        if (!list.includes(t.id)) list.push(t.id);
        seedIndex.set(w, list);
      }
    }
  return seedIndex;
}
/** 테스트·데이터 교체 시 씨앗 색인을 다시 만들게 한다 */
export function resetTopicIndex() {
  seedIndex = null;
}

/**
 * 문장 → 사전형 단어 목록. 문장 중간의 대문자 단어는 이름·지명으로 보고 뺀다.
 * 문장 첫 단어는 대문자라 이름인지 알 수 없어 head 로 표시해 두고, 나중에 다른 문장에서
 * 소문자로도 나왔는지 보고 판단한다 (Sarah·Boston 처럼 늘 대문자인 말은 이름).
 */
export function tokensOf(en) {
  const out = [];
  const raw = String(en || '').match(/[A-Za-z][A-Za-z']*/g) || [];
  raw.forEach((w, k) => {
    const upper = w.length > 1 && w[0] === w[0].toUpperCase();
    if (k > 0 && upper) return;
    const base = lemma(w.toLowerCase().replace(/'s$/, '').replace(/'/g, ''));
    if (base.length >= 3) out.push({ word: base, head: k === 0 && upper });
  });
  return out;
}

/** 문장 속 학습 대상 단어 (사전형) */
export const wordsOf = (en) => tokensOf(en).map((t) => t.word);

/** 핵심단어 후보인가 (씨앗 단어는 쉬워도 주제를 대표하므로 통과) */
function isCandidate(word, seed) {
  if (SKIP.has(word) || word.length < 3) return false;
  if (seed) return true;
  if (COMMON_WORDS.has(word)) return false;
  const r = rankOf(word);
  return r >= 900 && r <= 40000;
}

// 점수: 주제를 대표하는 씨앗 + 이야기 속 반복 등장 + 적당한 난이도
const scoreOf = (c) => (c.seed ? 4 : 0) + Math.min(c.count, 8) * 1.1 + Math.log(Math.min(Math.max(rankOf(c.word), 100), 20000)) / 2;

/**
 * 저장된 이야기들 → 주제별 핵심단어 + 관련 문장.
 * @param {Array<{videoId?:string,title?:string,sentences:Array<{i:number,en:string,ko?:string}>,vocab?:Array<object>}>} lessons
 * @param {{ maxWords?: number, maxSentences?: number, meanings?: Record<string, object> }} opts
 *   meanings: 이미 알고 있는 뜻 (이야기 단어장·저장해 둔 뜻) — 없으면 뜻이 빈 채로 나온다
 * @returns {Array<{id:string,name:string,emoji:string,words:object[],sentences:object[],sentenceTotal:number}>}
 */
export function analyzeTopics(lessons, opts = {}) {
  const maxWords = opts.maxWords ?? TOPIC_WORDS;
  const maxSentences = opts.maxSentences ?? 60;
  const seedMap = seeds();

  // 이미 받아 둔 뜻 모으기 (이야기 단어장 → 넘겨받은 뜻 순으로)
  const known = new Map();
  for (const lesson of lessons || [])
    for (const v of lesson.vocab || []) if (v.ko && !known.has(v.word)) known.set(v.word, v);
  for (const [w, v] of Object.entries(opts.meanings || {})) if (v?.ko && !known.has(w)) known.set(w, v);

  // ① 문장마다 단어를 뽑고, 소문자로도 쓰이는 단어를 모아 둔다 (문장 첫 단어가 이름인지 가릴 때 쓴다)
  const lines = [];
  const lower = new Set();
  (lessons || []).forEach((lesson, li) => {
    for (const s of lesson.sentences || []) {
      if (!s?.en) continue;
      const toks = tokensOf(s.en);
      for (const t of toks) if (!t.head) lower.add(t.word);
      lines.push({ li, s, lesson, toks });
    }
  });

  // ② 문장마다 씨앗 단어를 세어 주제를 정한다 (가장 많이 걸린 주제, 동점이면 여럿)
  const byTopic = new Map(TOPICS.map((t) => [t.id, []]));
  {
    for (const { li, s, lesson, toks } of lines) {
      // 늘 대문자로만 나오는 첫 단어는 이름·지명으로 보고 뺀다
      const tokens = toks.filter((t) => !t.head || lower.has(t.word) || seedMap.has(t.word)).map((t) => t.word);
      const hits = new Map();
      for (const w of new Set(tokens)) for (const id of seedMap.get(w) || []) hits.set(id, (hits.get(id) || 0) + 1);
      if (!hits.size) continue;
      const best = Math.max(...hits.values());
      const item = { li, en: s.en, ko: s.ko || '', videoId: lesson.videoId, title: lesson.title || '', tokens, si: s.i };
      for (const [id, n] of hits) if (n === best) byTopic.get(id).push(item);
    }
  }

  // ③ 주제마다 단어를 세어 핵심단어를 고르고, 그 단어가 나오는 문장을 모은다
  const out = [];
  for (const t of TOPICS) {
    const items = byTopic.get(t.id);
    if (!items.length) continue;
    const counts = new Map();
    items.forEach((item, k) => {
      for (const w of new Set(item.tokens)) {
        const seed = (seedMap.get(w) || []).includes(t.id);
        if (!isCandidate(w, seed)) continue;
        const c = counts.get(w) || { word: w, count: 0, seed, at: [] };
        c.count++;
        if (c.at.length < 8) c.at.push(k);
        counts.set(w, c);
      }
    });
    const picked = [...counts.values()].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, maxWords);
    if (!picked.length) continue;

    // 문장 고르기: 핵심단어마다 예문을 하나씩 먼저 확보하고, 남는 자리는 나온 순서대로 채운다
    const chosen = new Set();
    for (const c of picked) {
      const at = c.at.find((k) => !chosen.has(k));
      chosen.add(at ?? c.at[0]);
      if (chosen.size >= maxSentences) break;
    }
    for (let k = 0; k < items.length && chosen.size < maxSentences; k++) chosen.add(k);
    const order = [...chosen].sort((a, b) => a - b);
    const sentences = order.map((k, i) => {
      const it = items[k];
      return { i, en: it.en, ko: it.ko, videoId: it.videoId, title: it.title };
    });
    const posOf = new Map(order.map((k, i) => [k, i]));

    const words = picked.map((c) => {
      const at = c.at.find((k) => posOf.has(k)) ?? c.at[0];
      const i = posOf.get(at) ?? 0;
      const seen = known.get(c.word);
      return {
        word: c.word,
        ko: seen?.ko || '',
        pos: seen?.pos || '',
        def: seen?.def || '',
        ipa: ipaOf(c.word) || seen?.ipa || '',
        level: Number.isFinite(rankOf(c.word)) ? levelOf(rankOf(c.word)) : seen?.level || '',
        count: c.count,
        seed: c.seed,
        i,
        example: sentences[i]?.en || '',
      };
    });

    out.push({ id: t.id, name: t.name, emoji: t.emoji, words, sentences, sentenceTotal: items.length });
  }
  // 문장이 많이 모인 주제부터
  return out.sort((a, b) => b.words.length - a.words.length || b.sentenceTotal - a.sentenceTotal);
}
