# NGS Viewer 베타

팀원 PC에서 비나리 Space를 사용하는 로컬 뷰어입니다. GitHub에서 코드를
받아 실행합니다. ZIP, 운영 키, 브라우저 쿠키, 프로젝트 파일 복사는 필요 없습니다.

## 1. 팀원 계정 준비

- 본인 ChatGPT 계정으로 Codex에 로그인합니다.
- 초대받은 비나리 Space를 열 수 있는지 확인합니다.
- 공유받은 **NPCGen 요청과 결과** 플러그인을 Codex에서 설치하고, 연결을
  묻는 경우 본인 계정으로 한 번 승인합니다. Viewer용 별도 MCP 등록은 없습니다.
- Node.js 24 이상과 Git이 필요합니다. Viewer를 사용하는 동안 Codex 로그인을 유지하세요.

## 2. GitHub에서 받기

```sh
git clone --branch team-viewer --single-branch https://github.com/pvenus/ngs-platform.git
cd ngs-platform
```

이미 저장소를 받았다면 팀 배포 기준은 `team-viewer` 브랜치입니다.

## 3. 설치 및 실행

**macOS** 터미널:

```sh
./ngs-viewer/install-macos.sh
```

**Windows 10/11** 일반 사용자 PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ngs-viewer\install-windows.ps1
```

Space 주소, P2 경로 및 포트를 입력합니다. Space 기본값은
`https://vinus-npcgen.park-venus0518.chatgpt.site`, 포트는 `5281`입니다.
P2는 기존 제작용 폴더가 아닌 새 폴더를 고르세요. Windows에서는
네트워크 드라이브·정션·공유 클라우드 경로가 아닌 로컬 NTFS 폴더여야 합니다.

설치기는 Codex에서 권한이 있는 Space 파일 목록을 실제로 읽은 뒤에만 서비스
자동 실행을 등록합니다. 설치기에서 로그인 팝업을 띄우지 않습니다. macOS는
로그인 사용자의 LaunchAgent, Windows는 일반 사용자의 예약 작업입니다.
Windows는 WSL2나 관리자 권한이 필요하지 않습니다. 실제 Windows PC 검증은
아직 하지 않았습니다.

Codex 실행 파일을 자동으로 찾지 못하면 macOS에서
`--codex-bin <Codex 절대 경로> --codex-mcp codex_apps`, Windows 스크립트에서는
`-CodexBin <codex.exe 절대 경로>`로 지정하세요. 자동 탐색은 macOS 기본
ChatGPT 설치 경로와 PATH를 사용합니다.

설치 후 [로컬 Viewer](http://127.0.0.1:5281)를 엽니다. 포트를 바꿨다면
주소의 포트도 바꿉니다. 첫 동기화가 끝나면 로컬 P2에서 화면이 열립니다.
Viewer 탭이나 Space 팝업을 계속 열어둘 필요는 없습니다. Codex 연결이 끊기면
오류를 표시하고 이미 내려받은 파일은 그대로 둡니다.

## 동작

- 파일은 Space → 로그인된 Codex MCP → P2 방향으로만 전달합니다. 전체
  SHA-256 검증과 스냅샷 확정을 거치며, 현재 실행이 끝난 후 60초 뒤 다시
  확인합니다. 동기화 도중 버튼을 눌러도 중복으로 실행하지 않습니다.
- 사용자가 제출한 제작 요청은 동기화와 별개로 Space 공식 요청 API에 즉시 한
  번 전달합니다. 로컬 큐, 디스크 보관, 자동 재전송은 없습니다. 응답만 끊겨
  접수 여부가 불확실하면 다시 누르기 전에 Space 요청 목록을 확인하세요.
- Viewer는 인터넷에 로컬 포트를 노출하거나 OPS에 등록하지 않습니다.
  기존 NGS 프로젝트 폴더·원본·생성 워커를 건드리지 않습니다.

## 개발용 테스트

```sh
npm --prefix ngs-viewer test
node --test space-hosting/overlay/tests/space-viewer-{export,install}.mjs
```
