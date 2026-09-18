# English Tales — 유튜브 이야기로 배우는 영어

유튜브 채널(기본: [Zylos Tales](https://www.youtube.com/@ZylosTales))의 **영상 제목과 영어 자막만** 가져와
제목별로 **문장 발음 · 한국어 해석 · 단어 · 표현 · 퀴즈** 학습 자료를 만드는 휴대폰·PC 공용 웹앱(PWA)입니다.
영상은 재생하거나 내려받지 않습니다.

## 사용 방식 (휴대폰이 메인)

```
GitHub에서 수정(브랜치·PR) ──▶ CI 자동 검사 ──▶ main 머지 ──▶ Render 자동 배포(HTTPS)
                                                                   │
                                  휴대폰: https://<앱>.onrender.com ◀┘  (홈 화면에 추가)
로컬 PC: `GitHub 최신본 백업받기.bat` 으로 main을 받아 두는 백업 복사본
```

- **휴대폰**: Render 주소를 열고 브라우저 메뉴의 "홈 화면에 추가". HTTPS라서 따라 말하기(마이크)도 됩니다.
- **수정**: GitHub 저장소에서 파일을 열고 연필(✏️) → "Create a new branch … and start a pull request" → CI가 ✅ 되면 **Merge**.
  머지되면 Render가 검사를 통과한 커밋을 자동으로 배포합니다(2~3분).
- **로컬 PC(백업)**: `GitHub 최신본 백업받기.bat`을 더블클릭하면 GitHub main과 같은 상태로 받아옵니다. 이 폴더에서는 직접 수정하지 않습니다.
  인터넷이 안 될 때 등 비상시에는 `English Tales 실행.bat`으로 PC에서 앱을 켤 수 있습니다.

### Render 처음 연결 (한 번만)
1. https://render.com 에 GitHub 계정으로 가입
2. **New → Blueprint** → 이 저장소 선택 → `render.yaml` 확인 → Apply
3. (선택) Claude 해석을 쓰려면 `ANTHROPIC_API_KEY` 값을 입력
4. 생성된 `https://english-tales-xxxx.onrender.com` 주소를 휴대폰에서 열기

무료 플랜은 15분간 접속이 없으면 잠들어 첫 접속이 30~60초 걸리고, 재시작·재배포 때 서버의 저장 파일(만든 레슨, 음성 캐시)이 지워집니다.
학습 기록은 휴대폰에도 저장되어 있어 다시 접속하면 서버로 복구됩니다. 한 번 연 레슨과 들은 음성은 휴대폰에 캐시되어 오프라인에서도 재생됩니다.

### PC에서 직접 실행 (비상용)

```bash
npm install
npm run pc      # 서버 실행 + 브라우저 자동 열기 (Windows: English Tales 실행.bat 더블클릭)
npm test        # 배포 전 CI와 같은 테스트
```

## 발음 · 반복 듣기

- **원어민 음성**: 서버가 Microsoft 신경망 음성(Aria, Andrew, Jenny 등 미국·영국·호주 9종)으로 MP3를 만들어 들려줍니다.
  설정 → 목소리에서 고를 수 있고, 연결이 안 되면 기기 내장 음성으로 자동 전환됩니다 (Edge "소리 내어 읽기"의 비공식 엔드포인트).
- **반복 듣기**: 문장 카드의 🔁 버튼은 그 문장만 멈출 때까지 반복, 아래 플레이어에서 문장마다 1·2·3·5회/계속 반복과
  전체 반복(끝나면 처음부터)을 고를 수 있습니다. 설정에서 반복 사이 쉬는 시간(0~4초)을 조절해 따라 말하기(쉐도잉)에 맞추세요.

## 해석 엔진

| 모드 | 조건 | 내용 |
|---|---|---|
| **Claude** (권장) | `.env`에 `ANTHROPIC_API_KEY` 설정 | 자연스러운 문장 해석, 문맥에 맞는 단어 뜻·IPA·난이도(A2~C2), 숙어/표현 해설 |
| 기본 | 키 없음 | 문장 해석: Google 번역 비공식 무료 엔드포인트 (요청이 많으면 일시 차단될 수 있음 → "해석 다시 받기"). 단어 30개: 구어 빈도 목록으로 선정·난이도 표시, 발음기호는 CMU 발음 사전(오프라인), 뜻은 Google/MyMemory. 표현: 내장 구동사·관용 표현 목록에서 자동 매칭 |

```bash
cp .env.example .env   # ANTHROPIC_API_KEY=sk-ant-... 입력 후 npm start
```

한 번 만든 학습 자료는 `data/lessons/<영상ID>.json`에 저장되어 다음부터 바로 열립니다.
해석이 일부 비어 있으면 레슨 화면의 **해석 다시 받기**를 누르세요.

## 기능

- **이야기(홈)**: 채널의 제목 목록(30개씩 더 불러오기), 제목 검색, 이야기별 진행률, 익힌 문장·저장 단어·연속 학습일
- **문장**: 문장별 듣기 / 천천히 듣기 / 따라 말하기(음성 인식 후 단어별 채점) / 익힘 표시, 해석 가리기,
  연속 듣기 플레이어(1~3회 반복 쉐도잉), 문장 속 단어를 누르면 뜻 보기
- **단어 / 표현**: 발음기호, 품사, 뜻, 영어 풀이, 원문 예문+해석, 단어장 저장
- **퀴즈**: 뜻 고르기 · 듣고 고르기 · 빈칸 채우기 10문제
- **단어장**: 모든 이야기에서 저장한 단어, 플래시카드 복습
- **설정**: 유튜브 채널 변경(`@핸들`, 채널 URL, `UC…` ID), 목소리·속도, 해석 표시, 테마, 기록 초기화

## 참고

- 발음(TTS)과 음성 인식은 브라우저의 Web Speech API를 씁니다. 음성 인식은 Chrome(안드로이드·PC)에서 잘 동작합니다.
- **마이크와 앱 설치(오프라인 캐시)는 HTTPS 또는 localhost에서만** 동작합니다. PC(`localhost`)에서는 따라 말하기가 되지만,
  휴대폰에서 LAN 주소(http)로 접속하면 듣기·해석·단어·퀴즈는 되고 따라 말하기는 막힐 수 있습니다. 필요하면 HTTPS 터널(예: `cloudflared tunnel --url http://localhost:5173`)이나 HTTPS 호스팅을 사용하세요.
- 영어 자막(수동 또는 자동 생성)이 없는 영상은 학습 자료를 만들 수 없습니다.
- 추출한 자막은 개인 학습용으로만 사용하세요. 저작권은 각 채널에 있습니다.

## 구조

```
server/
  index.js        HTTP 서버, API, 레슨 생성 작업(진행률 폴링)
  youtube.js      채널 → 영상 목록, 자막(단어 단위 타이밍) 추출
  sentences.js    자막 → 학습 문장 분할
  enrich.js       해석·단어·표현 생성 (Claude / 기본 모드), 단어 조회
  tts.js          원어민 발음(신경망 음성) MP3 생성·캐시
  wordfreq.js / ipa.js / expressions.js   단어 선정·발음기호·표현 (오프라인)
public/           휴대폰·PC 공용 PWA (index.html, app.js, app.css, sw.js, manifest)
  merge.js        PC↔휴대폰 학습 기록 병합 규칙 (서버·브라우저 공용)
English Tales 실행.bat / start.sh   PC 원클릭 실행 (비상용)
GitHub 최신본 백업받기.bat         로컬 백업 갱신
render.yaml · .github/workflows/ci.yml   배포 설정 · 자동 검사
test/             자동 테스트
```

API: `GET /api/tts?t=&v=`, `GET|PUT /api/state`, `GET /api/channel?url=`, `GET /api/channel/more?token=`, `GET|DELETE /api/lesson/:videoId`, `GET /api/define?word=`, `GET /api/status`
