# Real disposable Git worktrees; remote observations/fetch are synthetic. No browser or network.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\scripts\update-loaded-folders.ps1" -DefineOnly
$script:GitExecutable = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
$root = Join-Path ([IO.Path]::GetTempPath()) ('folder-updater-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$hooks = Join-Path $root 'empty-hooks'
$null = New-Item -ItemType Directory -Path $hooks
$script:GitOptions = @('-c', "core.hooksPath=$hooks", '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false')
$script:RealGit = (Get-Command Invoke-RepoGit).ScriptBlock
$script:ObservedMaster = ''
$script:FetchHeadOverride = ''
$script:ObservedMasters = @{}
$script:VerifyProductionOptions = $false
$script:ProductionMergeCalls = 0
$script:Passed = 0
function Invoke-RepoGit {
    param([string]$Path, [string[]]$GitArguments, [switch]$AllowOne)
    if ($script:VerifyProductionOptions) {
        foreach ($option in @('core.fsmonitor=false', 'branch.master.mergeOptions=', 'merge.autoStash=false', 'gc.auto=0', 'maintenance.auto=false', 'protocol.allow=never', 'protocol.https.allow=always')) {
            if ($script:GitOptions -notcontains $option) { throw "Missing production Git option: $option" }
        }
        $hookOption = @($script:GitOptions | Where-Object { $_ -like 'core.hooksPath=*' })
        if ($hookOption.Count -ne 1 -or @(Get-ChildItem -LiteralPath $hookOption[0].Substring('core.hooksPath='.Length) -Force).Count) { throw 'Production hook directory is not empty' }
        if ($GitArguments[0] -eq 'merge') {
            if ($GitArguments -notcontains '--no-squash' -or $GitArguments -notcontains '--ff-only' -or $GitArguments -notcontains '--no-overwrite-ignore') { throw 'Missing production merge safety flags' }
            $script:ProductionMergeCalls++
        }
    }
    $observed = if ($script:ObservedMasters.ContainsKey($Path)) { $script:ObservedMasters[$Path] } else { $script:ObservedMaster }
    if ($GitArguments[0] -eq 'ls-remote') {
        return [pscustomobject]@{ Code = 0; Lines = @($observed + "`trefs/heads/master") }
    }
    if ($GitArguments[0] -eq 'fetch') {
        $fetched = if ($script:FetchHeadOverride) { $script:FetchHeadOverride } else { $observed }
        return & $script:RealGit $Path @('update-ref', 'refs/remotes/origin/master', $fetched)
    }
    & $script:RealGit $Path $GitArguments -AllowOne:$AllowOne
}
function Git-Test {
    param([string]$Path, [string[]]$Arguments)
    $result = & $script:RealGit $Path $Arguments
    $result.Lines
}
function New-Fixture {
    param([string]$Name)
    $path = Join-Path $root $Name
    $null = New-Item -ItemType Directory -Path $path
    $null = Git-Test $path @('init', '-b', 'master')
    $null = Git-Test $path @('config', 'user.name', 'Synthetic updater test')
    $null = Git-Test $path @('config', 'user.email', 'synthetic@example.invalid')
    $null = Git-Test $path @('config', 'remote.origin.url', 'https://github.com/OhOkThisIsFine/capture-full-page-extension.git')
    Set-Content -LiteralPath (Join-Path $path 'manifest.json') -Value '{"version":"1.0.0"}'
    $null = Git-Test $path @('add', 'manifest.json')
    $null = Git-Test $path @('commit', '-m', 'synthetic base')
    $before = @(Git-Test $path @('rev-parse', 'HEAD'))[0]
    Set-Content -LiteralPath (Join-Path $path 'manifest.json') -Value '{"version":"2.0.0"}'
    $null = Git-Test $path @('commit', '-am', 'synthetic target')
    $target = @(Git-Test $path @('rev-parse', 'HEAD'))[0]
    # Tests switch a clean disposable fixture to its earlier commit; no reset/clean/stash.
    $null = Git-Test $path @('checkout', '-B', 'master', $before)
    $script:ObservedMaster = $target
    $script:FetchHeadOverride = ''
    [pscustomobject]@{ Name = $Name; Path = $path; Origin = 'https://github.com/OhOkThisIsFine/capture-full-page-extension.git'; Commit = $target }
}
function Expect-Refusal {
    param([scriptblock]$Action, [string]$Pattern)
    try { & $Action; throw 'Unexpected acceptance' } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
    }
    $script:Passed++
}
try {
    $plan = New-Fixture 'clean'
    $prepared = Prepare-RepositoryUpdate $plan
    # A real post-merge hook would create this marker if hooks were not disabled.
    $marker = Join-Path $plan.Path 'hook-ran'
    [IO.File]::WriteAllText((Join-Path $plan.Path '.git\hooks\post-merge'), "#!/bin/sh`ntouch hook-ran`n")
    Apply-RepositoryUpdate $prepared
    if (Test-Path -LiteralPath $marker) { throw 'Hook executed' }
    if ((Read-GitValue $plan.Path @('rev-parse', 'HEAD')) -ne $plan.Commit) { throw 'Wrong final HEAD' }
    $script:Passed++

    $plan = New-Fixture 'tracked-edits'
    Add-Content -LiteralPath (Join-Path $plan.Path 'manifest.json') -Value 'local edit'
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Local edits'
    if (-not (Select-String -LiteralPath (Join-Path $plan.Path 'manifest.json') -Pattern 'local edit')) { throw 'Edit lost' }

    $plan = New-Fixture 'untracked'
    Set-Content -LiteralPath (Join-Path $plan.Path 'personal.txt') -Value 'preserve'
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Local edits/untracked'

    $plan = New-Fixture 'divergence'
    Set-Content -LiteralPath (Join-Path $plan.Path 'personal.txt') -Value 'local commit'
    $null = Git-Test $plan.Path @('add', 'personal.txt')
    $null = Git-Test $plan.Path @('commit', '-m', 'synthetic local branch')
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Diverged/ahead'

    $plan = New-Fixture 'wrong-origin'
    $null = Git-Test $plan.Path @('config', 'remote.origin.url', 'https://example.invalid/other.git')
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Origin mismatch'

    $plan = New-Fixture 'rewritten-origin'
    $null = Git-Test $plan.Path @('config', 'url.https://example.invalid/.insteadOf', 'https://github.com/')
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Origin mismatch'

    $plan = New-Fixture 'stale-pin'
    $script:ObservedMaster = '1111111111111111111111111111111111111111'
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Master differs'

    $plan = New-Fixture 'remote-drift-during-fetch'
    $script:FetchHeadOverride = Read-GitValue $plan.Path @('rev-parse', 'HEAD')
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Remote changed during fetch'

    $plan = New-Fixture 'operation-in-progress'
    Set-Content -LiteralPath (Join-Path $plan.Path '.git\MERGE_HEAD') -Value $plan.Commit
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Git operation in progress'

    $plan = New-Fixture 'wrong-branch'
    $null = Git-Test $plan.Path @('checkout', '-b', 'personal-work')
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Expected master branch'

    $plan = New-Fixture 'invalid-pin'
    $plan.Commit = 'master'
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'exact reviewed'

    $plan = New-Fixture 'head-drift'
    $prepared = Prepare-RepositoryUpdate $plan
    $null = Git-Test $plan.Path @('checkout', '-B', 'master', $plan.Commit)
    Expect-Refusal { Apply-RepositoryUpdate $prepared } 'Checkout changed after preflight'

    $plan = New-Fixture 'changed-after-preflight'
    $prepared = Prepare-RepositoryUpdate $plan
    Set-Content -LiteralPath (Join-Path $plan.Path 'personal.txt') -Value 'late edit'
    Expect-Refusal { Apply-RepositoryUpdate $prepared } 'Local edits/untracked'

    $plan = New-Fixture 'filter-attribute'
    $null = Git-Test $plan.Path @('checkout', '-B', 'master', $plan.Commit)
    Set-Content -LiteralPath (Join-Path $plan.Path '.gitattributes') -Value '*.json filter=remote-script'
    $null = Git-Test $plan.Path @('add', '.gitattributes')
    $null = Git-Test $plan.Path @('commit', '-m', 'synthetic filter')
    $plan.Commit = @(Git-Test $plan.Path @('rev-parse', 'HEAD'))[0]
    $script:ObservedMaster = $plan.Commit
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Checkout filters'

    $plan = New-Fixture 'submodule'
    $base = Read-GitValue $plan.Path @('rev-parse', 'HEAD')
    $null = Git-Test $plan.Path @('checkout', '-B', 'master', $plan.Commit)
    $null = Git-Test $plan.Path @('update-index', '--add', '--cacheinfo', ('160000,' + $plan.Commit + ',nested'))
    $null = Git-Test $plan.Path @('commit', '-m', 'synthetic gitlink')
    $plan.Commit = @(Git-Test $plan.Path @('rev-parse', 'HEAD'))[0]
    $script:ObservedMaster = $plan.Commit
    $null = Git-Test $plan.Path @('checkout', '-B', 'master', $base)
    # A clean base still refuses a remote target containing an uninitialized gitlink.
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Submodules are unsupported'

    $plan = New-Fixture 'ignored-collision'
    $base = Read-GitValue $plan.Path @('rev-parse', 'HEAD')
    $null = Git-Test $plan.Path @('checkout', '-B', 'master', $plan.Commit)
    Set-Content -LiteralPath (Join-Path $plan.Path 'private.txt') -Value 'remote tracked file'
    $null = Git-Test $plan.Path @('add', 'private.txt')
    $null = Git-Test $plan.Path @('commit', '-m', 'synthetic collision')
    $plan.Commit = @(Git-Test $plan.Path @('rev-parse', 'HEAD'))[0]
    $script:ObservedMaster = $plan.Commit
    $null = Git-Test $plan.Path @('checkout', '-B', 'master', $base)
    Add-Content -LiteralPath (Join-Path $plan.Path '.git\info\exclude') -Value 'private.txt'
    Set-Content -LiteralPath (Join-Path $plan.Path 'private.txt') -Value 'precious ignored data'
    $prepared = Prepare-RepositoryUpdate $plan
    Expect-Refusal { Apply-RepositoryUpdate $prepared } 'Git merge failed'
    if ((Get-Content -LiteralPath (Join-Path $plan.Path 'private.txt') -Raw).Trim() -ne 'precious ignored data') { throw 'Ignored data overwritten' }

    $plan = New-Fixture 'identity-change'
    $base = Read-GitValue $plan.Path @('rev-parse', 'HEAD')
    $null = Git-Test $plan.Path @('checkout', '-B', 'master', $plan.Commit)
    Set-Content -LiteralPath (Join-Path $plan.Path 'manifest.json') -Value '{"version":"2.0.0","key":"synthetic-new-identity"}'
    $null = Git-Test $plan.Path @('commit', '-am', 'synthetic identity change')
    $plan.Commit = @(Git-Test $plan.Path @('rev-parse', 'HEAD'))[0]
    $script:ObservedMaster = $plan.Commit
    $null = Git-Test $plan.Path @('checkout', '-B', 'master', $base)
    Expect-Refusal { Prepare-RepositoryUpdate $plan } 'Manifest identity key changed'

    $plan = New-Fixture 'replacement-object'
    $base = Read-GitValue $plan.Path @('rev-parse', 'HEAD')
    $null = Git-Test $plan.Path @('checkout', '-b', 'synthetic-replacement', $base)
    Set-Content -LiteralPath (Join-Path $plan.Path 'manifest.json') -Value '{"version":"99.0.0"}'
    $null = Git-Test $plan.Path @('commit', '-am', 'synthetic substituted object')
    $replacement = @(Git-Test $plan.Path @('rev-parse', 'HEAD'))[0]
    $null = Git-Test $plan.Path @('checkout', 'master')
    $null = Git-Test $plan.Path @('replace', $plan.Commit, $replacement)
    # Demonstrate substitution is active for ordinary Git; this read executes no repository code.
    $substituted = @(& $script:GitExecutable @script:GitOptions -C $plan.Path show ($plan.Commit + ':manifest.json'))
    if ($LASTEXITCODE -or (($substituted -join "`n" | ConvertFrom-Json).version -ne '99.0.0')) { throw 'Replacement attack fixture is not active' }
    $prepared = Prepare-RepositoryUpdate $plan
    if ($prepared.Version -ne '2.0.0') { throw 'Pinned manifest was substituted by replacement ref' }
    Apply-RepositoryUpdate $prepared
    if ((Get-Content -LiteralPath (Join-Path $plan.Path 'manifest.json') -Raw | ConvertFrom-Json).version -ne '2.0.0') {
        throw 'Pinned checkout was substituted by replacement ref'
    }
    if ((Read-GitValue $plan.Path @('rev-parse', 'HEAD')) -ne $plan.Commit) { throw 'Replacement changed pinned HEAD' }
    if ((Read-GitValue $plan.Path @('rev-parse', ('refs/replace/' + $plan.Commit))) -ne $replacement) { throw 'Existing replacement ref was modified' }
    $script:Passed++
    # Establish the inherited-config failure with actual Git in a separate disposable repo.
    $plan = New-Fixture 'inherited-squash-demonstration'
    $before = Read-GitValue $plan.Path @('rev-parse', 'HEAD')
    $null = Git-Test $plan.Path @('config', 'branch.master.mergeOptions', '--squash')
    $null = Git-Test $plan.Path @('merge', '--ff-only', '--no-edit', '--no-autostash', $plan.Commit)
    if ((Read-GitValue $plan.Path @('rev-parse', 'HEAD')) -ne $before -or
        (Invoke-RepoGit $plan.Path @('status', '--porcelain=v1')).Lines.Count -eq 0) { throw 'Inherited squash fixture did not demonstrate unchanged HEAD and dirty index' }

    $first = New-Fixture 'production-start-capture'
    $base = Read-GitValue $first.Path @('rev-parse', 'HEAD')
    $null = Git-Test $first.Path @('checkout', '-b', 'synthetic-replacement', $base)
    Set-Content -LiteralPath (Join-Path $first.Path 'manifest.json') -Value '{"version":"99.0.0"}'
    $null = Git-Test $first.Path @('commit', '-am', 'synthetic Start replacement')
    $replacement = @(Git-Test $first.Path @('rev-parse', 'HEAD'))[0]
    $null = Git-Test $first.Path @('checkout', 'master')
    $null = Git-Test $first.Path @('replace', $first.Commit, $replacement)
    $second = New-Fixture 'production-start-reddit'
    $second.Origin = 'https://github.com/OhOkThisIsFine/reddit-autoblocker.git'
    $null = Git-Test $second.Path @('config', 'remote.origin.url', $second.Origin)
    $script:StartPlans = @($first, $second)
    function Get-LoadedRepositoryPlans { $script:StartPlans }
    foreach ($candidate in $script:StartPlans) {
        $script:ObservedMasters[$candidate.Path] = $candidate.Commit
        $null = Git-Test $candidate.Path @('config', 'branch.master.mergeOptions', '--squash')
        [IO.File]::WriteAllText((Join-Path $candidate.Path '.git\hooks\post-merge'), "#!/bin/sh`ntouch hook-ran`n")
    }
    $script:VerifyProductionOptions = $true
    Start-FolderUpdate
    $script:VerifyProductionOptions = $false # Start has already removed its empty temporary hooks directory.
    foreach ($candidate in $script:StartPlans) {
        if ((Read-GitValue $candidate.Path @('rev-parse', 'HEAD')) -ne $candidate.Commit) { throw 'Production Start did not fast-forward' }
        if ((Invoke-RepoGit $candidate.Path @('status', '--porcelain=v1')).Lines.Count) { throw 'Production Start dirtied the repository' }
        if ((Get-Content -LiteralPath (Join-Path $candidate.Path 'manifest.json') -Raw | ConvertFrom-Json).version -ne '2.0.0') { throw 'Production Start installed substituted tree' }
        if (Test-Path -LiteralPath (Join-Path $candidate.Path 'hook-ran')) { throw 'Production Start executed hook' }
        if ((Read-GitValue $candidate.Path @('config', '--local', '--get', 'branch.master.mergeOptions')) -ne '--squash') { throw 'Persistent merge config changed' }
    }
    if ($script:ProductionMergeCalls -ne 2) { throw 'Actual Start merge route was not exercised for both repos' }
    $script:Passed++
    Write-Host "PASS $script:Passed safety cases; real disposable Git, synthetic fetch/master; no network/browser."
    Write-Host "Retained synthetic fixtures: $root"
} catch { Write-Error $_ -ErrorAction Continue; Write-Host "Retained failed fixtures: $root"; exit 1 }
