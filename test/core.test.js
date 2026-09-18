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

test('영상 날짜: 상대 시간 → 날짜', async () => {
  const { parseRelative } = await import('../public/lib/youtube.js');
  const now = Date.parse('2026-09-18T00:00:00Z');
  const day = (t) => new Date(parseRelative(t, now)).toISOString().slice(0, 10);
  assert.equal(day('3d ago'), '2026-09-15');
  assert.equal(day('2 weeks ago'), '2026-09-04');
  assert.equal(day('Streamed 1 month ago'), '2026-08-19');
  assert.equal(parseRelative('no date', now), null);
});

test('안드로이드 목소리: 이름이 모두 같아도 목소리마다 다른 표시 이름', async () => {
  // 안드로이드 TTS 플러그인이 실제로 주는 모양: name 은 전부 같고 voiceURI 가 다르다
  const android = [
    ['en-us-x-iol-local', 'en-US', true], ['en-us-x-iol-network', 'en-US', false], ['en-us-x-tpf-network', 'en-US', false],
    ['en-us-x-sfg-local', 'en-US', true], ['en-US-language', 'en-US', true], ['en-gb-x-rjs-network', 'en-GB', false],
    ['ko-kr-x-ism-local', 'ko-KR', true],
  ].map(([voiceURI, lang, localService]) => ({ voiceURI, name: lang.startsWith('ko') ? '한국어 대한민국' : '영어 미국', lang, localService, default: false }));
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { TextToSpeech: { getSupportedVoices: async () => ({ voices: android }), speak: async () => {}, stop: async () => {} } },
  };
  try {
    const { createTTS } = await import('../public/lib/tts.js');
    const tts = createTTS(() => ({ voice: '', rate: 1 }), () => {});
    const groups = await tts.groups();
    const all = groups.flatMap((g) => g.voices);
    const labels = all.map((v) => tts.label(v));
    assert.equal(all.length, 6); // 한국어 제외
    assert.equal(new Set(labels).size, labels.length, '표시 이름이 서로 달라야 함: ' + labels.join(', '));
    assert.deepEqual(groups.map((g) => g.regionName), ['미국', '영국']);
    assert.match(tts.label(tts.current()), /^미국 1 · .* \(고품질\)$/); // 기본은 미국 고품질
    assert.ok(labels.includes('미국 5 · 기본') || labels.some((l) => l.includes('기본')));
  } finally {
    delete globalThis.Capacitor;
  }
});
