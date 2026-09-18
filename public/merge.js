// PC ↔ 휴대폰 학습 기록 병합 규칙 (서버와 브라우저가 같은 파일을 사용)
// - 이야기 진행률·단어: 항목별로 더 최근에 바뀐 쪽(t)이 이긴다. 삭제한 단어는 { deleted, t } 로 남겨 되살아나지 않게 한다.
// - 학습한 날짜: 초기화 시각(daysT)이 같으면 합치고, 다르면 더 최근에 초기화한 쪽을 따른다.
// - 채널: 더 최근에 바꾼 쪽을 따른다.

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.t || 0) > (a.t || 0) ? b : a;
}

function mergeMap(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = newer(a[k], b[k]);
  return out;
}

export function emptyState() {
  return { progress: {}, words: {}, days: [], daysT: 0, channel: null };
}

export function mergeState(a, b) {
  a = { ...emptyState(), ...(a || {}) };
  b = { ...emptyState(), ...(b || {}) };
  let days;
  let daysT;
  if ((a.daysT || 0) === (b.daysT || 0)) {
    days = [...new Set([...a.days, ...b.days])].sort().slice(-400);
    daysT = a.daysT || 0;
  } else {
    const w = (a.daysT || 0) > (b.daysT || 0) ? a : b;
    days = [...w.days];
    daysT = w.daysT;
  }
  return {
    progress: mergeMap(a.progress, b.progress),
    words: mergeMap(a.words, b.words),
    days,
    daysT,
    channel: newer(a.channel, b.channel),
  };
}
