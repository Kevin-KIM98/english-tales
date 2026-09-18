#!/usr/bin/env sh
# macOS / Linux: 서버를 켜고 브라우저를 엽니다
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
exec node --env-file-if-exists=.env server/index.js --open
