// 앱 버전 정보 파일 생성. CI에서는 BUILD_NUMBER(=GitHub Actions 실행 번호)로 빌드 번호를 넣는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const build = Number(process.env.BUILD_NUMBER || 0);
const info = { version: `${pkg.version.replace(/\.\d+$/, '')}.${build}`, build, repo: pkg.appRepo };
fs.writeFileSync(path.join(here, '..', 'public', 'build-info.js'), `export default ${JSON.stringify(info)};\n`);
console.log('build-info:', info);
