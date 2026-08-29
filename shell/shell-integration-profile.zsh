# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------

# Prevent recursive sourcing.
if [[ -n "$PULSAR_TERMINAL_PROFILE_INITIALIZED" ]]; then
	return
fi
export PULSAR_TERMINAL_PROFILE_INITIALIZED=1

if [[ $options[norcs] = off && -o "login" ]]; then
	if [[ -f $USER_ZDOTDIR/.zprofile ]]; then
		PULSAR_TERMINAL_ZDOTDIR=$ZDOTDIR
		ZDOTDIR=$USER_ZDOTDIR
		. $USER_ZDOTDIR/.zprofile
		ZDOTDIR=$PULSAR_TERMINAL_ZDOTDIR
	fi

	# Apply any explicit path prefix (see #99878)
	if (( ${+PULSAR_TERMINAL_PATH_PREFIX} )); then
		export PATH="$PULSAR_TERMINAL_PATH_PREFIX$PATH"
	fi
	builtin unset PULSAR_TERMINAL_PATH_PREFIX
fi
