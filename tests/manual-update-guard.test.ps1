# Imported by the retained safety suite; all production invocations below have invalid targets.
$guardInitialize = (Get-Command Initialize-UpdateGit).ScriptBlock
$guardPlans = (Get-Command Get-LoadedRepositoryPlans).ScriptBlock
$guardCapture = $CaptureCommit
$guardReddit = $RedditCommit
$script:GuardTouched = $false
function Initialize-UpdateGit { $script:GuardTouched = $true; throw 'Guard reached Git/temp initialization' }
function Get-LoadedRepositoryPlans { $script:GuardTouched = $true; throw 'Guard reached checkout plans' }
$guardCases = @(
    @('', ''),
    @(('a' * 40), ''),
    @('', ('b' * 40)),
    @('bad', ('b' * 40)),
    @(('a' * 40), 'bad'),
    @(('A' * 40), ('b' * 40)),
    @(('a' * 40), ('B' * 40)),
    @(('a' * 39), ('b' * 40)),
    @(('a' * 40), ('b' * 41))
)
try {
    foreach ($case in $guardCases) {
        $CaptureCommit = $case[0]
        $RedditCommit = $case[1]
        try { Start-FolderUpdate; throw 'Unexpected acceptance' } catch {
            if ($_.Exception.Message -notmatch 'Manual update refused: supply both explicit reviewed lowercase 40-hex SHAs') { throw }
        }
        if ($script:GuardTouched) { throw 'Invalid targets reached Git, temp creation or checkout planning' }
    }
} finally {
    Set-Item -Path Function:Initialize-UpdateGit -Value $guardInitialize
    Set-Item -Path Function:Get-LoadedRepositoryPlans -Value $guardPlans
    $CaptureCommit = $guardCapture
    $RedditCommit = $guardReddit
}

function Invoke-GuardProcess {
    param([string]$Executable, [string]$Arguments, [int]$ExpectedExit)
    $before = @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'extension-update-empty-hooks-*' | ForEach-Object { $_.Name })
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        $null = $process.Start()
        $process.StandardInput.WriteLine()
        $process.StandardInput.WriteLine()
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(10000)) {
            $process.Kill()
            throw 'Invalid-target subprocess failed to finish'
        }
        $output = $process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()
        if ($process.ExitCode -ne $ExpectedExit) { throw "Unexpected guard exit: $($process.ExitCode). $output" }
        if ($ExpectedExit -ne 0 -and ($output -replace '\s+', ' ') -notmatch 'Manual update refused: supply both explicit reviewed lowercase 40-hex SHAs') {
            throw "Subprocess did not reach explicit SHA refusal: $output"
        }
    } finally { $process.Dispose() }
    $after = @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'extension-update-empty-hooks-*' | ForEach-Object { $_.Name })
    if (Compare-Object $before $after) { throw 'Invalid invocation created a hooks directory' }
}
$guardScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/update-loaded-folders.ps1'))
$guardWrapper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/update-loaded-folders.cmd'))
$guardArguments = @('', ('-CaptureCommit ' + ('a' * 40)), ('-RedditCommit ' + ('b' * 40)),
    '-CaptureCommit bad -RedditCommit bad', ('-CaptureCommit ' + ('A' * 40) + ' -RedditCommit ' + ('b' * 40)))
Invoke-GuardProcess 'powershell.exe' ('-NoProfile -File "{0}" -DefineOnly' -f $guardScript) 0
foreach ($arguments in $guardArguments) {
    Invoke-GuardProcess 'powershell.exe' ('-NoProfile -File "{0}" {1}' -f $guardScript, $arguments) 1
    Invoke-GuardProcess 'cmd.exe' ('/d /c ""{0}" {1}"' -f $guardWrapper, $arguments) 1
}
Write-Host 'PASS 9 early-guard cases, inert DefineOnly, and 10 direct/wrapper refusals; no Git or checkout operation.'
