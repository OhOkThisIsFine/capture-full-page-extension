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
    Write-Host "PASS $script:AutomaticPassed automatic promotion cases plus19 existing folder safety cases; no network/browser/task installation."
    Write-Host "Retained fixtures: $root"
} catch {Write-Error $_ -ErrorAction Continue;Write-Host $_.ScriptStackTrace;Write-Host "Retained failed fixtures: $root";exit 1}
