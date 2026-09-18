// GitHub Actions에서 APK를 만들기 전에 자동으로 돌아가는 기본 테스트 (네트워크 없이 실행)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSentences } from '../public/lib/sentences.js';
import { loadWordData, lemma, levelOf, rankOf, ipaOf } from '../public/lib/words.js';
import { findExpressions } from '../public/lib/expressions.js';
import { normalizeChannelInput } from '../public/lib/youtube.js';
import { ipaOf as arpabetToIpa } from '../scripts/ipa.mjs';
import { alignSegments, translateMany, fillMissing, missingCount, setPacing } from '../public/lib/enrich.js';
import { setTransport } from '../public/lib/net.js';

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

/* ── 해석(번역) ── */
// Google 번역 응답 흉내: 조각마다 [번역, 원문] 이 들어 있고 줄바꿈은 원문 그대로 붙는다
function fakeSegments(text) {
  const lines = text.split('\n');
  return [lines.map((l, k) => [`번역(${l})` + (k < lines.length - 1 ? '\n' : ''), l + (k < lines.length - 1 ? '\n' : ''), null, null, 1])];
}
const qOf = (url) => decodeURIComponent(new URL(url).searchParams.get('q'));

/** 번역 요청을 가로채는 가짜 네트워크. reply(줄 목록, 호출 순번) 가 status 를 돌려주면 그대로 응답 */
function fakeNet(reply) {
  const calls = [];
  setTransport(async (url) => {
    const q = qOf(url);
    calls.push(q);
    if (url.startsWith('https://api.mymemory')) {
      const status = reply(q.split('\n'), calls.length, 'mymemory');
      if (status && status !== 200) return { status, text: '{}' };
      return { status: 200, text: JSON.stringify({ responseData: { translatedText: `메모리(${q})` } }) };
    }
    const status = reply(q.split('\n'), calls.length, 'google');
    if (status && status !== 200) return { status, text: '<html>Sorry...</html>' };
    return { status: 200, text: JSON.stringify(fakeSegments(q)) };
  });
  return calls;
}

test('해석: 조각을 원래 줄에 맞춰 나눈다', () => {
  const lines = ['It is not loud.', 'It does not announce itself.'];
  assert.deepEqual(alignSegments(fakeSegments(lines.join('\n'))[0], lines), ['번역(It is not loud.)', '번역(It does not announce itself.)']);
  // 줄 수가 맞지 않는 응답은 통째로 버린다 (엉뚱한 줄에 붙이지 않는다)
  assert.equal(alignSegments([['하나', 'It is not loud.']], lines), null);
  // 한 조각이 두 줄에 걸쳤는데 번역이 나뉘지 않았다면 그 줄들만 비운다
  assert.deepEqual(alignSegments([['둘을 하나로', 'It is not loud.\nIt does not announce itself.']], lines), ['', '']);
  // 원문이 안 딸려 와도 줄바꿈 수가 맞으면 그대로 쓴다
  assert.deepEqual(alignSegments([['크지 않다.\n'], ['스스로 알리지 않는다.']], lines), ['크지 않다.', '스스로 알리지 않는다.']);
});

test('해석: 묶음이 거부당하면 반으로 쪼개 되살린다', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0 });
  t.after(() => (setTransport(null), setPacing({ gap: 350, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000 })));
  const lines = Array.from({ length: 8 }, (_, i) => `Sentence number ${i}.`);
  // 4줄이 넘는 요청은 모두 거부 → 쪼개서 받아 와야 한다
  const calls = fakeNet((qLines) => (qLines.length > 4 ? 429 : 200));
  const out = await translateMany(lines);
  assert.equal(out.failed, 0);
  assert.deepEqual([...out], lines.map((l) => `번역(${l})`));
  assert.ok(calls.length > 1);
});

test('해석: Google 이 안 되면 남은 줄만 두 번째 번역기로', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0 });
  t.after(() => (setTransport(null), setPacing({ gap: 350, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000 })));
  const calls = fakeNet((qLines, n, who) => (who === 'google' ? 429 : 200));
  const out = await translateMany(['It is not loud.', 'Nobody tells you.']);
  assert.equal(out.failed, 0);
  assert.deepEqual([...out], ['메모리(It is not loud.)', '메모리(Nobody tells you.)']);
  assert.ok(calls.some((q) => q === 'It is not loud.'));
});

test('해석 다시 받기: 비어 있는 곳만 다시 받고 있던 해석은 그대로', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0 });
  t.after(() => (setTransport(null), setPacing({ gap: 350, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000 })));
  const lesson = {
    title: 'A Story About Falling Behind',
    titleKo: '뒤처짐에 관한 이야기',
    sentences: [
      { i: 0, en: 'It is not loud.', ko: '시끄럽지 않다.' },
      { i: 1, en: 'Nobody tells you.', ko: '' },
    ],
    vocab: [{ word: 'panic', ko: '' }],
    incomplete: true,
  };
  assert.deepEqual(missingCount(lesson), { title: 0, sentences: 1, vocab: 1, total: 2 });
  const calls = fakeNet(() => 200);
  const { filled, left } = await fillMissing(lesson);
  assert.equal(filled, 2);
  assert.equal(left, 0);
  assert.equal(lesson.incomplete, false);
  assert.equal(lesson.sentences[0].ko, '시끄럽지 않다.'); // 이미 있던 해석은 다시 받지 않는다
  assert.equal(lesson.sentences[1].ko, '번역(Nobody tells you.)');
  assert.equal(lesson.vocab[0].ko, '번역(panic)');
  assert.ok(!calls.some((q) => q.includes('It is not loud.')));
});
