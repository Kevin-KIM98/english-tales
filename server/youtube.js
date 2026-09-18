// YouTube 데이터 수집: 채널 식별 → 영상 제목 목록 → 영어 자막(단어 단위 타임스탬프)
// 영상/오디오는 받지 않고, 학습에 필요한 제목과 자막 텍스트만 가져온다.

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WEB_CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' };
// 자막 트랙은 WEB 클라이언트로는 막히는 경우가 많아 모바일 클라이언트를 순서대로 시도한다.
const PLAYER_CLIENTS = [
  {
    client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'en', gl: 'US' },
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
  },
  {
    client: { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2', hl: 'en', gl: 'US' },
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)',
  },
];

export class YouTubeError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** '@ZylosTales', 'https://www.youtube.com/@ZylosTales', 'UC…', '/channel/UC…' 모두 허용 */
export function normalizeChannelInput(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new YouTubeError('채널 주소를 입력해 주세요.', 400);
  const id = raw.match(/(UC[\w-]{22})/);
  if (id) return { path: `channel/${id[1]}` };
  const handle = raw.match(/@([\w.\-·]+)/);
  if (handle) return { path: `@${handle[1]}` };
  const custom = raw.match(/youtube\.com\/(c|user)\/([\w.-]+)/);
  if (custom) return { path: `${custom[1]}/${custom[2]}` };
  if (/^[\w.-]+$/.test(raw)) return { path: `@${raw}` };
  throw new YouTubeError('인식할 수 없는 채널 주소입니다. 예: https://www.youtube.com/@ZylosTales', 400);
}

function extractInitialData(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (!m) throw new YouTubeError('채널 페이지를 해석하지 못했습니다.');
  return JSON.parse(m[1]);
}

/** ytInitialData / browse 응답에서 영상(제목·길이)과 다음 페이지 토큰을 모은다. */
function collectVideos(root) {
  const videos = [];
  let continuation = null;
  const seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.lockupViewModel?.contentId && o.lockupViewModel.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
      const l = o.lockupViewModel;
      const title = l.metadata?.lockupMetadataViewModel?.title?.content;
      const badge = JSON.stringify(l.contentImage || {}).match(/"text":"(\d+(?::\d+){1,2})"/);
      if (title && !seen.has(l.contentId)) {
        seen.add(l.contentId);
        videos.push({ id: l.contentId, title, duration: badge ? badge[1] : '' });
      }
    } else if (o.videoRenderer?.videoId) {
      const v = o.videoRenderer;
      const title = v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText;
      if (title && !seen.has(v.videoId)) {
        seen.add(v.videoId);
        videos.push({ id: v.videoId, title, duration: v.lengthText?.simpleText || '' });
      }
    }
    if (o.continuationCommand?.token) continuation = o.continuationCommand.token;
    for (const k in o) walk(o[k]);
  })(root);
  return { videos, continuation };
}

export async function getChannel(input) {
  const { path } = normalizeChannelInput(input);
  const res = await fetch(`https://www.youtube.com/${path}/videos`, {
    headers: { 'User-Agent': WEB_UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' },
  });
  if (res.status === 404) throw new YouTubeError('채널을 찾을 수 없습니다.', 404);
  if (!res.ok) throw new YouTubeError(`채널 페이지 요청 실패 (${res.status})`);
  const data = extractInitialData(await res.text());
  const meta = data.metadata?.channelMetadataRenderer || {};
  const { videos, continuation } = collectVideos(data.contents);
  return {
    channelId: meta.externalId || '',
    title: meta.title || path,
    handle: path.startsWith('@') ? path : meta.vanityChannelUrl?.split('/').pop() || '',
    avatar: meta.avatar?.thumbnails?.at(-1)?.url || '',
    description: (meta.description || '').slice(0, 300),
    videos,
    continuation,
  };
}

export async function getMoreVideos(continuation) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': WEB_UA },
    body: JSON.stringify({ context: { client: WEB_CLIENT }, continuation }),
  });
  if (!res.ok) throw new YouTubeError(`목록 추가 요청 실패 (${res.status})`);
  return collectVideos(await res.json());
}

/** 영어 자막을 단어 단위 타이밍과 함께 가져온다. 사람이 만든 자막 > 자동 생성 자막 순으로 선택. */
export async function getTranscript(videoId) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new YouTubeError('잘못된 영상 ID', 400);
  let player = null;
  for (const { client, ua } of PLAYER_CLIENTS) {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ua },
      body: JSON.stringify({ context: { client }, videoId }),
    });
    if (!res.ok) continue;
    const json = await res.json();
    if (json.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) {
      player = json;
      break;
    }
    player ??= json;
  }
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const english = tracks.filter((t) => t.languageCode?.startsWith('en'));
  const track = english.find((t) => t.kind !== 'asr') || english[0];
  if (!track) throw new YouTubeError('이 영상에는 영어 자막이 없어 학습 자료를 만들 수 없습니다.', 422);

  const url = track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';
  const res = await fetch(url, { headers: { 'User-Agent': WEB_UA } });
  if (!res.ok) throw new YouTubeError(`자막 다운로드 실패 (${res.status})`);
  const body = await res.text();
  if (!body.trim()) throw new YouTubeError('자막이 비어 있습니다. 잠시 후 다시 시도해 주세요.');
  const events = JSON.parse(body).events || [];

  const words = [];
  for (const ev of events) {
    if (!ev.segs) continue;
    for (const seg of ev.segs) {
      const text = seg.utf8;
      if (!text || text === '\n') continue;
      words.push({ t: (ev.tStartMs || 0) + (seg.tOffsetMs || 0), text });
    }
  }
  return {
    videoId,
    title: player?.videoDetails?.title || '',
    lengthSeconds: Number(player?.videoDetails?.lengthSeconds || 0),
    auto: track.kind === 'asr',
    words,
  };
}
