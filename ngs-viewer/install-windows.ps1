# NGS Viewer setup for native Windows. Run as the Windows user who will use it.
param(
  [Parameter()][string]$P2,
  [Parameter()][string]$Space,
  [Parameter()][string]$Port,
  [Parameter()][string]$CodexBin
)

$ErrorActionPreference = 'Stop'
$defaultSpace = 'https://vinus-npcgen.park-venus0518.chatgpt.site'
$defaultP2 = Join-Path $env:LOCALAPPDATA 'NGS Viewer P2'
$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 24+ Windows LTS is required. Install it, then run setup again.' }
$version = & $node.Source --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) {
  throw 'Node.js 24+ Windows LTS is required.'
}
if (-not $P2) {
  $P2 = Read-Host "New P2 folder on an NTFS drive [$defaultP2]"
  if (-not $P2) { $P2 = $defaultP2 }
}
if (-not $Space) {
  $Space = Read-Host "Space address [$defaultSpace]"
  if (-not $Space) { $Space = $defaultSpace }
}
if (-not $Port) {
  $Port = Read-Host 'Viewer port [5281]'
  if (-not $Port) { $Port = '5281' }
}
$P2 = $P2.Trim().Trim('"')
if ($P2 -notmatch '^[A-Za-z]:\\.+') { throw 'Choose a new folder on a local NTFS drive (for example, C:\Games\NGS-P2).' }
$P2 = [IO.Path]::GetFullPath($P2).TrimEnd('\')
$entry = Join-Path $PSScriptRoot 'install.mjs'
$viewerArgs = @('--space', $Space.Trim(), '--p2', $P2, '--port', $Port.Trim())
if ($CodexBin) {
  $viewerArgs += @('--codex-bin', [IO.Path]::GetFullPath($CodexBin), '--codex-mcp', 'codex_apps', '--codex-mode', 'stdio')
}
& $node.Source $entry @viewerArgs
exit $LASTEXITCODE
