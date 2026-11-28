# NGS Viewer 베타

팀원 PC에서 비나리 Space를 사용하는 로컬 뷰어입니다. Mac과 Windows 모두 같은 검증본을 GitHub에서
받아 실행합니다. ZIP, 운영 키, 브라우저 쿠키, 프로젝트 파일 복사는 필요 없습니다.

## 1. 팀원 계정 준비

- 본인 ChatGPT 계정으로 Codex에 로그인합니다.
- 초대받은 비나리 Space를 열 수 있는지 확인합니다.
- 공유받은 **NPCGen 요청과 결과** 플러그인을 Codex에서 설치하고, 연결을
  묻는 경우 본인 계정으로 한 번 승인합니다. Viewer용 별도 MCP 등록은 없습니다.
- Node.js 24 이상과 Git이 필요합니다. Viewer를 사용하는 동안 Codex 로그인을 유지하세요.

## 2. GitHub에서 받기

```sh
git clone --branch team-viewer-stable --single-branch https://github.com/pvenus/ngs-platform.git
cd ngs-platform
```

`team-viewer`에 코드가 올라가면 GitHub Actions가 macOS·Windows 검사를 합니다.
두 환경이 모두 통과한 커밋만 `team-viewer-stable`로 반영됩니다. 그 전에는
직전 통과 버전이 남습니다. 첫 검사 전에는 이 브랜치가 아직 존재하지 않을 수 있습니다.
별도로 빌드 파일과 SHA-256 해시는 해당 [Actions 실행](https://github.com/pvenus/ngs-platform/actions/workflows/team-viewer.yml)에서 확인할 수 있습니다.

이미 설치한 서비스는 설치 시점의 실행본을 사용합니다. 브랜치가 갱신돼도 팀원
PC가 자동으로 바뀌지는 않습니다. Windows에서는 아래 업데이트 스크립트를 실행하세요.

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
저장 위치는 기존 제작용 폴더가 아닌 별도 폴더를 고르세요. 설치 시 잠금 파일 기준으로 Miniflare를 설치하고 그 폴더 안에 로컬 R2/D1을 초기화합니다. 기존 Viewer 사본 파일을 가져오지 않고 Space에서 첫 동기화를 수행합니다. Windows에서는
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

## 업데이트

macOS: 저장소에서 `node ngs-viewer/update-macos.mjs`를 실행하세요. 기본 포트가 아니면 `--port`를 지정합니다. 이전 업데이트 대기 기능이 없는 실행본은 먼저 동기화와 제작 요청이 끝난 것을 확인한 뒤 `--allow-legacy-idle`을 한 번 사용하세요.

Windows:

처음 스크립트를 받으려면 저장소에서 `git pull --ff-only origin team-viewer-stable`을
한 번 실행하세요. 이후 아래 스크립트가 최신 검증 버전을 확인합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ngs-viewer\update-windows.ps1
```

설치 버전과 같으면 조회만 하고, 다운로드·복사·재시작을 하지 않습니다.
새 버전이 있을 때만 별도 폴더에 받은 뒤 예약 작업의 실행 경로를 교체합니다.
동기화나 제작 요청이 진행 중이면 종료하므로, 완료 후 다시 실행하세요.
새 버전이 지정 포트에서 응답하지 않으면 이전 실행본을 다시 시작합니다.
P2, 포트, Codex 연결은 그대로 유지됩니다. 포트가 5281이 아니면 `-Port <포트>`를 추가하세요.

업데이트 일시 중지 기능이 없던 옛 버전은 첫 동기화가 끝나고 제작 요청이 없는
상태를 확인한 뒤 한 번만 `-AllowLegacyIdle`을 추가해서 업데이트하세요.

## 동작

- 파일은 Space R2 → 로그인된 Codex MCP → Miniflare 로컬 R2 방향으로만 전달합니다. D1 목록과 R2 수신 엔진은 로컬 NGS와 같은 모듈을 사용합니다. 전체
  SHA-256 검증과 스냅샷 확정을 거칩니다. 일부 파일이 실패하면 기존 경로 삭제는 미루고 이전에 확정한 읽기 상태를 유지합니다. 서로 다른 파일은 최대 10개까지
  동시에 받지만 같은 파일의 청크는 순서대로 하나씩 받습니다. 현재 실행이
  끝난 후 60초 뒤 다시
  확인합니다. 동기화 도중 버튼을 눌러도 중복으로 실행하지 않습니다.
- 사용자가 제출한 제작 요청은 동기화와 별개로 Space 공식 요청 API에 즉시 한
  번 전달합니다. 로컬 큐, 디스크 보관, 자동 재전송은 없습니다. 응답만 끊겨
  접수 여부가 불확실하면 다시 누르기 전에 Space 요청 목록을 확인하세요.
- Viewer는 인터넷에 로컬 포트를 노출하거나 OPS에 등록하지 않습니다.
  기존 NGS 프로젝트 폴더·원본·생성 워커를 건드리지 않습니다.

## 개발용 테스트

```sh
npm ci --prefix ngs-local/local-miniflare --ignore-scripts --no-audit --no-fund
npm --prefix ngs-viewer test
node --test space-hosting/overlay/tests/space-viewer-{export,install}.mjs
```
