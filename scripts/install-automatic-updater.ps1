[CmdletBinding()]
param([string]$ReviewedCommit,[switch]$DefineOnly)
$runInstaller=-not $DefineOnly
. "$PSScriptRoot\automatic-folder-updater.ps1" -DefineOnly

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
    if($ApprovedSourceCommit -cnotmatch '^[0-9a-f]{40}$'){throw 'Supply the exact independently reviewed helper source commit.'}
    $sourceRoot=Split-Path $PSScriptRoot -Parent
    $git=(Get-Command git.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source
    $head=@(& $git --no-replace-objects -c core.fsmonitor=false -C $sourceRoot rev-parse HEAD)
    if($LASTEXITCODE -or $head.Count -ne 1 -or $head[0] -cne $ApprovedSourceCommit){throw 'Installer source HEAD differs from reviewed commit.'}
    $dirty=@(& $git --no-replace-objects -c core.fsmonitor=false -C $sourceRoot status --porcelain=v1 --untracked-files=all)
    if($LASTEXITCODE -or $dirty.Count){throw 'Installer source is not clean; preserve changes and stop.'}
    $null=Get-Command gh.exe -CommandType Application -ErrorAction Stop
    $spec=Get-UpdaterTaskSpecification
    if(Get-ScheduledTask -TaskName $spec.Name -ErrorAction SilentlyContinue){throw 'Task name already exists; no overwrite attempted.'}
    if(Test-Path -LiteralPath $spec.Root){
        $directory=Get-Item -LiteralPath $spec.Root
        if(-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or @(Get-ChildItem -LiteralPath $spec.Root -Force).Count){throw 'Install directory is not empty/ordinary; preserve it.'}
    }else{$null=New-Item -ItemType Directory -Path $spec.Root}
    $files=@()
    foreach($name in @('update-loaded-folders.ps1','automatic-folder-updater.ps1')){
        $source=Join-Path $PSScriptRoot $name;$destination=Join-Path $spec.Root $name
        [IO.File]::Copy($source,$destination,$false)
        $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash
        if((Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash -cne $hash){throw 'Installed script readback mismatch; task not registered.'}
        $files += [pscustomobject]@{name=$name;sha256=$hash.ToLowerInvariant()}
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
