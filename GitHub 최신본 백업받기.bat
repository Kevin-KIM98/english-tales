@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem GitHub(main)의 최신 코드를 이 PC 백업 폴더로 받아옵니다.
rem 이 폴더에서 직접 수정하지 마세요. 수정은 GitHub에서 PR로 합니다.
git fetch origin
git checkout main
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo 받기 실패: 이 폴더에 GitHub와 다른 변경이 있습니다. 확인 후 다시 실행하세요.
) else (
  echo.
  echo 백업 완료: GitHub 최신 버전과 같습니다.
  git log -1 --format="마지막 변경: %h %s (%cr)"
)
pause
