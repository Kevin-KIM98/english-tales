// 오프라인 발음기호: CMU 발음 사전(ARPAbet) → 미국식 IPA
import { dictionary } from 'cmu-pronouncing-dictionary';

const VOWELS = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ',
  EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
};
const CONSONANTS = {
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n',
  NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
// 강세 표시를 붙일 때 음절 첫소리로 함께 묶을 수 있는 자음 조합
const ONSETS = new Set(['s p', 's t', 's k', 'p ɹ', 'b ɹ', 't ɹ', 'd ɹ', 'k ɹ', 'ɡ ɹ', 'f ɹ', 'θ ɹ', 'p l', 'b l', 'k l', 'ɡ l', 'f l', 's l', 's w', 't w', 'k w', 's m', 's n']);

export function ipaOf(word) {
  const arpa = dictionary[word.toLowerCase()];
  if (!arpa) return '';
  const out = []; // { s: 기호, v: 모음 여부, stress }
  for (const ph of arpa.split(' ')) {
    const m = ph.match(/^([A-Z]+)([012])?$/);
    if (!m) continue;
    const [, base, st] = m;
    if (VOWELS[base]) {
      let s = VOWELS[base];
      if (st === '0' && base === 'AH') s = 'ə';
      if (st === '0' && base === 'ER') s = 'ɚ';
      out.push({ s, v: true, stress: st });
    } else if (CONSONANTS[base]) out.push({ s: CONSONANTS[base], v: false });
  }
  const vowelCount = out.filter((x) => x.v).length;
  // 강세 모음 앞 자음(1~2개)을 음절 첫소리로 보고 그 앞에 ˈ(1강세)·ˌ(2강세)를 둔다
  const res = [];
  out.forEach((x, i) => {
    if (x.v && vowelCount > 1 && (x.stress === '1' || x.stress === '2')) {
      let k = res.length;
      if (i > 0 && !out[i - 1].v) {
        k = res.length - 1;
        if (i > 1 && !out[i - 2].v && ONSETS.has(`${out[i - 2].s} ${out[i - 1].s}`)) k = res.length - 2;
      }
      // 단어 첫 소리부터가 강세 음절이면 맨 앞
      if (out.slice(0, i).every((y) => !y.v)) k = 0;
      res.splice(k, 0, x.stress === '1' ? 'ˈ' : 'ˌ');
    }
    res.push(x.s);
  });
  return '/' + res.join('') + '/';
}
