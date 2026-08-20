# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------
if [[ -f $USER_ZDOTDIR/.zshenv ]]; then
	PULSAR_TERMINAL_ZDOTDIR=$ZDOTDIR
	ZDOTDIR=$USER_ZDOTDIR

	# Prevent recursion.
	if [[ $USER_ZDOTDIR != $PULSAR_TERMINAL_ZDOTDIR ]]; then
		. $USER_ZDOTDIR/.zshenv
	fi

	USER_ZDOTDIR=$ZDOTDIR
	ZDOTDIR=$PULSAR_TERMINAL_ZDOTDIR
fi
