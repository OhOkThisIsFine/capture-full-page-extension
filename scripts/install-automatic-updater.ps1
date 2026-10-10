[CmdletBinding()]
param([string]$ReviewedCommit,[switch]$DefineOnly)
$runInstaller=-not $DefineOnly

function Get-InstallerSourceRoot { Split-Path $PSScriptRoot -Parent }

function Read-ReviewedGitBlob {
    param([string]$Git,[string]$Root,[string]$Commit,[string]$Name)
    if($Root.Contains('"')){throw 'Unsafe source path.'}
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$Git
    $start.Arguments='--no-replace-objects -c core.fsmonitor=false -C "'+$Root.TrimEnd('\')+'" cat-file blob '+$Commit+':scripts/'+$Name
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $process=[Diagnostics.Process]::new();$process.StartInfo=$start
    $memory=[IO.MemoryStream]::new()
    try{
        $null=$process.Start()
        $copy=$process.StandardOutput.BaseStream.CopyToAsync($memory)
        $errorRead=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit(10000)){$process.Kill();throw 'Reviewed blob read timed out.'}
        $null=$copy.GetAwaiter().GetResult();$null=$errorRead.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0 -or $memory.Length -gt 1048576){throw 'Reviewed blob missing/oversized.'}
        return ,$memory.ToArray()
    }finally{$memory.Dispose();$process.Dispose()}
}

function Verify-ReviewedUpdaterSource {
    param([string]$Root,[string]$Commit)
    if($Commit -cnotmatch '^[0-9a-f]{40}$'){throw 'Supply the exact independently reviewed helper source commit.'}
    $git=(Get-Command git.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source
    $options=@('--no-replace-objects','-c','core.fsmonitor=false')
    $filters=@(& $git @options -C $Root config --name-only --get-regexp '^filter\..*\.(smudge|process|clean|required)$')
    if($LASTEXITCODE -notin 0,1){throw 'Source filter configuration could not be inspected.'}
    foreach($filter in $filters){$value=if($filter.EndsWith('.required')){'false'}else{''};$options+=@('-c',($filter+'='+$value))}
    $head=@(& $git @options -C $Root rev-parse HEAD)
    if($LASTEXITCODE -or $head.Count -ne 1 -or $head[0] -cne $Commit){throw 'Installer source HEAD differs from reviewed commit.'}
    $flags=@(& $git @options -C $Root ls-files -v)
    if($LASTEXITCODE -or @($flags|Where-Object{$_ -cmatch '^[a-zS] '}).Count){throw 'Installer source has hidden index flags; no helpers imported or copied.'}
    $dirty=@(& $git @options -C $Root status --porcelain=v1 --untracked-files=all)
    if($LASTEXITCODE -or $dirty.Count){throw 'Installer source is not clean; no helpers imported or copied.'}
    Read-VerifiedUpdaterFiles $git $Root $Commit
}

function Read-VerifiedUpdaterFiles {
    param([string]$Git,[string]$Root,[string]$Commit)
    $verified=@()
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try{
        foreach($name in @('install-automatic-updater.ps1','update-loaded-folders.ps1','automatic-folder-updater.ps1')){
            $path=Join-Path $Root ('scripts\'+$name)
            $file=Get-Item -LiteralPath $path
            if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 1048576){throw 'Nonordinary helper source; refuse installation.'}
            $blob=Read-ReviewedGitBlob $git $Root $Commit $name
            $local=[IO.File]::ReadAllBytes($path)
            $expected=[BitConverter]::ToString($algorithm.ComputeHash($blob)).Replace('-','').ToLowerInvariant()
            $observed=[BitConverter]::ToString($algorithm.ComputeHash($local)).Replace('-','').ToLowerInvariant()
            if($local.Length -ne $blob.Length -or $observed -cne $expected){throw 'Helper disk bytes differ from exact reviewed Git blob; no helpers imported or copied. Use an exact-byte source checkout, not normalization.'}
            $verified += [pscustomobject]@{Name=$name;Bytes=$blob;Sha256=$expected}
        }
    }finally{$algorithm.Dispose()}
    return $verified
}

function Get-UpdaterTaskSpecification {
    param([string]$Root=(Join-Path $env:LOCALAPPDATA 'OwnerExtensionUpdater'))
    [pscustomobject]@{
        Name='OwnerExtensionFolderUpdater'
        Root=$Root
        Execute=(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
        Arguments=('-NoProfile -WindowStyle Hidden -File "'+(Join-Path $Root 'automatic-folder-updater.ps1')+'"')
        User=[Security.Principal.WindowsIdentity]::GetCurrent().Name
        LogonType='Interactive'
        RunLevel='Limited'
        IntervalMinutes=15
        MultipleInstances='IgnoreNew'
        ExecutionMinutes=5
    }
}

function Install-OwnerAutomaticUpdater {
    param([string]$ApprovedSourceCommit)
    $sourceRoot=Get-InstallerSourceRoot
    $verified=@(Verify-ReviewedUpdaterSource $sourceRoot $ApprovedSourceCommit)
    $null=Get-Command gh.exe -CommandType Application -ErrorAction Stop
    $spec=Get-UpdaterTaskSpecification
    if(Get-ScheduledTask -TaskName $spec.Name -ErrorAction SilentlyContinue){throw 'Task name already exists; no overwrite attempted.'}
    if(Test-Path -LiteralPath $spec.Root){
        $directory=Get-Item -LiteralPath $spec.Root
        if(-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or @(Get-ChildItem -LiteralPath $spec.Root -Force).Count){throw 'Install directory is not empty/ordinary; preserve it.'}
    }else{$null=New-Item -ItemType Directory -Path $spec.Root}
    $files=@()
    foreach($name in @('update-loaded-folders.ps1','automatic-folder-updater.ps1')){
        $file=@($verified|Where-Object{$_.Name -ceq $name})[0];$destination=Join-Path $spec.Root $name
        $stream=[IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$stream.Write($file.Bytes,0,$file.Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
        if((Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant() -cne $file.Sha256){throw 'Installed script readback mismatch; task not registered.'}
        $files += [pscustomobject]@{name=$name;sha256=$file.Sha256}
    }
    $action=New-ScheduledTaskAction -Execute $spec.Execute -Argument $spec.Arguments -WorkingDirectory $spec.Root
    $repeat=New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $spec.IntervalMinutes)
    $logon=New-ScheduledTaskTrigger -AtLogOn -User $spec.User
    $principal=New-ScheduledTaskPrincipal -UserId $spec.User -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes $spec.ExecutionMinutes) -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $null=Register-ScheduledTask -TaskName $spec.Name -Action $action -Trigger @($repeat,$logon) -Principal $principal -Settings $settings -Description 'Owner-approved tested updates for the two C:\Code unpacked Brave extension folders; no browser control.'
    $installed=Get-ScheduledTask -TaskName $spec.Name
    $principalMatches=$installed.Principal.UserId -ceq $spec.User
    if(-not $principalMatches){
        try{$resolved=[Security.Principal.NTAccount]::new($spec.User).Translate([Security.Principal.SecurityIdentifier]).Value;$principalMatches=$installed.Principal.UserId -ceq $resolved}catch{$principalMatches=$false}
    }
    if($installed.Actions.Count -ne 1 -or $installed.Actions[0].Execute -cne $spec.Execute -or
       $installed.Actions[0].Arguments -cne $spec.Arguments -or $installed.Actions[0].WorkingDirectory -cne $spec.Root -or
       -not $principalMatches -or [string]$installed.Principal.LogonType -cne 'Interactive' -or
       [string]$installed.Principal.RunLevel -cne 'Limited' -or [string]$installed.Settings.MultipleInstances -cne 'IgnoreNew' -or
       $installed.Settings.ExecutionTimeLimit -cne 'PT5M' -or
       -not @($installed.Triggers|Where-Object{$_.Repetition.Interval -ceq 'PT15M'}).Count){throw 'Task registered but readback differs; report exact mismatch, do not claim verified setup.'}
    $record=[ordered]@{schemaVersion=1;sourceCommit=$ApprovedSourceCommit;task=$spec.Name;files=$files;registeredAt=[DateTime]::UtcNow.ToString('o');browserReloadObserved=$false}
    [IO.File]::WriteAllText((Join-Path $spec.Root 'installation.json'),($record|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Write-Host "Registered $($spec.Name): current interactive user, limited privileges, every15minutes/logon."
    Write-Host 'No browser control occurred. Once the watcher release is on disk, the owner must Reload each extension once.'
    Write-Host 'Actual local-marker read and self-reload in Brave remain separate verification.'
}

if($runInstaller){try{Install-OwnerAutomaticUpdater $ReviewedCommit}catch{Write-Error $_ -ErrorAction Continue;exit 1}}
