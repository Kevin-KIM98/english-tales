// 네트워크: 앱(안드로이드)에서는 네이티브 HTTP로 직접 요청해 브라우저 CORS 제한 없이 유튜브·번역에 접근한다.
// 개발용 브라우저에서는 dev 서버의 /proxy 를 거친다.

const native = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());

// 테스트에서 네트워크 대신 쓸 함수 ({ status, text } 를 돌려준다). 앱에서는 쓰지 않는다.
let transport = null;
export function setTransport(fn) {
  transport = fn;
}

/**
 * @returns {Promise<{ status: number, ok: boolean, text: string, json: () => any }>}
 */
export async function http(url, { method = 'GET', headers = {}, body, timeout = 15000 } = {}) {
  let status;
  let text;
  if (transport) {
    ({ status, text } = await transport(url, { method, headers, body, timeout }));
  } else if (native()) {
    const res = await globalThis.Capacitor.Plugins.CapacitorHttp.request({
      url,
      method,
      headers,
      data: body,
      responseType: 'text',
      connectTimeout: timeout,
      readTimeout: timeout,
    });
    status = res.status;
    text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  } else {
    const res = await fetch('/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers, body, timeout }),
    });
    if (!res.ok) throw new Error(`개발 프록시 오류 (${res.status})`);
    ({ status, text } = await res.json());
  }
  return { status, ok: status >= 200 && status < 300, text, json: () => JSON.parse(text) };
}

export const isNative = native;
