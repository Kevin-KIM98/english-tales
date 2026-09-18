// English Tales — 유튜브 이야기 채널 자막으로 공부하는 학습 앱 (휴대폰·PC 공용)
import { mergeState } from './merge.js';

const DEFAULT_CHANNEL = 'https://www.youtube.com/@ZylosTales';
const $view = document.getElementById('view');
const $app = document.getElementById('app');

/* ───────────── 저장소 (이 기기에만 저장) ───────────── */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('et.' + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('et.' + key, JSON.stringify(value));
    } catch {}
  },
};

const settings = Object.assign(
  { channel: DEFAULT_CHANNEL, voice: '', rate: 0.95, showKo: true, theme: 'auto', repeat: 1, gap: 0.8, loopAll: false, recentChannels: [] },
  store.get('settings', {}),
);
const saveSettings = () => store.set('settings', settings);
// 아래 기록은 서버를 통해 PC·휴대폰이 함께 쓴다. 항목마다 t(수정 시각)를 붙여 병합한다.
const progress = store.get('progress', {}); // videoId → { titleKo, total, learned: [], quiz, lastTab, t }
const words = store.get('words', {}); // word → { ...vocab, videoId, addedAt, known, t } | { deleted: true, t }
const days = new Set(store.get('days', []));
let daysT = store.get('daysT', 0);

/** 이야기 진행률 저장. id를 주면 그 이야기를 방금 바뀐 것으로 표시해 다른 기기에 전파한다. */
function saveProgress(id) {
  if (id && progress[id]) progress[id].t = Date.now();
  store.set('progress', progress);
  if (id) sync.push();
}
function saveWords() {
  store.set('words', words);
  sync.push();
}
const hasWord = (w) => Boolean(words[w] && !words[w].deleted);
const wordList = () => Object.values(words).filter((w) => !w.deleted);

function markStudied() {
  const d = new Date().toLocaleDateString('sv');
  if (!days.has(d)) {
    days.add(d);
    store.set('days', [...days].slice(-400));
    sync.push();
  }
}

/* ───────────── PC ↔ 휴대폰 동기화 ───────────── */
const sync = {
  timer: null,
  snapshot() {
    return {
      progress,
      words,
      days: [...days],
      daysT,
      channel: { url: settings.channel, recent: settings.recentChannels, t: settings.channelT || 0 },
    };
  },
  /** 병합된 상태를 로컬에 반영. 화면에 보이는 내용이 바뀌었으면 true */
  apply(remote) {
    const before = JSON.stringify(this.snapshot());
    const m = mergeState(this.snapshot(), remote);
    for (const k of Object.keys(progress)) if (!m.progress[k]) delete progress[k];
    Object.assign(progress, m.progress);
    for (const k of Object.keys(words)) if (!m.words[k]) delete words[k];
    Object.assign(words, m.words);
    days.clear();
    m.days.forEach((d) => days.add(d));
    daysT = m.daysT;
    if (m.channel && m.channel.url && (m.channel.t || 0) > (settings.channelT || 0)) {
      settings.channel = m.channel.url;
      settings.recentChannels = m.channel.recent || [];
      settings.channelT = m.channel.t;
      saveSettings();
    }
    store.set('progress', progress);
    store.set('words', words);
    store.set('days', [...days]);
    store.set('daysT', daysT);
    return before !== JSON.stringify(this.snapshot());
  },
  push() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.send(), 800);
  },
  async send() {
    try {
      const res = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.snapshot()),
      });
      if (res.ok) this.apply(await res.json());
    } catch {} // 오프라인이면 다음 기회에
  },
  async pull() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) return;
      const changed = this.apply(await res.json());
      this.send(); // 이 기기에만 있던 기록도 서버로
      // 목록·단어장 화면이면 다른 기기의 변경을 바로 보여 준다 (레슨 도중에는 방해하지 않음)
      const page = location.hash.split('/')[1] || '';
      if (changed && ['', 'words', 'settings'].includes(page) && !document.activeElement?.matches('input')) route();
    } catch {}
  },
};
function streak() {
  let n = 0;
  const d = new Date();
  if (!days.has(d.toLocaleDateString('sv'))) d.setDate(d.getDate() - 1);
  while (days.has(d.toLocaleDateString('sv'))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function applyTheme() {
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = settings.theme;
}
applyTheme();

/* ───────────── 유틸 ───────────── */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shuffle = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}
async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(body.error || `요청 실패 (${res.status})`);
  return { status: res.status, body };
}
const icon = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  slow: '<svg viewBox="0 0 24 24"><path d="M3 17h13a4 4 0 0 0 4-4v0a3 3 0 0 0-3-3h-.5A6.5 6.5 0 0 0 4 12v5"/><circle cx="19" cy="7" r="2"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M18 6 9 12l9 6zM6 6v12"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="m6 6 9 6-9 6zM18 6v12"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  repeatOne: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11 10h1.5v5" stroke-width="2"/></svg>',
};

/* ───────────── 발음: 원어민 신경망 음성(서버) + 기기 음성(대체) ───────────── */
// settings.voice: 'en-US-AriaNeural' 같은 원어민 음성 ID, 또는 'device:<voiceURI>' (기기 내장 음성)
if (settings.voice && !settings.voice.startsWith('device:') && !/Neural$/.test(settings.voice)) settings.voice = '';

const tts = {
  voices: [], // 기기 내장 영어 음성
  audio: new Audio(),
  seq: 0,
  neuralFails: 0,
  load() {
    this.voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  },
  useDevice() {
    return settings.voice.startsWith('device:') || this.neuralFails >= 3;
  },
  deviceVoice() {
    const uri = settings.voice.replace(/^device:/, '');
    return (
      this.voices.find((v) => v.voiceURI === uri) ||
      this.voices.find((v) => v.lang === 'en-US' && /natural|google|samantha|aria|jenny/i.test(v.name)) ||
      this.voices.find((v) => v.lang === 'en-US') ||
      this.voices[0]
    );
  },
  url(text) {
    const v = settings.voice && !settings.voice.startsWith('device:') ? settings.voice : '';
    return `/api/tts?${new URLSearchParams({ v, t: text.slice(0, 600) })}`;
  },
  /** 다음 문장을 미리 받아 두어 반복·연속 재생 사이 끊김을 줄인다 */
  preload(text) {
    if (!text || this.useDevice()) return;
    fetch(this.url(text)).catch(() => {});
  },
  speak(text, { rate = 1, onend } = {}) {
    this.stop();
    const my = ++this.seq;
    const done = () => my === this.seq && onend?.();
    if (this.useDevice()) return this.speakDevice(text, rate, done);
    const a = this.audio;
    a.src = this.url(text);
    a.playbackRate = Math.max(0.5, Math.min(2, settings.rate * rate));
    a.preservesPitch = true;
    a.onended = done;
    a.onerror = () => {
      if (my !== this.seq) return;
      if (++this.neuralFails === 3) toast('원어민 음성 서버에 연결할 수 없어 기기 음성으로 읽어요');
      this.speakDevice(text, rate, done);
    };
    a.play().then(
      () => (this.neuralFails = 0),
      (err) => {
        // 자동 재생 제한 등으로 재생이 막힌 경우 기기 음성으로 대체
        if (my === this.seq && err.name !== 'AbortError') this.speakDevice(text, rate, done);
      },
    );
  },
  speakDevice(text, rate, onend) {
    if (!('speechSynthesis' in window)) return toast('이 브라우저는 음성 재생을 지원하지 않습니다');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.deviceVoice();
    if (v) u.voice = v;
    u.lang = v?.lang || 'en-US';
    u.rate = settings.rate * rate;
    u.onend = onend;
    u.onerror = (e) => e.error !== 'interrupted' && e.error !== 'canceled' && onend();
    speechSynthesis.speak(u);
  },
  stop() {
    this.seq++;
    this.audio.onended = this.audio.onerror = null;
    this.audio.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },
};
if ('speechSynthesis' in window) {
  tts.load();
  speechSynthesis.onvoiceschanged = () => tts.load();
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen() {
  return new Promise((resolve, reject) => {
    if (!Recognition) return reject(new Error('이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome 권장)'));
    const r = new Recognition();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 3;
    let best = '';
    r.onresult = (e) => (best = e.results[0][0].transcript);
    r.onerror = (e) =>
      reject(new Error(e.error === 'not-allowed' ? '마이크 권한을 허용해 주세요 (HTTPS 또는 localhost 필요)' : '음성을 인식하지 못했어요'));
    r.onend = () => resolve(best);
    r.start();
    listen.current = r;
  });
}

/** 목표 문장과 인식 결과를 단어 단위로 맞춰 본다 (LCS) */
function compareSpeech(target, heard) {
  const a = target.split(/\s+/).map(norm);
  const b = heard.split(/\s+/).map(norm).filter(Boolean);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ok = new Array(a.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] && a[i] === b[j]) {
      ok[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const counted = a.filter(Boolean).length || 1;
  return { ok, score: Math.round((ok.filter(Boolean).length / counted) * 100) };
}

/* ───────────── 라우터 ───────────── */
let routeToken = 0;
function route() {
  routeToken++;
  tts.stop();
  player.stop(true);
  closeSheet();
  const hash = location.hash.slice(1) || '/';
  const [, page, id, tab] = hash.split('/');
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.nav === (page || 'home')));
  $app.classList.toggle('immersive', page === 'lesson');
  window.scrollTo(0, 0);
  if (page === 'lesson' && id) return renderLesson(id, tab);
  if (page === 'words') return renderWords(id === 'review');
  if (page === 'settings') return renderSettings();
  renderHome();
}
window.addEventListener('hashchange', route);

/* ───────────── 홈: 채널의 제목 목록 ───────────── */
let channelData = store.get('channel', null);
let homeFilter = '';

async function loadChannel(force) {
  const q = new URLSearchParams({ url: settings.channel });
  if (force) q.set('refresh', '1');
  const { body } = await api('/api/channel?' + q);
  channelData = { ...body, source: settings.channel };
  store.set('channel', channelData);
  return channelData;
}

function storyStatus(v) {
  const p = progress[v.id];
  if (!p?.total) return { cls: '', pct: 0 };
  const pct = Math.round((p.learned.length / p.total) * 100);
  return { cls: pct >= 100 ? 'done' : 'started', pct };
}

function renderHome() {
  const token = routeToken;
  const learnedTotal = Object.values(progress).reduce((n, p) => n + (p.learned?.length || 0), 0);
  const ch = channelData?.source === settings.channel ? channelData : null;

  $view.innerHTML = `
    <div class="eyebrow">English Tales · 이야기로 배우는 영어</div>
    <div class="channel">
      ${ch?.avatar ? `<img src="${esc(ch.avatar)}" alt="" referrerpolicy="no-referrer" />` : ''}
      <div>
        <div class="name">${esc(ch?.title || '채널 불러오는 중…')}</div>
        <div class="muted" style="font-size:13px">${ch ? `이야기 ${ch.videos.length}편${ch.continuation ? '+' : ''}` : esc(settings.channel)}</div>
      </div>
    </div>
    <div class="stats">
      <div class="card stat"><b>${learnedTotal}</b><span>익힌 문장</span></div>
      <div class="card stat"><b>${wordList().length}</b><span>저장한 단어</span></div>
      <div class="card stat"><b>${streak()}일</b><span>연속 학습</span></div>
    </div>
    <label class="search">${icon.search}<input id="q" type="search" placeholder="제목으로 찾기" value="${esc(homeFilter)}" aria-label="제목 검색" /></label>
    <h2 class="section"><span>제목별 학습</span><button class="btn ghost" id="refresh" style="min-height:32px;padding:0 10px;font-size:12.5px">${icon.refresh.replace('<svg', '<svg style="width:16px;height:16px"')} 새로고침</button></h2>
    <div class="stories" id="stories">${ch ? '' : '<div class="skeleton"></div>'.repeat(5)}</div>
    <div id="more"></div>`;

  const paint = () => {
    const data = channelData;
    const list = data.videos.filter((v) => {
      const q = homeFilter.toLowerCase();
      return !q || v.title.toLowerCase().includes(q) || (progress[v.id]?.titleKo || '').includes(homeFilter);
    });
    document.getElementById('stories').innerHTML =
      list
        .map((v) => {
          const idx = data.videos.indexOf(v) + 1;
          const s = storyStatus(v);
          const p = progress[v.id];
          return `<a class="card story ${s.cls}" href="#/lesson/${v.id}" data-title="${esc(v.title)}">
            <div class="num">${idx}</div>
            <div>
              <div class="t">${esc(v.title)}</div>
              ${p?.titleKo ? `<div class="ko">${esc(p.titleKo)}</div>` : ''}
              <div class="meta">
                ${v.duration ? `<span class="chip">${esc(v.duration)}</span>` : ''}
                ${
                  p?.total
                    ? `<span class="chip ${s.cls === 'done' ? 'good' : 'accent'}">${s.cls === 'done' ? '완료' : `${p.learned.length}/${p.total}문장`}</span><div class="bar"><i style="width:${s.pct}%"></i></div>`
                    : '<span class="chip">새 이야기</span>'
                }
              </div>
            </div>
          </a>`;
        })
        .join('') || `<div class="empty">${icon.search}<div>찾는 제목이 없어요</div></div>`;
    document.getElementById('more').innerHTML =
      data.continuation && !homeFilter ? '<button class="btn block" id="loadmore" style="margin-top:14px">이야기 더 불러오기</button>' : '';
    document.getElementById('loadmore')?.addEventListener('click', loadMore);
  };

  async function loadMore(e) {
    e.target.disabled = true;
    e.target.textContent = '불러오는 중…';
    try {
      const { body } = await api('/api/channel/more?token=' + encodeURIComponent(channelData.continuation));
      const seen = new Set(channelData.videos.map((v) => v.id));
      channelData.videos.push(...body.videos.filter((v) => !seen.has(v.id)));
      channelData.continuation = body.continuation;
      store.set('channel', channelData);
      paint();
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
    }
  }

  document.getElementById('q').addEventListener('input', (e) => {
    homeFilter = e.target.value.trim();
    if (channelData) paint();
  });
  const refresh = async (force) => {
    try {
      await loadChannel(force);
      if (token === routeToken) renderHome();
    } catch (err) {
      if (token !== routeToken) return;
      document.getElementById('stories').innerHTML = `<div class="empty">${icon.book}<div>${esc(err.message)}</div>
        <a class="btn" href="#/settings" style="margin-top:12px">채널 설정 확인</a></div>`;
    }
  };
  document.getElementById('refresh').addEventListener('click', () => refresh(true));
  if (ch) paint();
  else refresh(false);
}

/* ───────────── 레슨 ───────────── */
const lessons = new Map();

async function fetchLesson(id, title, onWait) {
  if (lessons.has(id)) return lessons.get(id);
  const token = routeToken;
  for (;;) {
    const { status, body } = await api(`/api/lesson/${id}?title=${encodeURIComponent(title || '')}`);
    if (status === 200) {
      lessons.set(id, body);
      return body;
    }
    if (token !== routeToken) return null;
    onWait(body);
    await new Promise((r) => setTimeout(r, 1500));
    if (token !== routeToken) return null;
  }
}

function titleOf(id) {
  return channelData?.videos.find((v) => v.id === id)?.title || '';
}

async function renderLesson(id, tab) {
  const token = routeToken;
  const title = titleOf(id);
  $view.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/" aria-label="목록으로">${icon.back}</a><div class="title">${esc(title)}</div></div>
    <div class="card loading" id="loading">
      <div class="book">${icon.book}</div>
      <b>학습 자료를 준비하고 있어요</b>
      <div class="bar"><i id="lp" style="width:3%"></i></div>
      <div class="muted" id="ls" style="font-size:13px">자막 확인 중…</div>
      <div class="muted" style="font-size:12px;margin-top:10px">처음 여는 이야기는 자막 추출·해석에 30초~1분 정도 걸려요.<br>한 번 만들면 다음부터는 바로 열립니다.</div>
    </div>`;
  let lesson;
  try {
    lesson = await fetchLesson(id, title, (s) => {
      const lp = document.getElementById('lp');
      if (!lp) return;
      lp.style.width = Math.round((s.progress || 0) * 100) + '%';
      document.getElementById('ls').textContent = s.stage || '';
    });
  } catch (err) {
    if (token !== routeToken) return;
    document.getElementById('loading').innerHTML = `<div class="book">${icon.book}</div><b>학습 자료를 만들지 못했어요</b>
      <p class="muted">${esc(err.message)}</p><button class="btn primary" id="retry">다시 시도</button>`;
    document.getElementById('retry').onclick = route;
    return;
  }
  if (!lesson || token !== routeToken) return;

  const p = (progress[id] ||= { learned: [], total: 0 });
  Object.assign(p, { titleKo: lesson.titleKo, total: lesson.sentences.length, title: lesson.title });
  saveProgress();
  markStudied();

  tab = tab || p.lastTab || 'sentences';
  $view.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/" aria-label="목록으로">${icon.back}</a><div class="title">${esc(lesson.title)}</div></div>
    <div class="lesson-head">
      <div class="eyebrow">${lesson.sentences.length}문장 · 단어 ${lesson.vocab.length} · 표현 ${lesson.expressions.length}${lesson.autoCaptions ? ' · 자동 자막' : ''}</div>
      <h1>${esc(lesson.title)}</h1>
      <p>${esc(lesson.titleKo)}</p>
      ${
        lesson.incomplete
          ? `<div class="card" style="margin-top:12px;padding:12px 14px;display:flex;gap:10px;align-items:center;font-size:13px">
              <span class="grow" style="flex:1">번역 서비스가 바빠서 일부 해석이 비어 있어요.</span>
              <button class="btn" id="regen" style="min-height:36px">해석 다시 받기</button></div>`
          : ''
      }
    </div>
    <div class="tabs" role="tablist">
      ${[
        ['sentences', '문장'],
        ['vocab', '단어'],
        ['expressions', '표현'],
        ['quiz', '퀴즈'],
      ]
        .map(([k, l]) => `<button role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${l}</button>`)
        .join('')}
    </div>
    <section id="pane"></section>`;

  document.getElementById('regen')?.addEventListener('click', async () => {
    await api(`/api/lesson/${id}`, { method: 'DELETE' });
    lessons.delete(id);
    route();
  });

  const showTab = (k) => {
    player.stop(true);
    tts.stop();
    p.lastTab = k;
    saveProgress();
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === k);
      b.setAttribute('aria-selected', b.dataset.tab === k);
    });
    const pane = document.getElementById('pane');
    if (k === 'sentences') paneSentences(pane, lesson, p);
    else if (k === 'vocab') paneVocab(pane, lesson);
    else if (k === 'expressions') paneExpressions(pane, lesson);
    else paneQuiz(pane, lesson, p);
  };
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  showTab(tab);
}

/* 단어가 레슨 단어장 표제어의 활용형인지 대략 판별 */
function vocabFor(lesson, token) {
  const t = norm(token);
  if (t.length < 3) return null;
  return lesson.vocab.find((v) => {
    const l = v.word.toLowerCase();
    if (l.includes(' ')) return false;
    if (t === l) return true;
    const stem = l.length > 4 && /e$/.test(l) ? l.slice(0, -1) : l.length > 4 && /y$/.test(l) ? l.slice(0, -1) : l;
    return stem.length >= 4 && t.startsWith(stem) && t.length - stem.length <= 4;
  });
}

function sentenceHTML(lesson, s) {
  return s.en
    .split(/\s+/)
    .map((w, k) => `<span class="w${vocabFor(lesson, w) ? ' vocab' : ''}" data-k="${k}">${esc(w)}</span>`)
    .join(' ');
}

/* 문장 탭 */
function paneSentences(pane, lesson, p) {
  const learned = new Set(p.learned);
  let hideKo = !settings.showKo;
  pane.innerHTML = `
    <div class="tools">
      <button class="btn" id="toggleKo">${icon.eye} <span>${hideKo ? '해석 보기' : '해석 가리기'}</span></button>
      <span class="grow"></span>
      <span class="chip good" id="learnedCount">${learned.size}/${lesson.sentences.length} 익힘</span>
    </div>
    <div class="kbd-hint" aria-hidden="true">
      <kbd>Space</kbd> 연속 재생 <kbd>←</kbd><kbd>→</kbd> 이전·다음 <kbd>R</kbd> 듣기 <kbd>S</kbd> 천천히 <kbd>O</kbd> 한 문장 반복
      <kbd>M</kbd> 따라 말하기 <kbd>T</kbd> 해석 <kbd>L</kbd> 익힘
    </div>
    <div class="sentences">
      ${lesson.sentences
        .map(
          (s) => `<article class="card sent ${learned.has(s.i) ? 'learned' : ''}" id="s${s.i}" data-i="${s.i}">
          <div class="no"><span>${String(s.i + 1).padStart(2, '0')}</span><span class="check">${learned.has(s.i) ? '✓ 익힘' : ''}</span></div>
          <div class="en">${sentenceHTML(lesson, s)}</div>
          <div class="ko ${hideKo ? 'hidden' : ''}">${esc(s.ko)}</div>
          <div class="actions">
            <button class="icon-btn" data-act="play" aria-label="듣기">${icon.speaker}</button>
            <button class="icon-btn" data-act="slow" aria-label="천천히 듣기">${icon.slow}</button>
            <button class="icon-btn" data-act="loop" aria-label="이 문장 반복 듣기" title="이 문장 반복">${icon.repeatOne}</button>
            <button class="icon-btn" data-act="mic" aria-label="따라 말하기">${icon.mic}</button>
            <button class="icon-btn ${learned.has(s.i) ? 'on' : ''}" data-act="learn" aria-label="익힘 표시">${icon.check}</button>
            <span class="score"></span>
          </div>
          <div class="heard" hidden></div>
        </article>`,
        )
        .join('')}
    </div>`;

  const setLearned = (i, on) => {
    if (on) learned.add(i);
    else learned.delete(i);
    p.learned = [...learned];
    saveProgress(lesson.videoId);
    const el = document.getElementById('s' + i);
    el.classList.toggle('learned', on);
    el.querySelector('.check').textContent = on ? '✓ 익힘' : '';
    el.querySelector('[data-act="learn"]').classList.toggle('on', on);
    document.getElementById('learnedCount').textContent = `${learned.size}/${lesson.sentences.length} 익힘`;
  };

  document.getElementById('toggleKo').onclick = (e) => {
    hideKo = !hideKo;
    pane.querySelectorAll('.sent .ko').forEach((k) => k.classList.toggle('hidden', hideKo));
    e.currentTarget.querySelector('span').textContent = hideKo ? '해석 보기' : '해석 가리기';
  };

  pane.querySelector('.sentences').addEventListener('click', async (e) => {
    const card = e.target.closest('.sent');
    if (!card) return;
    const i = Number(card.dataset.i);
    const s = lesson.sentences[i];
    const ko = e.target.closest('.ko.hidden');
    if (ko) return ko.classList.remove('hidden');
    const w = e.target.closest('.w');
    if (w) return openWordSheet(w.textContent, lesson);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'loop') {
      if (player.playing && player.single && player.i === i) player.stop();
      else {
        player.loopOne(i);
        toast('이 문장을 반복해서 들려줘요 · 다시 누르면 멈춤');
      }
      return;
    }
    if (act === 'play' || act === 'slow') {
      player.stop();
      highlight(i);
      tts.speak(s.en, { rate: act === 'slow' ? 0.65 : 1, onend: () => highlight(-1) });
    } else if (act === 'learn') setLearned(i, !learned.has(i));
    else if (act === 'mic') {
      const btn = e.target.closest('[data-act]');
      if (btn.classList.contains('rec')) return listen.current?.stop();
      player.stop();
      tts.stop();
      btn.classList.add('rec');
      try {
        const heard = await listen();
        const { ok, score } = compareSpeech(s.en, heard);
        card.querySelectorAll('.en .w').forEach((span, k) => {
          span.classList.toggle('ok', ok[k]);
          span.classList.toggle('miss', !ok[k]);
        });
        const h = card.querySelector('.heard');
        h.hidden = false;
        h.textContent = heard ? `들린 문장: “${heard}”` : '아무 말도 들리지 않았어요';
        const sc = card.querySelector('.score');
        sc.textContent = `${score}점`;
        sc.style.color = score >= 80 ? 'var(--good)' : score >= 50 ? 'var(--accent)' : 'var(--bad)';
        if (score >= 80) {
          setLearned(i, true);
          toast(score === 100 ? '완벽해요! 🎉' : '좋아요! 익힌 문장으로 표시했어요');
        }
        markStudied();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.classList.remove('rec');
      }
    }
  });

  player.mount(lesson, (i) => highlight(i, true));
}

function highlight(i, scroll) {
  document.querySelectorAll('.sent.playing').forEach((el) => el.classList.remove('playing'));
  const el = document.getElementById('s' + i);
  if (!el) return;
  el.classList.add('playing');
  if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* 연속 듣기 플레이어 (쉐도잉·반복 듣기)
   - 반복 횟수: 문장마다 1·2·3·5회 또는 '계속'(다음으로 넘어가지 않음)
   - 한 문장 반복: 문장 카드의 🔁 버튼, 멈출 때까지 그 문장만
   - 전체 반복: 마지막 문장 뒤에 처음부터 다시 */
const REPEATS = [
  [1, '1회'],
  [2, '2회'],
  [3, '3회'],
  [5, '5회'],
  [0, '계속'],
];
const player = {
  el: null,
  lesson: null,
  i: 0,
  rep: 0,
  playing: false,
  single: false, // 한 문장 반복 중
  onMove: null,
  timer: null,
  mount(lesson, onMove) {
    this.stop(true);
    this.lesson = lesson;
    this.onMove = onMove;
    this.i = 0;
    const el = document.createElement('div');
    el.className = 'player';
    el.innerHTML = `
      <button class="icon-btn" data-p="prev" aria-label="이전 문장">${icon.prev}</button>
      <button class="icon-btn main" data-p="toggle" aria-label="연속 재생">${icon.play}</button>
      <button class="icon-btn" data-p="next" aria-label="다음 문장">${icon.next}</button>
      <div class="info"><b data-p="mode">연속 듣기</b><span data-p="pos">1 / ${lesson.sentences.length}</span></div>
      <button class="icon-btn ${settings.loopAll ? 'on' : ''}" data-p="loopAll" aria-label="전체 반복" title="전체 반복">${icon.repeat}</button>
      <select data-p="repeat" aria-label="문장마다 반복 횟수" title="문장마다 반복 횟수">
        ${REPEATS.map(([n, l]) => `<option value="${n}" ${settings.repeat == n ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`;
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-p]')?.dataset.p;
      if (a === 'toggle') this.playing ? this.stop() : this.play();
      if (a === 'prev') this.jump(this.i - 1);
      if (a === 'next') this.jump(this.i + 1);
      if (a === 'loopAll') {
        settings.loopAll = !settings.loopAll;
        saveSettings();
        e.target.closest('button').classList.toggle('on', settings.loopAll);
        toast(settings.loopAll ? '전체 반복: 끝까지 들으면 처음부터 다시' : '전체 반복 끔');
      }
    });
    el.querySelector('select').onchange = (e) => {
      settings.repeat = Number(e.target.value);
      saveSettings();
    };
    document.body.appendChild(el);
    this.el = el;
    // 화면에서 직접 누른 문장부터 이어 듣기
    document.querySelector('.sentences')?.addEventListener('click', (e) => {
      const card = e.target.closest('.sent');
      if (card && !this.playing) {
        this.i = Number(card.dataset.i);
        this.update();
      }
    });
    this.update();
  },
  update() {
    if (!this.el) return;
    this.el.querySelector('[data-p="pos"]').textContent =
      `${this.i + 1} / ${this.lesson.sentences.length}` + (this.playing && this.rep > 0 ? ` · ${this.rep + 1}번째` : '');
    this.el.querySelector('[data-p="mode"]').textContent = this.single ? '한 문장 반복 중' : '연속 듣기';
    this.el.querySelector('[data-p="toggle"]').innerHTML = this.playing ? icon.pause : icon.play;
    document.querySelectorAll('.sent.current').forEach((el) => el.classList.remove('current'));
    document.getElementById('s' + this.i)?.classList.add('current');
    document.querySelectorAll('.sent [data-act="loop"]').forEach((b) => {
      b.classList.toggle('on', this.playing && this.single && Number(b.closest('.sent').dataset.i) === this.i);
    });
  },
  jump(i) {
    this.i = Math.max(0, Math.min(this.lesson.sentences.length - 1, i));
    this.rep = 0;
    this.onMove?.(this.i);
    this.update();
    if (this.playing) this.say();
  },
  play() {
    this.playing = true;
    this.rep = 0;
    this.onMove?.(this.i);
    this.update();
    this.say();
    markStudied();
  },
  /** 한 문장만 멈출 때까지 반복 */
  loopOne(i) {
    this.stop();
    this.i = i;
    this.single = true;
    this.play();
  },
  say() {
    clearTimeout(this.timer);
    const s = this.lesson.sentences[this.i];
    tts.preload(this.lesson.sentences[this.i + 1]?.en);
    tts.speak(s.en, {
      onend: () => {
        if (!this.playing) return;
        this.rep++;
        this.update();
        this.timer = setTimeout(() => {
          if (!this.playing) return;
          if (this.single || settings.repeat === 0 || this.rep < settings.repeat) return this.say();
          if (this.i >= this.lesson.sentences.length - 1) return settings.loopAll ? this.jump(0) : this.stop();
          this.jump(this.i + 1);
        }, (settings.gap ?? 0.8) * 1000);
      },
    });
  },
  stop(remove) {
    clearTimeout(this.timer);
    this.playing = false;
    this.single = false;
    this.rep = 0;
    tts.stop();
    if (remove) {
      this.el?.remove();
      this.el = null;
    } else this.update();
  },
};

/* 단어 탭 */
function vocabCard(v, lesson) {
  const saved = hasWord(v.word) && words[v.word];
  const ex = (v.example || '').split(/\s+/).map((w) => (lesson && vocabFor({ vocab: [v] }, w) ? `<mark>${esc(w)}</mark>` : esc(w))).join(' ');
  const exKo = lesson?.sentences?.[v.i]?.ko || v.exampleKo || '';
  return `<article class="card vcard ${saved?.known ? 'known' : ''}" data-word="${esc(v.word)}">
    <div class="head">
      <div class="grow">
        <div class="word">${esc(v.word)}</div>
        <div class="ipa">${esc(v.ipa)} ${v.pos ? `· ${esc(v.pos)}` : ''}</div>
      </div>
      ${v.level ? `<span class="chip accent">${esc(v.level)}</span>` : ''}
      <button class="icon-btn" data-v="say" aria-label="발음 듣기">${icon.speaker}</button>
    </div>
    <div class="mean">${esc(v.ko)}</div>
    ${v.def ? `<div class="def">${esc(v.def)}</div>` : ''}
    ${v.example ? `<div class="ex">${ex}${exKo ? `<small>${esc(exKo)}</small>` : ''}</div>` : ''}
    <div class="foot">
      <button class="btn" data-v="save">${saved ? icon.starFill : icon.star} <span>${saved ? '단어장에 있음' : '단어장에 저장'}</span></button>
      <button class="btn ghost" data-v="ex">${icon.speaker} 예문 듣기</button>
    </div>
  </article>`;
}

function bindVocabActions(root, list, lesson) {
  root.addEventListener('click', (e) => {
    const card = e.target.closest('.vcard');
    const act = e.target.closest('[data-v]')?.dataset.v;
    if (!card || !act) return;
    const v = list().find((x) => x.word === card.dataset.word);
    if (!v) return;
    if (act === 'say') tts.speak(v.word, { rate: 0.85 });
    if (act === 'ex') tts.speak(v.example);
    if (act === 'save') {
      toggleSave(v, lesson);
      card.outerHTML = vocabCard(v, lesson);
    }
  });
}

function toggleSave(v, lesson) {
  if (hasWord(v.word)) {
    words[v.word] = { deleted: true, t: Date.now() };
    toast('단어장에서 뺐어요');
  } else {
    words[v.word] = {
      word: v.word,
      pos: v.pos,
      ipa: v.ipa,
      ko: v.ko,
      def: v.def,
      level: v.level,
      example: v.example,
      exampleKo: lesson?.sentences?.[v.i]?.ko || v.exampleKo || '',
      videoId: lesson?.videoId || v.videoId,
      addedAt: Date.now(),
      known: false,
      t: Date.now(),
    };
    toast('단어장에 저장했어요 ⭐');
  }
  saveWords();
}

function paneVocab(pane, lesson) {
  if (!lesson.vocab.length) return (pane.innerHTML = `<div class="empty">${icon.book}<div>추출된 단어가 없어요</div></div>`);
  pane.innerHTML = `
    <div class="tools">
      <span class="muted grow" style="font-size:13px">문장 속 밑줄 단어를 눌러도 뜻을 볼 수 있어요</span>
      <button class="btn" id="saveAll">${icon.star} 모두 저장</button>
    </div>
    <div class="vocab-list">${lesson.vocab.map((v) => vocabCard(v, lesson)).join('')}</div>`;
  bindVocabActions(pane.querySelector('.vocab-list'), () => lesson.vocab, lesson);
  document.getElementById('saveAll').onclick = () => {
    let n = 0;
    for (const v of lesson.vocab)
      if (!hasWord(v.word)) {
        toggleSave(v, lesson);
        n++;
      }
    toast(n ? `${n}개 단어를 저장했어요` : '이미 모두 저장되어 있어요');
    paneVocab(pane, lesson);
  };
}

/* 표현 탭 */
function paneExpressions(pane, lesson) {
  if (!lesson.expressions.length) {
    pane.innerHTML = `<div class="empty">${icon.book}<div>표현 해설은 Claude 해석 엔진에서 제공돼요.</div>
      <div style="font-size:12.5px;margin-top:6px">서버 .env에 ANTHROPIC_API_KEY를 넣고 레슨을 다시 만들어 보세요.</div></div>`;
    return;
  }
  pane.innerHTML = `<div class="vocab-list">${lesson.expressions
    .map(
      (x, k) => `<article class="card vcard">
      <div class="head"><div class="grow"><div class="word" style="font-size:21px">${esc(x.phrase)}</div></div>
        <button class="icon-btn" data-k="${k}" data-x="say" aria-label="발음 듣기">${icon.speaker}</button></div>
      <div class="mean">${esc(x.ko)}</div>
      <div class="def">${esc(x.note)}</div>
      ${x.example ? `<div class="ex">${esc(x.example)}<small>${esc(lesson.sentences[x.i]?.ko || '')}</small></div>` : ''}
      <div class="foot"><button class="btn ghost" data-k="${k}" data-x="ex">${icon.speaker} 예문 듣기</button></div>
    </article>`,
    )
    .join('')}</div>`;
  pane.onclick = (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    const x = lesson.expressions[b.dataset.k];
    tts.speak(b.dataset.x === 'say' ? x.phrase : x.example, { rate: b.dataset.x === 'say' ? 0.85 : 1 });
  };
}

/* 퀴즈 탭 */
function blankOut(sentence, word) {
  let hit = false;
  const out = sentence
    .split(/\s+/)
    .map((w) => {
      if (!hit && vocabFor({ vocab: [{ word }] }, w)) {
        hit = true;
        const tail = w.match(/[^A-Za-z']+$/)?.[0] || '';
        return `<span class="blank">&nbsp;</span>${esc(tail)}`;
      }
      return esc(w);
    })
    .join(' ');
  return hit ? out : null;
}

function buildQuiz(vocab, expressions = []) {
  const qs = [];
  // 표현 문제: 표현을 보고 뜻 고르기 (최대 3문제)
  if (expressions.length >= 4) {
    for (const x of shuffle(expressions).slice(0, 3)) {
      const opts = shuffle(expressions.filter((o) => o.phrase !== x.phrase && o.ko !== x.ko)).slice(0, 3);
      const v = { word: x.phrase, ko: x.ko, example: x.example };
      qs.push({ type: 'expr', v, prompt: esc(x.phrase), hint: '이 표현의 뜻은?', options: shuffle([x, ...opts].map((o) => o.ko)), answer: x.ko });
    }
  }
  const target = Math.max(10, qs.length + 7);
  for (const v of shuffle(vocab)) {
    const others = shuffle(vocab.filter((o) => o.word !== v.word)).slice(0, 3);
    const withKo = vocab.filter((o) => o.ko && o.word !== v.word);
    const types = ['listen'];
    if (v.ko && withKo.length >= 3) types.push('meaning');
    const blank = v.example && blankOut(v.example, v.word);
    if (blank) types.push('blank', 'blank');
    const type = types[Math.floor(Math.random() * types.length)];
    if (type === 'meaning') {
      const opts = shuffle(withKo).slice(0, 3);
      qs.push({ type, v, prompt: esc(v.word), hint: '알맞은 뜻을 고르세요', options: shuffle([v, ...opts].map((o) => o.ko)), answer: v.ko });
    }
    else if (type === 'listen')
      qs.push({ type, v, prompt: '🔊 듣고 고르기', hint: '들리는 단어를 고르세요 (다시 들으려면 문제를 누르세요)', options: shuffle([v, ...others].map((o) => o.word)), answer: v.word });
    else qs.push({ type, v, prompt: blank, hint: '빈칸에 들어갈 단어는?', options: shuffle([v, ...others].map((o) => o.word)), answer: v.word });
    if (qs.length >= target) break;
  }
  return shuffle(qs);
}

function paneQuiz(pane, lesson, p) {
  if (lesson.vocab.length < 4 && lesson.expressions.length < 4)
    return (pane.innerHTML = `<div class="empty">${icon.book}<div>퀴즈를 만들려면 단어나 표현이 4개 이상 필요해요</div></div>`);
  const qs = buildQuiz(lesson.vocab.length >= 4 ? lesson.vocab : [], lesson.expressions);
  let n = 0;
  let score = 0;
  const wrong = [];

  const show = () => {
    if (n >= qs.length) {
      const pct = Math.round((score / qs.length) * 100);
      p.quiz = Math.max(p.quiz || 0, pct);
      saveProgress(lesson.videoId);
      markStudied();
      pane.innerHTML = `<div class="card result">
        <div class="eyebrow">퀴즈 결과</div><b>${score} / ${qs.length}</b>
        <div class="muted">최고 기록 ${p.quiz}%</div>
        ${wrong.length ? `<p style="margin-top:18px">다시 볼 단어: ${wrong.map((w) => `<span class="chip accent">${esc(w.word)} · ${esc(w.ko)}</span>`).join(' ')}</p>` : '<p>모두 맞혔어요! 🎉</p>'}
        <button class="btn primary" id="again" style="margin-top:12px">다시 풀기</button></div>`;
      document.getElementById('again').onclick = () => paneQuiz(pane, lesson, p);
      return;
    }
    const q = qs[n];
    pane.innerHTML = `<div class="card quiz">
      <div class="progress"><span>${n + 1} / ${qs.length}</span><span>맞힌 문제 ${score}</span></div>
      <div class="bar"><i style="width:${(n / qs.length) * 100}%"></i></div>
      <div class="q" id="qp" ${q.type === 'listen' ? 'style="cursor:pointer"' : ''}>${q.prompt}</div>
      <div class="hint">${q.hint}</div>
      <div class="options">${q.options.map((o) => `<button data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>
    </div>`;
    if (q.type === 'listen') {
      tts.speak(q.v.word, { rate: 0.85 });
      document.getElementById('qp').onclick = () => tts.speak(q.v.word, { rate: 0.85 });
    }
    pane.querySelector('.options').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || pane.querySelector('.options.done')) return;
      pane.querySelector('.options').classList.add('done');
      const right = b.dataset.o === q.answer;
      if (right) score++;
      else wrong.push(q.v);
      pane.querySelectorAll('.options button').forEach((x) => {
        if (x.dataset.o === q.answer) x.classList.add('right');
        else if (x === b) x.classList.add('wrong');
      });
      tts.speak(q.type === 'blank' ? q.v.example : q.v.word, { rate: 0.9 });
      setTimeout(() => {
        n++;
        show();
      }, right ? 900 : 1900);
    };
  };
  show();
}

/* 단어 시트 (문장 속 단어 탭) */
function closeSheet() {
  document.querySelectorAll('.sheet, .sheet-bg').forEach((e) => e.remove());
}
async function openWordSheet(token, lesson) {
  const clean = norm(token).replace(/'s$/, '');
  if (!clean) return;
  tts.speak(clean, { rate: 0.85 });
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.onclick = closeSheet;
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.innerHTML = `<div class="grab"></div><div class="skeleton" style="height:120px"></div>`;
  document.body.append(bg, sheet);

  let v = vocabFor(lesson, token);
  if (!v) {
    try {
      const { body } = await api('/api/define?word=' + encodeURIComponent(clean));
      const s = lesson.sentences.find((x) => x.en.toLowerCase().includes(clean));
      v = { ...body, example: s?.en || '', i: s?.i };
    } catch {
      v = { word: clean, ipa: '', pos: '', ko: '뜻을 찾지 못했어요', def: '' };
    }
  }
  if (!sheet.isConnected) return;
  sheet.innerHTML = `<div class="grab"></div>${vocabCard(v, lesson).replace('card vcard', 'vcard').replace('<article', '<article style="padding:0"')}`;
  bindVocabActions(sheet, () => [v], lesson);
}

/* ───────────── 내 단어장 ───────────── */
function renderWords(review) {
  const list = wordList().sort((a, b) => b.addedAt - a.addedAt);
  if (review) return renderFlashcards(list.filter((w) => !w.known));
  let filter = 'all';
  $view.innerHTML = `
    <div class="eyebrow">My Words</div>
    <h1 class="display">내 단어장</h1>
    <div class="muted">${list.length}개 · 외운 단어 ${list.filter((w) => w.known).length}개</div>
    <div class="tools" style="margin-top:16px">
      <div class="tabs" style="grid-template-columns:repeat(3,1fr);margin:0;flex:1;position:static">
        <button data-f="all" class="on">전체</button><button data-f="learning">학습 중</button><button data-f="known">외움</button>
      </div>
    </div>
    <a class="btn primary block" href="#/words/review" ${list.some((w) => !w.known) ? '' : 'aria-disabled="true" style="pointer-events:none;opacity:.5"'}>플래시카드로 복습하기</a>
    <div class="vocab-list" id="wl" style="margin-top:14px"></div>`;
  const paint = () => {
    const items = list.filter((w) => filter === 'all' || (filter === 'known' ? w.known : !w.known));
    document.getElementById('wl').innerHTML = items.length
      ? items
          .map((w) =>
            vocabCard(w, null).replace(
              '<button class="btn ghost" data-v="ex">',
              `<button class="btn ghost" data-v="known">${icon.check} ${w.known ? '다시 학습' : '외웠어요'}</button><button class="btn ghost" data-v="ex">`,
            ),
          )
          .join('')
      : `<div class="empty">${icon.star}<div>${list.length ? '해당하는 단어가 없어요' : '레슨의 단어 탭에서 ⭐를 눌러 저장해 보세요'}</div></div>`;
  };
  document.querySelector('.tabs').onclick = (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  };
  document.getElementById('wl').addEventListener('click', (e) => {
    const card = e.target.closest('.vcard');
    const act = e.target.closest('[data-v]')?.dataset.v;
    if (!card || !act) return;
    const w = words[card.dataset.word];
    if (!w || w.deleted) return;
    if (act === 'say') tts.speak(w.word, { rate: 0.85 });
    if (act === 'ex') tts.speak(w.example);
    if (act === 'known') {
      w.known = !w.known;
      w.t = Date.now();
      saveWords();
      renderWords();
    }
    if (act === 'save') {
      words[w.word] = { deleted: true, t: Date.now() };
      saveWords();
      toast('단어장에서 뺐어요');
      renderWords();
    }
  });
  paint();
}

function renderFlashcards(deck) {
  deck = shuffle(deck);
  let n = 0;
  const show = () => {
    if (n >= deck.length) {
      $view.innerHTML = `<div class="topbar"><a class="icon-btn" href="#/words" aria-label="단어장으로">${icon.back}</a><div class="title">복습 완료</div></div>
        <div class="card result"><div class="eyebrow">오늘의 복습</div><b>${deck.length}</b><div class="muted">개 단어를 복습했어요</div>
        <a class="btn primary" href="#/words" style="margin-top:16px">단어장으로</a></div>`;
      markStudied();
      return;
    }
    const w = deck[n];
    $view.innerHTML = `
      <div class="topbar"><a class="icon-btn" href="#/words" aria-label="단어장으로">${icon.back}</a><div class="title">플래시카드 ${n + 1} / ${deck.length}</div></div>
      <div class="bar" style="margin:8px 0 14px"><i style="width:${(n / deck.length) * 100}%"></i></div>
      <div class="flash" id="flash"><div class="inner">
        <div class="face front card"><div class="word">${esc(w.word)}</div><div class="ipa">${esc(w.ipa)}</div>
          <div class="muted" style="margin-top:28px;font-size:13px">카드를 눌러 뜻 확인</div></div>
        <div class="face back card"><div class="mean">${esc(w.ko)}</div><div class="def">${esc(w.def)}</div>
          ${w.example ? `<div class="ex">${esc(w.example)}</div>` : ''}</div>
      </div></div>
      <div class="flash-ctl">
        <button class="btn" id="again">다시 볼게요</button>
        <button class="btn primary" id="gotit">${icon.check} 외웠어요</button>
      </div>
      <button class="btn ghost block" id="say" style="margin-top:8px">${icon.speaker} 발음 듣기</button>`;
    tts.speak(w.word, { rate: 0.85 });
    document.getElementById('flash').onclick = (e) => e.currentTarget.classList.toggle('flipped');
    document.getElementById('say').onclick = () => tts.speak(w.word, { rate: 0.85 });
    document.getElementById('again').onclick = () => {
      deck.push(w);
      n++;
      show();
    };
    document.getElementById('gotit').onclick = () => {
      Object.assign(words[w.word], { known: true, t: Date.now() });
      saveWords();
      n++;
      show();
    };
  };
  if (!deck.length) return (location.hash = '#/words');
  show();
}

/* ───────────── 설정 ───────────── */
const isHostPC = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
// 넓은 화면(PC)에서만 QR을 보여 준다 — 휴대폰으로 찍어서 들어가는 용도
const showQR = () => isHostPC() || matchMedia('(min-width: 700px) and (pointer: fine)').matches;
let serverInfo = null; // /api/status 응답 (원어민 음성 목록 등)

/** QR 코드 라이브러리는 PC 설정 화면에서만 필요하므로 그때 불러온다 */
async function drawQR(el, text) {
  try {
    if (!window.qrcode) {
      await new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
        sc.onload = resolve;
        sc.onerror = reject;
        document.head.appendChild(sc);
      });
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    el.remove();
  }
}
function renderSettings() {
  const recent = [DEFAULT_CHANNEL, ...settings.recentChannels].filter((c, i, a) => a.indexOf(c) === i && c !== settings.channel).slice(0, 5);
  $view.innerHTML = `
    <div class="eyebrow">Settings</div>
    <h1 class="display">설정</h1>

    <h2 class="section">유튜브 채널</h2>
    <div class="card form">
      <div class="row"><div class="label">현재 채널<small>${esc(channelData?.source === settings.channel ? channelData.title : '')} ${esc(settings.channel)}</small></div></div>
      <form class="channel-input" id="chForm">
        <input id="ch" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="@채널이름 또는 채널 주소" value="${esc(settings.channel)}" aria-label="유튜브 채널 주소" />
        <button class="btn primary" type="submit">변경</button>
      </form>
      ${recent.length ? `<div class="presets"><span class="muted" style="font-size:12.5px;align-self:center">최근:</span>${recent.map((c) => `<button type="button" data-ch="${esc(c)}">${esc(c.replace(/^https?:\/\/(www\.)?youtube\.com\//, ''))}</button>`).join('')}</div>` : ''}
    </div>
    <p class="muted" style="font-size:12.5px;margin:8px 4px 0">영어 자막이 있는 채널이면 어디든 가능해요. 영상은 불러오지 않고 제목과 자막만 학습 자료로 추출합니다.</p>

    <h2 class="section">발음 (음성)</h2>
    <div class="card form">
      <div class="row"><div class="label">목소리<small>원어민 음성은 실제 사람처럼 자연스럽게 읽어 줘요</small></div><select id="voice"></select></div>
      <div class="row"><div class="label">말하기 속도<small id="rateLabel">${settings.rate.toFixed(2)}배</small></div>
        <input id="rate" type="range" min="0.6" max="1.3" step="0.05" value="${settings.rate}" /></div>
      <div class="row"><div class="label">반복 사이 쉬는 시간<small id="gapLabel">${(settings.gap ?? 0.8).toFixed(1)}초 · 따라 말할 시간을 주려면 늘리세요</small></div>
        <input id="gap" type="range" min="0" max="4" step="0.5" value="${settings.gap ?? 0.8}" /></div>
      <div class="row"><div class="label">미리 듣기</div><button class="btn" id="test">${icon.speaker} 들어보기</button></div>
    </div>

    <h2 class="section">화면</h2>
    <div class="card form">
      <div class="row"><div class="label">해석 기본으로 보이기<small>끄면 해석이 흐리게 가려져요 (눌러서 확인)</small></div>
        <label class="switch"><input id="showKo" type="checkbox" ${settings.showKo ? 'checked' : ''} /><span></span></label></div>
      <div class="row"><div class="label">테마</div>
        <select id="theme">${[['auto', '시스템 설정'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>

    <h2 class="section">PC · 휴대폰 함께 쓰기</h2>
    <div class="card form">
      <div class="row devices">
        <div class="label">
          ${isHostPC() ? '휴대폰에서 열기' : '다른 기기에서 열기'}
          <small id="lanInfo">${
            isHostPC()
              ? '같은 Wi-Fi에서 휴대폰 카메라로 QR 코드를 찍으세요'
              : `이 주소를 휴대폰·PC 어디서나 여세요: <b>${esc(location.origin)}</b>`
          }</small>
          <small>학습 기록·단어장·채널 설정은 기기끼리 자동으로 맞춰집니다.</small>
        </div>
        ${showQR() ? '<div id="qr" class="qr" aria-label="접속 QR 코드"></div>' : ''}
      </div>
      <div class="row"><div class="label">지금 동기화<small id="syncInfo">창으로 돌아올 때마다 자동으로 가져와요</small></div>
        <button class="btn" id="syncNow">${icon.refresh} 동기화</button></div>
    </div>

    <h2 class="section">해석 엔진 · 데이터</h2>
    <div class="card form">
      <div class="row"><div class="label">해석 엔진<small id="engine">확인 중…</small></div></div>
      <div class="row"><div class="label">학습 기록 초기화<small>익힌 문장·단어장·연속 학습일을 이 기기에서 지웁니다</small></div>
        <button class="btn" id="reset" style="color:var(--bad)">초기화</button></div>
    </div>
    <p class="muted" style="font-size:12px;text-align:center;margin-top:24px">English Tales · 학습 기록은 서버를 통해 기기끼리 동기화됩니다</p>`;

  const voiceSel = document.getElementById('voice');
  const fillVoices = () => {
    const neural = serverInfo?.voices || [];
    const cur = settings.voice || serverInfo?.defaultVoice || '';
    voiceSel.innerHTML =
      (neural.length
        ? `<optgroup label="원어민 음성 (추천)">${neural
            .map((v) => `<option value="${esc(v.id)}" ${cur === v.id ? 'selected' : ''}>${esc(v.label)}</option>`)
            .join('')}</optgroup>`
        : '') +
      (tts.voices.length
        ? `<optgroup label="기기 음성 (오프라인)">${tts.voices
            .map((v) => `<option value="device:${esc(v.voiceURI)}" ${cur === 'device:' + v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${v.lang})</option>`)
            .join('')}</optgroup>`
        : '');
  };
  fillVoices();
  if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', fillVoices, { once: true });
  voiceSel.onchange = () => {
    settings.voice = voiceSel.value;
    tts.neuralFails = 0;
    saveSettings();
    tts.speak('Once upon a time, there was a quiet little town.');
  };
  document.getElementById('rate').oninput = (e) => {
    settings.rate = Number(e.target.value);
    document.getElementById('rateLabel').textContent = settings.rate.toFixed(2) + '배';
    saveSettings();
  };
  document.getElementById('gap').oninput = (e) => {
    settings.gap = Number(e.target.value);
    document.getElementById('gapLabel').textContent = `${settings.gap.toFixed(1)}초 · 따라 말할 시간을 주려면 늘리세요`;
    saveSettings();
  };
  document.getElementById('test').onclick = () => tts.speak('Once upon a time, there was a quiet little town.');
  document.getElementById('showKo').onchange = (e) => {
    settings.showKo = e.target.checked;
    saveSettings();
  };
  document.getElementById('theme').onchange = (e) => {
    settings.theme = e.target.value;
    saveSettings();
    applyTheme();
  };
  document.getElementById('reset').onclick = () => {
    if (!confirm('학습 기록과 단어장을 모두 지울까요?')) return;
    // 지운 기록이 다른 기기에서 되살아나지 않도록 '지움' 표시를 남긴다
    const now = Date.now();
    for (const k of Object.keys(progress)) progress[k] = { ...progress[k], learned: [], quiz: 0, t: now };
    for (const k of Object.keys(words)) words[k] = { deleted: true, t: now };
    days.clear();
    daysT = now;
    store.set('days', []);
    store.set('daysT', daysT);
    saveProgress();
    saveWords();
    toast('초기화했어요 (PC·휴대폰 모두 적용)');
  };

  const change = async (url) => {
    const btn = document.querySelector('#chForm button');
    btn.disabled = true;
    btn.textContent = '확인 중…';
    const prev = settings.channel;
    settings.channel = url.trim();
    try {
      const data = await loadChannel(true);
      settings.recentChannels = [prev, ...settings.recentChannels.filter((c) => c !== prev && c !== settings.channel)].slice(0, 6);
      settings.channelT = Date.now();
      saveSettings();
      sync.push();
      toast(`채널 변경: ${data.title} · 이야기 ${data.videos.length}편`);
      location.hash = '#/';
    } catch (err) {
      settings.channel = prev;
      toast(err.message);
      btn.disabled = false;
      btn.textContent = '변경';
    }
  };
  document.getElementById('chForm').onsubmit = (e) => {
    e.preventDefault();
    const v = document.getElementById('ch').value;
    if (v.trim()) change(v);
  };
  document.querySelector('.presets')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (b) change(b.dataset.ch);
  });

  document.getElementById('syncNow').onclick = async () => {
    await sync.pull();
    document.getElementById('syncInfo').textContent = '방금 동기화했어요 · ' + new Date().toLocaleTimeString();
  };

  api('/api/status')
    .then(({ body }) => {
      serverInfo = body;
      fillVoices();
      const qr = document.getElementById('qr');
      if (qr && !isHostPC()) drawQR(qr, location.origin);
      else if (qr && body.lanUrl) {
        document.getElementById('lanInfo').innerHTML = `같은 Wi-Fi에서 QR 코드를 찍거나 <b>${esc(body.lanUrl)}</b> 로 접속하세요`;
        drawQR(qr, body.lanUrl);
      } else if (qr) {
        qr.remove();
        document.getElementById('lanInfo').textContent = '네트워크 주소를 찾지 못했어요. PC가 Wi-Fi/랜에 연결되어 있는지 확인하세요.';
      }
      document.getElementById('engine').textContent = body.claude
        ? 'Claude — 자연스러운 해석 + 단어·표현 해설'
        : '기본 모드 — 무료 번역 + 사전 (서버에 ANTHROPIC_API_KEY를 설정하면 Claude 사용)';
    })
    .catch(() => (document.getElementById('engine').textContent = '서버에 연결할 수 없어요 (오프라인)'));
}

/* ───────────── 시작 ───────────── */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
/* ───────────── PC 키보드 단축키 ───────────── */
function clickIf(sel) {
  const el = document.querySelector(sel);
  if (el) el.click();
  return Boolean(el);
}
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, select, textarea, [contenteditable]')) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const page = location.hash.split('/')[1] || '';

  if (key === 'Escape') {
    if (document.querySelector('.sheet')) return closeSheet();
    if (page === 'lesson') location.hash = '#/';
    else if (location.hash.startsWith('#/words/review')) location.hash = '#/words';
    return;
  }
  if (document.querySelector('.sheet')) return;

  if (page === '' && key === '/') {
    e.preventDefault();
    document.getElementById('q')?.focus();
    return;
  }

  // 플래시카드: Space 뒤집기, ← 다시, → 외웠어요, P 발음
  if (page === 'words' && document.getElementById('flash')) {
    const map = { ' ': '#flash', Enter: '#flash', ArrowLeft: '#again', ArrowRight: '#gotit', p: '#say' };
    if (map[key] && clickIf(map[key])) e.preventDefault();
    return;
  }

  if (page !== 'lesson') return;
  // 퀴즈: 1~4로 보기 선택, Space로 다시 듣기
  const options = document.querySelectorAll('.options:not(.done) button');
  if (options.length) {
    if (/^[1-4]$/.test(key) && options[key - 1]) {
      options[key - 1].click();
      e.preventDefault();
    } else if (key === ' ' && clickIf('#qp')) e.preventDefault();
    return;
  }
  // 문장 탭: 현재 문장(테두리 표시)에 대해 동작
  if (player.el) {
    const cur = `#s${player.i}`;
    const actions = {
      ' ': () => player.el.querySelector('[data-p="toggle"]').click(),
      ArrowRight: () => player.jump(player.i + 1),
      ArrowLeft: () => player.jump(player.i - 1),
      r: () => clickIf(`${cur} [data-act="play"]`),
      s: () => clickIf(`${cur} [data-act="slow"]`),
      o: () => clickIf(`${cur} [data-act="loop"]`),
      m: () => clickIf(`${cur} [data-act="mic"]`),
      l: () => clickIf(`${cur} [data-act="learn"]`),
      t: () => clickIf('#toggleKo'),
    };
    if (actions[key]) {
      e.preventDefault();
      actions[key]();
      if (key === 'ArrowRight' || key === 'ArrowLeft')
        document.getElementById('s' + player.i)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
});

// 다른 기기에서 공부한 기록을 창으로 돌아올 때마다 가져온다
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync.pull());
window.addEventListener('focus', () => sync.pull());

route();
sync.pull();
