[CmdletBinding()]
param(
    [string]$CaptureCommit = 'a6326a67fd40f6ea60c3dcbb9bb2324b18caa813',
    [string]$RedditCommit = 'eb50f95b197d239c7ed562e27721b505363de1a4',
    [switch]$DefineOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-RepoGit {
    param([string]$Path, [string[]]$GitArguments, [switch]$AllowOne)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $script:GitExecutable --no-replace-objects @script:GitOptions -C $Path @GitArguments 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($code -ne 0 -and -not ($AllowOne -and $code -eq 1)) {
        throw "Git $($GitArguments[0]) failed in $Path (exit $code); no recovery/reset attempted."
    }
    [pscustomobject]@{ Code = $code; Lines = @($output | ForEach-Object { $_.ToString() }) }
}

function Read-GitValue {
    param([string]$Path, [string[]]$GitArguments)
    $result = Invoke-RepoGit $Path $GitArguments
    if ($result.Lines.Count -ne 1) { throw "Ambiguous Git value in $Path." }
    $result.Lines[0].Trim()
}

function Assert-CleanRepository {
    param($Plan)
    $top = Read-GitValue $Plan.Path @('rev-parse', '--show-toplevel')
    if ($top.Replace('/', '\').TrimEnd('\') -cne $Plan.Path) { throw 'Unexpected repository root.' }
    foreach ($arguments in @(@('config', '--get', 'remote.origin.url'), @('remote', 'get-url', 'origin'))) {
        if ((Read-GitValue $Plan.Path $arguments) -cne $Plan.Origin) { throw "Origin mismatch: $($Plan.Path)." }
    }
    if ((Read-GitValue $Plan.Path @('branch', '--show-current')) -cne 'master') { throw 'Expected master branch.' }
    $status = Invoke-RepoGit $Plan.Path @('status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none')
    if ($status.Lines.Count) { throw "Local edits/untracked files: $($Plan.Path). Preserve them; update refused." }
    $flags=Invoke-RepoGit $Plan.Path @('ls-files','-v')
    if (@($flags.Lines | Where-Object { $_ -cmatch '^[a-zS] ' }).Count) { throw 'Hidden assume-unchanged/skip-worktree state; update refused.' }
    $gitDirectory = Read-GitValue $Plan.Path @('rev-parse', '--absolute-git-dir')
    foreach ($marker in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'index.lock')) {
        if (Test-Path -LiteralPath (Join-Path $gitDirectory $marker)) { throw "Git operation in progress: $marker." }
    }
}

function Prepare-RepositoryUpdate {
    param($Plan)
    if ($Plan.Commit -cnotmatch '^[0-9a-f]{40}$') { throw 'Choose an exact reviewed 40-character commit.' }
    Assert-CleanRepository $Plan
    $before = Read-GitValue $Plan.Path @('rev-parse', 'HEAD')
    $remote = Read-GitValue $Plan.Path @('ls-remote', '--exit-code', 'origin', 'refs/heads/master')
    if ($remote -cne ($Plan.Commit + "`trefs/heads/master")) { throw "Master differs from chosen commit: $($Plan.Path). Review the new commit first." }
    # Fetch the named branch, never arbitrary URLs/releases or recursive submodules.
    $null = Invoke-RepoGit $Plan.Path @('fetch', '--no-recurse-submodules', 'origin', 'refs/heads/master:refs/remotes/origin/master')
    if ((Read-GitValue $Plan.Path @('rev-parse', 'refs/remotes/origin/master')) -cne $Plan.Commit) { throw 'Remote changed during fetch.' }
    $ancestry = Invoke-RepoGit $Plan.Path @('merge-base', '--is-ancestor', $before, $Plan.Commit) -AllowOne
    if ($ancestry.Code) { throw "Diverged/ahead checkout: $($Plan.Path). Update refused." }
    $tree = Invoke-RepoGit $Plan.Path @('ls-tree', '-r', $Plan.Commit)
    foreach ($line in $tree.Lines) {
        if ($line -match '^160000 ') { throw 'Submodules are unsupported; update refused.' }
        if ($line -match "`t(.*/)?\.gitattributes$") {
            $attributePath = $line.Split("`t", 2)[1]
            $attributes = Invoke-RepoGit $Plan.Path @('show', ($Plan.Commit + ':' + $attributePath))
            foreach ($attributeLine in $attributes.Lines) {
                if ($attributeLine.TrimStart().StartsWith('#')) { continue }
                if ($attributeLine -match '(^|\s)([-!]?filter(?:=|\s|$)|[-!]?working-tree-encoding(?:=|\s|$))') {
                    throw 'Checkout filters/encoding attributes are unsupported; no remote code execution.'
                }
            }
        }
    }
    $manifest = Invoke-RepoGit $Plan.Path @('show', ($Plan.Commit + ':manifest.json'))
    $targetManifest = $manifest.Lines -join "`n" | ConvertFrom-Json
    $currentManifest = Get-Content -LiteralPath (Join-Path $Plan.Path 'manifest.json') -Raw | ConvertFrom-Json
    $oldKey = $currentManifest.PSObject.Properties['key']
    $newKey = $targetManifest.PSObject.Properties['key']
    if (($null -eq $oldKey) -ne ($null -eq $newKey) -or
        ($null -ne $oldKey -and $oldKey.Value -cne $newKey.Value)) {
        throw 'Manifest identity key changed; preserve extension ID and refuse update.'
    }
    $targetVersion = $targetManifest.version
    [pscustomobject]@{ Plan = $Plan; Before = $before; Version = $targetVersion }
}

function Apply-RepositoryUpdate {
    param($Prepared)
    $plan = $Prepared.Plan
    Assert-CleanRepository $plan
    if ((Read-GitValue $plan.Path @('rev-parse', 'HEAD')) -cne $Prepared.Before) { throw 'Checkout changed after preflight.' }
    if ((Read-GitValue $plan.Path @('rev-parse', 'refs/remotes/origin/master')) -cne $plan.Commit) { throw 'Tracking ref changed after preflight.' }
    if ($Prepared.Before -cne $plan.Commit) {
        $null = Invoke-RepoGit $plan.Path @('merge', '--ff-only', '--no-squash', '--no-edit', '--no-autostash', '--no-overwrite-ignore', $plan.Commit)
    }
    if ((Read-GitValue $plan.Path @('rev-parse', 'HEAD')) -cne $plan.Commit) { throw 'Final HEAD mismatch.' }
    Assert-CleanRepository $plan
    $version = (Get-Content -LiteralPath (Join-Path $plan.Path 'manifest.json') -Raw | ConvertFrom-Json).version
    if ($version -cne $Prepared.Version) { throw 'Manifest version mismatch.' }
    Write-Host "$($plan.Name): $version on disk, HEAD $($plan.Commit)."
}

function Get-LoadedRepositoryPlans {
    # Internal seam for disposable tests; the user-facing script exposes no folder override.
    @(
        [pscustomobject]@{ Name = 'Capture Full Page'; Path = 'C:\Code\capture-full-page-extension'; Origin = 'https://github.com/OhOkThisIsFine/capture-full-page-extension.git'; Commit = $CaptureCommit },
        [pscustomobject]@{ Name = 'Reddit Keyword Auto-Blocker'; Path = 'C:\Code\reddit-autoblocker'; Origin = 'https://github.com/OhOkThisIsFine/reddit-autoblocker.git'; Commit = $RedditCommit }
    )
}

function Initialize-UpdateGit {
    param([object[]]$Plans)
    $script:GitExecutable = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $hooks = Join-Path ([IO.Path]::GetTempPath()) ('extension-update-empty-hooks-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $hooks
    try {
        # Per-command overrides only. Remote hooks, checkout filters, fsmonitor and maintenance cannot run.
        $script:GitOptions = @('-c', "core.hooksPath=$hooks", '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false',
            '-c', 'fetch.recurseSubmodules=false', '-c', 'merge.autoStash=false', '-c', 'branch.master.mergeOptions=', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
            '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always')
        foreach ($plan in $Plans) {
            $directory = Get-Item -LiteralPath $plan.Path -ErrorAction Stop
            if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected an ordinary repository directory.' }
            $filters = Invoke-RepoGit $plan.Path @('config', '--name-only', '--get-regexp', '^filter\..*\.(smudge|process|clean|required)$') -AllowOne
            foreach ($filter in $filters.Lines) {
                $setting = if ($filter.EndsWith('.required')) { 'false' } else { '' }
                $script:GitOptions += @('-c', ($filter + '=' + $setting))
            }
        }
        return $hooks
    } catch {
        [IO.Directory]::Delete($hooks, $false)
        throw
    }
}

function Start-FolderUpdate {
    $plans = @(Get-LoadedRepositoryPlans)
    $hooks = Initialize-UpdateGit $plans
    try {
        # Validate both candidates before updating either working tree. Fetch may update tracking refs.
        $prepared = @($plans | ForEach-Object { Prepare-RepositoryUpdate $_ })
        foreach ($candidate in $prepared) { Apply-RepositoryUpdate $candidate }
        Write-Host 'Brave has not been reloaded. Click Reload for each extension in brave://extensions, then reload affected tabs.'
        Write-Host 'Folders and extension data were preserved. This does not verify the active browser version.'
    } finally {
        # Delete only this newly created empty directory; never recursive cleanup.
        [IO.Directory]::Delete($hooks, $false)
    }
}

if (-not $DefineOnly) {
    try { Start-FolderUpdate } catch { Write-Error $_ -ErrorAction Continue; exit 1 }
}
