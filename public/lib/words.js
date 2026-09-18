// 앱에 들어 있는 오프라인 데이터로 단어 원형·난이도·발음기호 구하기
let RANK = null;
let IPA = null;

/** 데이터 불러오기 (앱: 로컬 파일, 테스트: 직접 주입) */
export async function loadWordData(loader) {
  if (RANK) return;
  const get = loader || (async (f) => (await fetch(new URL(`../data/${f}`, import.meta.url))).text());
  const [freq, ipa] = await Promise.all([get('freq.txt'), get('ipa.json')]);
  RANK = new Map(freq.split('\n').map((w, i) => [w, i + 1]));
  IPA = JSON.parse(ipa);
}

export const rankOf = (w) => RANK?.get(w.toLowerCase()) ?? Infinity;
export const ipaOf = (w) => IPA?.[w.toLowerCase()] || '';

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
