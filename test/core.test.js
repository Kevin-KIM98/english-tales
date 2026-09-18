// GitHub Actions에서 APK를 만들기 전에 자동으로 돌아가는 기본 테스트 (네트워크 없이 실행)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSentences } from '../public/lib/sentences.js';
import { loadWordData, lemma, levelOf, rankOf, ipaOf } from '../public/lib/words.js';
import { findExpressions } from '../public/lib/expressions.js';
import { normalizeChannelInput } from '../public/lib/youtube.js';
import { ipaOf as arpabetToIpa } from '../scripts/ipa.mjs';

before(async () => {
  // npm run build 로 만든 오프라인 데이터를 읽는다
  await loadWordData(async (f) => fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
});

test('자막 → 문장 분할', () => {
  const words = 'There is a quiet [music] panic. It shows up on Tuesday. Nobody tells you.'
    .split(' ')
    .map((text, i) => ({ t: i * 300, text: (i ? ' ' : '') + text }));
  const s = buildSentences(words);
  assert.equal(s.length, 3);
  assert.equal(s[0].en, 'There is a quiet panic.');
  assert.ok(s[0].end <= s[1].start);
});

test('단어 원형·난이도', () => {
  assert.equal(lemma('stories'), 'story');
  assert.equal(lemma('quieter'), 'quiet');
  assert.equal(lemma('bigger'), 'big');
  assert.equal(lemma('teacher'), 'teacher');
  assert.ok(rankOf('the') < rankOf('abandon'));
  assert.equal(levelOf(500), 'A2');
});

test('발음기호 (앱 데이터 + 변환기)', () => {
  assert.equal(ipaOf('abandon'), '/əˈbændən/');
  assert.equal(arpabetToIpa('quiet'), '/ˈkwaɪət/');
  assert.equal(ipaOf('zzzqqq'), '');
});

test('표현 찾기 (활용형·목적어 사이 끼임)', () => {
  const found = findExpressions([
    { i: 0, en: 'She gave it up after a year.' },
    { i: 1, en: 'He finally figured out the answer.' },
  ]).map((e) => e.phrase);
  assert.ok(found.includes('give up'));
  assert.ok(found.includes('figure out'));
});

test('채널 주소 해석', () => {
  assert.deepEqual(normalizeChannelInput('https://www.youtube.com/@ZylosTales'), { path: '@ZylosTales' });
  assert.deepEqual(normalizeChannelInput('UCm1XC5nCMNMUR7c9cYbABQA'), { path: 'channel/UCm1XC5nCMNMUR7c9cYbABQA' });
  assert.throws(() => normalizeChannelInput(''));
});
