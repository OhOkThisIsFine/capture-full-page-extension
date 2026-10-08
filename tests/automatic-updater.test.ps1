# Production automatic route; disposable Git worktrees, synthetic remote/CI, no task registration.
$ErrorActionPreference='Stop'
. "$PSScriptRoot\..\scripts\automatic-folder-updater.ps1" -DefineOnly
. "$PSScriptRoot\folder-updater.test.ps1"
$script:AutomaticPassed=0
$script:CiPass=$true
function Read-SuccessfulMasterRun {param($Spec,[string]$Commit);if(-not $script:CiPass){throw 'Synthetic CI is not successful'};return '12345'}
function New-AutomaticFixture {
    param([string]$Name)
    $plan=New-Fixture $Name
    $base=Read-GitValue $plan.Path @('rev-parse','HEAD')
    $null=Git-Test $plan.Path @('checkout','-B','master',$plan.Commit)
    Set-Content -LiteralPath (Join-Path $plan.Path '.gitignore') -Value "/local-update-state.json`n/.local-update-state.*.tmp"
    Set-Content -LiteralPath (Join-Path $plan.Path 'ci.yml') -Value 'synthetic approved CI; never executed'
    Set-Content -LiteralPath (Join-Path $plan.Path 'code.js') -Value 'synthetic complete target; never executed'
    $null=Git-Test $plan.Path @('add','.gitignore','ci.yml','code.js')
    $null=Git-Test $plan.Path @('commit','-m','synthetic release with watcher marker rule')
    $target=Read-GitValue $plan.Path @('rev-parse','HEAD')
    $blob=Read-GitValue $plan.Path @('rev-parse',($target+':ci.yml'))
    $null=Git-Test $plan.Path @('checkout','-B','master',$base)
    $script:ObservedMaster=$target
    [pscustomobject]@{Name=$Name;Path=$plan.Path;Origin=$plan.Origin;Repository='synthetic/never-contacted';Workflow='ci.yml';WorkflowBlob=$blob}
}
function Automatic-Refusal {param([scriptblock]$Action,[string]$Pattern);Expect-Refusal $Action $Pattern;$script:AutomaticPassed++}
try {
    # Reset the fixture option-spy; Initialize-UpdateGit constructs the real options below.
    $script:VerifyProductionOptions=$false
    $spec=New-AutomaticFixture 'automatic-complete'
    $hooks=Initialize-UpdateGit @($spec)
    $candidate=Read-AutomaticCandidate $spec
    $state=Join-Path $root 'automatic-state'
    $null=New-Item -ItemType Directory -Path $state
    $stage=Stage-AutomaticCandidate $candidate $state
    if((Get-Content -LiteralPath (Join-Path $stage 'code.js') -Raw).Trim() -ne 'synthetic complete target; never executed'){throw 'Stage not verified'}
    if(Test-Path -LiteralPath (Join-Path $spec.Path 'local-update-state.json')){throw 'Marker published before merge'}
    Apply-RepositoryUpdate $candidate.Prepared
    Publish-CompletionMarker $candidate
    $marker=Get-Content -LiteralPath (Join-Path $spec.Path 'local-update-state.json') -Raw|ConvertFrom-Json
    if($marker.releaseVersion -ne '2.0.0' -or $marker.commit -ne $candidate.Prepared.Plan.Commit){throw 'Bad completed marker'}
    if((Invoke-RepoGit $spec.Path @('status','--porcelain=v1','--untracked-files=all')).Lines.Count){throw 'Marker dirtied repo'}
    $script:AutomaticPassed++

    Add-Content -LiteralPath (Join-Path $spec.Path 'code.js') -Value 'local edit after merge'
    Automatic-Refusal {Publish-CompletionMarker $candidate} 'Local edits'
    if((Get-Content -LiteralPath (Join-Path $spec.Path 'local-update-state.json') -Raw|ConvertFrom-Json).commit -ne $marker.commit){throw 'Failure changed marker'}
    [IO.Directory]::Delete($hooks,$false)

    $spec=New-AutomaticFixture 'automatic-ci-fail';$hooks=Initialize-UpdateGit @($spec)
    $script:CiPass=$false
    Automatic-Refusal {Read-AutomaticCandidate $spec} 'CI is not successful'
    $script:CiPass=$true;[IO.Directory]::Delete($hooks,$false)

    $spec=New-AutomaticFixture 'automatic-workflow-change';$hooks=Initialize-UpdateGit @($spec)
    $spec.WorkflowBlob='1'*40
    Automatic-Refusal {Read-AutomaticCandidate $spec} 'CI workflow changed'
    [IO.Directory]::Delete($hooks,$false)

    $spec=New-AutomaticFixture 'automatic-no-version-bump';$hooks=Initialize-UpdateGit @($spec)
    $base=Read-GitValue $spec.Path @('rev-parse','HEAD');$target=$script:ObservedMaster
    $null=Git-Test $spec.Path @('checkout','-B','master',$target)
    Set-Content -LiteralPath (Join-Path $spec.Path 'manifest.json') -Value '{"version":"1.0.0"}'
    $null=Git-Test $spec.Path @('commit','-am','synthetic same-version commit')
    $script:ObservedMaster=Read-GitValue $spec.Path @('rev-parse','HEAD')
    $null=Git-Test $spec.Path @('checkout','-B','master',$base)
    Automatic-Refusal {Read-AutomaticCandidate $spec} 'not a strictly newer release'
    [IO.Directory]::Delete($hooks,$false)

    $spec=New-AutomaticFixture 'automatic-hidden-edits';$hooks=Initialize-UpdateGit @($spec)
    $null=Git-Test $spec.Path @('update-index','--assume-unchanged','manifest.json')
    Automatic-Refusal {Read-AutomaticCandidate $spec} 'Hidden assume-unchanged'
    [IO.Directory]::Delete($hooks,$false)

    $workflowSpec=[pscustomobject]@{Workflow='ci.yml';Repository='synthetic/never-contacted'}
    $good=[pscustomobject]@{head_sha='a'*40;head_branch='master';event='push';status='completed';conclusion='success';path='ci.yml';repository=[pscustomobject]@{full_name='synthetic/never-contacted'};id=123}
    if((Select-SuccessfulMasterRun $workflowSpec ('a'*40) ([pscustomobject]@{workflow_runs=@($good)})) -ne '123'){throw 'Valid CI rejected'}
    foreach($field in @('head_sha','head_branch','event','status','conclusion','path')) {
        $bad=$good|ConvertTo-Json|ConvertFrom-Json;$bad.$field='wrong'
        Automatic-Refusal {Select-SuccessfulMasterRun $workflowSpec ('a'*40) ([pscustomobject]@{workflow_runs=@($bad)})} 'no successful approved'
    }
    if((Compare-ReleaseVersion '1.2.10' '1.2.9') -ne 1 -or (Compare-ReleaseVersion '1.2' '1.2.0.0') -ne 0){throw 'Bad numeric version ordering'}
    $script:AutomaticPassed++

    # Actual automatic entry point promotes one clean repo while preserving/skipping the dirty other.
    $first=New-AutomaticFixture 'automatic-main-dirty'
    $script:ObservedMasters[$first.Path]=$script:ObservedMaster
    Add-Content -LiteralPath (Join-Path $first.Path 'manifest.json') -Value 'preserve this edit'
    $second=New-AutomaticFixture 'automatic-main-clean'
    $script:ObservedMasters[$second.Path]=$script:ObservedMaster
    $script:AutoSpecs=@($first,$second)
    function Get-AutomaticRepositorySpecs {$script:AutoSpecs}
    $receipt=@(Start-AutomaticFolderUpdate (Join-Path $root 'actual-automatic-route'))
    if($receipt[0].status -ne 'skipped' -or $receipt[1].status -ne 'updated'){throw 'Automatic main did not skip dirty/promote clean independently'}
    if(-not (Select-String -LiteralPath (Join-Path $first.Path 'manifest.json') -Pattern 'preserve this edit')){throw 'Main lost edit'}
    if(Test-Path -LiteralPath (Join-Path $first.Path 'local-update-state.json')){throw 'Skipped repo published marker'}
    if(-not (Test-Path -LiteralPath (Join-Path $second.Path 'local-update-state.json'))){throw 'Successful main lacks completion marker'}
    $script:AutomaticPassed++
    # B's marker is still newer than a loaded A worker. Actual automatic promotion must reserve B
    # before the first C live-write call, then publish only the completely verified C marker.
    $spec=New-AutomaticFixture 'automatic-marker-B-to-C';$hooks=Initialize-UpdateGit @($spec)
    $candidateB=Read-AutomaticCandidate $spec
    Apply-RepositoryUpdate $candidateB.Prepared;Publish-CompletionMarker $candidateB
    $markerPath=Join-Path $spec.Path 'local-update-state.json'
    $bytesB=[IO.File]::ReadAllBytes($markerPath)
    $null=Git-Test $spec.Path @('checkout','-b','synthetic-release-C')
    Set-Content -LiteralPath (Join-Path $spec.Path 'manifest.json') -Value '{"version":"3.0.0"}'
    Set-Content -LiteralPath (Join-Path $spec.Path 'code.js') -Value 'synthetic complete C; never executed'
    $null=Git-Test $spec.Path @('commit','-am','synthetic C')
    $targetC=Read-GitValue $spec.Path @('rev-parse','HEAD')
    $null=Git-Test $spec.Path @('checkout','master')
    [IO.Directory]::Delete($hooks,$false)
    $script:ObservedMasters[$spec.Path]=$targetC;$script:AutoSpecs=@($spec)
    $script:ReservationPath=$spec.Path;$script:ReservationObserved=0
    $script:ApplyBeforeMarkerTest=(Get-Command Apply-RepositoryUpdate).ScriptBlock
    function Apply-RepositoryUpdate {
        param($Prepared)
        if($Prepared.Plan.Path -ceq $script:ReservationPath){
            if(Test-Path -LiteralPath (Join-Path $Prepared.Plan.Path 'local-update-state.json')){throw 'Completed B marker survived into C live mutation'}
            $script:ReservationObserved++
        }
        & $script:ApplyBeforeMarkerTest $Prepared
    }
    $rows=@(Start-AutomaticFolderUpdate (Join-Path $root 'marker-B-to-C-state'))
    if($rows[0].status -ne 'updated' -or $script:ReservationObserved -ne 1){throw 'Actual promotion failed marker-before-mutation gate'}
    $reserved=@(Get-ChildItem -LiteralPath $spec.Path -Filter '.local-update-state.*.tmp' -File)
    if($reserved.Count -ne 1 -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($reserved[0].FullName)) -cne [Convert]::ToBase64String($bytesB)){throw 'Exact reserved B bytes were not preserved'}
    if((Get-Content -LiteralPath $markerPath -Raw|ConvertFrom-Json).commit -cne $targetC){throw 'C completion marker not published last'}
    $script:AutomaticPassed++

    # Recognizable but foreign/stale metadata is preserved, not overwritten or renamed.
    $hooks=Initialize-UpdateGit @($spec)
    $current=Read-AutomaticCandidate $spec
    $foreign='{"schemaVersion":1,"commit":"'+('f'*40)+'","releaseVersion":"3.0.0"}'
    [IO.File]::WriteAllText($markerPath,$foreign,[Text.UTF8Encoding]::new($false))
    Automatic-Refusal {Reserve-CompletionMarker $current} 'does not belong to current checkout'
    if([IO.File]::ReadAllText($markerPath) -cne $foreign){throw 'Foreign marker changed'}
    [IO.Directory]::Delete($hooks,$false)

    # A clean bootstrap has no local marker, but must reject a reserved marker tracked by target.
    $spec=New-AutomaticFixture 'automatic-target-tracks-marker';$hooks=Initialize-UpdateGit @($spec)
    $base=Read-GitValue $spec.Path @('rev-parse','HEAD');$target=$script:ObservedMaster
    $null=Git-Test $spec.Path @('checkout','-B','master',$target)
    Set-Content -LiteralPath (Join-Path $spec.Path 'local-update-state.json') -Value 'foreign tracked marker'
    $null=Git-Test $spec.Path @('add','-f','local-update-state.json')
    $null=Git-Test $spec.Path @('commit','-m','synthetic forbidden tracked marker')
    $script:ObservedMaster=Read-GitValue $spec.Path @('rev-parse','HEAD')
    $null=Git-Test $spec.Path @('checkout','-B','master',$base)
    if(Test-Path -LiteralPath (Join-Path $spec.Path 'local-update-state.json')){throw 'Bootstrap fixture is not empty'}
    Automatic-Refusal {Read-AutomaticCandidate $spec} 'Selected target tracks reserved completion marker'
    if((Read-GitValue $spec.Path @('rev-parse','HEAD')) -cne $base){throw 'Tracked-marker refusal mutated live checkout'}
    [IO.Directory]::Delete($hooks,$false)

    # Read the actual installer specification only; never invoke installation cmdlets.
    . "$PSScriptRoot\..\scripts\install-automatic-updater.ps1" -DefineOnly
    $taskSpec=Get-UpdaterTaskSpecification (Join-Path $root 'not-installed')
    if($taskSpec.IntervalMinutes -ne 15 -or $taskSpec.LogonType -ne 'Interactive' -or
       $taskSpec.RunLevel -ne 'Limited' -or $taskSpec.MultipleInstances -ne 'IgnoreNew' -or
       $taskSpec.Arguments -notmatch '\-WindowStyle Hidden' -or $taskSpec.Arguments -match 'ExecutionPolicy|Bypass|RunAs') {
        throw 'Installer specification violates approved scope'
    }
    if(Test-Path -LiteralPath $taskSpec.Root){throw 'Task specification created install directory'}
    $script:AutomaticPassed++
    . "$PSScriptRoot\installer.test.ps1"
    Write-Host "PASS $script:AutomaticPassed automatic promotion cases plus19 existing folder safety cases; no network/browser/task installation."
    Write-Host "Retained fixtures: $root"
} catch {Write-Error $_ -ErrorAction Continue;Write-Host $_.ScriptStackTrace;Write-Host "Retained failed fixtures: $root";exit 1}
