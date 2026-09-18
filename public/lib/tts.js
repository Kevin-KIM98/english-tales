// 발음: 앱에서는 안드로이드 TTS 엔진(구글 자연 음성)을, 개발용 브라우저에서는 Web Speech API를 쓴다
import { isNative } from './net.js';

const plugin = () => globalThis.Capacitor?.Plugins?.TextToSpeech;

export function createTTS(getSettings, toast) {
  let seq = 0;
  let voices = []; // { id, name, lang }
  let loaded = null;

  async function loadVoices() {
    if (isNative() && plugin()) {
      const { voices: list } = await plugin().getSupportedVoices();
      // 네이티브 플러그인은 목록의 순번(index)으로 목소리를 고른다
      voices = list
        .map((v, index) => ({ id: String(index), name: v.name, lang: v.lang, local: v.localService }))
        .filter((v) => /^en[-_]/i.test(v.lang));
    } else if ('speechSynthesis' in globalThis) {
      const read = () =>
        speechSynthesis
          .getVoices()
          .filter((v) => v.lang.startsWith('en'))
          .map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
      voices = read();
      if (!voices.length)
        await new Promise((r) => {
          speechSynthesis.addEventListener('voiceschanged', r, { once: true });
          setTimeout(r, 1500);
        });
      voices = read();
    }
    return voices;
  }

  /** 설정에서 고른 목소리 → 없으면 자연스러운 미국 영어 음성을 우선 */
  function pick() {
    const want = getSettings().voice;
    return (
      voices.find((v) => v.id === want) ||
      voices.find((v) => /en[-_]US/i.test(v.lang) && /network|natural|neural|google|samantha|aria|jenny/i.test(v.name)) ||
      voices.find((v) => /en[-_]US/i.test(v.lang)) ||
      voices[0]
    );
  }

  async function speak(text, { rate = 1, onend } = {}) {
    const my = ++seq;
    const done = () => my === seq && onend?.();
    loaded ||= loadVoices().catch(() => []);
    await loaded;
    const v = pick();
    const r = getSettings().rate * rate;
    if (isNative() && plugin()) {
      try {
        await plugin().stop().catch(() => {});
        await plugin().speak({ text, lang: v?.lang?.replace('_', '-') || 'en-US', rate: r, pitch: 1, volume: 1, voice: v ? Number(v.id) : undefined, category: 'playback' });
        done(); // speak()는 다 읽은 뒤에 끝난다
      } catch (err) {
        if (my === seq) toast?.('음성을 재생하지 못했어요. 설정 → 음성 데이터 설치를 확인하세요');
      }
      return;
    }
    if (!('speechSynthesis' in globalThis)) return toast?.('이 기기는 음성 재생을 지원하지 않습니다');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const sv = speechSynthesis.getVoices().find((x) => x.voiceURI === v?.id);
    if (sv) u.voice = sv;
    u.lang = v?.lang || 'en-US';
    u.rate = r;
    u.onend = done;
    u.onerror = (e) => e.error !== 'interrupted' && e.error !== 'canceled' && done();
    speechSynthesis.speak(u);
  }

  function stop() {
    seq++;
    if (isNative() && plugin()) plugin().stop().catch(() => {});
    else if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
  }

  return {
    speak,
    stop,
    voices: async () => {
      loaded ||= loadVoices().catch(() => []);
      await loaded;
      return voices;
    },
    current: () => pick(),
    /** 안드로이드 음성 데이터(고품질 음성) 설치 화면 열기 */
    openInstall: () => plugin()?.openInstall?.(),
  };
}
