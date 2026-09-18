// 앱·개발 서버 JS 파일 문법 검사 (Windows·리눅스 공통)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = ['public/app.js', 'dev/server.js', ...fs.readdirSync('public/lib').map((f) => `public/lib/${f}`)];
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`문법 검사 통과: ${files.length}개 파일`);
