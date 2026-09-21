// GitHub Actions에서 APK를 만들기 전에 자동으로 돌아가는 기본 테스트 (네트워크 없이 실행)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSentences } from '../public/lib/sentences.js';
import { loadWordData, lemma, levelOf, rankOf, ipaOf } from '../public/lib/words.js';
import { findExpressions, findTraps } from '../public/lib/expressions.js';
import { normalizeChannelInput } from '../public/lib/youtube.js';
import { resumeIndex } from '../public/lib/study.js';
import { pickKeywords, wordsOf, KEYWORD_COUNT } from '../public/lib/keywords.js';
import { ipaOf as arpabetToIpa } from '../scripts/ipa.mjs';
import { alignSegments, translateMany, fillMissing, missingCount, setPacing } from '../public/lib/enrich.js';
import { setTransport } from '../public/lib/net.js';
import { llmTranslate, setEngine, engineReady, checkKey } from '../public/lib/llm.js';

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
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0, budget: 0 });
  t.after(() => (setTransport(null), setPacing({ gap: 120, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000, budget: 30000, lanes: 3 })));
  const lines = Array.from({ length: 8 }, (_, i) => `Sentence number ${i}.`);
  // 4줄이 넘는 요청은 모두 거부 → 쪼개서 받아 와야 한다
  const calls = fakeNet((qLines) => (qLines.length > 4 ? 429 : 200));
  const out = await translateMany(lines);
  assert.equal(out.failed, 0);
  assert.deepEqual([...out], lines.map((l) => `번역(${l})`));
  assert.ok(calls.length > 1);
});

test('해석: Google 이 안 되면 남은 줄만 두 번째 번역기로', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0, budget: 0 });
  t.after(() => (setTransport(null), setPacing({ gap: 120, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000, budget: 30000, lanes: 3 })));
  const calls = fakeNet((qLines, n, who) => (who === 'google' ? 429 : 200));
  const out = await translateMany(['It is not loud.', 'Nobody tells you.']);
  assert.equal(out.failed, 0);
  assert.deepEqual([...out], ['메모리(It is not loud.)', '메모리(Nobody tells you.)']);
  assert.ok(calls.some((q) => q === 'It is not loud.'));
});

test('해석 다시 받기: 비어 있는 곳만 다시 받고 있던 해석은 그대로', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0, budget: 0 });
  t.after(() => (setTransport(null), setPacing({ gap: 120, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000, budget: 30000, lanes: 3 })));
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

test('직역하면 뜻이 달라지는 표현 짚어 주기', () => {
  // 무료 번역기는 이 문장을 '문을 닫은 채 학교에 다닌 사람'으로 옮긴다
  const t = findTraps('Someone you went to school with just closed on a house.');
  assert.equal(t.length, 1);
  assert.equal(t[0].phrase, 'close on a house');
  assert.match(t[0].ko, /매매/);
  // 관사가 달라도, 활용형이어도 찾는다
  assert.equal(findTraps('She is closing on the house next week.')[0]?.phrase, 'close on a house');
  assert.equal(findTraps('He kept his head above water for a year.')[0]?.phrase, 'keep your head above water');
  // 평범한 문장에는 아무것도 붙이지 않는다
  assert.deepEqual(findTraps('It is not loud.'), []);
});

test('해석: 한 번 거부당해도 다음번에는 다시 구글로 (잠김 없음)', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [30], maxWait: 1000, budget: 0, lanes: 2 });
  t.after(() => (setTransport(null), setPacing({ gap: 120, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000, budget: 30000, lanes: 3 })));
  let refuse = true;
  let google = 0;
  fakeNet((qLines, n, who) => {
    if (who !== 'google') return 200;
    google++;
    return refuse ? 429 : 200;
  });
  await translateMany(['It is not loud.']); // 거부당해 두 번째 번역기로 넘어간다
  assert.ok(google > 0);

  refuse = false;
  const before = google;
  await new Promise((r) => setTimeout(r, 80)); // 쉬는 시간이 지나면
  const out = await translateMany(['Nobody tells you.']);
  assert.ok(google > before, '쉬는 시간이 지난 뒤에는 구글에 다시 물어봐야 한다');
  assert.equal(out[0], '번역(Nobody tells you.)');
});

test('이어보기: 마지막 익힘 다음 문장부터', () => {
  assert.equal(resumeIndex(272, [0, 1, 2]), 3); // 3번째까지 익혔으면 그다음부터
  assert.equal(resumeIndex(272, []), 0); // 처음 여는 이야기는 1번부터
  assert.equal(resumeIndex(10, [0, 4, 2]), 5); // 띄엄띄엄 익혔어도 가장 뒤 익힘의 다음
  assert.equal(resumeIndex(5, [0, 1, 2, 3, 4]), 0); // 다 익혔으면 처음부터 복습
  assert.equal(resumeIndex(5, [4]), 0); // 마지막만 익혔으면 아직 안 익힌 첫 문장
  assert.equal(resumeIndex(5, [0, 4]), 1);
  assert.equal(resumeIndex(3, new Set([0])), 1); // Set 으로 넘겨도 된다
});

/* ── 스토리별 핵심단어 ── */
const story = (lines, extra = {}) => ({
  videoId: 'vid1',
  title: '이야기',
  sentences: lines.map((en, i) => ({ i, en, ko: `해석 ${i}` })),
  ...extra,
});

test('핵심단어: 어려운 단어를 고르고 쉬운 말은 뺀다', () => {
  const items = pickKeywords(
    story([
      'The mortgage payment was late again this month.',
      'She could not afford the tuition for the semester.',
      'He was furious about the inheritance.',
    ]),
  );
  const list = items.map((it) => it.word);
  assert.ok(list.includes('mortgage') && list.includes('tuition') && list.includes('inheritance'));
  assert.ok(!list.includes('about') && !list.includes('month') && !list.includes('this')); // 너무 쉬운 말
  // 어려운 단어가 앞에 온다 (빈도 순위가 낮을수록 어렵다)
  assert.ok(items[0].rank > items[items.length - 1].rank / 3);
  assert.ok(items.every((it) => it.level && it.ipa !== undefined));
});

test('핵심단어: 개수는 20개까지, 단어마다 그 단어가 들어간 문장이 붙는다', () => {
  const lines = Array.from({ length: 40 }, (_, k) => `The reluctant accountant audited the mortgage ledger number ${k}.`);
  lines.push('A dragon circled the abandoned lighthouse.');
  const items = pickKeywords(story(lines));
  assert.equal(KEYWORD_COUNT, 20);
  assert.ok(items.length <= KEYWORD_COUNT);
  for (const it of items) {
    assert.ok(wordsOf(it.en).includes(it.word), `${it.word} 예문에 단어가 있어야 한다`);
    assert.equal(it.en, story(lines).sentences[it.si].en); // 원래 이야기의 몇 번째 문장인지도 함께
  }
  assert.equal(pickKeywords(story(lines), { maxWords: 3 }).length, 3);
  assert.equal(pickKeywords({ sentences: [] }).length, 0);
});

test('핵심단어: 문장은 되도록 겹치지 않게, 해석이 있는 문장을 먼저 고른다', () => {
  const lesson = {
    videoId: 'v',
    title: '이야기',
    sentences: [
      { i: 0, en: 'The mortgage and the tuition arrived together.', ko: '' }, // 해석이 빈 줄
      { i: 1, en: 'He could not pay the mortgage that winter.', ko: '그해 겨울 그는 대출금을 내지 못했다.' },
      { i: 2, en: 'Her tuition was due before the semester.', ko: '학기 전에 등록금 납부일이 되었다.' },
    ],
  };
  const items = pickKeywords(lesson);
  const at = (w) => items.find((it) => it.word === w);
  assert.equal(at('mortgage').si, 1); // 해석이 있는 문장으로
  assert.equal(at('tuition').si, 2); // 앞 단어가 쓴 문장은 피해서
  // 해석이 있는 문장이 하나라도 있으면 해석이 빈 문장을 예문으로 쓰지 않는다
  for (const it of items) {
    const alts = lesson.sentences.filter((x) => wordsOf(x.en).includes(it.word));
    if (alts.some((x) => x.ko)) assert.ok(lesson.sentences[it.si].ko, `${it.word} 예문에는 해석이 있어야 한다`);
  }
});

test('핵심단어: 이름은 빼고 사전형으로 모으며, 뜻은 이야기 단어장에서 가져온다', () => {
  const lesson = story(
    [
      'Sarah signed the mortgage papers in Boston.',
      'The mortgages were bundled by the reluctant accountant.',
    ],
    { vocab: [{ word: 'mortgage', ko: '주택담보대출', pos: 'n.' }] },
  );
  const items = pickKeywords(lesson);
  const list = items.map((it) => it.word);
  assert.ok(!list.includes('sarah') && !list.includes('boston')); // 이름·지명 제외
  assert.ok(list.includes('mortgage') && !list.includes('mortgages')); // 활용형은 사전형으로
  assert.equal(items.find((it) => it.word === 'mortgage').ko, '주택담보대출');
  assert.equal(items.find((it) => it.word === 'mortgage').count, 2);
  // 뜻을 모르면 빈 채로 둔다 (앱이 열 때 받아 채운다)
  assert.equal(items.find((it) => it.word === 'accountant').ko, '');
  assert.equal(pickKeywords(lesson, { meanings: { accountant: { ko: '회계사' } } }).find((it) => it.word === 'accountant').ko, '회계사');
});

/* ── 해석 엔진 (LLM) ── */
const isLlm = (url) => url.startsWith('https://generativelanguage.googleapis.com');
const geminiReply = (items) => ({
  status: 200,
  text: JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(items) + '\n```' }] } }] }),
});
/** 프롬프트에 담긴 '1. 문장' 목록을 읽어 낸다 */
const askedLines = (body) => {
  const text = JSON.parse(body).contents[0].parts[0].text;
  return [...text.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), line: m[2] }));
};

test('해석 엔진: 번호로 맞춰 문맥 번역을 받는다', async (t) => {
  t.after(() => (setTransport(null), setEngine({})));
  setEngine({ on: true, key: 'test-key', model: 'gemini-flash-lite-latest' });
  assert.equal(engineReady(), true);
  const seen = [];
  setTransport(async (url, { body }) => {
    assert.ok(isLlm(url));
    seen.push(url);
    // 순서를 섞어 돌려줘도 번호로 제자리를 찾아야 한다
    return geminiReply(askedLines(body).map(({ n, line }) => ({ n, ko: `엘엘엠(${line})` })).reverse());
  });
  const out = await llmTranslate(['It is not loud.', 'Nobody tells you.'], { title: 'A Story' });
  assert.deepEqual(out, ['엘엘엠(It is not loud.)', '엘엘엠(Nobody tells you.)']);
  assert.match(seen[0], /gemini-flash-lite-latest:generateContent\?key=test-key/);
});

test('해석 엔진: LLM 이 빠뜨린 줄만 무료 번역기가 채운다', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0, budget: 0 });
  t.after(() => (setTransport(null), setEngine({}), setPacing({ gap: 120, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000, budget: 30000, lanes: 3 })));
  setEngine({ on: true, key: 'k' });
  let google = 0;
  setTransport(async (url, { body }) => {
    if (isLlm(url)) {
      const asked = askedLines(body);
      return geminiReply([{ n: asked[0].n, ko: `엘엘엠(${asked[0].line})` }]); // 첫 줄만 돌려준다
    }
    google++;
    const q = decodeURIComponent(new URL(url).searchParams.get('q'));
    if (url.startsWith('https://api.mymemory')) return { status: 200, text: JSON.stringify({ responseData: { translatedText: `메모리(${q})` } }) };
    const src = q.split('\n');
    return { status: 200, text: JSON.stringify([src.map((l, k) => [`번역(${l})` + (k < src.length - 1 ? '\n' : ''), l + (k < src.length - 1 ? '\n' : '')]), null, 'en']) };
  });
  const out = await translateMany(['It is not loud.', 'Nobody tells you.'], () => {}, { title: 'A Story' });
  assert.equal(out.failed, 0);
  assert.equal(out[0], '엘엘엠(It is not loud.)'); // LLM 해석은 그대로 두고
  assert.equal(out[1], '번역(Nobody tells you.)'); // 빠진 줄만 무료 번역기로
  assert.equal(google, 1);
});

test('해석 엔진: 꺼져 있으면 LLM 에 보내지 않는다', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0, budget: 0 });
  t.after(() => (setTransport(null), setEngine({}), setPacing({ gap: 120, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000, budget: 30000, lanes: 3 })));
  setEngine({ on: false, key: 'k' });
  setTransport(async (url) => {
    assert.ok(!isLlm(url), 'LLM 을 껐는데 요청이 나갔다');
    const q = decodeURIComponent(new URL(url).searchParams.get('q'));
    const src = q.split('\n');
    return { status: 200, text: JSON.stringify([src.map((l) => [`번역(${l})`, l]), null, 'en']) };
  });
  const out = await translateMany(['It is not loud.']);
  assert.equal(out[0], '번역(It is not loud.)');
});

test('해석 엔진: 키 확인은 쓸 수 있는 모델을 골라 준다', async (t) => {
  t.after(() => (setTransport(null), setEngine({})));
  setTransport(async (url) => {
    assert.match(url, /\/models\?key=my-key/);
    return {
      status: 200,
      text: JSON.stringify({
        models: [
          { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    };
  });
  const { models, picked } = await checkKey('my-key');
  assert.equal(picked, 'gemini-flash-lite-latest'); // 무료 한도가 넉넉한 쪽을 고른다
  assert.deepEqual(models, ['gemini-flash-latest', 'gemini-flash-lite-latest']);
});

test('해석 엔진: LLM 이 해낸 줄 수를 알려 준다 (엔진 표시 판단용)', async (t) => {
  setPacing({ gap: 0, retry: 0, cooldowns: [0], maxWait: 0, budget: 0 });
  t.after(() => (setTransport(null), setEngine({}), setPacing({ gap: 120, retry: 600, cooldowns: [4000, 12000, 25000], maxWait: 30000, budget: 30000, lanes: 3 })));
  setEngine({ on: true, key: 'k' });
  let llmFails = false;
  setTransport(async (url, { body }) => {
    if (isLlm(url)) {
      if (llmFails) return { status: 429, text: '{"error":{"message":"quota"}}' };
      return geminiReply(askedLines(body).map(({ n, line }) => ({ n, ko: `엘엘엠(${line})` })));
    }
    const q = decodeURIComponent(new URL(url).searchParams.get('q'));
    const src = q.split('\n');
    return { status: 200, text: JSON.stringify([src.map((l, k) => [`번역(${l})` + (k < src.length - 1 ? '\n' : ''), l + (k < src.length - 1 ? '\n' : '')]), null, 'en']) };
  });

  const good = await translateMany(['It is not loud.', 'Nobody tells you.']);
  assert.equal(good.llm, 2); // 처음부터 LLM 이 다 했다

  llmFails = true; // 한도 초과 → 무료 번역기가 대신한다
  const fallback = await translateMany(['It is not loud.', 'Nobody tells you.']);
  assert.equal(fallback.llm, 0);
  assert.equal(fallback.failed, 0);
  assert.equal(fallback[0], '번역(It is not loud.)');
});
