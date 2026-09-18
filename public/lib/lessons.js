// 레슨(학습 자료) 만들기 작업: 자막 → 문장 → 해석·단어·표현 → 휴대폰에 저장
// 같은 영상은 한 번만 만들고, 새 영상은 뒤에서 차례로 미리 만들어 둘 수 있다.
import { db } from './db.js';
import { getTranscript } from './youtube.js';
import { buildSentences } from './sentences.js';
import { enrich, fillMissing, missingCount } from './enrich.js';

export const LESSON_VERSION = 3; // 올리면 저장된 레슨을 새 규칙으로 다시 만든다

const jobs = new Map(); // videoId → { stage, progress, promise, listeners }
const watchers = new Set();
/** 작업이 시작·끝날 때 알림 (목록 화면의 '준비 중' 표시 갱신용) */
export function onJobsChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
const notify = () => watchers.forEach((fn) => fn());
const key = (id) => `lesson:${id}`;

export async function getLesson(id) {
  const l = await db.get(key(id));
  return l?.version === LESSON_VERSION ? l : null;
}

export async function hasLesson(id) {
  return Boolean(await getLesson(id));
}

export function deleteLesson(id) {
  return db.del(key(id));
}

export { missingCount };

/**
 * 비어 있는 해석만 다시 받아 저장한다 (자막·단어 추출은 다시 하지 않는다).
 * @returns {Promise<{ lesson: object, filled: number, left: number }>}
 */
export async function refillLesson(id, onProgress) {
  const lesson = await getLesson(id);
  if (!lesson) throw new Error('저장된 학습 자료가 없습니다.');
  const res = await fillMissing(lesson, onProgress);
  await db.set(key(id), res.lesson);
  return res;
}

export function jobOf(id) {
  return jobs.get(id);
}

/** 레슨을 만든다. 이미 만드는 중이면 그 작업에 합류. onProgress({stage, progress}) */
export function buildLesson(id, hintTitle, onProgress) {
  let job = jobs.get(id);
  if (!job) {
    job = { stage: '자막 가져오는 중', progress: 0.02, listeners: new Set() };
    const report = (patch) => {
      Object.assign(job, patch);
      job.listeners.forEach((fn) => fn(job));
    };
    job.promise = (async () => {
      const cached = await getLesson(id);
      if (cached) return cached;
      const transcript = await getTranscript(id);
      const title = transcript.title || hintTitle || id;
      const sentences = buildSentences(transcript.words);
      if (sentences.length < 3) throw new Error('자막에서 학습할 문장을 찾지 못했습니다.');
      report({ stage: `${sentences.length}개 문장 해석 · 단어 추출 중`, progress: 0.1 });
      const result = await enrich({ title, sentences }, (p) => report({ progress: 0.1 + p * 0.88 }));
      const lesson = {
        version: LESSON_VERSION,
        videoId: id,
        title,
        autoCaptions: transcript.auto,
        lengthSeconds: transcript.lengthSeconds,
        createdAt: new Date().toISOString(),
        ...result,
      };
      await db.set(key(id), lesson);
      return lesson;
    })().finally(() => {
      jobs.delete(id);
      notify();
    });
    jobs.set(id, job);
    notify();
  }
  if (onProgress) {
    job.listeners.add(onProgress);
    onProgress(job);
    job.promise.finally(() => job.listeners.delete(onProgress)).catch(() => {});
  }
  return job.promise;
}

/* ── 새 영상 자동 준비 (뒤에서 하나씩) ── */
const queue = [];
let running = false;
export function prefetch(videos, onDone) {
  for (const v of videos) if (!queue.some((q) => q.id === v.id)) queue.push(v);
  if (running) return;
  running = true;
  (async () => {
    while (queue.length) {
      const v = queue.shift();
      try {
        if (!(await hasLesson(v.id))) onDone?.(v, await buildLesson(v.id, v.title));
      } catch (err) {
        console.warn('[prefetch]', v.id, err.message);
      }
    }
    running = false;
  })();
}
