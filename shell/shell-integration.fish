# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------

#
# Pulsar terminal integration for fish (based on same for Visual Studio Code)
#
# Manual installation:
#
#   (1) Add the following to the end of `$__fish_config_dir/config.fish`:
#
#         string match -q "$TERM_PROGRAM" "pulsar"
#         and . (code --locate-shell-integration-path fish)
#
#   (2) Restart fish.

# Don't run in scripts, other terminals, or more than once per session.
status is-interactive
and string match --quiet "$TERM_PROGRAM" "pulsar"
and ! set --query PULSAR_TERMINAL_SHELL_INTEGRATION
or exit

set --global PULSAR_TERMINAL_SHELL_INTEGRATION 1
set --global __pulsar_shell_env_reporting $PULSAR_TERMINAL_SHELL_ENV_REPORTING
set -e PULSAR_TERMINAL_SHELL_ENV_REPORTING

# Prevent AI-executed commands from polluting shell history
if test "$PULSAR_TERMINAL_PREVENT_SHELL_HISTORY" = "1"
	set -g fish_private_mode 1
	set -e PULSAR_TERMINAL_PREVENT_SHELL_HISTORY
end

set -g envVarsToReport
if test -n "$__pulsar_shell_env_reporting"
	set envVarsToReport (string split "," "$__pulsar_shell_env_reporting")
end

# Apply any explicit path prefix (see #99878)
# On fish, '$fish_user_paths' is always prepended to the PATH, for both login and non-login shells, so we need
# to apply the path prefix fix always, not only for login shells (see #232291)
if set -q PULSAR_TERMINAL_PATH_PREFIX
	set -gx PATH "$PULSAR_TERMINAL_PATH_PREFIX$PATH"
end
set -e PULSAR_TERMINAL_PATH_PREFIX

set -g pulsar_env_keys
set -g pulsar_env_values

# Tracks if the shell has been initialized, this prevents
set -g pulsar_initialized 0

set -g __pulsar_applied_env_vars 0
function __pulsar_apply_env_vars
	if test $__pulsar_applied_env_vars -eq 1;
		return
	end
	set -l __pulsar_applied_env_vars 1
	# Apply EnvironmentVariableCollections if needed
	if test -n "$PULSAR_TERMINAL_ENV_REPLACE"
		set ITEMS (string split : $PULSAR_TERMINAL_ENV_REPLACE)
		for B in $ITEMS
			set split (string split -m1 = $B)
			set -gx "$split[1]" (echo -e "$split[2]")
		end
		set -e PULSAR_TERMINAL_ENV_REPLACE
	end
	if test -n "$PULSAR_TERMINAL_ENV_PREPEND"
		set ITEMS (string split : $PULSAR_TERMINAL_ENV_PREPEND)
		for B in $ITEMS
			set split (string split -m1 = $B)
			set -gx "$split[1]" (echo -e "$split[2]")"$$split[1]" # avoid -p as it adds a space
		end
		set -e PULSAR_TERMINAL_ENV_PREPEND
	end
	if test -n "$PULSAR_TERMINAL_ENV_APPEND"
		set ITEMS (string split : $PULSAR_TERMINAL_ENV_APPEND)
		for B in $ITEMS
			set split (string split -m1 = $B)
			set -gx "$split[1]" "$$split[1]"(echo -e "$split[2]") # avoid -a as it adds a space
		end
		set -e PULSAR_TERMINAL_ENV_APPEND
	end
end

# Register Python shell activate hooks
# Prevent multiple activation with guard
if not set -q PULSAR_TERMINAL_PYTHON_AUTOACTIVATE_GUARD
	set -gx PULSAR_TERMINAL_PYTHON_AUTOACTIVATE_GUARD 1
	if test -n "$PULSAR_TERMINAL_PYTHON_FISH_ACTIVATE"; and test "$TERM_PROGRAM" = "pulsar"
		# Fish does not crash on eval failure, so don't need negation.
		eval $PULSAR_TERMINAL_PYTHON_FISH_ACTIVATE
		set __pulsar_activation_status $status

		if test $__pulsar_activation_status -ne 0
			builtin printf '\x1b[0m\x1b[7m * \x1b[0;103m VS Code Python fish activation failed with exit code %d \x1b[0m \n' "$__pulsar_activation_status"
		end
	end
	# Remove any leftover Python activation env vars.
	for var in (set -n | string match -r '^PULSAR_TERMINAL_PYTHON_.*_ACTIVATE$')
		set -eg $var
	end
end

# Handle the shell integration nonce
if set -q PULSAR_TERMINAL_NONCE
	set -l __pulsar_nonce $PULSAR_TERMINAL_NONCE
	set -e PULSAR_TERMINAL_NONCE
end

# Helper function
function __pulsar_esc -d "Emit escape sequences for VS Code shell integration"
	builtin printf "\e]633;%s\a" (string join ";" -- $argv)
end

# Sent right before executing an interactive command.
# Marks the beginning of command output.
function __pulsar_cmd_executed --on-event fish_preexec
	__pulsar_esc E (__pulsar_escape_value "$argv") $__pulsar_nonce
	__pulsar_esc C

	# Creates a marker to indicate a command was run.
	set --global _pulsar_has_cmd
end


# Escape a value for use in the 'P' ("Property") or 'E' ("Command Line") sequences.
# Backslashes are doubled and non-alphanumeric characters are hex encoded.
function __pulsar_escape_value
	# Escape backslashes and semi-colons
	echo $argv | string replace --all '\\' '\\\\' | string replace --all ';' '\\x3b'
end

# Sent right after an interactive command has finished executing.
# Marks the end of command output.
function __pulsar_cmd_finished --on-event fish_postexec
	__pulsar_esc D $status
end

# Sent when a command line is cleared or reset, but no command was run.
# Marks the cleared line with neither success nor failure.
function __pulsar_cmd_clear --on-event fish_cancel
	if test $pulsar_initialized -eq 0;
		return
	end
	__pulsar_esc E "" $__pulsar_nonce
	__pulsar_esc C
	__pulsar_esc D
end

# Preserve the user's existing prompt, to wrap in our escape sequences.
function __preserve_fish_prompt --on-event fish_prompt
	if functions --query fish_prompt
		if functions --query __pulsar_fish_prompt
			# Erase the fallback so it can be set to the user's prompt
			functions --erase __pulsar_fish_prompt
		end
		functions --copy fish_prompt __pulsar_fish_prompt
		functions --erase __preserve_fish_prompt
		# Now __pulsar_fish_prompt is guaranteed to be defined
		__init_pulsar_shell_integration
	else
		if functions --query __pulsar_fish_prompt
			functions --erase __preserve_fish_prompt
			__init_pulsar_shell_integration
		else
			# There is no fish_prompt set, so stick with the default
			# Now __pulsar_fish_prompt is guaranteed to be defined
			function __pulsar_fish_prompt
				echo -n (whoami)@(prompt_hostname) (prompt_pwd) '~> '
			end
		end
	end
end

# Sent whenever a new fish prompt is about to be displayed.
# Updates the current working directory.
function __pulsar_update_cwd --on-event fish_prompt
	__pulsar_esc P Cwd=(__pulsar_escape_value "$PWD")

	# If a command marker exists, remove it.
	# Otherwise, the commandline is empty and no command was run.
	if set --query _pulsar_has_cmd
		set --erase _pulsar_has_cmd
	else
		__pulsar_cmd_clear
	end
end

if test -n "$__pulsar_shell_env_reporting"
	function __pulsar_update_env --on-event fish_prompt
		if test (count $envVarsToReport) -gt 0
			__pulsar_esc EnvSingleStart 1

			for key in $envVarsToReport
				if set -q $key
					set -l value $$key
					__pulsar_esc EnvSingleEntry $key (__pulsar_escape_value "$value")
				end
			end

			__pulsar_esc EnvSingleEnd
		end
	end
end

# Sent at the start of the prompt.
# Marks the beginning of the prompt (and, implicitly, a new line).
function __pulsar_fish_prompt_start
	# Applying environment variables is deferred to after config.fish has been
	# evaluated
	__pulsar_apply_env_vars
	__pulsar_esc A
	set -g pulsar_initialized 1
end

# Sent at the end of the prompt.
# Marks the beginning of the user's command input.
function __pulsar_fish_cmd_start
	__pulsar_esc B
end

function __pulsar_fish_has_mode_prompt -d "Returns true if fish_mode_prompt is defined and not empty"
	functions fish_mode_prompt | string match -rvq '^ *(#|function |end$|$)'
end

# Preserve and wrap fish_mode_prompt (which appears to the left of the regular
# prompt), but only if it's not defined as an empty function (which is the
# officially documented way to disable that feature).
function __init_pulsar_shell_integration
	if __pulsar_fish_has_mode_prompt
		functions --copy fish_mode_prompt __pulsar_fish_mode_prompt

		function fish_mode_prompt
			__pulsar_fish_prompt_start
			__pulsar_fish_mode_prompt
		end

		function fish_prompt
			__pulsar_fish_prompt
			__pulsar_fish_cmd_start
		end
	else
		# No fish_mode_prompt, so put everything in fish_prompt.
		function fish_prompt
			__pulsar_fish_prompt_start
			__pulsar_fish_prompt
			__pulsar_fish_cmd_start
		end
	end
end

# Report prompt type
if set -q POSH_SESSION_ID
	__pulsar_esc P PromptType=oh-my-posh
end

# Report this shell supports rich command detection
__pulsar_esc P HasRichCommandDetection=True

__preserve_fish_prompt
