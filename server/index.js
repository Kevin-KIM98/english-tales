import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { getChannel, getMoreVideos, getTranscript, YouTubeError } from './youtube.js';
import { buildSentences } from './sentences.js';
import { enrich, claudeEnabled, define } from './enrich.js';
import { mergeState, emptyState } from '../public/merge.js';
import { initTTS, speech, VOICES, DEFAULT_VOICE } from './tts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const LESSONS = path.join(here, '..', 'data', 'lessons');
const PORT = Number(process.env.PORT || 5173);
const STATE_FILE = path.join(here, '..', 'data', 'state.json');
const LESSON_VERSION = 2; // 올리면 저장된 레슨을 새 규칙으로 다시 만든다
const OPEN_BROWSER = process.argv.includes('--open');

/** 휴대폰이 접속할 주소: 공유기가 준 사설 IP(Wi-Fi·이더넷)를 VPN·가상 어댑터보다 우선한다 */
function lanAddress() {
  const score = (name, ip) => {
    let s = 0;
    if (/^192\.168\./.test(ip)) s += 30;
    else if (/^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) s += 20;
    if (/wi-?fi|wlan|wireless|ethernet|이더넷|^en\d|^eth\d/i.test(name)) s += 10;
    if (/tailscale|zerotier|vpn|vethernet|virtualbox|vmware|docker|wsl|hyper-v|utun|tun\d/i.test(name)) s -= 50;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) s -= 20; // CGNAT 대역(Tailscale 등)
    return s;
  };
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces()))
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) candidates.push({ ip: a.address, s: score(name, a.address) });
  return candidates.sort((a, b) => b.s - a.s)[0]?.ip;
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

/* ── PC·휴대폰이 함께 쓰는 학습 기록 (한 사람용) ── */
async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return emptyState();
  }
}
let stateWrite = Promise.resolve();
function updateState(incoming) {
  // 동시에 두 기기가 보내도 순서대로 병합되도록 직렬화
  const next = stateWrite.then(async () => {
    const merged = mergeState(await readState(), incoming);
    await fs.writeFile(STATE_FILE, JSON.stringify(merged));
    return merged;
  });
  stateWrite = next.catch(() => {});
  return next;
}

async function readBody(req, limit = 5_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('요청이 너무 큽니다'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

await fs.mkdir(LESSONS, { recursive: true });
await initTTS(path.join(here, '..', 'data', 'tts'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
};

/* ── 학습 자료 생성 작업 (영상별 1개, 진행률 폴링) ── */
const jobs = new Map(); // videoId → { stage, progress, error }

const lessonFile = (id) => path.join(LESSONS, `${id}.json`);

async function readLesson(id) {
  try {
    const lesson = JSON.parse(await fs.readFile(lessonFile(id), 'utf8'));
    return lesson.version === LESSON_VERSION ? lesson : null;
  } catch {
    return null;
  }
}

function startJob(videoId, hintTitle) {
  const job = { stage: '자막 가져오는 중', progress: 0.02, error: null };
  jobs.set(videoId, job);
  (async () => {
    const transcript = await getTranscript(videoId);
    const title = transcript.title || hintTitle || videoId;
    const sentences = buildSentences(transcript.words);
    if (sentences.length < 3) throw new YouTubeError('자막에서 학습할 문장을 찾지 못했습니다.', 422);
    Object.assign(job, { stage: `${sentences.length}개 문장 해석 · 단어 추출 중`, progress: 0.1 });
    const result = await enrich({ title, sentences }, (p) => (job.progress = 0.1 + p * 0.88));
    const lesson = {
      version: LESSON_VERSION,
      videoId,
      title,
      autoCaptions: transcript.auto,
      lengthSeconds: transcript.lengthSeconds,
      createdAt: new Date().toISOString(),
      ...result,
    };
    await fs.writeFile(lessonFile(videoId), JSON.stringify(lesson));
    jobs.delete(videoId);
  })().catch((err) => {
    console.error(`[lesson ${videoId}]`, err);
    Object.assign(job, { error: err.message, status: err.status || 500 });
  });
}

/* ── HTTP ── */
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const channelCache = new Map(); // input → { at, data }

async function api(req, res, url) {
  const p = url.pathname;

  if (p === '/api/status') {
    const lan = lanAddress();
    return send(res, 200, { claude: claudeEnabled(), lanUrl: lan ? `http://${lan}:${PORT}` : null, voices: VOICES, defaultVoice: DEFAULT_VOICE });
  }

  // 원어민(신경망) 발음 MP3. 같은 문장은 캐시되어 반복 재생이 빠르다.
  if (p === '/api/tts') {
    const audio = await speech(url.searchParams.get('t'), url.searchParams.get('v') || DEFAULT_VOICE);
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audio.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return res.end(audio);
  }

  if (p === '/api/state') {
    if (req.method === 'PUT') return send(res, 200, await updateState(await readBody(req)));
    return send(res, 200, await readState());
  }

  if (p === '/api/channel') {
    const input = url.searchParams.get('url') || '@ZylosTales';
    const hit = channelCache.get(input);
    if (hit && Date.now() - hit.at < 10 * 60_000 && !url.searchParams.has('refresh')) return send(res, 200, hit.data);
    const data = await getChannel(input);
    channelCache.set(input, { at: Date.now(), data });
    return send(res, 200, data);
  }

  if (p === '/api/channel/more') {
    const token = url.searchParams.get('token');
    if (!token) return send(res, 400, { error: 'token 필요' });
    return send(res, 200, await getMoreVideos(token));
  }

  if (p === '/api/define') {
    const word = (url.searchParams.get('word') || '').toLowerCase();
    if (!/^[a-z][a-z'-]{0,40}$/.test(word)) return send(res, 400, { error: '단어 형식이 올바르지 않습니다' });
    return send(res, 200, await define(word));
  }

  const m = p.match(/^\/api\/lesson\/([\w-]{11})$/);
  if (m) {
    const id = m[1];
    if (req.method === 'DELETE') {
      await fs.rm(lessonFile(id), { force: true });
      jobs.delete(id);
      return send(res, 200, { ok: true });
    }
    const lesson = await readLesson(id);
    if (lesson) return send(res, 200, lesson);
    const job = jobs.get(id);
    if (job?.error) {
      jobs.delete(id);
      return send(res, job.status, { error: job.error });
    }
    if (!job) startJob(id, url.searchParams.get('title'));
    const j = jobs.get(id);
    return send(res, 202, { status: 'working', stage: j.stage, progress: j.progress });
  }

  send(res, 404, { error: 'not found' });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await fs.readFile(file);
    // 앱 파일은 매번 새 버전인지 확인하게 해서, 배포 직후에도 옛 화면이 남지 않도록 한다
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    // SPA: 알 수 없는 경로는 앱 셸로
    const data = await fs.readFile(path.join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(data);
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await serveStatic(res, url.pathname);
    } catch (err) {
      console.error(err);
      send(res, err.status || 500, { error: err.message || '서버 오류' });
    }
  })
  .on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    // 이미 실행 중이면(런처를 두 번 누른 경우 등) 브라우저만 열고 종료
    console.log(`\n  이미 http://localhost:${PORT} 에서 실행 중입니다.`);
    if (OPEN_BROWSER) openBrowser(`http://localhost:${PORT}`);
    setTimeout(() => process.exit(0), 500);
  })
  .listen(PORT, '0.0.0.0', () => {
    const lan = lanAddress();
    console.log(`\n  English Tales 학습 앱 실행 중`);
    console.log(`  • PC:     http://localhost:${PORT}`);
    if (lan) console.log(`  • 휴대폰: http://${lan}:${PORT}  (같은 Wi-Fi, 앱 설정 화면의 QR 코드로도 접속 가능)`);
    console.log(`  • 해석 엔진: ${claudeEnabled() ? 'Claude (claude-opus-5)' : '기본 모드 (ANTHROPIC_API_KEY 미설정)'}`);
    console.log(`  • 종료: 이 창에서 Ctrl+C\n`);
    if (OPEN_BROWSER) openBrowser(`http://localhost:${PORT}`);
  });
