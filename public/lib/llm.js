// 해석 엔진(LLM): 문장을 한 줄씩 따로 던지는 기계 번역과 달리, 이야기 제목과 앞뒤 문장을
// 함께 주고 번역하게 해서 관용구·말투·대명사가 제대로 살아나게 한다.
// 무료 티어가 있는 Google Gemini 를 쓴다. 키가 없거나 한도를 넘기면 부르는 쪽에서
// 기존 무료 번역기로 그대로 되돌아가므로, 해석이 비는 일은 없다.

import { http } from './net.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const KEY_HELP = 'https://aistudio.google.com/apikey';
// 모델 이름은 자주 바뀌므로 '최신' 별칭을 먼저 쓰고, 없으면 목록에서 찾아 쓴다
const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
const LINES_PER_CALL = 80; // 한 번에 번역할 문장 수 (무료 한도는 '하루 요청 수'라 요청을 적게 쓴다)

const cfg = { on: false, key: '', model: '' };

/** 앱 설정에서 해석 엔진 정보를 받아 둔다 (키는 휴대폰에만 저장된다) */
export function setEngine({ on = false, key = '', model = '' } = {}) {
  Object.assign(cfg, { on: Boolean(on && key), key: key.trim(), model: model.trim() });
}

/** LLM 으로 해석할 수 있는 상태인가 */
export function engineReady() {
  return Boolean(cfg.on && cfg.key);
}

export function engineModel() {
  return cfg.model || FALLBACK_MODELS[0];
}

async function callModel(model, body) {
  const res = await http(`${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 60000,
  });
  if (!res.ok) {
    const msg = (() => {
      try {
        return res.json().error?.message || '';
      } catch {
        return '';
      }
    })();
    throw Object.assign(new Error(msg || `해석 엔진 오류 (${res.status})`), { status: res.status });
  }
  const data = res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

/** 모델 이름이 바뀌었을 때를 대비해, 쓸 수 있는 모델을 찾아 기억해 둔다 */
async function withModel(body) {
  const candidates = [...new Set([cfg.model, ...FALLBACK_MODELS].filter(Boolean))];
  for (const model of candidates) {
    try {
      const text = await callModel(model, body);
      cfg.model = model;
      return text;
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err; // 한도 초과·네트워크 오류는 그대로 알린다
    }
  }
  const names = await listModels();
  const found = names.find((n) => n.includes('flash-lite')) || names.find((n) => n.includes('flash')) || names[0];
  if (!found) throw new Error('쓸 수 있는 모델을 찾지 못했어요');
  const text = await callModel(found, body);
  cfg.model = found;
  return text;
}

/** 키로 쓸 수 있는 모델 목록 (설정 화면에서 고르게 한다) */
export async function listModels(key = cfg.key) {
  const res = await http(`${BASE}/models?key=${encodeURIComponent(key)}`, { timeout: 15000 });
  if (!res.ok) {
    let msg = '';
    try {
      msg = res.json().error?.message || '';
    } catch {
      msg = '';
    }
    throw new Error(msg || `모델 목록을 받지 못했어요 (${res.status})`);
  }
  return (res.json().models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
}

/** 설정 화면의 '키 확인': 키가 살아 있는지 + 쓸 만한 모델 이름 */
export async function checkKey(key) {
  const names = await listModels(key);
  const free = names.filter((n) => n.includes('flash'));
  return { models: free.length ? free : names, picked: free.find((n) => n.includes('flash-lite')) || free[0] || names[0] || '' };
}

const SENTENCE_RULES = [
  '너는 영어 학습 앱의 번역가다. 영어 문장을 한국어로 옮긴다.',
  '- 학습자가 원문 구조를 떠올릴 수 있게, 뜻을 바꾸지 말고 자연스러운 한국어로 옮긴다.',
  '- 관용 표현은 절대 직역하지 않는다. (예: "close on a house" → "집 매매를 마무리하다")',
  '- 이야기 전체의 말투를 일정하게 유지한다. 앞뒤 문장을 보고 대명사가 가리키는 대상을 살린다.',
  '- 문장 하나에 한국어 한 문장. 설명·주석·원문 반복은 넣지 않는다.',
  '- 번호를 그대로 유지하고, 빠뜨리지 않는다.',
].join('\n');

const WORD_RULES = [
  '너는 영어 학습 앱의 사전이다. 단어의 한국어 뜻을 적는다.',
  '- 이 이야기에서 쓰인 의미로, 짧은 뜻만 적는다 (예: "포기하다", "뒤처지다").',
  '- 품사가 여럿이면 이야기에 맞는 것 하나만. 예문·설명은 넣지 않는다.',
  '- 번호를 그대로 유지하고, 빠뜨리지 않는다.',
].join('\n');

/** 모델이 돌려준 JSON 을 너그럽게 읽는다 (```json 울타리·잡소리 섞여도) */
function parseItems(text) {
  const body = text.replace(/^[\s\S]*?```(?:json)?/i, '').replace(/```[\s\S]*$/, '') || text;
  for (const candidate of [body, text]) {
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start < 0 || end <= start) continue;
    try {
      const items = JSON.parse(candidate.slice(start, end + 1));
      if (Array.isArray(items)) return items;
    } catch {
      /* 다음 후보로 */
    }
  }
  return null;
}

async function translateChunk(lines, offset, out, { title = '', word = false } = {}) {
  const numbered = lines.map((l, k) => `${offset + k + 1}. ${l}`).join('\n');
  const text = await withModel({
    systemInstruction: { parts: [{ text: word ? WORD_RULES : SENTENCE_RULES }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              (title ? `이야기 제목: ${title}\n\n` : '') +
              `${word ? '단어' : '문장'} ${lines.length}개다. 번호를 맞춰 한국어로 옮겨라.\n` +
              `JSON 배열만 출력한다: [{"n": 번호, "ko": "한국어"}]\n\n${numbered}`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 8192 },
  });
  const items = parseItems(text);
  if (!items) throw new Error('해석을 읽지 못했어요');
  let filled = 0;
  for (const item of items) {
    const i = Number(item?.n) - 1 - offset;
    const ko = String(item?.ko ?? '').trim();
    if (i >= 0 && i < lines.length && ko) {
      out[offset + i] = ko;
      filled++;
    }
  }
  return filled;
}

/**
 * LLM 으로 여러 줄을 번역한다. 받아 내지 못한 줄은 빈 문자열로 두고 부르는 쪽이 채운다.
 * @param {string[]} lines
 * @param {{ title?: string, word?: boolean }} opts
 * @param {(p:number)=>void} onProgress
 * @returns {Promise<string[]>} 줄별 한국어 (실패한 줄은 '')
 */
export async function llmTranslate(lines, opts = {}, onProgress = () => {}) {
  const out = new Array(lines.length).fill('');
  if (!engineReady()) return out;
  const chunks = [];
  for (let i = 0; i < lines.length; i += LINES_PER_CALL) chunks.push(i);
  let done = 0;
  for (const offset of chunks) {
    const part = lines.slice(offset, offset + LINES_PER_CALL);
    try {
      await translateChunk(part, offset, out, opts);
    } catch (err) {
      console.warn('[llm]', err.message);
      // 한도 초과·키 문제면 나머지도 안 될 테니 여기서 멈추고 무료 번역기에 넘긴다
      if (err.status === 429 || err.status === 401 || err.status === 403) break;
    }
    onProgress(++done / chunks.length);
  }
  return out;
}
