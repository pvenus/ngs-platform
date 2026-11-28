/** Windows P2 guard. The current user's private NTFS tree is the trust boundary. */
import {execFileSync} from 'node:child_process';
import {win32 as path} from 'node:path';

export function windowsFileSegment(value){
 if(typeof value!=='string'||!value.length||/[<>:"/\\|?*\x00-\x1f]/u.test(value)||/[ .]$/u.test(value))return false;
 // Win32 aliases device names even with extensions (and superscript digits).
 return !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(value.trimEnd());
}
export function windowsP2Path(value){
 return typeof value==='string'&&/^[a-z]:\\./iu.test(value)&&path.resolve(value)===value&&
   value.slice(3).split('\\').every(windowsFileSegment);
}
export function windowsPowerShell(){return path.join(process.env.SystemRoot??'C:\\Windows',
 'System32','WindowsPowerShell','v1.0','powershell.exe');}
export function windowsCommand(script){
 return ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
}
export function ntfsGuardScript(root,{create=false,deep=false}={}){
 if(!windowsP2Path(root))throw Error('VIEWER_P2_NTFS_PATH_REQUIRED');
 const packet=Buffer.from(JSON.stringify({root,create,deep})).toString('base64');
 return `$ErrorActionPreference = 'Stop'
$c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${packet}')) | ConvertFrom-Json
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = 'S-1-5-18'
function Get-Attributes([string]$p) {
  $attrs = [IO.File]::GetAttributes($p)
  if ($attrs -band [IO.FileAttributes]::ReparsePoint) { throw 'VIEWER_P2_REPARSE_POINT' }
  return $attrs
}
function Test-PrivateAcl([string]$p,[bool]$isRoot,[bool]$isDir) {
  if ($isDir) { $acl = [IO.Directory]::GetAccessControl($p) }
  else { $acl = [IO.File]::GetAccessControl($p) }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or
      ($isRoot -and -not $acl.AreAccessRulesProtected)) { throw 'VIEWER_P2_NTFS_ACL_UNSAFE' }
  $mine = $false
  foreach ($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($ace.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        ($ace.IdentityReference.Value -ne $sid.Value -and $ace.IdentityReference.Value -ne $system)) {
      throw 'VIEWER_P2_NTFS_ACL_UNSAFE'
    }
    if ($ace.IdentityReference.Value -eq $sid.Value -and
        -not ($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
        ($ace.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) {
      if (-not $isDir -or ($ace.InheritanceFlags -band 3) -eq 3) { $mine = $true }
    }
  }
  if (-not $mine) { throw 'VIEWER_P2_NTFS_ACL_UNSAFE' }
}
try {
  $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($c.root))
  if (($drive.DriveType -ne [IO.DriveType]::Fixed -and $drive.DriveType -ne [IO.DriveType]::Removable) -or
      $drive.DriveFormat -ne 'NTFS') { throw 'VIEWER_P2_NTFS_REQUIRED' }
  $check = [IO.Path]::GetDirectoryName($c.root)
  while ($check) {
    if (-not ((Get-Attributes $check) -band [IO.FileAttributes]::Directory)) { throw 'VIEWER_P2_NTFS_PATH_REQUIRED' }
    $check = [IO.Path]::GetDirectoryName($check)
  }
  $absent = $false
  try { $attrs = Get-Attributes $c.root }
  catch {
    $reason=$_.Exception.GetBaseException()
    if ($reason -is [IO.FileNotFoundException] -or $reason -is [IO.DirectoryNotFoundException]) { $absent = $true }
    else { throw }
  }
  if ($absent) {
    if (-not $c.create) { throw 'VIEWER_P2_NTFS_PATH_REQUIRED' }
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true,$false)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
    [IO.DirectoryInfo]::new($c.root).Create($acl)
    $attrs = Get-Attributes $c.root
  }
  if (-not ($attrs -band [IO.FileAttributes]::Directory)) { throw 'VIEWER_P2_NTFS_PATH_REQUIRED' }
  Test-PrivateAcl $c.root $true $true
  if ($c.deep) {
    $queue = New-Object 'Collections.Generic.Stack[string]'
    $queue.Push($c.root)
    $count = 0
    while ($queue.Count) {
      foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($queue.Pop())) {
        if (++$count -gt 200000) { throw 'VIEWER_P2_NTFS_TREE_TOO_LARGE' }
        $a = Get-Attributes $child
        $dir = [bool]($a -band [IO.FileAttributes]::Directory)
        Test-PrivateAcl $child $false $dir
        if ($dir) { $queue.Push($child) }
      }
    }
  }
  Write-Output 'OK'
} catch {
  $code=$_.Exception.Message
  if ($code -match '^VIEWER_P2_[A-Z_]+$') { Write-Output $code } else { Write-Output 'VIEWER_P2_NTFS_CHECK_FAILED' }
  exit 1
}`;
}
export function verifyNtfsRoot(root,options,run=execFileSync){
 try{
  const result=run(windowsPowerShell(),windowsCommand(ntfsGuardScript(root,options)),
   {encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4096,stdio:['ignore','pipe','pipe']});
  if(result.trim()==='OK')return;
 }catch(error){
  const code=error.stdout?.trim();
  if(code&&/^VIEWER_P2_[A-Z_]+$/u.test(code))throw Object.assign(Error(code),{status:409});
  if(error.message==='VIEWER_P2_NTFS_PATH_REQUIRED')throw error;
 }
 throw Object.assign(Error('VIEWER_P2_NTFS_CHECK_FAILED'),{status:409});
}
