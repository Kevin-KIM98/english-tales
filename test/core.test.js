// 배포 전에 GitHub Actions에서 자동으로 돌아가는 기본 테스트 (네트워크 없이 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeState } from '../public/merge.js';
import { buildSentences } from '../server/sentences.js';
import { lemma, levelOf, rankOf } from '../server/wordfreq.js';
import { findExpressions } from '../server/expressions.js';
import { ipaOf } from '../server/ipa.js';
import { normalizeChannelInput } from '../server/youtube.js';

test('동기화: 더 최근 기록이 이기고, 지운 단어는 되살아나지 않는다', () => {
  const pc = { progress: { a: { learned: [1, 2], t: 10 } }, words: { old: { deleted: true, t: 20 } }, days: ['2026-01-01'], daysT: 0 };
  const phone = { progress: { a: { learned: [1], t: 5 } }, words: { old: { word: 'old', t: 15 } }, days: ['2026-01-02'], daysT: 0 };
  const m = mergeState(pc, phone);
  assert.deepEqual(m.progress.a.learned, [1, 2]);
  assert.equal(m.words.old.deleted, true);
  assert.deepEqual(m.days, ['2026-01-01', '2026-01-02']);
  assert.equal(mergeState(m, { days: [], daysT: 99 }).days.length, 0);
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
  assert.equal(lemma('teacher'), 'teacher');
  assert.ok(rankOf('the') < rankOf('abandon'));
  assert.equal(levelOf(500), 'A2');
});

test('표현 찾기 (활용형·목적어 사이 끼임)', () => {
  const found = findExpressions([
    { i: 0, en: 'She gave it up after a year.' },
    { i: 1, en: 'He finally figured out the answer.' },
  ]).map((e) => e.phrase);
  assert.ok(found.includes('give up'));
  assert.ok(found.includes('figure out'));
});

test('발음기호', () => {
  assert.equal(ipaOf('abandon'), '/əˈbændən/');
  assert.equal(ipaOf('zzzqqq'), '');
});

test('채널 주소 해석', () => {
  assert.deepEqual(normalizeChannelInput('https://www.youtube.com/@ZylosTales'), { path: '@ZylosTales' });
  assert.deepEqual(normalizeChannelInput('UCm1XC5nCMNMUR7c9cYbABQA'), { path: 'channel/UCm1XC5nCMNMUR7c9cYbABQA' });
  assert.throws(() => normalizeChannelInput(''));
});
