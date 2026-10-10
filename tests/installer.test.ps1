# No real task APIs, helper import or installation. Only disposable exact-byte Git fixtures.
$ErrorActionPreference='Stop'
if(-not (Get-Command Git-Test -ErrorAction SilentlyContinue)){. "$PSScriptRoot\folder-updater.test.ps1"}
$installerBytes=[IO.File]::ReadAllBytes("$PSScriptRoot\..\scripts\install-automatic-updater.ps1")
$script:InstallerCases=0;$script:TaskCmdletCalls=0
foreach($taskCommand in @('Get-ScheduledTask','Register-ScheduledTask','New-ScheduledTaskAction','New-ScheduledTaskTrigger','New-ScheduledTaskPrincipal','New-ScheduledTaskSettingsSet')){
    Set-Item -Path ('Function:\'+$taskCommand) -Value {$script:TaskCmdletCalls++;throw 'Fake task API reached; no real registration permitted'}
}
try{
    foreach($flag in @('--assume-unchanged','--skip-worktree')){
        $fixture=Join-Path $root ('installer-'+$flag.TrimStart('-'))
        $null=New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts')
        $null=Git-Test $fixture @('init','-b','master')
        $null=Git-Test $fixture @('config','core.autocrlf','false') # Fixture commits the exact copied bytes on every CI host.
        $null=Git-Test $fixture @('config','user.name','Synthetic installer test')
        $null=Git-Test $fixture @('config','user.email','synthetic@example.invalid')
        $proof=Join-Path $root ($flag.TrimStart('-')+'-helper-executed.txt')
        $helper="param([switch]`$DefineOnly)`n[IO.File]::WriteAllText('$proof','executed')`n"
        [IO.File]::WriteAllBytes((Join-Path $fixture 'scripts\install-automatic-updater.ps1'),$installerBytes)
        foreach($name in @('automatic-folder-updater.ps1','update-loaded-folders.ps1')){[IO.File]::WriteAllText((Join-Path $fixture ('scripts\'+$name)),$helper,[Text.UTF8Encoding]::new($false))}
        $null=Git-Test $fixture @('add','scripts')
        $null=Git-Test $fixture @('commit','-m','synthetic exact reviewed installer')
        $reviewed=@(Git-Test $fixture @('rev-parse','HEAD'))[0]
        # Definition-only load must not import even a perfectly matching helper.
        . (Join-Path $fixture 'scripts\install-automatic-updater.ps1') -DefineOnly
        $script:InstallerRoot=$fixture
        function Get-InstallerSourceRoot {$script:InstallerRoot}
        if(Test-Path -LiteralPath $proof){throw 'Installer imported helper before source verification'}
        $verified=@(Verify-ReviewedUpdaterSource $fixture $reviewed)
        if($verified.Count -ne 3){throw 'Exact reviewed blob baseline rejected'}
        $changed=Join-Path $fixture 'scripts\automatic-folder-updater.ps1'
        $null=Git-Test $fixture @('update-index',$flag,'scripts/automatic-folder-updater.ps1')
        [IO.File]::WriteAllText($changed,$helper+'# hidden altered helper'+"`n",[Text.UTF8Encoding]::new($false))
        if((Invoke-RepoGit $fixture @('status','--porcelain=v1')).Lines.Count){throw 'Fixture status did not hide edited helper'}
        Expect-Refusal {Install-OwnerAutomaticUpdater $reviewed} 'hidden index flags'
        Expect-Refusal {Read-VerifiedUpdaterFiles $script:GitExecutable $fixture $reviewed} 'disk bytes differ from exact reviewed Git blob'
        if($script:TaskCmdletCalls -ne 0 -or (Test-Path -LiteralPath $proof)){throw 'Refusal came after task API/helper execution'}
        if(-not (Select-String -LiteralPath $changed -Pattern 'hidden altered helper')){throw 'Hidden edit was changed'}
        $script:InstallerCases++
    }
    Write-Host "PASS $script:InstallerCases installer hidden-edit/exact-blob cases; fake task API calls0, helper executions0."
    # Successful installation roundtrip: real reviewed-byte checks and file copies,
    # fake task registration/readback. Never invoke a helper or real task API.
    . "$PSScriptRoot\..\scripts\install-automatic-updater.ps1" -DefineOnly
    $script:Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $script:RoundtripSource=Join-Path $root 'installer-roundtrip-source'
    $null=New-Item -ItemType Directory -Path (Join-Path $script:RoundtripSource 'scripts')
    $null=Git-Test $script:RoundtripSource @('init','-b','master')
    $null=Git-Test $script:RoundtripSource @('config','core.autocrlf','false')
    $null=Git-Test $script:RoundtripSource @('config','user.name','Synthetic installer test')
    $null=Git-Test $script:RoundtripSource @('config','user.email','synthetic@example.invalid')
    [IO.File]::WriteAllBytes((Join-Path $script:RoundtripSource 'scripts\install-automatic-updater.ps1'),$installerBytes)
    foreach($name in @('automatic-folder-updater.ps1','update-loaded-folders.ps1')){
        [IO.File]::WriteAllText((Join-Path $script:RoundtripSource ('scripts\'+$name)),"throw 'Synthetic helper must never execute'`n",[Text.UTF8Encoding]::new($false))
    }
    $null=Git-Test $script:RoundtripSource @('add','scripts')
    $null=Git-Test $script:RoundtripSource @('commit','-m','synthetic roundtrip source')
    $roundtripCommit=@(Git-Test $script:RoundtripSource @('rev-parse','HEAD'))[0]
    function Get-InstallerSourceRoot {$script:RoundtripSource}
    $script:RealSpecification=(Get-Command Get-UpdaterTaskSpecification).ScriptBlock
    function Get-UpdaterTaskSpecification {& $script:RealSpecification -Root $script:RoundtripRoot}
    function Get-ScheduledTask {param($TaskName,$ErrorAction);$script:FakeInstalled}
    function New-ScheduledTaskAction {param($Execute,$Argument,$WorkingDirectory);[pscustomobject]@{Execute=$Execute;Arguments=$Argument;WorkingDirectory=$WorkingDirectory}}
    function New-ScheduledTaskTrigger {param([switch]$Once,$At,$RepetitionInterval,[switch]$AtLogOn,$User);[pscustomobject]@{Repetition=[pscustomobject]@{Interval=$(if($Once){'PT15M'}else{''})};UserId=$User}}
    function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel);[pscustomobject]@{UserId=$script:ReturnedIdentity;LogonType=$LogonType;RunLevel=$RunLevel}}
    function New-ScheduledTaskSettingsSet {param($MultipleInstances,$ExecutionTimeLimit,[switch]$Hidden,[switch]$StartWhenAvailable,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries);[pscustomobject]@{MultipleInstances=$MultipleInstances;ExecutionTimeLimit='PT5M'}}
    function Register-ScheduledTask {param($TaskName,$Action,$Trigger,$Principal,$Settings,$Description);$script:FakeInstalled=[pscustomobject]@{Actions=@($Action);Triggers=@($Trigger);Principal=$Principal;Settings=$Settings};$script:Registrations++}
    $script:Registrations=0
    $identities=@($script:Identity.Name,$script:Identity.Name.Split('\')[-1],$script:Identity.Name.ToUpperInvariant(),$script:Identity.User.Value)
    for($index=0;$index -lt $identities.Count;$index++){
        $script:ReturnedIdentity=$identities[$index]
        $script:FakeInstalled=$null
        $script:RoundtripRoot=Join-Path $root ('installed-roundtrip-'+$index)
        Install-OwnerAutomaticUpdater $roundtripCommit
        $receipt=Get-Content (Join-Path $script:RoundtripRoot 'installation.json') -Raw|ConvertFrom-Json
        if($receipt.sourceCommit -cne $roundtripCommit -or $receipt.browserReloadObserved -ne $false){throw 'Roundtrip receipt differs'}
        foreach($file in $receipt.files){if((Get-FileHash -LiteralPath (Join-Path $script:RoundtripRoot $file.name) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256){throw 'Copied helper differs'}}
    }
    $spec=Get-UpdaterTaskSpecification
    foreach($badIdentity in @('S-1-5-32-546','unresolvable-installer-account-725859')){
        $script:FakeInstalled.Principal.UserId=$badIdentity
        Expect-Refusal {Assert-UpdaterTaskReadback $script:FakeInstalled $spec} 'readback differs'
    }
    $script:FakeInstalled.Principal.UserId=$script:Identity.User.Value
    $script:FakeInstalled.Principal.RunLevel='Highest'
    Expect-Refusal {Assert-UpdaterTaskReadback $script:FakeInstalled $spec} 'readback differs'
    $script:FakeInstalled.Principal.RunLevel='Limited'
    $originalExecute=$spec.Execute
    $spec.Execute='"'+$originalExecute+'"'
    Expect-Refusal {Assert-UpdaterTaskPaths $spec} 'canonical absolute native paths'
    $spec.Execute=Join-Path $script:RoundtripRoot 'missing-powershell.exe'
    Expect-Refusal {Assert-UpdaterTaskPaths $spec} 'Cannot find path'
    $spec.Execute=$originalExecute
    $script:FakeInstalled.Actions[0].WorkingDirectory='C:\missing-updater-directory'
    Expect-Refusal {Assert-UpdaterTaskReadback $script:FakeInstalled $spec} 'readback differs'
    if($script:Registrations -ne 4){throw 'Successful fake registration route was not reached'}
    Write-Host 'PASS 4 successful fake registration/receipt roundtrips, 6 identity/privilege/path refusals; no real task API or helper execution.'
    # Exercise refusal through the complete installer, before any receipt exists.
    $integrationIndex=0
    foreach($badIdentity in @('S-1-5-32-546','unresolvable-installer-account-725859')){
        $script:ReturnedIdentity=$badIdentity
        $script:FakeInstalled=$null
        $script:RoundtripRoot=Join-Path $root ('installed-bad-principal-'+$integrationIndex)
        if(Test-Path -LiteralPath $script:RoundtripRoot){throw 'Principal refusal fixture must begin with a fresh destination'}
        $beforeRegistrations=$script:Registrations
        Expect-Refusal {Install-OwnerAutomaticUpdater $roundtripCommit} 'readback differs'
        if($script:Registrations -ne ($beforeRegistrations+1)){throw 'Principal refusal did not reach registration/readback'}
        if(Test-Path -LiteralPath (Join-Path $script:RoundtripRoot 'installation.json')){throw 'Failed principal verification published a receipt'}
        if($script:FakeInstalled.Principal.UserId -cne $badIdentity){throw 'Failed principal verification silently rewrote the task'}
        $integrationIndex++
    }
    # A task conflict must be detected before destination creation or file copies.
    $script:RoundtripRoot=Join-Path $root 'installed-existing-task-conflict'
    $existingTask=$script:FakeInstalled
    $beforeTask=$existingTask|ConvertTo-Json -Depth 8 -Compress
    $beforeRegistrations=$script:Registrations
    if(Test-Path -LiteralPath $script:RoundtripRoot){throw 'Existing task fixture destination must start absent'}
    Expect-Refusal {Install-OwnerAutomaticUpdater $roundtripCommit} 'Task name already exists'
    if($script:Registrations -ne $beforeRegistrations){throw 'Existing task conflict attempted registration'}
    if(Test-Path -LiteralPath $script:RoundtripRoot){throw 'Existing task conflict created destination or wrote files'}
    if(-not [object]::ReferenceEquals($script:FakeInstalled,$existingTask) -or
       ($script:FakeInstalled|ConvertTo-Json -Depth 8 -Compress) -cne $beforeTask){throw 'Existing task conflict changed the task'}
    Write-Host 'PASS 3 full-installer refusal regressions: wrong/unresolvable principal without receipt, existing task preserved without registration or destination writes.'
}catch{Write-Host $_.ScriptStackTrace;throw}
