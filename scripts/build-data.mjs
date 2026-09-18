// 앱에 넣을 오프라인 데이터 생성 (npm run build 때 자동 실행)
//  public/data/freq.txt : 구어 빈도 순위 (한 줄에 한 단어, 줄 번호 = 순위) — SUBTLEX-US
//  public/data/ipa.json  : 단어 → 미국식 IPA — CMU 발음 사전에서 변환
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ipaOf } from './ipa.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'public', 'data');
fs.mkdirSync(out, { recursive: true });

const MAX = 45000;
const seen = new Set();
const words = [];
for (const { word } of require('subtlex-word-frequencies')) {
  const w = word.toLowerCase();
  if (!/^[a-z][a-z'-]*$/.test(w) || seen.has(w)) continue;
  seen.add(w);
  words.push(w);
  if (words.length >= MAX) break;
}
fs.writeFileSync(path.join(out, 'freq.txt'), words.join('\n'));

const ipa = {};
for (const w of words) {
  const p = ipaOf(w);
  if (p) ipa[w] = p;
}
fs.writeFileSync(path.join(out, 'ipa.json'), JSON.stringify(ipa));

const kb = (f) => Math.round(fs.statSync(path.join(out, f)).size / 1024);
console.log(`data: freq.txt ${words.length}단어 ${kb('freq.txt')}KB, ipa.json ${Object.keys(ipa).length}단어 ${kb('ipa.json')}KB`);
