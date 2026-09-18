# English Tales — 유튜브 이야기로 배우는 영어 (안드로이드 앱)

유튜브 채널(기본: [Zylos Tales](https://www.youtube.com/@ZylosTales))의 **영상 제목과 영어 자막만** 가져와
제목별로 **문장 발음 · 한국어 해석 · 단어 · 표현 · 퀴즈** 학습 자료를 만드는 휴대폰 설치형 앱입니다.
서버 없이 휴대폰 안에서 모든 처리가 이뤄지고, 영상은 재생하거나 내려받지 않습니다.

## 설치 · 업데이트 (휴대폰)

<p align="center"><img src="docs/install-qr-card.png" alt="English Tales 설치 QR 코드" width="360"></p>

휴대폰 카메라로 QR 코드를 찍으면 **항상 최신 버전** APK가 바로 내려받아집니다.
(주소: `https://github.com/Kevin-KIM98/english-tales/releases/latest/download/english-tales.apk`,
QR만 있는 이미지: [docs/install-qr.png](docs/install-qr.png))


1. 휴대폰에서 이 저장소의 [**Releases**](https://github.com/Kevin-KIM98/english-tales/releases/latest) 를 열고
   `english-tales-v1.0.N.apk` 를 눌러 내려받습니다.
2. 내려받은 파일을 열어 **설치** (처음 한 번은 "출처를 알 수 없는 앱 설치 허용"을 켜야 합니다).
3. 이후 새 버전이 나오면 앱 첫 화면과 **설정 → 앱 정보**에 "업데이트"가 표시됩니다. 누르면 새 APK를 받아 덮어 설치합니다.
   (학습 기록·단어장은 그대로 유지됩니다)

> 더 자연스러운 발음: 휴대폰 **설정 → 일반 → 텍스트 음성 변환(TTS)** 에서 엔진을 *Google 음성 서비스*로 하고
> 영어(미국) 음성 데이터를 설치하세요. 앱 **설정 → 발음 → 음성 데이터** 버튼으로도 바로 갈 수 있습니다.

## 새 영상 자동 가져오기

- 앱을 **열 때**, 다른 앱을 쓰다 **돌아올 때**, 목록을 **아래로 당겨 새로고침**하거나 **새 영상 확인** 버튼을 누를 때
  채널의 최신 목록을 확인합니다.
- 새로 올라온 영상은 **NEW** 로 표시되고, "새 이야기 N편을 가져왔어요" 알림이 뜹니다.
- **설정 → 새 이야기 학습 자료 자동 준비**(기본 켜짐)면 새 영상의 해석·단어·표현을 뒤에서 미리 만들어 둡니다(최대 3편).
- 한 번 만든 학습 자료는 휴대폰에 저장되어 인터넷 없이도 열립니다.

## 학습 기능

- **문장**: 문장별 듣기·천천히 듣기·🔁 한 문장 반복, 해석 가리기, 익힘 표시, 연속 듣기(문장마다 1·2·3·5회/계속 반복, 전체 반복,
  반복 사이 쉬는 시간 0~4초)
- **단어**: 이야기마다 30개 — 구어 빈도 기반 선정, 난이도(A2~C2), 발음기호(CMU 발음 사전), 뜻, 예문
- **표현**: 구동사·관용 표현 자동 추출 (give up, figure out …)
- **퀴즈**: 뜻 고르기 · 듣고 고르기 · 빈칸 채우기 · 표현 뜻
- **단어장**: 저장한 단어 플래시카드 복습
- **설정**: 유튜브 채널 변경(`@핸들`, 채널 주소, `UC…` ID), 목소리·속도, 테마, 업데이트 확인, 학습 자료 비우기

해석은 Google 번역 공개 엔드포인트(무료)를 쓰고, 단어 뜻이 비면 MyMemory로 보충합니다.
요청이 몰리면 일시적으로 해석이 비어 있을 수 있는데, 레슨 화면의 **해석 다시 받기**로 다시 받을 수 있습니다.

## 수정 → 머지 → 배포 (GitHub)

```
GitHub에서 수정 (새 브랜치 + Pull Request)
  └▶ CI 검사 (ci.yml: 빌드 데이터 생성 · 문법 검사 · 테스트)  ── 통과해야 머지 가능
       └▶ main 머지
            └▶ Android Release (android.yml): 테스트 → APK 빌드·서명 → GitHub Release v1.0.<실행번호>
                 └▶ 휴대폰 앱이 새 버전을 알려 줌 → 업데이트
```

- 파일을 GitHub에서 열고 ✏️ → **Create a new branch … and start a pull request** → 검사 ✅ → **Merge**.
- `main` 은 보호되어 있어 PR + 검사 통과가 필요합니다.
- APK 서명 키는 GitHub Secrets(`ANDROID_KEYSTORE_BASE64` 등)에만 있습니다. 원본은 로컬 `english-tales-signing` 폴더에 보관 —
  **잃어버리면 기존 설치 위에 업데이트할 수 없으니 따로 백업하세요.**

### 로컬 PC = 백업
`GitHub 최신본 백업받기.bat` 을 더블클릭하면 GitHub `main` 과 같은 상태로 받아옵니다. 이 폴더에서 직접 수정하지 않습니다.

### 개발 (선택)
```bash
npm install
npm run dev       # 브라우저에서 앱 화면 확인 (http://localhost:5173, 외부 요청은 개발 프록시 경유)
npm test          # CI와 같은 테스트
```
APK 빌드는 GitHub Actions가 하므로 PC에 Android SDK가 없어도 됩니다.

## 구조

```
public/            앱 화면 (Capacitor 웹 자산)
  app.js           화면·라우팅·학습 기능
  lib/youtube.js   채널 목록·자막 추출 (네이티브 HTTP)
  lib/enrich.js    해석·단어·표현 생성
  lib/lessons.js   학습 자료 생성 작업·새 영상 미리 준비
  lib/words.js · expressions.js · sentences.js   오프라인 단어·표현·문장 처리
  lib/tts.js       안드로이드 TTS (개발 시 브라우저 음성)
  lib/update.js    GitHub Release 업데이트 확인
  lib/db.js        휴대폰 저장소(IndexedDB)
android/           안드로이드 프로젝트 (Capacitor)
scripts/           빌드 데이터(빈도·발음기호)·버전 정보 생성
dev/server.js      개발용 서버·프록시 (앱에는 포함되지 않음)
.github/workflows  ci.yml(PR 검사) · android.yml(APK 배포)
```

추출한 자막은 개인 학습용으로만 사용하세요. 저작권은 각 채널에 있습니다.
