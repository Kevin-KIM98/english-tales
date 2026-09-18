// 원어민 발음: Microsoft Edge 신경망 음성(Read Aloud)으로 MP3 생성 + 디스크 캐시
// 비공식 엔드포인트라 실패할 수 있으며, 그때 앱은 기기 내장 음성으로 자동 전환한다.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const VOICES = [
  { id: 'en-US-AriaNeural', label: 'Aria · 미국 여성 (추천)' },
  { id: 'en-US-AndrewNeural', label: 'Andrew · 미국 남성 (내레이션)' },
  { id: 'en-US-JennyNeural', label: 'Jenny · 미국 여성' },
  { id: 'en-US-GuyNeural', label: 'Guy · 미국 남성' },
  { id: 'en-US-AvaNeural', label: 'Ava · 미국 여성' },
  { id: 'en-US-BrianNeural', label: 'Brian · 미국 남성' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia · 영국 여성' },
  { id: 'en-GB-RyanNeural', label: 'Ryan · 영국 남성' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha · 호주 여성' },
];
const VOICE_IDS = new Set(VOICES.map((v) => v.id));
export const DEFAULT_VOICE = VOICES[0].id;

let dir = null;
export async function initTTS(cacheDir) {
  dir = cacheDir;
  await fs.mkdir(dir, { recursive: true });
}

const inflight = new Map();
let active = 0;
const waiters = [];
async function slot() {
  if (active < 4) return active++;
  await new Promise((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}

function synth(text, voice) {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('음성 생성 시간 초과')), 15000);
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(escapeXml(text));
      const chunks = [];
      audioStream.on('data', (d) => chunks.push(d));
      audioStream.on('close', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        tts.close?.();
        buf.length > 500 ? resolve(buf) : reject(new Error('빈 음성 응답'));
      });
      audioStream.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

const escapeXml = (s) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

/** 문장(또는 단어)을 MP3로. 같은 문장·목소리는 캐시에서 바로 돌려준다. */
export async function speech(text, voice = DEFAULT_VOICE) {
  text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!text) throw Object.assign(new Error('text 필요'), { status: 400 });
  if (!VOICE_IDS.has(voice)) voice = DEFAULT_VOICE;
  const key = crypto.createHash('sha1').update(voice + '|' + text).digest('hex');
  const file = path.join(dir, key + '.mp3');
  try {
    return await fs.readFile(file);
  } catch {}
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    await slot();
    try {
      const buf = await synth(text, voice).catch(() => synth(text, voice)); // 일시 오류면 한 번 더
      await fs.writeFile(file, buf).catch(() => {});
      return buf;
    } finally {
      release();
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}
