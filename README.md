# terminal

Terminal emulation in Pulsar.

![screenshot of terminal package](https://raw.githubusercontent.com/pulsar-edit/terminal/main/images/terminal-package-screenshot.png)

Uses [XTerm](https://xtermjs.org/) and [`node-pty`](https://github.com/microsoft/node-pty).

Based heavily on [`atomic-terminal`](https://github.com/atom-community/terminal), [`x-terminal-reloaded`](https://github.com/Spiker985/x-terminal-reloaded), and all their predecessors.

## Commands

The simplest command is bound to <kbd>ctrl-\`</kbd> on all platforms: `terminal:focus`. This command will focus the last active terminal (if one exists), or else create a new terminal.

> [!NOTE]
> When focus is in a terminal, the terminal itself may handle some keystrokes _instead of_ Pulsar. If you notice that some of your keybindings don’t work inside the terminal, press <kbd>ctrl-\`</kbd> while the terminal is focused in order to _unfocus_ the terminal; at that point you’ll be able to press any key sequence and have it be interpreted by Pulsar instead of your terminal.

Most of the package’s keybindings rely on a [key sequence](https://docs.pulsar-edit.dev/using-pulsar/basics/#key-sequence): first press the main shortcut (<kbd>ctrl-shift-\`</kbd> on all platforms), then press a second key.

If you want to make any of these commands available via a simpler keybinding, you can [customize your keybindings](https://docs.pulsar-edit.dev/customizing-pulsar/customizing-keybindings/).

### Workspace keybindings

|Command|Description|Keybinding (Linux/Windows)|Keybinding (macOS)|
|-------|-----------|------------------|-----------------|
|`terminal:focus`|Focus the active terminal, or create one if needed|<kbd>ctrl-\`</kbd>|<kbd>ctrl-\`</kbd>|
|`terminal:open`|Create a new terminal in the default location|<kbd>ctrl-shift-\`</kbd> <kbd>N</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>N</kbd>|
|`terminal:open-left-dock`|Create a new terminal in the left dock|<kbd>ctrl-shift-\`</kbd> <kbd>L</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>L</kbd>|
|`terminal:open-right-dock`|Create a new terminal in the right dock|<kbd>ctrl-shift-\`</kbd> <kbd>R</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>R</kbd>|
|`terminal:open-bottom-dock`|Create a new terminal in the bottom dock|<kbd>ctrl-shift-\`</kbd> <kbd>B</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>B</kbd>|
|`terminal:open-split-up`|Create a new terminal by splitting the current pane container upward|<kbd>ctrl-shift-\`</kbd> <kbd>Up</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>Up</kbd>|
|`terminal:open-split-down`|Create a new terminal by splitting the current pane container downward|<kbd>ctrl-shift-\`</kbd> <kbd>Down</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>Down</kbd>|
|`terminal:open-split-left`|Create a new terminal by splitting the current pane container leftward|<kbd>ctrl-shift-\`</kbd> <kbd>Left</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>Left</kbd>|
|`terminal:open-split-right`|Create a new terminal by splitting the current pane container rightward|<kbd>ctrl-shift-\`</kbd> <kbd>Right</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>Right</kbd>|
|`terminal:run-selected-text`|Run the selected text in the active terminal|<kbd>ctrl-shift-\`</kbd> <kbd>X</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>X</kbd>|
|`terminal:insert-selected-text`|Insert the selected text into the active terminal|<kbd>ctrl-shift-\`</kbd> <kbd>I</kbd>|<kbd>ctrl-shift-\`</kbd> <kbd>I</kbd>|

### Terminal keybindings

These commands and key bindings can be used when the terminal has focus.

|Command|Description|Keybinding (Linux/Windows)|Keybinding (macOS)|
|-------|-----------|------------------|-----------------|
|`terminal:clear`|Clear the screen|<kbd>ctrl-L</kbd>|<kbd>ctrl-L</kbd> or <kbd>cmd-alt-K</kbd>|
|`terminal:find`|Open the find palette|<kbd>ctrl-F</kbd>|<kbd>cmd-F</kbd>|
|`terminal:find-next`|Jump to the next match in the find palette|<kbd>F3</kbd>|<kbd>cmd-G</kbd>|
|`terminal:find-previous`|Jump to the previous match in the find palette|<kbd>shift-F3</kbd>|<kbd>cmd-shift-G</kbd>|
|`terminal:set-selection-as-find-pattern`|Use the selected terminal text as the search term in the find palette|<kbd>ctrl-E</kbd>|<kbd>cmd-E</kbd>|
|`terminal:unfocus`|Unfocus the terminal, moving focus to the terminal’s pane container|<kbd>ctrl-\`</kbd> |<kbd>ctrl-\`</kbd>|

## Theming

The colors and fonts used by the terminal can be customized. By default, your terminal will try to reuse many aspects of your editor’s theme, but you can change this behavior.

This package supports multiple approaches to theming:

### Stylesheet variables

The ideal way to theme your terminal is via stylesheet variables, since this makes it possible for syntax themes to use terminal colors that harmonize with your editor theme.

If you use one of the eight built-in syntax themes, your terminal will **automatically** be styled to look like your editor, including theme-appropriate versions of the standard ANSI colors.

If you use a custom syntax theme that doesn’t define these variables, you can use the default fallbacks or define your own colors in your user stylesheet.

These are the default values as defined in `terminal-variables.less`:

```less
// This gives you access to Less variables from your syntax theme.
@import "syntax-variables";

// We use CSS custom properties, not Less variables, because they're
// late-binding and can more easily be overridden via your stylesheet. But you
// can still use Less variables as the values!
:root {
  // The first block of variables below will by default use equivalent values
  // from your syntax theme. You can still customize these, though, if you don't
  // like the defaults.
  // The ordinary text color of the terminal.
  --terminal-text-color: @syntax-text-color;
  // The background color of the terminal.
  --terminal-background-color: @syntax-background-color;
  // The background color of a selected text block.
  --terminal-selection-background-color: @syntax-selection-color;
  // The text color of selected text.
  --terminal-selection-text-color: @syntax-text-color;
  // The color of the cursor.
  --terminal-cursor-color: @syntax-cursor-color;
  // The color of the outline around a “find” result when it is inactive.
  --terminal-result-marker-color: @syntax-result-marker-color;
  // The color of the outline around a “find” result when it is active.
  --terminal-result-marker-color-selected: @syntax-result-marker-color-selected;

  // ANSI colors in regular and “bright” variants. If you use a built-in theme,
  // these will be replaced with theme-appropriate color values! Otherwise, the
  // values below will be used — but you can manually change them to match the
  // colors of your custom syntax theme, if you like.
  --terminal-color-black: #2e3436;
  --terminal-color-red: #cc0000;
  --terminal-color-green: #4e9a06;
  --terminal-color-yellow: #c4a000;
  --terminal-color-blue: #3465a4;
  --terminal-color-magenta: #75507b;
  --terminal-color-cyan: #06989a;
  --terminal-color-white: #d3d7cf;
  --terminal-color-bright-black: #555753;
  --terminal-color-bright-red: #ef2929;
  --terminal-color-bright-green: #8ae234;
  --terminal-color-bright-yellow: #fce94f;
  --terminal-color-bright-blue: #729fcf;
  --terminal-color-bright-magenta: #ad7fa8;
  --terminal-color-bright-cyan: #34e2e2;
  --terminal-color-bright-white: #eeeeec;
}
```

This is an exhaustive list of what can be customized, but it’s more likely you’ll want to customize just a few values. For instance, if all you want to do is change the “bright cyan” color value, you can edit your `styles.less` like so:

```less
@import "syntax-variables";
:root {
  // Make your "bright cyan" match your ordinary editor text color.
  --terminal-color-bright-cyan: @syntax-text-color;
}
```

You could also hard-code a hex or `rgba` value, or use one of Less’s [color manipulation functions](https://lesscss.org/functions/#color-definition).

### Configuration

If you prefer, you can eschew the stylesheet approach and define your terminal theme colors explicitly via configuration. The collapsed **Custom Theme Colors** section in the package settings lets you customize each individual color.

Be sure to switch the **Color Theme** setting to **Config** in order for these colors to be used.

> [!TIP]
> As stated in the package settings, all color values support transparency and can accept `rgba()` CSS literal values, even though the color picker in the `settings-view` UI [doesn’t (yet) let you specify an alpha channel](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/color#html.elements.input.alpha).
>
> To add an alpha channel to any color value, first customize it in the `settings-view` UI (so that the appropriate key is placed in your `config.cson`); then [edit your `config.cson`](https://docs.pulsar-edit.dev/customizing-pulsar/global-configuration-settings/) and drill down from the top-level `terminal:key` to find the value you just customized. Change it to the value you want, then save your `config.cson`.

### Legacy themes

All other values in the **Color Theme** list are specific terminal themes with hard-coded values. These themes are included because they were present in this package’s predecessors (`x-terminal`, etc.), but they are not comprehensive; most only define foreground and background text colors and otherwise will fall back onto colors specified in the **Custom Theme Colors** section.

## Services

### `terminal` (version 2.0.0)

This package defines a `terminal` service that is a streamlined version of the `terminal` version `1.0.0` service provided by `x-terminal` and `atomic-terminal`, among others.

Rather than serve as a direct copy of the `platformioIDETerminal` service described below, it aims to discard unneeded methods. It uses version `2.0.0` to signify a break in backward compatibility.

It may add methods in the future, but for now it provides an object with a few simple methods:

#### `open(): Promise<void>`

Opens a new terminal. The user’s configuration determines where that terminal opens in the workspace.

Returns a promise that fulfills once the terminal is created and ready for input.

#### `run(commands: string[]): Promise<boolean>`

Runs the given command or commands in the active terminal. The “active” terminal is whichever one was most recently used. If no terminal is present, one will be created.

By default, the user will be shown the whole list of commands before the terminal spawns, and will be able to approve or reject the request to run the commands.

Also keep in mind that the consuming package isn’t allowed to inspect the output directly. In other words, this method is not a substitute for `child_process.spawn` in the Node standard library.

Returns a promise that resolves to a boolean: `true` if the commands actually ran, and `false` if they did not.

### `platformioIDETerminal` (version 1.1.0)

This service is supported for the sake of compatibility, since it’s arguably the most widely used terminal service. As the name implies, this service was originally created by the `platformio-ide-terminal` package.

The `platformioIDETerminal` service supports the `open` and `run` methods defined above, plus:

#### `getTerminalViews(): TerminalModel`

Returns each terminal view currently open in the workspace. Each terminal view is an instance of `TerminalModel` — but it functions like a _view_ model, and implements the [pane item interface](https://github.com/pulsar-edit/types/blob/0099e6b3004de4f94fcdee04b2d86f2910e3abfb/src/pane.d.ts#L88).

Beware, though; this package makes no claim that these instances will share any properties or methods with whatever was returned by `platform-ide-terminal` for this method.

#### `updateProcessEnv()`

This method is provided so that this package technically conforms to the `platformioIDETerminal` service contract, but it does nothing. (It’s not clear that its original implementation ever did anything useful that couldn’t have been done by setting `process.env` directly.)
