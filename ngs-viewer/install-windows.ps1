# Same-user Windows logon startup via Task Scheduler + WSL2.
param(
  [Parameter()][string]$Distribution,
  [Parameter()][string]$Checkout,
  [Parameter()][string]$P2,
  [Parameter()][string]$Space,
  [Parameter()][string]$Port
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw 'WSL2와 Linux 배포판을 먼저 설치하세요. 네이티브 Windows Viewer는 지원하지 않습니다.'
}
if (-not $Distribution) { $Distribution = Read-Host 'WSL2 배포판 이름 (예: Ubuntu)' }
if (-not $Checkout) { $Checkout = Read-Host 'WSL2의 ngs-platform 절대 경로' }
if (-not $P2) { $P2 = Read-Host 'WSL2의 P2 절대 경로 (/home/...)' }
if (-not $Space) { $Space = Read-Host '비나리 Space 주소' }
if (-not $Port) { $Port = Read-Host 'Viewer 포트 (기본 5281)' }
if (-not $Port) { $Port = '5281' }
if ($Distribution -notmatch '^[a-zA-Z0-9._ -]{1,64}$' -or
    -not $Checkout.StartsWith('/') -or -not $P2.StartsWith('/') -or
    $Checkout.StartsWith('/mnt/') -or $P2.StartsWith('/mnt/')) {
  throw '배포판 이름과 WSL2 내부의 경로를 입력하세요. Windows 드라이브는 지원하지 않습니다.'
}
$entry = $Checkout.TrimEnd('/') + '/ngs-viewer/install.mjs'
& wsl.exe --distribution $Distribution --exec node $entry --space $Space --p2 $P2 --port $Port
exit $LASTEXITCODE
