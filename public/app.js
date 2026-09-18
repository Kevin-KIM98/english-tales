// English Tales — 유튜브 이야기 채널 자막으로 공부하는 안드로이드 학습 앱
// 서버 없이 휴대폰 안에서 채널 목록·자막·해석·단어를 모두 처리한다.
import { getChannel, getMoreVideos } from './lib/youtube.js';
import { buildLesson, getLesson, refillLesson, upgradeLesson, upgradeAllLessons, basicLessonIds, missingCount, jobOf, prefetch, onJobsChange } from './lib/lessons.js';
import { define } from './lib/enrich.js';
import { findTraps } from './lib/expressions.js';
import { resumeIndex } from './lib/study.js';
import { setEngine, engineReady, checkKey, KEY_HELP } from './lib/llm.js';
import { createTTS } from './lib/tts.js';
import { db } from './lib/db.js';
import { checkUpdate, applyUpdate, prepareWebUpdate, markAppReady, appInfo, openDownload } from './lib/update.js';
import { isNative } from './lib/net.js';

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
  { channel: DEFAULT_CHANNEL, voice: '', rate: 0.95, showKo: true, theme: 'auto', repeat: 1, gap: 0.8, loopAll: false, autoPrepare: true, sort: 'new', recentChannels: [], llmOn: false, llmKey: '', llmModel: '' },
  store.get('settings', {}),
);
const saveSettings = () => {
  store.set('settings', settings);
  applyEngine();
};
// 해석 엔진(LLM) 설정을 번역 쪽에 알려 준다 — 키는 이 휴대폰에만 저장된다
const applyEngine = () => setEngine({ on: settings.llmOn, key: settings.llmKey, model: settings.llmModel });
applyEngine();
// 학습 기록은 이 휴대폰에 저장된다
const progress = store.get('progress', {}); // videoId → { titleKo, total, learned: [], quiz, lastTab, t }
const words = store.get('words', {}); // word → { ...vocab, videoId, addedAt, known, t } | { deleted: true, t }
const days = new Set(store.get('days', []));

function saveProgress(id) {
  if (id && progress[id]) progress[id].t = Date.now();
  store.set('progress', progress);
}
function saveWords() {
  store.set('words', words);
}
const hasWord = (w) => Boolean(words[w] && !words[w].deleted);
const wordList = () => Object.values(words).filter((w) => !w.deleted);

function markStudied() {
  const d = new Date().toLocaleDateString('sv');
  if (!days.has(d)) {
    days.add(d);
    store.set('days', [...days].slice(-400));
  }
}

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

/* ───────────── 발음: 안드로이드 TTS (개발 브라우저에서는 Web Speech) ───────────── */
const tts = createTTS(() => settings, (m) => toast(m));

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

/* ───────────── 홈: 채널의 제목 목록 + 새 영상 자동 가져오기 ───────────── */
let channelData = store.get('channel', null);
let homeFilter = '';
const known = store.get('known', {}); // 채널 → 지금까지 본 영상 ID 목록 (새 영상 판별용)
const newIds = new Set(store.get('newIds', [])); // 아직 열어 보지 않은 새 영상
let lastCheck = 0;
let checking = null;
let updateInfo = null; // { version, kind: 'web'|'apk', … } 새 버전 정보
let updateReady = false; // 새 코드를 이미 받아 둠 (다음 실행 때 자동 적용)

/** 업데이트 실행: 웹 코드는 받아서 바로 적용(앱이 새로 뜸), 네이티브 변경은 APK 내려받기 */
async function runUpdate(btn) {
  if (!updateInfo) return;
  const label = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    if (updateInfo.kind === 'apk') toast('새 설치 파일을 내려받아요. 다 받으면 설치를 누르세요');
    await applyUpdate(updateInfo, (pct) => btn && (btn.textContent = `받는 중 ${Math.round(pct)}%`));
  } catch (err) {
    toast('업데이트하지 못했어요: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
}

const updateText = (u) =>
  u.kind === 'web'
    ? updateReady
      ? '새 버전을 받아 두었어요 · 누르면 바로 적용 (다음에 앱을 열 때 자동 적용)'
      : '누르면 앱 안에서 바로 업데이트돼요'
    : "새 설치 파일이 필요한 업데이트예요 · 내려받은 뒤 '설치'를 누르세요";

/**
 * 채널의 최신 목록을 가져와 저장된 목록과 합친다.
 * @returns {Promise<{ data: object, fresh: object[] }>} fresh = 새로 올라온 영상
 */
async function loadChannel() {
  const data = await getChannel(settings.channel);
  const source = settings.channel;
  // '더 불러오기'로 받아 둔 예전 영상은 유지하고, 최신 목록을 앞에 둔다
  const old = channelData?.source === source ? channelData.videos : [];
  const firstIds = new Set(data.videos.map((v) => v.id));
  // 예전에 정확한 날짜(RSS)를 받아 둔 영상은 그 날짜를 유지
  const oldById = new Map(old.map((v) => [v.id, v]));
  for (const v of data.videos) {
    const o = oldById.get(v.id);
    if (o?.exact && !v.exact) Object.assign(v, { published: o.published, exact: true });
    else if (!v.published && o?.published) v.published = o.published;
    // 한 번 확인한 진짜 제목은 A/B 테스트용 제목으로 덮어쓰지 않는다
    if (o?.titleExact && !v.titleExact) Object.assign(v, { title: o.title, titleExact: true });
  }
  const videos = [...data.videos, ...old.filter((v) => !firstIds.has(v.id))];
  const seen = known[source] ? new Set(known[source]) : null;
  const fresh = seen ? data.videos.filter((v) => !seen.has(v.id)) : [];
  fresh.forEach((v) => newIds.add(v.id));
  known[source] = [...new Set([...(known[source] || []), ...videos.map((v) => v.id)])].slice(-2000);
  channelData = { ...data, videos, continuation: channelData?.source === source && old.length > data.videos.length ? channelData.continuation : data.continuation, source, checkedAt: Date.now() };
  store.set('channel', channelData);
  store.set('known', known);
  store.set('newIds', [...newIds]);
  return { data: channelData, fresh };
}

/**
 * 새 영상 확인. 앱 시작·앱으로 돌아옴·당겨서 새로고침·새로고침 버튼에서 호출된다.
 * auto=true 인 자동 확인은 1분에 한 번까지만.
 */
function refreshChannel({ auto = false } = {}) {
  if (checking) return checking;
  if (auto && Date.now() - lastCheck < 60_000) return Promise.resolve(null);
  lastCheck = Date.now();
  const onHome = () => (location.hash.split('/')[1] || '') === '';
  setRefreshing(true);
  checking = loadChannel()
    .then(({ fresh }) => {
      if (fresh.length) {
        toast(`새 이야기 ${fresh.length}편을 가져왔어요`);
        if (settings.autoPrepare) prefetchLessons(fresh.slice(0, 3));
      } else if (!auto) toast('새로 올라온 이야기가 없어요');
      if (onHome()) renderHome();
      return fresh;
    })
    .catch((err) => {
      if (!auto || !channelData) toast(err.message);
      if (onHome() && !channelData) renderHome(err);
      return null;
    })
    .finally(() => {
      checking = null;
      setRefreshing(false);
    });
  return checking;
}

/** 새 영상의 학습 자료를 뒤에서 미리 만들어 둔다 */
function prefetchLessons(videos) {
  prefetch(videos, (v, lesson) => {
    const p = (progress[v.id] ||= { learned: [], total: 0 });
    Object.assign(p, { titleKo: lesson.titleKo, total: lesson.sentences.length, title: lesson.title });
    saveProgress();
    if ((location.hash.split('/')[1] || '') === '') renderHome();
  });
}

// 뒤에서 학습 자료를 만들기 시작·완료하면 목록의 상태 표시를 바로 바꾼다
onJobsChange(() => {
  if ((location.hash.split('/')[1] || '') === '' && !document.activeElement?.matches('input')) renderHome();
});

function setRefreshing(on) {
  document.getElementById('ptr')?.classList.toggle('spin', on);
  const btn = document.getElementById('refresh');
  if (btn) btn.disabled = on;
}

/** 올린 날짜순 정렬 (settings.sort: 'new' 최신순 | 'old' 오래된순). 날짜를 모르는 영상은 원래 순서대로 뒤에 */
function sortVideos(videos) {
  const dir = settings.sort === 'old' ? 1 : -1;
  return videos
    .map((v, k) => ({ v, k }))
    .sort((a, b) => {
      const pa = a.v.published;
      const pb = b.v.published;
      if (pa && pb && pa !== pb) return (pa - pb) * dir;
      if (!pa !== !pb) return pa ? -1 : 1;
      return a.k - b.k;
    })
    .map((x) => x.v);
}

/** 날짜 표시: 최근 1주는 'N일 전', 그 외 '9월 15일' (다른 해면 연도 포함, 추정 날짜는 '약') */
function dateLabel(v) {
  if (!v.published) return '';
  const d = new Date(v.published);
  const days = Math.floor((Date.now() - v.published) / 864e5);
  if (days < 1 && v.exact) return '오늘';
  if (days < 7) return `${Math.max(days, 1)}일 전`;
  const now = new Date();
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  const text = d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
  return v.exact ? text : `약 ${text}`;
}

function storyStatus(v) {

  const p = progress[v.id];
  if (!p?.total) return { cls: '', pct: 0 };
  const pct = Math.round((p.learned.length / p.total) * 100);
  return { cls: pct >= 100 ? 'done' : 'started', pct };
}

function renderHome(error) {
  const learnedTotal = Object.values(progress).reduce((n, p) => n + (p.learned?.length || 0), 0);
  const ch = channelData?.source === settings.channel ? channelData : null;
  const checked = ch?.checkedAt ? new Date(ch.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  $view.innerHTML = `
    <div id="ptr" class="ptr" aria-hidden="true">${icon.refresh}</div>
    ${
      updateInfo
        ? `<div class="card update-banner"><div><b>새 버전 ${esc(updateInfo.version)}</b><small>${esc(updateText(updateInfo))}</small></div>
            <button class="btn primary" id="doUpdate">업데이트</button></div>`
        : ''
    }
    <div class="eyebrow">English Tales · 이야기로 배우는 영어</div>
    <div class="channel">
      ${ch?.avatar ? `<img src="${esc(ch.avatar)}" alt="" referrerpolicy="no-referrer" />` : ''}
      <div>
        <div class="name">${esc(ch?.title || '채널 불러오는 중…')}</div>
        <div class="muted" style="font-size:13px">${ch ? `이야기 ${ch.videos.length}편${ch.continuation ? '+' : ''}${checked ? ` · ${checked} 확인` : ''}` : esc(settings.channel)}</div>
      </div>
    </div>
    <div class="stats">
      <div class="card stat"><b>${learnedTotal}</b><span>익힌 문장</span></div>
      <div class="card stat"><b>${wordList().length}</b><span>저장한 단어</span></div>
      <div class="card stat"><b>${streak()}일</b><span>연속 학습</span></div>
    </div>
    <label class="search">${icon.search}<input id="q" type="search" placeholder="제목으로 찾기" value="${esc(homeFilter)}" aria-label="제목 검색" /></label>
    <div class="sortbar" role="group" aria-label="정렬">
      <button data-sort="new" class="${settings.sort !== 'old' ? 'on' : ''}">최신순</button>
      <button data-sort="old" class="${settings.sort === 'old' ? 'on' : ''}">오래된순</button>
    </div>
    <h2 class="section"><span>제목별 학습 ${newIds.size ? `<span class="chip new">NEW ${newIds.size}</span>` : ''}</span>
      <button class="btn ghost" id="refresh" style="min-height:32px;padding:0 10px;font-size:12.5px">${icon.refresh.replace('<svg', '<svg style="width:16px;height:16px"')} 새 영상 확인</button></h2>
    <div class="stories" id="stories">${
      ch ? '' : error ? `<div class="empty">${icon.book}<div>${esc(error.message)}</div><a class="btn" href="#/settings" style="margin-top:12px">채널 설정 확인</a></div>` : '<div class="skeleton"></div>'.repeat(5)
    }</div>
    <div id="more"></div>`;

  const paint = () => {
    const data = channelData;
    const sorted = sortVideos(data.videos);
    const list = sorted.filter((v) => {
      const q = homeFilter.toLowerCase();
      return !q || displayTitle(v).toLowerCase().includes(q) || v.title.toLowerCase().includes(q) || (progress[v.id]?.titleKo || '').includes(homeFilter);
    });
    document.getElementById('stories').innerHTML =
      list
        .map((v) => {
          const idx = sorted.indexOf(v) + 1;
          const s = storyStatus(v);
          const p = progress[v.id];
          const status = jobOf(v.id)
            ? '<span class="chip accent">학습 자료 준비 중…</span>'
            : p?.total && p.learned.length
              ? `<span class="chip ${s.cls === 'done' ? 'good' : 'accent'}">${s.cls === 'done' ? '완료' : `${p.learned.length}/${p.total}문장`}</span><div class="bar"><i style="width:${s.pct}%"></i></div>`
              : p?.total
                ? '<span class="chip good">학습 자료 준비됨</span>'
                : '<span class="chip">새 이야기</span>';
          return `<a class="card story ${s.cls} ${newIds.has(v.id) ? 'is-new' : ''}" href="#/lesson/${v.id}">
            <div class="num">${idx}</div>
            <div>
              <div class="t">${newIds.has(v.id) ? '<span class="chip new">NEW</span> ' : ''}${esc(displayTitle(v))}</div>
              ${p?.titleKo ? `<div class="ko">${esc(p.titleKo)}</div>` : ''}
              <div class="meta">${dateLabel(v) ? `<span class="chip date">${esc(dateLabel(v))}</span>` : ''}${v.duration ? `<span class="chip">${esc(v.duration)}</span>` : ''}${status}</div>
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
      const more = await getMoreVideos(channelData.continuation);
      const seen = new Set(channelData.videos.map((v) => v.id));
      channelData.videos.push(...more.videos.filter((v) => !seen.has(v.id)));
      channelData.continuation = more.continuation;
      known[channelData.source] = [...new Set([...(known[channelData.source] || []), ...more.videos.map((v) => v.id)])];
      store.set('channel', channelData);
      store.set('known', known);
      paint();
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
    }
  }

  document.getElementById('q').addEventListener('input', (e) => {
    homeFilter = e.target.value.trim();
    if (channelData?.source === settings.channel) paint();
  });
  document.getElementById('refresh').addEventListener('click', () => refreshChannel());
  document.querySelector('.sortbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b || settings.sort === b.dataset.sort) return;
    settings.sort = b.dataset.sort;
    saveSettings();
    document.querySelectorAll('.sortbar button').forEach((x) => x.classList.toggle('on', x === b));
    if (channelData?.source === settings.channel) paint();
  });
  document.getElementById('doUpdate')?.addEventListener('click', (e) => runUpdate(e.currentTarget));
  if (checking) setRefreshing(true);
  if (ch) paint();
  else if (!error) refreshChannel();
}

/* 당겨서 새로고침: 목록 맨 위에서 아래로 끌었다 놓으면 새 영상 확인 */
(() => {
  let startY = null;
  let dy = 0;
  const onHome = () => (location.hash.split('/')[1] || '') === '';
  window.addEventListener('touchstart', (e) => {
    startY = onHome() && window.scrollY <= 0 && !document.querySelector('.sheet') ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    const ptr = document.getElementById('ptr');
    if (ptr) {
      ptr.style.transform = `translate(-50%, ${Math.min(dy * 0.5, 70)}px) rotate(${dy * 2}deg)`;
      ptr.style.opacity = Math.min(1, dy / 80);
    }
  }, { passive: true });
  window.addEventListener('touchend', () => {
    const ptr = document.getElementById('ptr');
    if (ptr) {
      ptr.style.transform = '';
      ptr.style.opacity = '';
    }
    if (startY !== null && dy > 90) refreshChannel();
    startY = null;
  });
})();

/* ───────────── 레슨 ───────────── */
const lessons = new Map();

async function fetchLesson(id, title, onWait) {
  if (lessons.has(id)) return lessons.get(id);
  const lesson = (await getLesson(id)) || (await buildLesson(id, title, onWait));
  lessons.set(id, lesson);
  return lesson;
}

/** 화면에 보여 줄 제목: 학습 자료(영상 정보의 진짜 제목) > RSS 제목 > 채널 목록 제목 */
function displayTitle(v) {
  return progress[v.id]?.title || v.title;
}

function titleOf(id) {
  const v = channelData?.videos.find((x) => x.id === id);
  return progress[id]?.title || v?.title || '';
}

/** '문장 12개 · 단어 뜻 3개가' 처럼 비어 있는 곳을 알려 준다 */
function missingText(m) {
  const parts = [];
  if (m.title) parts.push('제목');
  if (m.sentences) parts.push(`문장 ${m.sentences}개`);
  if (m.vocab) parts.push(`단어 뜻 ${m.vocab}개`);
  return parts.length ? `${parts.join(' · ')} 해석이` : '일부 해석이';
}

async function renderLesson(id, tab) {
  const token = routeToken;
  const title = titleOf(id);
  if (newIds.delete(id)) store.set('newIds', [...newIds]);
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
  const gaps = missingCount(lesson); // 저장해 둔 표시 대신 실제로 빈 곳을 센다 (예전 레슨도 다시 채울 수 있게)
  $view.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/" aria-label="목록으로">${icon.back}</a><div class="title">${esc(lesson.title)}</div></div>
    <div class="lesson-head">
      <div class="eyebrow">${lesson.sentences.length}문장 · 단어 ${lesson.vocab.length} · 표현 ${lesson.expressions.length}${lesson.autoCaptions ? ' · 자동 자막' : ''}</div>
      <h1>${esc(lesson.title)}</h1>
      <p>${esc(lesson.titleKo)}</p>
      ${
        gaps.total
          ? `<div class="card" id="gapCard" style="margin-top:12px;padding:12px 14px;display:flex;gap:10px;align-items:center;font-size:13px">
              <span class="grow" id="gapMsg" style="flex:1">번역 서비스가 바빠서 ${missingText(gaps)} 비어 있어요.</span>
              <button class="btn" id="regen" style="min-height:36px">해석 다시 받기</button></div>`
          : ''
      }
      ${
        engineReady() && lesson.engine === 'basic'
          ? `<div class="card" id="upCard" style="margin-top:12px;padding:12px 14px;display:flex;gap:10px;align-items:center;font-size:13px">
              <span class="grow" id="upMsg" style="flex:1">이 이야기는 무료 번역기로 해석했어요. LLM 으로 다시 해석하면 더 자연스러워져요.</span>
              <button class="btn" id="upgrade" style="min-height:36px">다시 해석</button></div>`
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

  // 비어 있는 해석만 다시 받는다 — 이미 받아 둔 해석·단어·표현은 그대로 둔다
  document.getElementById('regen')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const msg = document.getElementById('gapMsg');
    btn.disabled = true;
    const show = (t) => msg && (msg.textContent = t);
    const step = (p) => show(`해석을 다시 받는 중… ${Math.min(gaps.total, Math.round(p * gaps.total))}/${gaps.total}`);
    step(0);
    try {
      const { filled, left } = await refillLesson(id, step);
      if (token !== routeToken) return;
      lessons.delete(id);
      await renderLesson(id, tab);
      if (token !== routeToken) return;
      if (!left) toast('해석을 모두 채웠어요.');
      else toast(filled ? `${filled}군데 채웠어요. ${left}군데는 아직 비어 있어요.` : '번역 서비스가 아직 바빠요. 잠시 뒤 다시 눌러 주세요.');
    } catch (err) {
      if (token !== routeToken) return;
      btn.disabled = false;
      show(`해석을 받지 못했어요 (${err.message}). 잠시 뒤 다시 눌러 주세요.`);
    }
  });

  let firstPane = true; // 레슨을 연 직후 한 번만 '이어서 공부해요' 안내
  // 무료 번역기로 만든 이야기를 해석 엔진(LLM)으로 다시 해석
  document.getElementById('upgrade')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const msg = document.getElementById('upMsg');
    btn.disabled = true;
    const show = (t) => msg && (msg.textContent = t);
    const total = lesson.sentences.length;
    show('다시 해석하는 중… 0/' + total);
    try {
      await upgradeLesson(id, (p) => show(`다시 해석하는 중… ${Math.min(total, Math.round(p * total))}/${total}`));
      if (token !== routeToken) return;
      lessons.delete(id);
      await renderLesson(id, tab);
      if (token === routeToken) toast('LLM 해석으로 바꿨어요');
    } catch (err) {
      if (token !== routeToken) return;
      btn.disabled = false;
      show(`다시 해석하지 못했어요 (${err.message})`);
    }
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
    if (k === 'sentences') paneSentences(pane, lesson, p, firstPane);
    else if (k === 'vocab') paneVocab(pane, lesson);
    else if (k === 'expressions') paneExpressions(pane, lesson);
    else paneQuiz(pane, lesson, p);
    firstPane = false;
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

/** 무료 번역기가 직역해 버리는 표현은 문장 아래에 뜻을 따로 짚어 준다 */
function tipsHTML(en) {
  return findTraps(en)
    .map((t) => `<div class="tip"><b>${esc(t.phrase)}</b> ${esc(t.ko)}</div>`)
    .join('');
}

function sentenceHTML(lesson, s) {
  return s.en
    .split(/\s+/)
    .map((w, k) => `<span class="w${vocabFor(lesson, w) ? ' vocab' : ''}" data-k="${k}">${esc(w)}</span>`)
    .join(' ');
}

/* 문장 탭 */
function paneSentences(pane, lesson, p, announce) {
  const learned = new Set(p.learned);
  const start = resumeIndex(lesson.sentences.length, learned);
  let hideKo = !settings.showKo;
  pane.innerHTML = `
    <div class="tools">
      <button class="btn" id="toggleKo">${icon.eye} <span>${hideKo ? '해석 보기' : '해석 가리기'}</span></button>
      <button class="btn" id="voicePick" aria-label="영어 목소리 고르기">${icon.speaker} 목소리</button>
      <span class="grow"></span>
      <span class="chip good" id="learnedCount">${learned.size}/${lesson.sentences.length} 익힘</span>
    </div>
    <div class="kbd-hint" aria-hidden="true">
      <kbd>Space</kbd> 연속 재생 <kbd>←</kbd><kbd>→</kbd> 이전·다음 <kbd>R</kbd> 듣기 <kbd>S</kbd> 천천히 <kbd>O</kbd> 한 문장 반복
      <kbd>T</kbd> 해석 <kbd>L</kbd> 익힘
    </div>
    <div class="sentences">
      ${lesson.sentences
        .map(
          (s) => `<article class="card sent ${learned.has(s.i) ? 'learned' : ''}" id="s${s.i}" data-i="${s.i}">
          <div class="no"><span>${String(s.i + 1).padStart(2, '0')}</span><span class="check">${learned.has(s.i) ? '✓ 익힘' : ''}</span></div>
          <div class="en">${sentenceHTML(lesson, s)}</div>
          <div class="ko ${hideKo ? 'hidden' : ''}">${esc(s.ko)}</div>
          ${tipsHTML(s.en)}
          <div class="actions">
            <button class="icon-btn" data-act="play" aria-label="듣기">${icon.speaker}</button>
            <button class="icon-btn" data-act="slow" aria-label="천천히 듣기">${icon.slow}</button>
            <button class="icon-btn" data-act="loop" aria-label="이 문장 반복 듣기" title="이 문장 반복">${icon.repeatOne}</button>
            <button class="icon-btn ${learned.has(s.i) ? 'on' : ''}" data-act="learn" aria-label="익힘 표시">${icon.check}</button>
          </div>
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

  document.getElementById('voicePick').onclick = () => {
    player.stop();
    openVoiceSheet();
  };
  document.getElementById('toggleKo').onclick = (e) => {
    hideKo = !hideKo;
    pane.querySelectorAll('.sent .ko, .sent .tip').forEach((k) => k.classList.toggle('hidden', hideKo));
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
  });

  player.mount(lesson, (i) => highlight(i, true), start);
  if (start > 0) {
    document.getElementById('s' + start)?.scrollIntoView({ block: 'center' });
    if (announce) toast(`${start + 1}번 문장부터 이어서 공부해요`);
  }
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
  mount(lesson, onMove, startAt = 0) {
    this.stop(true);
    this.lesson = lesson;
    this.onMove = onMove;
    this.i = startAt;
    const el = document.createElement('div');
    el.className = 'player';
    el.innerHTML = `
      <button class="icon-btn" data-p="prev" aria-label="이전 문장">${icon.prev}</button>
      <button class="icon-btn main" data-p="toggle" aria-label="연속 재생">${icon.play}</button>
      <button class="icon-btn" data-p="next" aria-label="다음 문장">${icon.next}</button>
      <div class="info"><b data-p="mode">연속 듣기</b><span data-p="pos">${this.i + 1} / ${lesson.sentences.length}</span></div>
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
    pane.innerHTML = `<div class="empty">${icon.book}<div>이 이야기에서는 찾은 표현이 없어요.</div>
      <div style="font-size:12.5px;margin-top:6px">구동사·관용 표현이 나오면 여기에 뜻과 예문이 모입니다.</div></div>`;
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
/** 영어 목소리 고르기: 억양(지역)별 목록, ▶ 로 미리 듣고 눌러서 선택 */
const VOICE_SAMPLE = 'Once upon a time, there was a quiet little town by the sea.';
async function openVoiceSheet(onChange) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.onclick = () => {
    tts.stop();
    closeSheet();
  };
  const sheet = document.createElement('div');
  sheet.className = 'sheet voice-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', '영어 목소리 고르기');
  sheet.innerHTML = `<div class="grab"></div><h3>영어 목소리</h3><div class="skeleton" style="height:160px"></div>`;
  document.body.append(bg, sheet);

  const groups = await tts.groups();
  if (!sheet.isConnected) return;
  const cur = tts.current();
  sheet.innerHTML = `<div class="grab"></div>
    <h3>영어 목소리</h3>
    <p class="muted" style="margin:-4px 0 10px;font-size:13px">▶ 로 미리 들어 보고, 마음에 드는 목소리를 누르세요. <b>고품질</b>은 인터넷 연결 시 더 자연스러워요.</p>
    <div class="voice-list">
      ${
        groups.length
          ? groups
              .map(
                (g) => `<div class="voice-group">${esc(g.regionName)} 영어 <span class="muted">${g.voices.length}</span></div>
              ${g.voices
                .map(
                  (v) => `<div class="voice-row ${cur?.id === v.id ? 'on' : ''}" data-id="${esc(v.id)}">
                  <button class="voice-pick" data-act="pick">
                    <span class="radio"></span>
                    <span class="vname">목소리 ${v.num} <span class="muted vcode">${esc(v.short)}</span>${v.online ? ' <span class="chip accent">고품질</span>' : ''}</span>
                  </button>
                  <button class="icon-btn" data-act="try" aria-label="목소리 ${v.num} 미리 듣기">${icon.play}</button>
                </div>`,
                )
                .join('')}`,
              )
              .join('')
          : `<div class="empty">${icon.speaker}<div>이 휴대폰에 영어 음성이 없어요</div></div>`
      }
    </div>
    ${isNative() ? `<button class="btn block" id="vInstall" style="margin-top:12px">목소리 더 받기 (안드로이드 음성 데이터)</button>` : ''}
    <button class="btn primary block" id="vDone" style="margin-top:8px">완료</button>`;

  sheet.querySelector('.voice-list').addEventListener('click', (e) => {
    const row = e.target.closest('.voice-row');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const id = row.dataset.id;
    if (act === 'try') return tts.speak(VOICE_SAMPLE, { voiceId: id });
    settings.voice = id;
    saveSettings();
    sheet.querySelectorAll('.voice-row').forEach((r) => r.classList.toggle('on', r === row));
    tts.speak(VOICE_SAMPLE);
    onChange?.();
    toast(`목소리: ${tts.label(tts.current())}`);
  });
  sheet.querySelector('#vInstall')?.addEventListener('click', () => tts.openInstall());
  sheet.querySelector('#vDone').addEventListener('click', () => {
    tts.stop();
    closeSheet();
  });
}

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
      const body = await define(clean);
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
let upAllIds = []; // 무료 번역기로 만들어 둔 이야기 (설정 화면에서 한꺼번에 다시 해석)

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
    <p class="muted" style="font-size:12.5px;margin:8px 4px 0">영어 자막이 있는 채널이면 어디든 가능해요. 영상은 받지 않고 제목과 자막만 학습 자료로 추출합니다.</p>

    <h2 class="section">새 영상</h2>
    <div class="card form">
      <div class="row"><div class="label">새 이야기 학습 자료 자동 준비<small>앱을 열거나 새로고침할 때 새 영상이 있으면 해석·단어를 미리 만들어 둬요 (최대 3편)</small></div>
        <label class="switch"><input id="autoPrepare" type="checkbox" ${settings.autoPrepare ? 'checked' : ''} /><span></span></label></div>
      <div class="row"><div class="label">지금 확인<small>${channelData?.checkedAt ? '마지막 확인 ' + new Date(channelData.checkedAt).toLocaleString() : '아직 확인하지 않았어요'}</small></div>
        <button class="btn" id="checkNow">${icon.refresh} 새 영상 확인</button></div>
    </div>

    <h2 class="section">해석 엔진</h2>
    <div class="card form">
      <div class="row"><div class="label">LLM 으로 해석<small>이야기 제목과 앞뒤 문장을 함께 보고 번역해요. 관용 표현·말투가 훨씬 자연스러워집니다.</small></div>
        <label class="switch"><input id="llmOn" type="checkbox" ${settings.llmOn ? 'checked' : ''} /><span></span></label></div>
      <div class="row"><div class="label" style="flex:1"><label for="llmKey">Gemini API 키</label>
          <small>무료로 발급받아 쓰는 키예요 · 이 휴대폰에만 저장됩니다</small>
          <input id="llmKey" type="password" inputmode="text" autocapitalize="off" autocomplete="off" spellcheck="false"
            placeholder="AIza…" value="${esc(settings.llmKey)}" aria-label="Gemini API 키" style="width:100%;margin-top:8px" /></div></div>
      <div class="row"><div class="label">키 확인<small id="llmState">${settings.llmModel ? '사용할 모델 ' + esc(settings.llmModel) : '키를 넣고 확인을 눌러 주세요'}</small></div>
        <button class="btn" id="llmCheck">확인</button></div>
      <div class="row"><div class="label">키 발급<small>Google AI Studio 에서 무료로 만들 수 있어요</small></div>
        <button class="btn" id="llmHelp">발급 방법</button></div>
      <div class="row"><div class="label">저장해 둔 이야기 다시 해석<small id="upAllState">무료 번역기로 만든 이야기를 세는 중…</small></div>
        <button class="btn" id="upAll">모두 다시 해석</button></div>
    </div>
    <p class="muted" style="font-size:12.5px;margin:8px 4px 0">켜면 학습할 <b>문장이 Google 서버로 전송</b>돼 번역됩니다.
      무료 한도를 넘기면 자동으로 무료 번역기로 돌아가므로 해석이 비지 않아요.</p>

    <h2 class="section">발음 (음성)</h2>
    <div class="card form">
      <div class="row"><div class="label">영어 목소리<small id="voiceName">불러오는 중…</small></div>
        <button class="btn" id="voiceBtn">${icon.speaker} 목소리 고르기</button></div>
      <div class="row"><div class="label">말하기 속도<small id="rateLabel">${settings.rate.toFixed(2)}배</small></div>
        <input id="rate" type="range" min="0.6" max="1.3" step="0.05" value="${settings.rate}" /></div>
      <div class="row"><div class="label">반복 사이 쉬는 시간<small id="gapLabel">${(settings.gap ?? 0.8).toFixed(1)}초 · 따라 읽을 시간을 주려면 늘리세요</small></div>
        <input id="gap" type="range" min="0" max="4" step="0.5" value="${settings.gap ?? 0.8}" /></div>
      <div class="row"><div class="label">미리 듣기</div><button class="btn" id="test">${icon.speaker} 들어보기</button></div>
      ${
        isNative()
          ? `<div class="row"><div class="label">더 자연스러운 음성 받기<small>안드로이드 설정에서 Google 음성 데이터(영어-미국)를 설치하면 원어민처럼 읽어 줘요</small></div>
              <button class="btn" id="ttsInstall">음성 데이터</button></div>`
          : ''
      }
    </div>

    <h2 class="section">화면</h2>
    <div class="card form">
      <div class="row"><div class="label">해석 기본으로 보이기<small>끄면 해석이 흐리게 가려져요 (눌러서 확인)</small></div>
        <label class="switch"><input id="showKo" type="checkbox" ${settings.showKo ? 'checked' : ''} /><span></span></label></div>
      <div class="row"><div class="label">테마</div>
        <select id="theme">${[['auto', '시스템 설정'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>

    <h2 class="section">앱 정보 · 데이터</h2>
    <div class="card form">
      <div class="row"><div class="label">버전 ${esc(appInfo.version)}<small id="updInfo">${updateInfo ? `새 버전 ${esc(updateInfo.version)} · ${esc(updateText(updateInfo))}` : '앱 안에서 새 버전을 확인하고 바로 업데이트해요'}</small></div>
        <button class="btn ${updateInfo ? 'primary' : ''}" id="upd">${updateInfo ? '업데이트' : '업데이트 확인'}</button></div>
      <div class="row"><div class="label">저장된 학습 자료<small id="lessonCount">세는 중…</small></div>
        <button class="btn" id="clearLessons">비우기</button></div>
      <div class="row"><div class="label">학습 기록 초기화<small>익힌 문장·단어장·연속 학습일을 지웁니다</small></div>
        <button class="btn" id="reset" style="color:var(--bad)">초기화</button></div>
    </div>
    <p class="muted" style="font-size:12px;text-align:center;margin-top:24px">English Tales · 모든 학습 기록은 이 휴대폰에만 저장됩니다</p>`;

  const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

  // 현재 목소리 이름 표시 + 목소리 고르기 창
  const showVoice = () =>
    tts.ready().then(() => {
      const el = document.getElementById('voiceName');
      if (el) el.textContent = tts.current() ? tts.label(tts.current()) : '영어 음성이 없어요 — 음성 데이터를 설치하세요';
    });
  showVoice();
  on('voiceBtn', 'click', () => openVoiceSheet(showVoice));
  on('rate', 'input', (e) => {
    settings.rate = Number(e.target.value);
    document.getElementById('rateLabel').textContent = settings.rate.toFixed(2) + '배';
    saveSettings();
  });
  on('gap', 'input', (e) => {
    settings.gap = Number(e.target.value);
    document.getElementById('gapLabel').textContent = `${settings.gap.toFixed(1)}초 · 따라 읽을 시간을 주려면 늘리세요`;
    saveSettings();
  });
  on('test', 'click', () => tts.speak('Once upon a time, there was a quiet little town.'));
  on('ttsInstall', 'click', () => tts.openInstall());
  on('showKo', 'change', (e) => {
    settings.showKo = e.target.checked;
    saveSettings();
  });
  on('theme', 'change', (e) => {
    settings.theme = e.target.value;
    saveSettings();
    applyTheme();
  });
  on('llmOn', 'change', (e) => {
    settings.llmOn = e.target.checked;
    saveSettings();
    if (settings.llmOn && !settings.llmKey) toast('Gemini API 키를 넣어야 켜져요');
    else toast(settings.llmOn ? 'LLM 해석을 켰어요 · 다음에 만드는 이야기부터 적용돼요' : 'LLM 해석을 껐어요');
  });
  on('llmKey', 'change', (e) => {
    settings.llmKey = e.target.value.trim();
    settings.llmModel = ''; // 키가 바뀌면 모델도 다시 고른다
    saveSettings();
  });
  on('llmCheck', 'click', async (e) => {
    const key = document.getElementById('llmKey').value.trim();
    const state = document.getElementById('llmState');
    const btn = e.currentTarget;
    if (!key) return (state.textContent = '키를 먼저 넣어 주세요');
    btn.disabled = true;
    state.textContent = '확인하는 중…';
    try {
      const { models, picked } = await checkKey(key);
      Object.assign(settings, { llmKey: key, llmModel: picked, llmOn: true });
      saveSettings();
      document.getElementById('llmOn').checked = true;
      state.textContent = `사용할 모델 ${picked} · 쓸 수 있는 모델 ${models.length}개`;
      toast('키를 확인했어요 · LLM 해석을 켰습니다');
    } catch (err) {
      state.textContent = `확인 실패: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
  on('llmHelp', 'click', () => openDownload(KEY_HELP));

  // 저장해 둔 이야기(무료 번역기로 만든 것)를 한꺼번에 LLM 해석으로
  basicLessonIds().then((ids) => {
    const el = document.getElementById('upAllState');
    if (!el) return;
    upAllIds = ids;
    el.textContent = ids.length ? `${ids.length}편이 무료 번역기로 되어 있어요` : '모두 LLM 해석이에요';
    const btn = document.getElementById('upAll');
    if (btn) btn.disabled = !ids.length;
  });
  on('upAll', 'click', async (e) => {
    const btn = e.currentTarget;
    const el = document.getElementById('upAllState');
    if (!engineReady()) return (el.textContent = '먼저 키를 넣고 해석 엔진을 켜 주세요');
    if (!confirm(`${upAllIds.length}편을 LLM 해석으로 바꿀까요? 무료 한도를 쓰게 됩니다.`)) return;
    let stop = false;
    btn.textContent = '멈추기';
    btn.onclick = () => {
      stop = true;
      btn.textContent = '멈추는 중…';
    };
    const res = await upgradeAllLessons(
      ({ done, total, title }) => (el.textContent = `${done}/${total}편 · ${title}`),
      () => stop,
    );
    lessons.clear();
    toast(res.failed ? `${res.done - res.failed}편 바꿨어요 · ${res.failed}편 실패` : `${res.done}편을 LLM 해석으로 바꿨어요`);
    renderSettings();
  });

  on('autoPrepare', 'change', (e) => {
    settings.autoPrepare = e.target.checked;
    saveSettings();
  });
  on('checkNow', 'click', async () => {
    const fresh = await refreshChannel();
    if (fresh?.length) location.hash = '#/';
  });

  on('upd', 'click', async (e) => {
    if (updateInfo) return runUpdate(e.currentTarget);
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '확인 중…';
    try {
      updateInfo = await checkUpdate();
    } catch {}
    document.getElementById('updInfo').textContent = updateInfo ? `새 버전 ${updateInfo.version} · ${updateText(updateInfo)}` : '최신 버전이에요';
    btn.disabled = false;
    btn.textContent = updateInfo ? '업데이트' : '업데이트 확인';
    btn.classList.toggle('primary', Boolean(updateInfo));
  });

  db.keys().then((keys) => {
    const n = keys.filter((k) => String(k).startsWith('lesson:')).length;
    const el = document.getElementById('lessonCount');
    if (el) el.textContent = `${n}개 이야기 · 인터넷 없이도 열 수 있어요`;
  });
  on('clearLessons', 'click', async () => {
    if (!confirm('저장된 학습 자료를 지울까요? (학습 기록·단어장은 남아요. 다시 열면 새로 만들어요)')) return;
    for (const k of await db.keys()) if (String(k).startsWith('lesson:')) await db.del(k);
    lessons.clear();
    toast('학습 자료를 비웠어요');
    renderSettings();
  });
  on('reset', 'click', () => {
    if (!confirm('학습 기록과 단어장을 모두 지울까요?')) return;
    for (const k of Object.keys(progress)) progress[k] = { ...progress[k], learned: [], quiz: 0 };
    for (const k of Object.keys(words)) delete words[k];
    days.clear();
    store.set('days', []);
    saveProgress();
    saveWords();
    toast('초기화했어요');
  });

  const change = async (url) => {
    const btn = document.querySelector('#chForm button');
    btn.disabled = true;
    btn.textContent = '확인 중…';
    const prev = settings.channel;
    settings.channel = url.trim();
    try {
      const { data } = await loadChannel();
      settings.recentChannels = [prev, ...settings.recentChannels.filter((c) => c !== prev && c !== settings.channel)].slice(0, 6);
      saveSettings();
      toast(`채널 변경: ${data.title} · 이야기 ${data.videos.length}편`);
      location.hash = '#/';
    } catch (err) {
      settings.channel = prev;
      toast(err.message);
      btn.disabled = false;
      btn.textContent = '변경';
    }
  };
  on('chForm', 'submit', (e) => {
    e.preventDefault();
    const v = document.getElementById('ch').value;
    if (v.trim()) change(v);
  });
  document.querySelector('.presets')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (b) change(b.dataset.ch);
  });
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

/* ───────────── 앱 생명주기: 새 영상 자동 확인 · 업데이트 확인 · 뒤로 가기 ───────────── */
const AppPlugin = globalThis.Capacitor?.Plugins?.App;
if (isNative() && AppPlugin) {
  // 앱으로 돌아올 때마다(다른 앱 사용 후, 화면 켤 때) 새 영상 확인
  AppPlugin.addListener('resume', () => refreshChannel({ auto: true }));
  // 안드로이드 뒤로 가기: 창 닫기 → 이전 화면 → 목록에서는 앱을 뒤로 보내기
  AppPlugin.addListener('backButton', () => {
    if (document.querySelector('.sheet')) return closeSheet();
    const page = location.hash.split('/')[1] || '';
    if (page) history.length > 1 ? history.back() : (location.hash = '#/');
    else AppPlugin.minimizeApp();
  });
} else {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshChannel({ auto: true }));
}

route();
// 앱을 열면 바로 새 영상을 확인 (저장된 목록은 즉시 보여 주고 뒤에서 갱신)
if (channelData?.source === settings.channel) refreshChannel({ auto: true });

// 앱이 정상적으로 떴음을 업데이트 기능에 알림 (새 코드가 망가졌으면 이전 버전으로 자동 복구되게)
markAppReady();

/** 새 버전 확인 → 웹 코드 업데이트면 뒤에서 받아 두고 다음 실행 때 자동 적용 */
let lastUpdateCheck = 0;
async function checkForUpdate() {
  if (Date.now() - lastUpdateCheck < 5 * 60_000) return;
  lastUpdateCheck = Date.now();
  try {
    const u = await checkUpdate();
    if (!u) return;
    const changed = updateInfo?.build !== u.build;
    updateInfo = u;
    if (changed) updateReady = false;
    const onHome = () => (location.hash.split('/')[1] || '') === '';
    if (onHome()) renderHome();
    if (u.kind === 'web' && !updateReady) {
      await prepareWebUpdate(u);
      updateReady = true;
      if (onHome()) renderHome();
    }
  } catch (err) {
    console.warn('[update]', err.message);
  }
}
checkForUpdate();
AppPlugin?.addListener('resume', () => checkForUpdate());
