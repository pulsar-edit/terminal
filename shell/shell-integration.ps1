# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------

# Prevent installing more than once per session
if ((Test-Path variable:global:__PulsarState) -and $null -ne $Global:__PulsarState.OriginalPrompt) {
	return;
}

# Disable shell integration when the language mode is restricted
if ($ExecutionContext.SessionState.LanguageMode -ne "FullLanguage") {
	return;
}

$Global:__PulsarState = @{
	OriginalPrompt = $function:Prompt
	LastHistoryId = -1
	IsInExecution = $false
	EnvVarsToReport = @()
	Nonce = $null
	IsStable = $null
	IsA11yMode = $null
	IsWindows10 = $false
}

# Store the nonce in a regular variable and unset the environment variable. It's by design that
# anything that can execute PowerShell code can read the nonce, as it's basically impossible to hide
# in PowerShell. The most important thing is getting it out of the environment.
$Global:__PulsarState.Nonce = $env:PULSAR_TERMINAL_NONCE
$env:PULSAR_TERMINAL_NONCE = $null

$Global:__PulsarState.IsStable = $env:PULSAR_TERMINAL_STABLE
$env:PULSAR_TERMINAL_STABLE = $null

$Global:__PulsarState.IsA11yMode = $env:PULSAR_TERMINAL_A11Y_MODE
$env:PULSAR_TERMINAL_A11Y_MODE = $null

$__pulsar_shell_env_reporting = $env:PULSAR_TERMINAL_SHELL_ENV_REPORTING
$env:PULSAR_TERMINAL_SHELL_ENV_REPORTING = $null
if ($__pulsar_shell_env_reporting) {
	$Global:__PulsarState.EnvVarsToReport = $__pulsar_shell_env_reporting.Split(',')
}
Remove-Variable -Name __pulsar_shell_env_reporting -ErrorAction SilentlyContinue

$osVersion = [System.Environment]::OSVersion.Version
$Global:__PulsarState.IsWindows10 = $IsWindows -and $osVersion.Major -eq 10 -and $osVersion.Minor -eq 0 -and $osVersion.Build -lt 22000
Remove-Variable -Name osVersion -ErrorAction SilentlyContinue

if ($env:PULSAR_TERMINAL_ENV_REPLACE) {
	$Split = $env:PULSAR_TERMINAL_ENV_REPLACE.Split(":")
	foreach ($Item in $Split) {
		$Inner = $Item.Split('=', 2)
		[Environment]::SetEnvironmentVariable($Inner[0], $Inner[1].Replace('\x3a', ':'))
	}
	$env:PULSAR_TERMINAL_ENV_REPLACE = $null
}
if ($env:PULSAR_TERMINAL_ENV_PREPEND) {
	$Split = $env:PULSAR_TERMINAL_ENV_PREPEND.Split(":")
	foreach ($Item in $Split) {
		$Inner = $Item.Split('=', 2)
		[Environment]::SetEnvironmentVariable($Inner[0], $Inner[1].Replace('\x3a', ':') + [Environment]::GetEnvironmentVariable($Inner[0]))
	}
	$env:PULSAR_TERMINAL_ENV_PREPEND = $null
}
if ($env:PULSAR_TERMINAL_ENV_APPEND) {
	$Split = $env:PULSAR_TERMINAL_ENV_APPEND.Split(":")
	foreach ($Item in $Split) {
		$Inner = $Item.Split('=', 2)
		[Environment]::SetEnvironmentVariable($Inner[0], [Environment]::GetEnvironmentVariable($Inner[0]) + $Inner[1].Replace('\x3a', ':'))
	}
	$env:PULSAR_TERMINAL_ENV_APPEND = $null
}

# Register Python shell activate hooks
# Prevent multiple activation with guard
if (-not $env:PULSAR_TERMINAL_PYTHON_AUTOACTIVATE_GUARD) {
	$env:PULSAR_TERMINAL_PYTHON_AUTOACTIVATE_GUARD = '1'
	if ($env:PULSAR_TERMINAL_PYTHON_PWSH_ACTIVATE -and $env:TERM_PROGRAM -eq 'pulsar') {
		$activateScript = $env:PULSAR_TERMINAL_PYTHON_PWSH_ACTIVATE

		try {
			Invoke-Expression $activateScript
			$Global:__PulsarState.OriginalPrompt = $function:Prompt
		}
		catch {
			$activationError = $_
			Write-Host "`e[0m`e[7m * `e[0;103m VS Code Python powershell activation failed with exit code $($activationError.Exception.Message) `e[0m"
		}
	}
	# Remove any leftover Python activation env vars.
	Get-ChildItem Env:PULSAR_TERMINAL_PYTHON_*_ACTIVATE | Remove-Item -ErrorAction SilentlyContinue
}

function Global:__Pulsar-Escape-Value([string]$value) {
	# NOTE: In PowerShell v6.1+, this can be written `$value -replace '…', { … }` instead of `[regex]::Replace`.
	# Replace any non-alphanumeric characters.
	[regex]::Replace($value, "[$([char]0x00)-$([char]0x1f)\\\n;]", { param($match)
			# Encode the (ascii) matches as `\x<hex>`
			-Join (
				[System.Text.Encoding]::UTF8.GetBytes($match.Value) | ForEach-Object { '\x{0:x2}' -f $_ }
			)
		})
}

function Global:Prompt() {
	$FakeCode = [int]!$global:?
	# NOTE: We disable strict mode for the scope of this function because it unhelpfully throws an
	# error when $LastHistoryEntry is null, and is not otherwise useful.
	Set-StrictMode -Off
	$LastHistoryEntry = Get-History -Count 1
	$Result = ""
	# Skip finishing the command if the first command has not yet started or an execution has not
	# yet begun
	if ($Global:__PulsarState.LastHistoryId -ne -1 -and ($Global:__PulsarState.HasPSReadLine -eq $false -or $Global:__PulsarState.IsInExecution -eq $true)) {
		$Global:__PulsarState.IsInExecution = $false
		if ($LastHistoryEntry.Id -eq $Global:__PulsarState.LastHistoryId) {
			# Don't provide a command line or exit code if there was no history entry (eg. ctrl+c, enter on no command)
			$Result += "$([char]0x1b)]633;D`a"
		}
		else {
			# Command finished exit code
			# OSC 633 ; D [; <ExitCode>] ST
			$Result += "$([char]0x1b)]633;D;$FakeCode`a"
		}
	}
	# Prompt started
	# OSC 633 ; A ST
	$Result += "$([char]0x1b)]633;A`a"
	# Current working directory
	# OSC 633 ; <Property>=<Value> ST
	$Result += if ($pwd.Provider.Name -eq 'FileSystem') { "$([char]0x1b)]633;P;Cwd=$(__Pulsar-Escape-Value $pwd.ProviderPath)`a" }

	# Send current environment variables as JSON
	# OSC 633 ; EnvJson ; <Environment> ; <Nonce>
	if ($Global:__PulsarState.EnvVarsToReport.Count -gt 0) {
		$envMap = @{}
        foreach ($varName in $Global:__PulsarState.EnvVarsToReport) {
            if (Test-Path "env:$varName") {
                $envMap[$varName] = (Get-Item "env:$varName").Value
            }
        }
        $envJson = $envMap | ConvertTo-Json -Compress
        $Result += "$([char]0x1b)]633;EnvJson;$(__Pulsar-Escape-Value $envJson);$($Global:__PulsarState.Nonce)`a"
	}

	# Before running the original prompt, put $? back to what it was:
	if ($FakeCode -ne 0) {
		Write-Error "failure" -ea ignore
	}
	# Run the original prompt
	$OriginalPrompt += $Global:__PulsarState.OriginalPrompt.Invoke()
	$Result += $OriginalPrompt

	# Prompt
	# OSC 633 ; <Property>=<Value> ST
	if ($Global:__PulsarState.IsStable -eq "0") {
		$Result += "$([char]0x1b)]633;P;Prompt=$(__Pulsar-Escape-Value $OriginalPrompt)`a"
	}

	# Write command started
	$Result += "$([char]0x1b)]633;B`a"
	$Global:__PulsarState.LastHistoryId = $LastHistoryEntry.Id
	return $Result
}

# Report prompt type
if ($env:STARSHIP_SESSION_KEY) {
	[Console]::Write("$([char]0x1b)]633;P;PromptType=starship`a")
}
elseif ($env:POSH_SESSION_ID) {
	[Console]::Write("$([char]0x1b)]633;P;PromptType=oh-my-posh`a")
}
elseif ((Test-Path variable:global:GitPromptSettings) -and $Global:GitPromptSettings) {
	[Console]::Write("$([char]0x1b)]633;P;PromptType=posh-git`a")
}

if ($Global:__PulsarState.IsA11yMode -eq "1") {
	# Check if the loaded PSReadLine already supports EnableScreenReaderMode
	$hasScreenReaderParam = (Get-Module -Name PSReadLine) -and (Get-Command Set-PSReadLineOption).Parameters.ContainsKey('EnableScreenReaderMode')

	if (-not $hasScreenReaderParam -and $PSVersionTable.PSVersion -ge "7.0") {
		# The loaded PSReadLine lacks EnableScreenReaderMode (only available in 2.4.4-beta4+).
		# PowerShell 7.0+ skips autoloading PSReadLine when the OS reports a screen reader active.
		# When only VS Code's accessibility mode is enabled (no OS screen reader),
		# it's still loaded and must be removed to load our bundled copy.
		# Skip this on Windows PowerShell 5.1 where removing the built-in PSReadLine 2.0.0
		# and replacing it can cause input handling issues (e.g. repeated Enter key presses).
		if (Get-Module -Name PSReadLine) {
			Remove-Module PSReadLine -Force
		}

		# Import VS Code's bundled PSReadLine 2.4.3 which has EnableScreenReaderMode
		$specialPsrlPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'psreadline'
		if (Test-Path $specialPsrlPath) {
			Import-Module $specialPsrlPath
		}

		$hasScreenReaderParam = (Get-Module -Name PSReadLine) -and (Get-Command Set-PSReadLineOption).Parameters.ContainsKey('EnableScreenReaderMode')
	}

	if ($hasScreenReaderParam) {
		Set-PSReadLineOption -EnableScreenReaderMode
	}
}

# Only send the command executed sequence when PSReadLine is loaded, if not shell integration should
# still work thanks to the command line sequence
$Global:__PulsarState.HasPSReadLine = $false
if (Get-Module -Name PSReadLine) {
	$Global:__PulsarState.HasPSReadLine = $true
	[Console]::Write("$([char]0x1b)]633;P;HasRichCommandDetection=True`a")

	$Global:__PulsarState.OriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine
	function Global:PSConsoleHostReadLine {
		$CommandLine = $Global:__PulsarState.OriginalPSConsoleHostReadLine.Invoke()
		$Global:__PulsarState.IsInExecution = $true

		# Command line
		# OSC 633 ; E [; <CommandLine> [; <Nonce>]] ST
		$Result = "$([char]0x1b)]633;E;"
		$Result += $(__Pulsar-Escape-Value $CommandLine)
		# Only send the nonce if the OS is not Windows 10 as it seems to echo to the terminal
		# sometimes
		if ($Global:__PulsarState.IsWindows10 -eq $false) {
			$Result += ";$($Global:__PulsarState.Nonce)"
		}
		$Result += "`a"

		# Command executed
		# OSC 633 ; C ST
		$Result += "$([char]0x1b)]633;C`a"

		# Write command executed sequence directly to Console to avoid the new line from Write-Host
		[Console]::Write($Result)

		$CommandLine
	}

	# Set ContinuationPrompt property
	$Global:__PulsarState.ContinuationPrompt = (Get-PSReadLineOption).ContinuationPrompt
	if ($Global:__PulsarState.ContinuationPrompt) {
		[Console]::Write("$([char]0x1b)]633;P;ContinuationPrompt=$(__Pulsar-Escape-Value $Global:__PulsarState.ContinuationPrompt)`a")
	}
}

# Set IsWindows property
if ($PSVersionTable.PSVersion -lt "6.0") {
	# Windows PowerShell is only available on Windows
	[Console]::Write("$([char]0x1b)]633;P;IsWindows=$true`a")
}
else {
	[Console]::Write("$([char]0x1b)]633;P;IsWindows=$IsWindows`a")
}

# Set always on key handlers which map to default VS Code keybindings
function Set-MappedKeyHandler {
	param ([string[]] $Chord, [string[]]$Sequence)
	try {
		$Handler = Get-PSReadLineKeyHandler -Chord $Chord | Select-Object -First 1
	}
 catch [System.Management.Automation.ParameterBindingException] {
		# PowerShell 5.1 ships with PSReadLine 2.0.0 which does not have -Chord,
		# so we check what's bound and filter it.
		$Handler = Get-PSReadLineKeyHandler -Bound | Where-Object -FilterScript { $_.Key -eq $Chord } | Select-Object -First 1
	}
	if ($Handler) {
		Set-PSReadLineKeyHandler -Chord $Sequence -Function $Handler.Function
	}
}

function Set-MappedKeyHandlers {
	Set-MappedKeyHandler -Chord Ctrl+Spacebar -Sequence 'F12,a'
	Set-MappedKeyHandler -Chord Alt+Spacebar -Sequence 'F12,b'
	Set-MappedKeyHandler -Chord Shift+Enter -Sequence 'F12,c'
	Set-MappedKeyHandler -Chord Shift+End -Sequence 'F12,d'
}

if ($Global:__PulsarState.HasPSReadLine) {
	Set-MappedKeyHandlers

	# Prevent AI-executed commands from polluting shell history
	if ($env:PULSAR_TERMINAL_PREVENT_SHELL_HISTORY -eq "1") {
		Set-PSReadLineOption -AddToHistoryHandler {
			param([string]$line)
			return $false
		}
		$env:PULSAR_TERMINAL_PREVENT_SHELL_HISTORY = $null
	}
}
