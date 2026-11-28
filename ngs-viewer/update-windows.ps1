# Update an existing Viewer using the tested GitHub branch. Run as its Windows user.
[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=5281,[switch]$AllowLegacyIdle)
$ErrorActionPreference = 'Stop'
$upstream = 'https://github.com/pvenus/ngs-platform.git'
$space = 'https://vinus-npcgen.park-venus0518.chatgpt.site'
$url = "http://127.0.0.1:$Port"
$name = "VINUS-NGS-Viewer-$Port"
$task = Get-ScheduledTask -TaskPath '\' -TaskName $name
$sid = $task.Principal.UserId
if ($sid -notmatch '^S-1-') {
  $sid = ([Security.Principal.NTAccount]::new($sid)).Translate([Security.Principal.SecurityIdentifier]).Value
}
if ($sid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -or
    $task.Principal.RunLevel -ne 'Limited' -or @($task.Actions).Count -ne 1) {
  throw 'The Viewer task is not an installation owned by the current user.'
}
$old = @($task.Actions)[0]
$base = Join-Path $env:LOCALAPPDATA 'VINUS NGS Viewer'
$m = [regex]::Match($old.Arguments,'^"([^"]+)"( .+)$')
$oldEntry = $m.Groups[1].Value
$rest = $m.Groups[2].Value
$entryPattern = '^' + [regex]::Escape($base) + '\\runtime-[a-f0-9-]+\\ngs-viewer\\viewer\.mjs$'
if (-not $m.Success -or $oldEntry -notmatch $entryPattern -or
    $rest -notmatch (' "--port" "' + $Port + '"(?: |$)') -or
    $rest -notmatch (' "--space" "' + [regex]::Escape($space) + '"(?: |$)') -or
    -not (Test-Path -LiteralPath $oldEntry -PathType Leaf) -or
    -not (Test-Path -LiteralPath $old.Execute -PathType Leaf)) {
  throw 'The registered action does not match this Viewer and port.'
}
function Get-ViewerConfig {
  Invoke-RestMethod -Uri "$url/__viewer/config" -TimeoutSec 3 -MaximumRedirection 0
}
$before = Get-ViewerConfig
if ($before.port -ne $Port -or $before.spaceOrigin -ne $space -or $before.backend -ne 'codex' -or
    $before.guardKey -notmatch '^[a-f0-9]{64}$') { throw 'Cannot verify the local Viewer.' }
$headers = @{ Origin=$url; 'x-ngs-viewer-key'=$before.guardKey }
function Set-ViewerGate([string]$operation) {
  Invoke-RestMethod -Uri "$url/__viewer/update/$operation" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 5 -MaximumRedirection 0
}
$git = (Get-Command git.exe -CommandType Application).Source
$tar = (Get-Command tar.exe -CommandType Application).Source
$repo = Split-Path -Parent $PSScriptRoot
$remote = & $git -C $repo remote get-url origin
if ($LASTEXITCODE -ne 0 -or $remote -ne $upstream) { throw 'Use the official ngs-platform checkout.' }
$tip = & $git -C $repo ls-remote --exit-code $upstream refs/heads/team-viewer-stable
if ($LASTEXITCODE -ne 0 -or $tip -notmatch '^([a-f0-9]{40})	refs/heads/team-viewer-stable$') { throw 'Could not check the verified Viewer version.' }
$expectedSha = $Matches[1]
if ($before.releaseCommit -eq $expectedSha) { Write-Output 'Viewer is already at the tested version.'; exit 0 }
& $git -C $repo fetch --no-tags $upstream refs/heads/team-viewer-stable
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the tested Team Viewer branch.' }
$sha = & $git -C $repo rev-parse --verify 'FETCH_HEAD^{commit}'
if ($LASTEXITCODE -ne 0 -or $sha -ne $expectedSha) { throw 'The tested branch moved during the check; retry without replacing the Viewer.' }

# Use a file instead of Node -e so Windows PowerShell does not strip JS quotes.
& $old.Execute (Join-Path $PSScriptRoot 'setup\check-update-root.mjs') $base
if ($LASTEXITCODE -ne 0) { throw 'The Viewer runtime folder is unsafe.' }
$runtime = Join-Path $base ("runtime-" + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $runtime | Out-Null
$bundle = Join-Path $runtime 'update-source.tar'
$paused=$false; $stopIssued=$false; $changed=$false; $done=$false
try {
  $paths = @('ngs-viewer','ngs-local/sites/npcgen/build','space-hosting/overlay/build/shared-ngs-assets.ts','space-hosting/overlay/build/shared-ngs-response.mjs')
  & $git -C $repo archive --format=tar "--output=$bundle" $sha @paths
  if ($LASTEXITCODE -ne 0) { throw 'Cannot stage the tested version.' }
  & $tar -xf $bundle -C $runtime
  if ($LASTEXITCODE -ne 0) { throw 'Cannot extract the Viewer.' }
  Remove-Item -LiteralPath $bundle
  $entry = Join-Path $runtime 'ngs-viewer\viewer.mjs'
  & $old.Execute --check $entry
  if ($LASTEXITCODE -ne 0) { throw 'Staged Viewer failed validation.' }
  [IO.File]::WriteAllText((Join-Path $runtime 'ngs-viewer\runtime-commit.txt'),$sha)
  $argsForAction = @{Execute=$old.Execute; Argument=('"' + $entry + '"' + $rest)}
  if ($old.WorkingDirectory) { $argsForAction.WorkingDirectory=$old.WorkingDirectory }
  $action = New-ScheduledTaskAction @argsForAction
  try {
    if ((Set-ViewerGate 'pause').paused -ne $true) { throw 'Viewer did not confirm the update pause.' }
    $paused=$true
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($code -eq 409) { throw 'Viewer is busy. Wait for the sync or request to finish and retry.' }
    if (-not ($AllowLegacyIdle -and $code -eq 404)) { throw }
    $prior = Invoke-RestMethod -Uri "$url/__viewer/status" -TimeoutSec 3 -MaximumRedirection 0
    if ($prior.state -notin @('completed','failed')) { throw 'Viewer is busy. Wait for sync to finish and retry.' }
    Write-Warning 'Legacy Viewer does not have a pause gate. Last observed state is idle.'
  }
  $current = Get-ScheduledTask -TaskName $name -TaskPath '\'
  if (@($current.Actions).Count -ne 1 -or $current.Actions[0].Execute -ne $old.Execute -or
      $current.Actions[0].Arguments -ne $old.Arguments) { throw 'The Viewer task changed; no replacement was made.' }
  $stopIssued=$true
  Stop-ScheduledTask -TaskName $name -TaskPath '\'
  $stopped=$false
  for ($i=0; $i -lt 20; $i++) {
    if ((Get-ScheduledTask -TaskName $name -TaskPath '\').State -ne 'Running') { $stopped=$true; break }
    Start-Sleep -Milliseconds 400
  }
  if (-not $stopped) { throw 'Previous Viewer did not stop.' }
  $changed=$true
  Set-ScheduledTask -TaskName $name -TaskPath '\' -Action $action | Out-Null
  Start-ScheduledTask -TaskName $name -TaskPath '\'
  for ($i=0; $i -lt 24; $i++) {
    try { $live = Get-ViewerConfig } catch { $live = $null }
    if ($live -and $live.port -eq $Port -and $live.spaceOrigin -eq $space -and $live.backend -eq 'codex' -and $live.releaseCommit -eq $sha) {
      $done=$true; break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $done) { throw 'New Viewer did not respond with the expected version.' }
  Write-Output "Viewer updated to $sha. P2 and Codex settings were retained."
} catch {
  $original=$_
  if ($changed) {
    Stop-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue
    Set-ScheduledTask -TaskName $name -TaskPath '\' -Action $old | Out-Null
    Start-ScheduledTask -TaskName $name -TaskPath '\'
    Write-Warning 'Previous Viewer task was restored.'
  } elseif ($stopIssued -and (Get-ScheduledTask -TaskName $name -TaskPath '\').State -ne 'Running') {
    Start-ScheduledTask -TaskName $name -TaskPath '\'
  }
  throw $original
} finally {
  if ($paused -and -not $done) { try { Set-ViewerGate 'resume' | Out-Null } catch {} }
}
