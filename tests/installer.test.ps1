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
}catch{Write-Host $_.ScriptStackTrace;throw}
