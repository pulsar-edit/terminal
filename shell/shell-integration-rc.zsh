# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------
builtin autoload -Uz add-zsh-hook is-at-least

# Prevent the script recursing when setting up
if [ -n "$PULSAR_TERMINAL_SHELL_INTEGRATION" ]; then
	ZDOTDIR=$USER_ZDOTDIR
	builtin return
fi

# This variable allows the shell to both detect that VS Code's shell integration is enabled as well
# as disable it by unsetting the variable.
PULSAR_TERMINAL_SHELL_INTEGRATION=1

# By default, zsh will set the `$HISTFILE` to the `$ZDOTDIR` location
# automatically. In the case of the shell integration being injected, this
# means that the terminal will use a different history file to other terminals.
# To fix this issue, set `$HISTFILE` back to the default location before
# `~/.zshrc` is called as that may depend upon the value.
if [[  "$PULSAR_TERMINAL_INJECTION" == "1" ]]; then
	HISTFILE=$USER_ZDOTDIR/.zsh_history
fi

# Only fix up `ZDOTDIR` if shell integration was injected (not manually
# installed) and has not been called yet.
if [[ "$PULSAR_TERMINAL_INJECTION" == "1" ]]; then
	if [[ $options[norcs] = off  && -f $USER_ZDOTDIR/.zshrc ]]; then
		PULSAR_TERMINAL_ZDOTDIR=$ZDOTDIR
		ZDOTDIR=$USER_ZDOTDIR
    # A user's custom `HISTFILE` location might be set when their `.zshrc` file
    # is sourced below.
		. $USER_ZDOTDIR/.zshrc
	fi
fi

__pulsar_use_aa=0
__pulsar_env_keys=()
__pulsar_env_values=()

# Associative arrays are only available in zsh 4.3 or later.
if is-at-least 4.3; then
	__pulsar_use_aa=1
	typeset -A pulsar_aa_env
fi

# Apply EnvironmentVariableCollections if needed.
if [ -n "${PULSAR_TERMINAL_ENV_REPLACE:-}" ]; then
	IFS=':' read -rA ADDR <<< "$PULSAR_TERMINAL_ENV_REPLACE"
	for ITEM in "${ADDR[@]}"; do
		VARNAME="$(echo ${ITEM%%=*})"
		export $VARNAME="$(echo -e ${ITEM#*=})"
	done
	unset PULSAR_TERMINAL_ENV_REPLACE
fi
if [ -n "${PULSAR_TERMINAL_ENV_PREPEND:-}" ]; then
	IFS=':' read -rA ADDR <<< "$PULSAR_TERMINAL_ENV_PREPEND"
	for ITEM in "${ADDR[@]}"; do
		VARNAME="$(echo ${ITEM%%=*})"
		export $VARNAME="$(echo -e ${ITEM#*=})${(P)VARNAME}"
	done
	unset PULSAR_TERMINAL_ENV_PREPEND
fi
if [ -n "${PULSAR_TERMINAL_ENV_APPEND:-}" ]; then
	IFS=':' read -rA ADDR <<< "$PULSAR_TERMINAL_ENV_APPEND"
	for ITEM in "${ADDR[@]}"; do
		VARNAME="$(echo ${ITEM%%=*})"
		export $VARNAME="${(P)VARNAME}$(echo -e ${ITEM#*=})"
	done
	unset PULSAR_TERMINAL_ENV_APPEND
fi

# Register Python shell activate hooks
# Prevent multiple activation with guard
if [ -z "${PULSAR_TERMINAL_PYTHON_AUTOACTIVATE_GUARD:-}" ]; then
	export PULSAR_TERMINAL_PYTHON_AUTOACTIVATE_GUARD=1
	if [ -n "${PULSAR_TERMINAL_PYTHON_ZSH_ACTIVATE:-}" ] && [ "$TERM_PROGRAM" = "pulsar" ]; then
		# Prevent crashing by negating exit code
		if ! builtin eval "$PULSAR_TERMINAL_PYTHON_ZSH_ACTIVATE"; then
			__pulsar_activation_status=$?
			builtin printf '\x1b[0m\x1b[7m * \x1b[0;103m Pulsar Python zsh activation failed with exit code %d \x1b[0m' "$__pulsar_activation_status"
		fi
	fi
	# Remove any leftover Python activation env vars.
	unset -m 'PULSAR_TERMINAL_PYTHON_*_ACTIVATE'
fi

# Report prompt type
if [ -n "${P9K_SSH:-}" ] || [ -n "${P9K_TTY:-}" ]; then
	builtin printf '\e]633;P;PromptType=p10k\a'
	# Force shell integration on for p10k
	# typeset -g POWERLEVEL9K_TERM_SHELL_INTEGRATION=true
elif [ -n "${ZSH:-}" ] && [ -n "$ZSH_VERSION" ] && (( ${+functions[omz]} )); then
	builtin printf '\e]633;P;PromptType=oh-my-zsh\a'
elif [ -n "${STARSHIP_SESSION_KEY:-}" ]; then
	builtin printf '\e]633;P;PromptType=starship\a'
fi

# Shell integration was disabled by the shell, exit without warning assuming either the shell has
# explicitly disabled shell integration as it's incompatible or it implements the protocol.
if [ -z "$PULSAR_TERMINAL_SHELL_INTEGRATION" ]; then
	builtin return
fi

# Prevent AI-executed commands from polluting shell history
if [ "${PULSAR_TERMINAL_PREVENT_SHELL_HISTORY:-}" = "1" ]; then
	builtin setopt HIST_IGNORE_SPACE
	builtin unset PULSAR_TERMINAL_PREVENT_SHELL_HISTORY
fi

# Agent terminal zsh fixups: disable bang history expansion so ! in double
# quotes does not hang on dquote>, and enable inline # comments so the
# agent can annotate commands.
if [ "${PULSAR_TERMINAL_AGENT_ZSH_FIXUPS:-}" = "1" ]; then
	builtin setopt NO_BANG_HIST
	builtin setopt INTERACTIVE_COMMENTS
	builtin unset PULSAR_TERMINAL_AGENT_ZSH_FIXUPS
fi

# The property (P) and command (E) codes embed values which require escaping.
# Backslashes are doubled. Non-alphanumeric characters are converted to escaped hex.
__pulsar_escape_value() {
	builtin emulate -L zsh

	# Process text byte by byte, not by codepoint.
	builtin local LC_ALL=C str="$1" i byte token out='' val

	for (( i = 0; i < ${#str}; ++i )); do
	# Escape backslashes, semi-colons specially, then special ASCII chars below space (0x20).
		byte="${str:$i:1}"
		val=$(printf "%d" "'$byte")
		if (( val < 31 )); then
			# For control characters, use hex encoding
			token=$(printf "\\\\x%02x" "'$byte")
		elif [ "$byte" = "\\" ]; then
			token="\\\\"
		elif [ "$byte" = ";" ]; then
			token="\\x3b"
		else
			token="$byte"
		fi

		out+="$token"
	done

	builtin print -r -- "$out"
}

__pulsar_in_command_execution="1"
__pulsar_current_command=""

# It's fine this is in the global scope as it getting at it requires access to the shell environment
__pulsar_nonce="$PULSAR_TERMINAL_NONCE"
unset PULSAR_TERMINAL_NONCE

__pulsar_shell_env_reporting="${PULSAR_TERMINAL_SHELL_ENV_REPORTING:-}"
unset PULSAR_TERMINAL_SHELL_ENV_REPORTING

envVarsToReport=()
IFS=',' read -rA envVarsToReport <<< "$__pulsar_shell_env_reporting"

builtin printf "\e]633;P;ContinuationPrompt=%s\a" "$(echo "$PS2" | sed 's/\x1b/\\\\x1b/g')"

# Report this shell supports rich command detection
builtin printf '\e]633;P;HasRichCommandDetection=True\a'

__pulsar_prompt_start() {
	builtin printf '\e]633;A\a'
}

__pulsar_prompt_end() {
	builtin printf '\e]633;B\a'
}

__pulsar_update_cwd() {
	builtin printf '\e]633;P;Cwd=%s\a' "$(__pulsar_escape_value "${PWD}")"
}

__update_env_cache_aa() {
	local key="$1"
	local value="$2"
	if [ $__pulsar_use_aa -eq 1 ]; then
		if [[ "${pulsar_aa_env["$key"]}" != "$value" ]]; then
			pulsar_aa_env["$key"]="$value"
			builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
		fi
	fi
}

__update_env_cache() {
	local key="$1"
	local value="$2"

	for (( i=1; i <= $#__pulsar_env_keys; i++ )); do
		if [[ "${__pulsar_env_keys[$i]}" == "$key" ]]; then
			if [[ "${__pulsar_env_values[$i]}" != "$value" ]]; then
				__pulsar_env_values[$i]="$value"
				builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
			fi
			return
		fi
	done

		# Key does not exist so add key, value pair
		__pulsar_env_keys+=("$key")
		__pulsar_env_values+=("$value")
		builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
}

__pulsar_update_env() {
	if [[ ${#envVarsToReport[@]} -gt 0 ]]; then
		builtin printf '\e]633;EnvSingleStart;%s;%s;\a' 0 $__pulsar_nonce
		if [ $__pulsar_use_aa -eq 1 ]; then
			if [[ ${#pulsar_aa_env[@]} -eq 0 ]]; then
				# Associative array is empty, do not diff, just add
				for key in "${envVarsToReport[@]}"; do
					if [[ -n "$key" && -n "${(P)key+_}" ]]; then
						pulsar_aa_env["$key"]="${(P)key}"
						builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "${(P)key}")" "$__pulsar_nonce"
					fi
				done
			else
				# Diff approach for associative array
				for var in "${envVarsToReport[@]}"; do
					if [[ -n "$var" && -n "${(P)var+_}" ]]; then
						value="${(P)var}"
						__update_env_cache_aa "$var" "$value"
					fi
				done
				# Track missing env vars not needed for now, as we are only tracking pre-defined env var from terminalEnvironment.
			fi
		else
			# Two arrays approach
			if [[ ${#__pulsar_env_keys[@]} -eq 0 ]] && [[ ${#__pulsar_env_values[@]} -eq 0 ]]; then
				# Non-associative arrays are both empty, do not diff, just add
				for key in "${envVarsToReport[@]}"; do
					if [[ -n "$key" && -n "${(P)key+_}" ]]; then
						value="${(P)key}"
						__pulsar_env_keys+=("$key")
						__pulsar_env_values+=("$value")
						builtin printf '\e]633;EnvSingleEntry;%s;%s;%s\a' "$key" "$(__pulsar_escape_value "$value")" "$__pulsar_nonce"
					fi
				done
			else
				# Diff approach for non-associative arrays
				for var in "${envVarsToReport[@]}"; do
					if [[ -n "$var" && -n "${(P)var+_}" ]]; then
						value="${(P)var}"
						__update_env_cache "$var" "$value"
					fi
				done
				# Track missing env vars not needed for now, as we are only tracking pre-defined env var from terminalEnvironment.
			fi
		fi

		builtin printf '\e]633;EnvSingleEnd;%s;\a' $__pulsar_nonce
	fi
}

__pulsar_command_output_start() {
	builtin printf '\e]633;E;%s;%s\a' "$(__pulsar_escape_value "${__pulsar_current_command}")" $__pulsar_nonce
	builtin printf '\e]633;C\a'
}

__pulsar_continuation_start() {
	builtin printf '\e]633;F\a'
}

__pulsar_continuation_end() {
	builtin printf '\e]633;G\a'
}

__pulsar_right_prompt_start() {
	builtin printf '\e]633;H\a'
}

__pulsar_right_prompt_end() {
	builtin printf '\e]633;I\a'
}

__pulsar_command_complete() {
	if [[ "$__pulsar_current_command" == "" ]]; then
		builtin printf '\e]633;D\a'
	else
		builtin printf '\e]633;D;%s\a' "$__pulsar_status"
	fi
	__pulsar_update_cwd
}

if [[ -o NOUNSET ]]; then
	if [ -z "${RPROMPT-}" ]; then
		RPROMPT=""
	fi
fi
__pulsar_update_prompt() {
	__pulsar_prior_prompt="$PS1"
	__pulsar_prior_prompt2="$PS2"
	__pulsar_in_command_execution=""
	PS1="%{$(__pulsar_prompt_start)%}$PS1%{$(__pulsar_prompt_end)%}"
	PS2="%{$(__pulsar_continuation_start)%}$PS2%{$(__pulsar_continuation_end)%}"
	if [ -n "$RPROMPT" ]; then
		__pulsar_prior_rprompt="$RPROMPT"
		RPROMPT="%{$(__pulsar_right_prompt_start)%}$RPROMPT%{$(__pulsar_right_prompt_end)%}"
	fi
}

__pulsar_precmd() {
	builtin local __pulsar_status="$?"
	if [ -z "${__pulsar_in_command_execution-}" ]; then
		# not in command execution
		__pulsar_command_output_start
	fi

	__pulsar_command_complete "$__pulsar_status"
	__pulsar_current_command=""

	# in command execution
	if [ -n "$__pulsar_in_command_execution" ]; then
		# non null
		__pulsar_update_prompt
	fi
	__pulsar_update_env
}

__pulsar_preexec() {
	PS1="$__pulsar_prior_prompt"
	PS2="$__pulsar_prior_prompt2"
	if [ -n "$RPROMPT" ]; then
		RPROMPT="$__pulsar_prior_rprompt"
	fi
	__pulsar_in_command_execution="1"
	__pulsar_current_command=$1
	__pulsar_command_output_start
}
add-zsh-hook precmd __pulsar_precmd
add-zsh-hook preexec __pulsar_preexec

if [[ $options[login] = off && $USER_ZDOTDIR != $PULSAR_TERMINAL_ZDOTDIR ]]; then
	ZDOTDIR=$USER_ZDOTDIR
fi
