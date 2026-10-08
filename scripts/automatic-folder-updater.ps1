[CmdletBinding()]
param([switch]$DefineOnly)
$runAutomatic = -not $DefineOnly
. "$PSScriptRoot\update-loaded-folders.ps1" -DefineOnly

function Get-AutomaticRepositorySpecs {
    @(
        [pscustomobject]@{ Name='Capture Full Page'; Path='C:\Code\capture-full-page-extension'; Origin='https://github.com/OhOkThisIsFine/capture-full-page-extension.git'; Repository='OhOkThisIsFine/capture-full-page-extension'; Workflow='.github/workflows/build-extension.yml'; WorkflowBlob='a90b1f2f02feca9750239dda2a64d6f6dcc7dcbb' },
        [pscustomobject]@{ Name='Reddit Keyword Auto-Blocker'; Path='C:\Code\reddit-autoblocker'; Origin='https://github.com/OhOkThisIsFine/reddit-autoblocker.git'; Repository='OhOkThisIsFine/reddit-autoblocker'; Workflow='.github/workflows/tests.yml'; WorkflowBlob='fb813a06a138cb874b37ef6e77746b9b4ad04c0a' }
    )
}

function Compare-ReleaseVersion {
    param([string]$Left, [string]$Right)
    $parts = @()
    foreach ($version in @($Left,$Right)) {
        if ($version -cnotmatch '^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$') { throw 'Invalid release version.' }
        $numbers = @($version.Split('.') | ForEach-Object { [int]$_ })
        if (@($numbers | Where-Object { $_ -gt 65535 }).Count -or -not @($numbers | Where-Object { $_ -gt 0 }).Count) { throw 'Invalid release components.' }
        while ($numbers.Count -lt 4) { $numbers += 0 }
        $parts += ,$numbers
    }
    for ($index=0; $index -lt 4; $index++) {
        if ($parts[0][$index] -gt $parts[1][$index]) { return 1 }
        if ($parts[0][$index] -lt $parts[1][$index]) { return -1 }
    }
    return 0
}

function Select-SuccessfulMasterRun {
    param($Spec,[string]$Commit,$Data)
    $matching=@($Data.workflow_runs | Where-Object {
        $_.head_sha -ceq $Commit -and $_.head_branch -ceq 'master' -and $_.event -ceq 'push' -and
        $_.status -ceq 'completed' -and $_.conclusion -ceq 'success' -and $_.path -ceq $Spec.Workflow -and
        $_.repository.full_name -ceq $Spec.Repository
    })
    if (-not $matching.Count) { throw 'Exact master commit has no successful approved workflow run.' }
    return [string]$matching[0].id
}

function Read-SuccessfulMasterRun {
    param($Spec, [string]$Commit)
    $previousPreference=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        $response=@(& $script:GitHubExecutable api "repos/$($Spec.Repository)/actions/runs?head_sha=$Commit&event=push&status=success&per_page=20" 2>&1)
        $code=$LASTEXITCODE
    } finally { $ErrorActionPreference=$previousPreference }
    if ($code) { throw 'Existing GitHub access could not verify CI; no login/grants attempted.' }
    $json=$response -join "`n"
    if ($json.Length -gt 1048576) { throw 'CI response exceeds bound.' }
    $data=$json | ConvertFrom-Json
    Select-SuccessfulMasterRun $Spec $Commit $data
}

function Read-AutomaticCandidate {
    param($Spec)
    Assert-CleanRepository $Spec
    $remote=Read-GitValue $Spec.Path @('ls-remote','--exit-code','origin','refs/heads/master')
    if ($remote -cnotmatch '^([0-9a-f]{40})\trefs/heads/master$') { throw 'Ambiguous master SHA.' }
    $commit=$Matches[1]
    $plan=[pscustomobject]@{Name=$Spec.Name;Path=$Spec.Path;Origin=$Spec.Origin;Commit=$commit}
    $prepared=Prepare-RepositoryUpdate $plan
    if ((Read-GitValue $Spec.Path @('rev-parse',($commit+':'+$Spec.Workflow))) -cne $Spec.WorkflowBlob) {
        throw 'CI workflow changed; independent review and helper pin update required.'
    }
    $run=Read-SuccessfulMasterRun $Spec $commit
    $current=(Get-Content -LiteralPath (Join-Path $Spec.Path 'manifest.json') -Raw | ConvertFrom-Json).version
    if ($prepared.Before -cne $commit -and (Compare-ReleaseVersion $prepared.Version $current) -ne 1) {
        throw 'Master is not a strictly newer release; same-version/downgrade update skipped.'
    }
    $markerTracked=Invoke-RepoGit $Spec.Path @('ls-files','--error-unmatch','local-update-state.json') -AllowOne
    if ($markerTracked.Code -eq 0) { throw 'Completion marker must be local and untracked.' }
    $ignored=Invoke-RepoGit $Spec.Path @('check-ignore','local-update-state.json') -AllowOne
    if ($ignored.Code -ne 0 -and $prepared.Before -ceq $commit) { throw 'Bootstrap marker ignore rule is not installed.' }
    [pscustomobject]@{Spec=$Spec;Prepared=$prepared;Run=$run}
}

function Stage-AutomaticCandidate {
    param($Candidate,[string]$StateRoot)
    $plan=$Candidate.Prepared.Plan
    $entries=(Invoke-RepoGit $plan.Path @('ls-tree','-rl',$plan.Commit)).Lines
    if ($entries.Count -gt 2048) { throw 'Candidate file-count bound exceeded.' }
    [long]$total=0
    foreach($entry in $entries) {
        if ($entry -cnotmatch '^(100644|100755) blob ([0-9a-f]{40})\s+(\d+)\t([^\r\n]+)$') { throw 'Unsupported tree entry.' }
        $total += [long]$Matches[3]
        $relative=$Matches[4]
        if ($relative -match '(^|/)(\.\.?|\.git)(/|$)|[\\:]' -or $relative.StartsWith('/')) { throw 'Unsafe tree path.' }
    }
    if ($total -gt 67108864) { throw 'Candidate byte bound exceeded.' }
    $stagingRoot=Join-Path $StateRoot 'staging'
    if (-not (Test-Path -LiteralPath $stagingRoot)) { $null=New-Item -ItemType Directory -Path $stagingRoot }
    [long]$retained=0
    foreach($file in @(Get-ChildItem -LiteralPath $stagingRoot -Recurse -File)) {$retained += $file.Length}
    if (($retained+$total) -gt 134217728) { throw 'Retained staging budget reached; no automatic deletion.' }
    $stage=Join-Path $stagingRoot ([Guid]::NewGuid().ToString('N'))
    $savedOptions=$script:GitOptions
    try {
        $script:GitOptions += @('-c','core.autocrlf=false')
        $null=Invoke-RepoGit $plan.Path @('worktree','add','--detach',$stage,$plan.Commit)
        foreach($entry in $entries) {
            if ($entry -cnotmatch '^(100644|100755) blob ([0-9a-f]{40})\s+(\d+)\t([^\r\n]+)$') { throw 'Tree changed.' }
            $blob=$Matches[2];$relative=$Matches[4]
            if ((Read-GitValue $stage @('hash-object','--no-filters','--',$relative)) -cne $blob) { throw 'Staged file does not match exact Git blob.' }
        }
    } finally { $script:GitOptions=$savedOptions }
    return $stage # Retain only this task-created snapshot; no old worktree cleanup.
}

function Publish-CompletionMarker {
    param($Candidate)
    $plan=$Candidate.Prepared.Plan
    Assert-CleanRepository $plan
    if ((Read-GitValue $plan.Path @('rev-parse','HEAD')) -cne $plan.Commit) { throw 'Marker cannot precede exact final HEAD.' }
    if ((Invoke-RepoGit $plan.Path @('check-ignore','local-update-state.json') -AllowOne).Code -ne 0) { throw 'Completion marker is not ignored.' }
    # Read every tracked file through Git's configured EOL conversion; filters are disabled.
    foreach($entry in (Invoke-RepoGit $plan.Path @('ls-tree','-r',$plan.Commit)).Lines) {
        if ($entry -cnotmatch '^(100644|100755) blob ([0-9a-f]{40})\t([^\r\n]+)$') { throw 'Unsupported final tree.' }
        $blob=$Matches[2];$relative=$Matches[3]
        if ((Read-GitValue $plan.Path @('hash-object',('--path='+$relative),'--',$relative)) -cne $blob) { throw 'Final file readback mismatch; marker withheld.' }
    }
    $marker=Join-Path $plan.Path 'local-update-state.json'
    if (Test-Path -LiteralPath $marker) {
        $existing=Get-Item -LiteralPath $marker
        if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $existing.Length -gt 1024) { throw 'Unexpected marker file; preserve it.' }
        $old=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
        if (($old.PSObject.Properties.Name | Sort-Object) -join ',' -cne 'commit,releaseVersion,schemaVersion' -or
            $old.schemaVersion -ne 1 -or $old.commit -cnotmatch '^[0-9a-f]{40}$') { throw 'Unrecognized existing marker; preserve it.' }
        $null=Compare-ReleaseVersion $old.releaseVersion $old.releaseVersion
        if ($old.commit -ceq $plan.Commit -and $old.releaseVersion -ceq $Candidate.Prepared.Version) { return }
    }
    $temporary=Join-Path $plan.Path ('.local-update-state.'+[Guid]::NewGuid().ToString('N')+'.tmp')
    $payload=([ordered]@{schemaVersion=1;commit=$plan.Commit;releaseVersion=$Candidate.Prepared.Version}|ConvertTo-Json -Compress)+"`n"
    $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$bytes=([Text.UTF8Encoding]::new($false)).GetBytes($payload);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
    # Atomic final publication, after stage/merge/all-file readback. Never a half-written marker.
    if (Test-Path -LiteralPath $marker) {[IO.File]::Replace($temporary,$marker,$null)} else {[IO.File]::Move($temporary,$marker)}
}

function Start-AutomaticFolderUpdate {
    param([string]$StateRoot=(Join-Path $env:LOCALAPPDATA 'OwnerExtensionUpdater'))
    $mutex=[Threading.Mutex]::new($false,'Local\OwnerExtensionFolderUpdater')
    $owned=$false;$hooks=$null;$rows=@()
    $oldGitPrompt=$env:GIT_TERMINAL_PROMPT;$oldGcmInteractive=$env:GCM_INTERACTIVE;$oldGhPrompt=$env:GH_PROMPT_DISABLED
    try {
        try {$owned=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$owned=$true}
        if (-not $owned) { return } # Scheduler also has IgnoreNew; no overlapping promotions.
        $env:GIT_TERMINAL_PROMPT='0';$env:GCM_INTERACTIVE='Never';$env:GH_PROMPT_DISABLED='1'
        if (-not (Test-Path -LiteralPath $StateRoot)) {$null=New-Item -ItemType Directory -Path $StateRoot}
        $specs=@(Get-AutomaticRepositorySpecs)
        $hooks=Initialize-UpdateGit $specs
        $script:GitHubExecutable=(Get-Command gh.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source
        foreach($spec in $specs) {
            try {
                $candidate=Read-AutomaticCandidate $spec
                $changed=$candidate.Prepared.Before -cne $candidate.Prepared.Plan.Commit
                if ($changed) {$null=Stage-AutomaticCandidate $candidate $StateRoot;Apply-RepositoryUpdate $candidate.Prepared}
                Publish-CompletionMarker $candidate
                $rows += [pscustomobject]@{name=$spec.Name;status=$(if($changed){'updated'}else{'current'});version=$candidate.Prepared.Version;commit=$candidate.Prepared.Plan.Commit;ciRun=$candidate.Run}
            } catch {$rows += [pscustomobject]@{name=$spec.Name;status='skipped';reason=$_.Exception.Message}}
        }
        [IO.File]::WriteAllText((Join-Path $StateRoot 'last-run.json'),([ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');repositories=$rows}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
        $rows
    } finally {
        $env:GIT_TERMINAL_PROMPT=$oldGitPrompt;$env:GCM_INTERACTIVE=$oldGcmInteractive;$env:GH_PROMPT_DISABLED=$oldGhPrompt
        if ($hooks) {[IO.Directory]::Delete($hooks,$false)}
        if ($owned) {$mutex.ReleaseMutex()};$mutex.Dispose()
    }
}

if($runAutomatic) {try {Start-AutomaticFolderUpdate|Format-Table -AutoSize} catch {Write-Error $_ -ErrorAction Continue;exit 1}}
