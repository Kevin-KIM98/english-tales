// 발음: 앱에서는 안드로이드 TTS 엔진(구글 자연 음성)을, 개발용 브라우저에서는 Web Speech API를 쓴다
import { isNative } from './net.js';

const plugin = () => globalThis.Capacitor?.Plugins?.TextToSpeech;

// 영어 억양(지역) 이름
const REGIONS = {
  US: '미국', GB: '영국', AU: '호주', CA: '캐나다', IN: '인도', IE: '아일랜드', NZ: '뉴질랜드',
  ZA: '남아공', SG: '싱가포르', NG: '나이지리아', PH: '필리핀', HK: '홍콩', KE: '케냐', TZ: '탄자니아',
};
const REGION_ORDER = ['US', 'GB', 'AU', 'CA', 'IE', 'NZ', 'IN', 'ZA'];

/** 목소리 한 개의 표시 정보: 지역, 이름, 고품질(온라인) 여부 */
function describe(v) {
  const region = (v.lang.split(/[-_]/)[1] || '').toUpperCase();
  // 구글 음성 이름 예: en-us-x-iol-local / en-us-x-tpf-network / en-US-language
  const code = v.name.match(/-x-([a-z0-9]+)-(local|network)$/i);
  const online = code ? code[2].toLowerCase() === 'network' : v.local === false;
  const short = code
    ? code[1].toUpperCase()
    : /-language$/i.test(v.name)
      ? '기본'
      : v.name.replace(/^(Microsoft|Google)\s+/i, '').replace(/\s*\(.*\)$/, '').replace(/\s+(Online|Natural)$/i, '');
  return { region, regionName: REGIONS[region] || region || '기타', short, online };
}

export function createTTS(getSettings, toast) {
  let seq = 0;
  let voices = []; // { id, name, lang, local, region, regionName, short, online }
  let loaded = null;

  async function readVoices() {
    if (isNative() && plugin()) {
      const { voices: list } = await plugin().getSupportedVoices();
      // 네이티브 플러그인은 전체 목록의 순번(index)으로 목소리를 고른다.
      // 안드로이드 플러그인의 name 은 모든 목소리가 '영어 미국'처럼 같아서, 목소리마다 다른 voiceURI(en-us-x-iol-network)를 이름으로 쓴다.
      const seen = new Set();
      return list
        .map((v, index) => ({ id: String(index), name: v.voiceURI || v.name, lang: v.lang, local: v.localService }))
        .filter((v) => /^en[-_]/i.test(v.lang) && !seen.has(v.name) && seen.add(v.name));
    }
    if (!('speechSynthesis' in globalThis)) return [];
    const read = () =>
      speechSynthesis
        .getVoices()
        .filter((v) => v.lang.startsWith('en'))
        .map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
    let list = read();
    if (!list.length) {
      await new Promise((r) => {
        speechSynthesis.addEventListener('voiceschanged', r, { once: true });
        setTimeout(r, 1500);
      });
      list = read();
    }
    return list;
  }

  async function loadVoices() {
    // TTS 엔진이 막 켜졌을 때는 목록이 비어 오는 경우가 있어 몇 번 다시 묻는다
    for (let i = 0; i < 4; i++) {
      const list = await readVoices().catch(() => []);
      if (list.length) {
        voices = list.map((v) => ({ ...v, ...describe(v) }));
        // 지역마다 '고품질 먼저, 이름순'으로 번호를 붙여 목소리를 구별하기 쉽게 한다 (미국 1, 미국 2 …)
        const byRegion = new Map();
        for (const v of [...voices].sort((a, b) => b.online - a.online || a.short.localeCompare(b.short))) {
          const n = (byRegion.get(v.region) || 0) + 1;
          byRegion.set(v.region, n);
          v.num = n;
        }
        return voices;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    loaded = null; // 다음에 다시 시도
    return (voices = []);
  }
  const ensure = () => (loaded ||= loadVoices());

  /** 설정에서 고른 목소리 → 없으면 자연스러운 미국 영어 음성을 우선 */
  function pick(id = getSettings().voice) {
    return (
      voices.find((v) => v.id === id) ||
      voices.find((v) => v.region === 'US' && /network|natural|neural|google|samantha|aria|jenny/i.test(v.name)) ||
      voices.find((v) => v.region === 'US') ||
      voices[0]
    );
  }

  /** @param {{ rate?: number, onend?: Function, voiceId?: string }} opts voiceId: 미리 듣기용으로 특정 목소리 지정 */
  async function speak(text, { rate = 1, onend, voiceId } = {}) {
    const my = ++seq;
    const done = () => my === seq && onend?.();
    await ensure();
    if (my !== seq) return;
    const v = pick(voiceId);
    const r = getSettings().rate * rate;
    if (isNative() && plugin()) {
      try {
        await plugin().stop().catch(() => {});
        await plugin().speak({
          text,
          lang: v?.lang?.replace('_', '-') || 'en-US',
          rate: r,
          pitch: 1,
          volume: 1,
          voice: v ? Number(v.id) : undefined,
          category: 'playback',
        });
        done(); // speak()는 다 읽은 뒤에 끝난다
      } catch {
        if (my === seq) toast?.('음성을 재생하지 못했어요. 설정 → 발음 → 음성 데이터를 확인하세요');
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

  /** 지역별로 묶은 목소리 목록 [{ region, regionName, voices: [...] }] (미국·영국·호주… 순) */
  async function groups() {
    await ensure();
    const map = new Map();
    for (const v of voices) {
      if (!map.has(v.region)) map.set(v.region, { region: v.region, regionName: v.regionName, voices: [] });
      map.get(v.region).voices.push(v);
    }
    const rank = (r) => (REGION_ORDER.includes(r) ? REGION_ORDER.indexOf(r) : 99);
    return [...map.values()]
      .sort((a, b) => rank(a.region) - rank(b.region) || a.regionName.localeCompare(b.regionName))
      .map((g) => ({ ...g, voices: g.voices.sort((a, b) => a.num - b.num) }));
  }

  return {
    speak,
    stop,
    groups,
    /** 현재 목소리 (목록을 아직 못 불러왔으면 undefined) */
    current: () => pick(),
    /** 화면 표시용 이름: '미국 2 · IOL (고품질)' — 목소리마다 다르게 */
    label: (v) => (v ? `${v.regionName} ${v.num} · ${v.short}${v.online ? ' (고품질)' : ''}` : '기본 영어 음성'),
    ready: ensure,
    /** 안드로이드 음성 데이터(고품질 음성) 설치 화면 열기 */
    openInstall: () => plugin()?.openInstall?.(),
  };
}
