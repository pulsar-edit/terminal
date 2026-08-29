# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------

# Prevent the script recursing when setting up
if [[ -n "${PULSAR_TERMINAL_SHELL_INTEGRATION:-}" ]]; then
	builtin return
fi

PULSAR_TERMINAL_SHELL_INTEGRATION=1

pulsar_env_keys=()
pulsar_env_values=()
use_associative_array=0
bash_major_version=${BASH_VERSINFO[0]}

__pulsar_terminal_shell_env_reporting="${PULSAR_TERMINAL_SHELL_ENV_REPORTING:-}"
unset PULSAR_TERMINAL_SHELL_ENV_REPORTING

envVarsToReport=()
IFS=',' read -ra envVarsToReport <<< "$__pulsar_terminal_shell_env_reporting"

if (( BASH_VERSINFO[0] >= 4 )); then
	use_associative_array=1
	# Associative arrays are only available in bash 4.0+
	declare -A pulsar_aa_env
fi

# Run relevant rc/profile only if shell integration has been injected, not when run manually
if [ "$PULSAR_TERMINAL_INJECTION" == "1" ]; then
	if [ -z "$PULSAR_TERMINAL_SHELL_LOGIN" ]; then
		if [ -r ~/.bashrc ]; then
			. ~/.bashrc
		fi
	else
		# Imitate -l because --init-file doesn't support it:
		# run the first of these files that exists
		if [ -r /etc/profile ]; then
			. /etc/profile
		fi
		# execute the first that exists
		if [ -r ~/.bash_profile ]; then
			. ~/.bash_profile
		elif [ -r ~/.bash_login ]; then
			. ~/.bash_login
		elif [ -r ~/.profile ]; then
			. ~/.profile
		fi
		builtin unset PULSAR_TERMINAL_SHELL_LOGIN

		# Apply any explicit path prefix (see #99878)
		if [ -n "${PULSAR_TERMINAL_PATH_PREFIX:-}" ]; then
			export PATH="$PULSAR_TERMINAL_PATH_PREFIX$PATH"
			builtin unset PULSAR_TERMINAL_PATH_PREFIX
		fi
	fi
	builtin unset PULSAR_TERMINAL_INJECTION
fi

if [ -z "$PULSAR_TERMINAL_SHELL_INTEGRATION" ]; then
	builtin return
fi

# Prevent AI-executed commands from polluting shell history
if [ "${PULSAR_TERMINAL_PREVENT_SHELL_HISTORY:-}" = "1" ]; then
	export HISTCONTROL="ignorespace"
	builtin unset PULSAR_TERMINAL_PREVENT_SHELL_HISTORY
fi

# Apply EnvironmentVariableCollections if needed
if [ -n "${PULSAR_TERMINAL_ENV_REPLACE:-}" ]; then
	IFS=':' read -ra ADDR <<< "$PULSAR_TERMINAL_ENV_REPLACE"
	for ITEM in "${ADDR[@]}"; do
		VARNAME="$(echo $ITEM | cut -d "=" -f 1)"
		VALUE="$(echo -e "$ITEM" | cut -d "=" -f 2-)"
		export $VARNAME="$VALUE"
	done
	builtin unset PULSAR_TERMINAL_ENV_REPLACE
fi
if [ -n "${PULSAR_TERMINAL_ENV_PREPEND:-}" ]; then
	IFS=':' read -ra ADDR <<< "$PULSAR_TERMINAL_ENV_PREPEND"
	for ITEM in "${ADDR[@]}"; do
		VARNAME="$(echo $ITEM | cut -d "=" -f 1)"
		VALUE="$(echo -e "$ITEM" | cut -d "=" -f 2-)"
		export $VARNAME="$VALUE${!VARNAME}"
	done
	builtin unset PULSAR_TERMINAL_ENV_PREPEND
fi
if [ -n "${PULSAR_TERMINAL_ENV_APPEND:-}" ]; then
	IFS=':' read -ra ADDR <<< "$PULSAR_TERMINAL_ENV_APPEND"
	for ITEM in "${ADDR[@]}"; do
		VARNAME="$(echo $ITEM | cut -d "=" -f 1)"
		VALUE="$(echo -e "$ITEM" | cut -d "=" -f 2-)"
		export $VARNAME="${!VARNAME}$VALUE"
	done
	builtin unset PULSAR_TERMINAL_ENV_APPEND
fi

# Register Python shell activate hooks
# Prevent multiple activation with guard
if [ -z "${PULSAR_TERMINAL_PYTHON_AUTOACTIVATE_GUARD:-}" ]; then
	export PULSAR_TERMINAL_PYTHON_AUTOACTIVATE_GUARD=1
	if [ -n "${PULSAR_TERMINAL_PYTHON_BASH_ACTIVATE:-}" ] && [ "$TERM_PROGRAM" = "pulsar" ]; then
		# Prevent crashing by negating exit code
		if ! builtin eval "$PULSAR_TERMINAL_PYTHON_BASH_ACTIVATE"; then
			__pulsar_activation_status=$?
			builtin printf '\x1b[0m\x1b[7m * \x1b[0;103m Pulsar Python bash activation failed with exit code %d \x1b[0m' "$__pulsar_activation_status"
		fi
	fi
	# Remove any leftover Python activation env vars.
	for var in "${!PULSAR_TERMINAL_PYTHON_@}"; do
		case "$var" in
			PULSAR_TERMINAL_PYTHON_*_ACTIVATE)
				unset "$var"
				;;
		esac
	done
fi

__pulsar_get_trap() {
	# 'trap -p DEBUG' outputs a shell command like `trap -- '…shellcode…' DEBUG`.
	# The terms are quoted literals, but are not guaranteed to be on a single line.
	# (Consider a trap like $'echo foo\necho \'bar\'').
	# To parse, we splice those terms into an expression capturing them into an array.
	# This preserves the quoting of those terms: when we `eval` that expression, they are preserved exactly.
	# This is different than simply exploding the string, which would split everything on IFS, oblivious to quoting.
	builtin local -a terms
	builtin eval "terms=( $(trap -p "${1:-DEBUG}") )"
	#                    |________________________|
	#                            |
	#        \-------------------*--------------------/
	# terms=( trap  --  '…arbitrary shellcode…'  DEBUG )
	#        |____||__| |_____________________| |_____|
	#          |    |            |                |
	#          0    1            2                3
	#                            |
	#                   \--------*----/
	builtin printf '%s' "${terms[2]:-}"
}

__pulsar_escape_value_fast() {
	builtin local LC_ALL=C out
	out=${1//\\/\\\\}
	out=${out//;/\\x3b}
	builtin printf '%s\n' "${out}"
}

# The property (P) and command (E) codes embed values which require escaping.
# Backslashes are doubled. Non-alphanumeric characters are converted to escaped hex.
__pulsar_escape_value() {
	# If the input being too large, switch to the faster function
	if [ "${#1}" -ge 2000 ]; then
		__pulsar_escape_value_fast "$1"
		builtin return
	fi

	# Process text byte by byte, not by codepoint.
	builtin local -r LC_ALL=C
	builtin local -r str="${1}"
	builtin local -ir len="${#str}"

	builtin local -i i
	builtin local -i val
	builtin local byte
	builtin local token
	builtin local out=''

	for (( i=0; i < "${#str}"; ++i )); do
		# Escape backslashes, semi-colons specially, then special ASCII chars below space (0x20).
		byte="${str:$i:1}"
		builtin printf -v val '%d' "'$byte"
		if  (( val < 31 )); then
			builtin printf -v token '\\x%02x' "'$byte"
		elif (( val == 92 )); then # \
			token="\\\\"
		elif (( val == 59 )); then # ;
			token="\\x3b"
		else
			token="$byte"
		fi

		out+="$token"
	done

	builtin printf '%s\n' "$out"
}

# Send the IsWindows property if the environment looks like Windows
__pulsar_regex_environment="^CYGWIN*|MINGW*|MSYS*"
if [[ "$(uname -s)" =~ $__pulsar_regex_environment ]]; then
	builtin printf '\e]633;P;IsWindows=True\a'
	__pulsar_is_windows=1
else
	__pulsar_is_windows=0
fi

# Allow verifying $BASH_COMMAND doesn't have aliases resolved via history when the right HISTCONTROL
# configuration is used
__pulsar_regex_histcontrol=".*(erasedups|ignoreboth|ignoredups|ignorespace).*"
if [[ "${HISTCONTROL:-}" =~ $__pulsar_regex_histcontrol ]]; then
	__pulsar_history_verify=0
else
	__pulsar_history_verify=1
fi

builtin unset __pulsar_regex_environment
builtin unset __pulsar_regex_histcontrol

__pulsar_initialized=0
__pulsar_original_PS1="$PS1"
__pulsar_original_PS2="$PS2"
__pulsar_custom_PS1=""
__pulsar_custom_PS2=""
__pulsar_in_command_execution="1"
__pulsar_current_command=""

# It's fine this is in the global scope as it getting at it requires access to the shell environment
__pulsar_nonce="$PULSAR_TERMINAL_NONCE"
unset PULSAR_TERMINAL_NONCE

# Some features should only work in Insiders
__pulsar_stable="$PULSAR_TERMINAL_STABLE"
unset PULSAR_TERMINAL_STABLE

# Report continuation prompt
if [ "$__pulsar_stable" = "0" ]; then
	builtin printf "\e]633;P;ContinuationPrompt=$(echo "$PS2" | sed 's/\x1b/\\\\x1b/g')\a"
fi

if [ -n "$STARSHIP_SESSION_KEY" ]; then
	builtin printf '\e]633;P;PromptType=starship\a'
elif [ -n "$POSH_SESSION_ID" ]; then
	builtin printf '\e]633;P;PromptType=oh-my-posh\a'
fi

# Report this shell supports rich command detection
builtin printf '\e]633;P;HasRichCommandDetection=True\a'

__pulsar_report_prompt() {
	# Expand the original PS1 similarly to how bash would normally
	# See https://stackoverflow.com/a/37137981 for technique
	if ((BASH_VERSINFO[0] >= 5 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4))); then
		__pulsar_prompt=${__pulsar_original_PS1@P}
	else
		__pulsar_prompt=${__pulsar_original_PS1}
	fi

	__pulsar_prompt="$(builtin printf "%s" "${__pulsar_prompt//[$'\001'$'\002']}")"
	builtin printf "\e]633;P;Prompt=%s\a" "$(__pulsar_escape_value "${__pulsar_prompt}")"
}

__pulsar_prompt_start() {
	builtin printf '\e]633;A\a'
}

__pulsar_prompt_end() {
	builtin printf '\e]633;B\a'
}

__pulsar_update_cwd() {
	if [ "$__pulsar_is_windows" = "1" ]; then
		__pulsar_cwd="$(cygpath -m "$PWD")"
	else
		__pulsar_cwd="$PWD"
	fi
	builtin printf '\e]633;P;Cwd=%s\a' "$(__pulsar_escape_value "$__pulsar_cwd")"
}

__updateEnvCacheAA() {
	local key="$1"
	local value="$2"
	if [ "$use_associative_array" = 1 ]; then
		if [[ "${pulsar_aa_env[$key]}" != "$value" ]]; then
			pulsar_aa_env["$key"]="$value"
			builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
		fi
	fi
}

__updateEnvCache() {
	local key="$1"
	local value="$2"

	for i in "${!pulsar_env_keys[@]}"; do
		if [[ "${pulsar_env_keys[$i]}" == "$key" ]]; then
			if [[ "${pulsar_env_values[$i]}" != "$value" ]]; then
				pulsar_env_values[$i]="$value"
				builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
			fi
			return
		fi
	done

	pulsar_env_keys+=("$key")
	pulsar_env_values+=("$value")
	builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
}

__pulsar_update_env() {
	if [[ ${#envVarsToReport[@]} -gt 0 ]]; then
		builtin printf '\e]633;EnvSingleStart;%s;%s\a' 0 $__pulsar_nonce

		if [ "$use_associative_array" = 1 ]; then
			if [ ${#pulsar_aa_env[@]} -eq 0 ]; then
				# Associative array is empty, do not diff, just add
				for key in "${envVarsToReport[@]}"; do
					if [ -n "${!key+x}" ]; then
						local value="${!key}"
						pulsar_aa_env["$key"]="$value"
						builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
					fi
				done
			else
				# Diff approach for associative array
				for key in "${envVarsToReport[@]}"; do
					if [ -n "${!key+x}" ]; then
						local value="${!key}"
						__updateEnvCacheAA "$key" "$value"
					fi
				done
				# Track missing env vars not needed for now, as we are only tracking pre-defined env var from terminalEnvironment.
			fi

		else
			if [[ -z ${pulsar_env_keys[@]} ]] && [[ -z ${pulsar_env_values[@]} ]]; then
				# Non associative arrays are both empty, do not diff, just add
				for key in "${envVarsToReport[@]}"; do
					if [ -n "${!key+x}" ]; then
						local value="${!key}"
						pulsar_env_keys+=("$key")
						pulsar_env_values+=("$value")
						builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
					fi
				done
			else
				# Diff approach for non-associative arrays
				for key in "${envVarsToReport[@]}"; do
					if [ -n "${!key+x}" ]; then
						local value="${!key}"
						__updateEnvCache "$key" "$value"
					fi
				done
				# Track missing env vars not needed for now, as we are only tracking pre-defined env var from terminalEnvironment.
			fi
		fi
		builtin printf '\e]633;EnvSingleEnd;%s;\a' $__pulsar_nonce
	fi
}

__pulsar_command_output_start() {
	if [[ -z "${__pulsar_first_prompt-}" ]]; then
		builtin return
	fi
	builtin printf '\e]633;E;%s;%s\a' "$(__pulsar_escape_value "${__pulsar_current_command}")" $__pulsar_nonce
	builtin printf '\e]633;C\a'
}

__pulsar_continuation_start() {
	builtin printf '\e]633;F\a'
}

__pulsar_continuation_end() {
	builtin printf '\e]633;G\a'
}

__pulsar_command_complete() {
	if [[ -z "${__pulsar_first_prompt-}" ]]; then
		__pulsar_update_cwd
		builtin return
	fi
	if [ "$__pulsar_current_command" = "" ]; then
		builtin printf '\e]633;D\a'
	else
		builtin printf '\e]633;D;%s\a' "$__pulsar_status"
	fi
	__pulsar_update_cwd
}
__pulsar_update_prompt() {
	# in command execution
	if [ "$__pulsar_in_command_execution" = "1" ]; then
    # Wrap the prompt if it is not yet wrapped. If the PS1 changed after this
    # this was last set, it means the user re-exported the PS1, so we should
    # re-wrap it
		if [[ "$__pulsar_custom_PS1" == "" || "$__pulsar_custom_PS1" != "$PS1" ]]; then
			__pulsar_original_PS1=$PS1
			__pulsar_custom_PS1="\[$(__pulsar_prompt_start)\]$__pulsar_original_PS1\[$(__pulsar_prompt_end)\]"
			PS1="$__pulsar_custom_PS1"
		fi
		if [[ "$__pulsar_custom_PS2" == "" || "$__pulsar_custom_PS2" != "$PS2" ]]; then
			__pulsar_original_PS2=$PS2
			__pulsar_custom_PS2="\[$(__pulsar_continuation_start)\]$__pulsar_original_PS2\[$(__pulsar_continuation_end)\]"
			PS2="$__pulsar_custom_PS2"
		fi
		__pulsar_in_command_execution="0"
	fi
}

__pulsar_precmd() {
	__pulsar_command_complete "$__pulsar_status"
	__pulsar_current_command=""
	# Report prompt is a work in progress, currently encoding is too slow
	if [ "$__pulsar_stable" = "0" ]; then
		__pulsar_report_prompt
	fi
	__pulsar_first_prompt=1
	__pulsar_update_prompt
	__pulsar_update_env
}

__pulsar_preexec() {
	__pulsar_initialized=1
	if [[ ! $BASH_COMMAND == __pulsar_prompt* ]]; then
		# Use history if it's available to verify the command as BASH_COMMAND comes in with aliases
		# resolved
		if [ "$__pulsar_history_verify" = "1" ]; then
			__pulsar_current_command="$(builtin history 1 | sed 's/ *[0-9]* *//')"
		else
			__pulsar_current_command=$BASH_COMMAND
		fi
	else
		__pulsar_current_command=""
	fi
	__pulsar_command_output_start
}

# Debug trapping/preexec inspired by starship (ISC)
if [[ -n "${bash_preexec_imported:-}" ]]; then
	__pulsar_preexec_only() {
		if [ "$__pulsar_in_command_execution" = "0" ]; then
			__pulsar_in_command_execution="1"
			__pulsar_preexec
		fi
	}
	precmd_functions+=(__pulsar_prompt_cmd)
	preexec_functions+=(__pulsar_preexec_only)
else
	__pulsar_dbg_trap="$(__pulsar_get_trap DEBUG)"

	if [[ -z "$__pulsar_dbg_trap" ]]; then
		__pulsar_preexec_only() {
			if [ "$__pulsar_in_command_execution" = "0" ]; then
				__pulsar_in_command_execution="1"
				__pulsar_preexec
			fi
		}
		trap '__pulsar_preexec_only "$_"' DEBUG
	elif [[ "$__pulsar_dbg_trap" != '__pulsar_preexec "$_"' && "$__pulsar_dbg_trap" != '__pulsar_preexec_all "$_"' ]]; then
		__pulsar_preexec_all() {
			if [ "$__pulsar_in_command_execution" = "0" ]; then
				__pulsar_in_command_execution="1"
				__pulsar_preexec
				builtin eval "${__pulsar_dbg_trap}"
			fi
		}
		trap '__pulsar_preexec_all "$_"' DEBUG
	fi
fi

__pulsar_update_prompt

__pulsar_restore_exit_code() {
	return "$1"
}

__pulsar_prompt_cmd_original() {
	__pulsar_status="$?"
	builtin local cmd
	__pulsar_restore_exit_code "${__pulsar_status}"
	# Evaluate the original PROMPT_COMMAND similarly to how bash would normally
	# See https://unix.stackexchange.com/a/672843 for technique
	for cmd in "${__pulsar_original_prompt_command[@]}"; do
		eval "${cmd:-}"
	done
	__pulsar_precmd
}

__pulsar_prompt_cmd() {
	__pulsar_status="$?"
	__pulsar_precmd
}

# PROMPT_COMMAND arrays and strings seem to be handled the same (handling only the first entry of
# the array?)
__pulsar_original_prompt_command=${PROMPT_COMMAND:-}

if [[ -z "${bash_preexec_imported:-}" ]]; then
	if [[ -n "${__pulsar_original_prompt_command:-}" && "${__pulsar_original_prompt_command:-}" != "__pulsar_prompt_cmd" ]]; then
		PROMPT_COMMAND=__pulsar_prompt_cmd_original
	else
		PROMPT_COMMAND=__pulsar_prompt_cmd
	fi
fi
