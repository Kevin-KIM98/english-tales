// 앱 업데이트 확인: GitHub Releases 의 최신 APK 와 설치된 빌드 번호를 비교한다
import info from '../build-info.js';
import { http } from './net.js';

export const appInfo = info;

/** @returns {Promise<null | { version: string, build: number, url: string, notes: string }>} */
export async function checkUpdate() {
  if (!info.repo) return null;
  const res = await http(`https://api.github.com/repos/${info.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'english-tales-app' },
    timeout: 10000,
  });
  if (!res.ok) return null;
  const rel = res.json();
  const build = Number(String(rel.tag_name).split('.').pop());
  const apk = rel.assets?.find((a) => a.name.endsWith('.apk'));
  if (!apk || !(build > info.build)) return null;
  return { version: rel.tag_name.replace(/^v/, ''), build, url: apk.browser_download_url, notes: rel.body || '' };
}

/** APK 받기: 시스템 브라우저로 열면 내려받은 뒤 '설치' 를 누를 수 있다 */
export function openDownload(url) {
  const browser = globalThis.Capacitor?.Plugins?.Browser;
  if (browser) browser.open({ url });
  else window.open(url, '_blank');
}
