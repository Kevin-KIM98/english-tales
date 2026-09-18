// 앱 안에서 업데이트
// - 화면·기능(웹 코드)만 바뀐 경우: 새 코드 묶음(zip)을 내려받아 앱 안에서 바로 적용 (APK 재설치 없음)
//   → @capgo/capacitor-updater (자체 호스팅 모드, 외부 서버·통계 전송 없음)
// - 안드로이드 네이티브 부분(플러그인 등)이 바뀐 경우에만 새 APK 설치가 필요
// 업데이트 파일은 GitHub Pages(https://kevin-kim98.github.io/english-tales/)에 main 머지 때마다 올라간다.
import info from '../build-info.js';
import { http, isNative } from './net.js';

export const appInfo = info;
export const SITE = 'https://kevin-kim98.github.io/english-tales/';

const updater = () => globalThis.Capacitor?.Plugins?.CapacitorUpdater;
const AppPlugin = () => globalThis.Capacitor?.Plugins?.App;

/** 설치된 APK의 네이티브 수준 (versionName '1.0.12 (n2)' 의 n2). 업데이트 기능이 없던 예전 APK는 0 */
async function installedNative() {
  if (!isNative()) return Infinity;
  try {
    const { version } = await AppPlugin().getInfo();
    return Number(String(version).match(/\(n(\d+)\)/)?.[1] || 0);
  } catch {
    return 0;
  }
}

/** 앱이 정상적으로 떴음을 알린다. 이걸 안 부르면 새 코드에 문제가 있다고 보고 이전 버전으로 되돌린다. */
export function markAppReady() {
  updater()?.notifyAppReady?.().catch(() => {});
}

/**
 * @returns {Promise<null | { version, build, kind: 'web'|'apk', web, apk, notes }>}
 */
export async function checkUpdate() {
  const res = await http(`${SITE}update.json?t=${Date.now()}`, { timeout: 10000 });
  if (!res.ok) return null;
  const u = res.json();
  if (!(u.build > info.build)) return null;
  const needsApk = u.native > (await installedNative()) || !updater();
  return {
    version: u.version,
    build: u.build,
    kind: needsApk ? 'apk' : 'web',
    web: SITE + u.web,
    apk: SITE + (u.apk || 'english-tales.apk'),
    notes: u.notes || '',
  };
}

let downloaded = null; // { build, id } 이미 받아 둔 새 코드

/** 새 코드를 뒤에서 내려받아 둔다. 다음에 앱을 다시 열 때 자동 적용 (next) */
export async function prepareWebUpdate(u, onProgress) {
  const up = updater();
  if (!up || u.kind !== 'web') return null;
  if (downloaded?.build === u.build) return downloaded;
  const handle = onProgress ? await up.addListener('download', (e) => onProgress(e.percent ?? 0)) : null;
  try {
    const bundle = await up.download({ url: u.web, version: u.version });
    await up.next({ id: bundle.id });
    downloaded = { build: u.build, id: bundle.id };
    return downloaded;
  } finally {
    handle?.remove?.();
  }
}

/** 지금 바로 업데이트: 웹 코드는 내려받아 즉시 적용(앱이 새로 뜸), 네이티브 변경은 APK 내려받기 */
export async function applyUpdate(u, onProgress) {
  if (u.kind === 'web') {
    const d = await prepareWebUpdate(u, onProgress);
    await updater().set({ id: d.id }); // 이 줄에서 앱이 새 버전으로 다시 시작된다
    return;
  }
  openDownload(u.apk);
}

/** APK 받기: 시스템 브라우저로 열면 내려받은 뒤 '설치' 를 누를 수 있다 (github.com 이 아닌 Pages 주소) */
export function openDownload(url) {
  const browser = globalThis.Capacitor?.Plugins?.Browser;
  if (browser) browser.open({ url });
  else window.open(url, '_blank');
}
