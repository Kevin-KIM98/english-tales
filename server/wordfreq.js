// 구어 영어 빈도 순위(SUBTLEX-US, 약 7.4만 단어)로 학습할 단어 고르기·난이도 추정
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RANK = new Map();
require('subtlex-word-frequencies').forEach(({ word }, i) => {
  const w = word.toLowerCase();
  if (!RANK.has(w)) RANK.set(w, i + 1);
});

export const rankOf = (w) => RANK.get(w.toLowerCase()) ?? Infinity;

/** 활용형 → 사전형 추정 (빈도 목록에 있는 형태만 인정) */
export function lemma(word) {
  const w = word.toLowerCase();
  const tries = [];
  if (/ies$/.test(w)) tries.push(w.slice(0, -3) + 'y');
  if (/ied$/.test(w)) tries.push(w.slice(0, -3) + 'y');
  if (/ing$/.test(w)) tries.push(w.slice(0, -3), w.slice(0, -3) + 'e', w.slice(0, -4));
  if (/ed$/.test(w)) tries.push(w.slice(0, -2), w.slice(0, -1), w.slice(0, -3));
  if (/es$/.test(w)) tries.push(w.slice(0, -2));
  if (/s$/.test(w) && !/ss$/.test(w)) tries.push(w.slice(0, -1));
  // 원형이 충분히 흔한 단어일 때만 바꾼다 (순위 비교로 엉뚱한 원형을 거른다)
  for (const b of tries) if (b.length >= 3 && rankOf(b) < 30000 && rankOf(b) < rankOf(w) * 3) return b;
  // 비교급·최상급(quieter, bigger, newest): 원형이 훨씬 흔할 때만 (teacher → teach 방지)
  const cmp = w.match(/^(.+?)(i)?(er|est)$/);
  if (cmp) {
    const stem = cmp[2] ? cmp[1] + 'y' : cmp[1];
    const undoubled = /(.)\1$/.test(stem) ? stem.slice(0, -1) : stem; // bigg → big
    for (const b of [stem, stem + 'e', undoubled])
      if (b.length >= 3 && rankOf(b) * 5 < rankOf(w)) return b;
  }
  return w;
}

/** 빈도 순위 → 대략적인 CEFR 수준 */
export function levelOf(rank) {
  if (rank <= 1200) return 'A2';
  if (rank <= 3000) return 'B1';
  if (rank <= 6500) return 'B2';
  if (rank <= 14000) return 'C1';
  return 'C2';
}
