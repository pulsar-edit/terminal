import which from 'which';

import { PACKAGE_NAME, isMac, isWindows } from './utils';
import { THEME_COLORS } from './themes';

export class Config {
  static get (keyName?: string) {
    if (!keyName) {
      return atom.config.get(PACKAGE_NAME);
    }
    let keyPath = `${PACKAGE_NAME}.${keyName}`;
    return atom.config.get(keyPath);
  }
  static set<T extends unknown = unknown>(keyName: string, value: T) {
    let keyPath = `${PACKAGE_NAME}.${keyName}`;
    return atom.config.set(keyPath, value);
  }
}

function getDefaultShell () {
  // On Windows we read `COMSPEC`, the ancient environment variable that
  // usually points to `cmd.exe`. But on first run, we will try to opt into
  // PowerShell if the system appears to have it.
  //
  // On Unix systems we'll use the venerable `SHELL` as the source of truth for
  // your login shell.
  return isWindows() ?
    (process.env.COMSPEC || 'cmd.exe') :
    (process.env.SHELL || '/bin/sh');
}

export function getConfigSchema () {
  let defaultTerminalCommand = getDefaultShell();

  let colorSchemaObject: any = {};
  for (let [i, item] of THEME_COLORS.entries()) {
    let schema: any = {};
    schema.title = item.name;
    schema.type = 'color';
    schema.default = item.default;
    schema.order = i;
    if (item.description) {
      schema.description = item.description;
    }
    let key = item.short ?? item.name.toLowerCase();
    colorSchemaObject[key] = schema;
  }

  return {
    terminal: {
      title: 'Terminal Settings',
      description: 'Settings related to the process running the shell.',
      type: 'object',
      order: 0,
      properties: {
        activeTerminalIndicator: {
          title: 'Active Terminal Indicator',
          description: `Character(s) to use to indicate the active terminal.`,
          type: 'string',
          default: '⦿ ',
          order: 0
        },
        shell: {
          title: 'Shell',
          description: `Command to run to initialize the shell.`,
          type: 'string',
          default: defaultTerminalCommand,
          order: 1
        },
        args: {
          title: 'Arguments',
          description: 'Arguments to pass to the shell initialization command (comma-separated).',
          type: 'array',
          default: [],
          items: {
            type: 'string'
          },
          order: 2
        },
        terminalType: {
          title: 'Terminal Type',
          description: 'The type of terminal to use.',
          type: 'string',
          default: process.env.TERM || 'xterm-256color',
          order: 3
        },
        encoding: {
          title: 'Character Encoding',
          description: 'The encoding to use in a spawned terminal.',
          type: 'string',
          default: 'utf8',
          order: 6
        },
        env: {
          title: 'Environment Variables',
          description: 'Define, override, or delete certain environment variables within the shell.',
          type: 'object',
          order: 7,
          properties: {
            fallbackEnv: {
              title: 'Fallback',
              description: `Environment variables that should always be present, even if the environment does not define them. If the shell does define these, the shell’s value will take precedence. (Accepts a stringified JSON object.)`,
              type: 'string',
              default: '{}',
              order: 6
            },
            overrideEnv: {
              title: 'Overridden',
              description: `Environment variables that should always be present _and_ take precedence over values that may already be defined in the environment. (Accepts a stringified JSON object.)`,
              type: 'string',
              default: '{}',
              order: 7
            },
            deleteEnv: {
              title: 'Deleted',
              description: `Names of environment variables that should be deleted from a terminal environment whenever present on startup. (Separate multiple entries with commas.)`,
              type: 'array',
              default: ['NODE_ENV'],
              order: 8
            }
          }
        }
      }
    },
    xterm: {
      title: 'XTerm Configuration',
      description: 'Customize the behavior of XTerm.js.',
      type: 'object',
      order: 1,
      properties: {
        webgl: {
          title: 'WebGL Renderer',
          description: `Enable the [WebGL-based renderer](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl).`,
          type: 'boolean',
          order: 0,
          default: true
        },
        webLinks: {
          title: 'Web Links',
          description: `Enable [clickable web links](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-web-links).`,
          type: 'boolean',
          order: 1,
          default: true
        },
        additionalOptions: {
          title: 'Additional Options',
          description: `Options to apply to XTerm terminal objects; [consult the reference](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#properties). (Accepts a stringified JSON object.)`,
          type: 'string',
          order: 2,
          default: '{}'
        }
      }
    },
    appearance: {
      title: 'Appearance',
      type: 'object',
      order: 2,
      properties: {
        fontFamily: {
          title: 'Font Family',
          description: 'Font to use in terminals. Can be left blank unless you want something other than your editor font.',
          order: 0,
          type: 'string',
          default: atom.config.get('editor.fontFamily') || 'monospace'
        },
        useEditorFontFamily: {
          title: 'Use Editor Font Family',
          description: 'When enabled, terminals will always use the font family specified in the Editor settings instead of the value above.',
          order: 1,
          type: 'boolean',
          default: true
        },
        fontSize: {
          title: 'Font Size',
          description: 'Font size to use in terminals.',
          type: 'integer',
          default: 14,
          minimum: 8,
          maximum: 100,
          order: 2
        },
        useEditorFontSize: {
          title: 'Use Editor Font Size',
          description: 'When enabled, terminals will always use the font size specified in the Editor settings instead of the value above.',
          order: 3,
          type: 'boolean',
          default: true
        },
        lineHeight: {
          title: 'Line Height',
          description: 'Multiplier to control space between lines.',
          type: 'number',
          default: 1.3,
          minimum: 1,
          maximum: 2,
          order: 4
        },
        useEditorLineHeight: {
          title: 'Use Editor Line Height',
          description: 'When enabled, terminals will always use the line height specified in the Editor settings instead of the value above.',
          order: 5,
          type: 'boolean',
          default: false
        },
        theme: {
          title: 'Color Theme',
          description: 'Which set of colors to use in the terminal.  **Stylesheet** lets you (or a theme) specify terminal colors in a stylesheet; **Custom** prefers the values specified in the section below; and the remaining values are legacy preset themes.\n\nIf you choose **Custom**, expand the **Custom Theme Colors** heading to modify individual colors.',
          type: 'string',
          enum: [
            {
              value: 'Stylesheet',
              description: 'Stylesheet (uses colors defined in your syntax theme or user stylesheet)'
            },
            {
              value: 'Config',
              description: 'Config (uses colors specified below)'
            },
            'Atom Dark',
            'Atom Light',
            'Base16 Tomorrow Dark',
            'Base16 Tomorrow Light',
            'Christmas',
            'City Lights',
            'Dracula',
            'Grass',
            'Homebrew',
            'Inverse',
            'Linux',
            'Man Page',
            'Novel',
            'Ocean',
            'One Dark',
            'One Light',
            'Predawn',
            'Pro',
            'Red Sands',
            'Red',
            'Silver Aerogel',
            'Solarized Dark',
            'Solarized Light',
            'Solid Colors',
            'Standard'
          ],
          default: 'Stylesheet',
          order: 6
        },
        customThemeColors: {
          title: 'Custom Theme Colors',
          description: "Colors to use for a custom terminal theme. These will be ignored unless “Color Theme” above is set to `Config`.\n\n**All of these values support transparency**, even if you can’t specify it via `settings-view`! Open your `config.cson` to add an alpha channel to any item; specify it using `rgba` syntax (e.g., `rgba(43, 88, 145, 0.5)`).",
          type: 'object',
          order: 7,
          collapsed: true,
          properties: colorSchemaObject
        }
      }
    },
    behavior: {
      title: 'Behavior',
      description: 'How Pulsar manages terminal pane items within the workspace.',
      type: 'object',
      order: 3,
      properties: {
        defaultContainer: {
          title: 'Default Container',
          description: 'The destination of a terminal when one is not otherwise specified. (This can happen if you invoke **Terminal: Open** or if one is opened programmatically.)',
          type: 'string',
          enum: [
            'Center',
            'Bottom Dock',
            'Left Dock',
            'Right Dock',
            'Split Up',
            'Split Down',
            'Split Left',
            'Split Right'
          ],
          default: 'Center',
          order: 0
        },
        activeTerminalLogic: {
          title: 'Active Terminal Logic',
          description: `How the “active” terminal is determined.\n\nMany commands operate on the active terminal. If no terminal fits the selected definition, a new terminal will typically be created.`,
          type: 'string',
          enum: [
            {
              value: 'visible',
              description: 'Most recently used visible terminal'
            },

            {
              value: 'all',
              description: 'Most recently used terminal, whether visible or not'
            }
          ],
          default: 'visible',
          order: 2
        },
        runInActive: {
          title: 'Run in Active Terminal',
          description: `When enabled, commands invoked via the service API will try to reuse the active terminal (if there is one) instead of opening a new terminal.`,
          type: 'boolean',
          default: true,
          order: 3
        },
        leaveOpenAfterExit: {
          title: 'Leave Open After Exit',
          description: 'When enabled, will leave terminals open even after their shells have exited. When disabled, terminal pane items will be removed from the workspace immediately upon shell exit.',
          type: 'boolean',
          default: false,
          order: 4
        },
        relaunchTerminalsOnStartup: {
          title: 'Relaunch Terminals on Startup',
          description: 'When enabled, all terminals that were open at the end of the previous session will be restored when a project is reopened.',
          type: 'boolean',
          default: true,
          order: 5
        },
        copyTextOnSelect: {
          title: 'Copy Text on Select',
          description: 'When enabled, terminal text will be copied to the clipboard immediately upon selection.',
          type: 'boolean',
          default: false,
          order: 6
        },
        requireModifierToOpenUrls: {
          title: 'Require Modifier to Open URLs',
          description: `When enabled, you must hold down ${isMac() ? '`Cmd`' : '`Ctrl`'} while clicking on a URL in order to open it.`,
          type: 'boolean',
          default: true,
          order: 7
        }
      }
    },
    advanced: {
      title: 'Advanced',
      type: 'object',
      order: 4,
      collapsed: true,
      description: 'Uncommon settings.',
      properties: {
        enableDebugLogging: {
          title: 'Enable Debug Logging',
          description: 'Logs more information from the PTY process to the developer console.\n\nYou may want to enable this if you’re reporting a bug and you’re asked to provide more information. Otherwise, leave it disabled; it’s quite verbose! (Takes effect after a terminal is restarted.)',
          type: 'boolean',
          default: false,
          order: 1
        },
        allowedCommands: {
          title: 'Allowed Commands',
          description: 'Any sets of commands you’ve allowed to run automatically via a terminal service will appear here when you choose **Always Allow**.',
          type: 'array',
          default: [],
          items: {
            type: 'string'
          },
          order: 2
        },
        warnAboutModifierWhenOpeningUrls: {
          title: 'Warn About Modifier When Opening URLs',
          description: `When enabled _and_ **Require Modifier to Open URLs** is enabled, a user’s initial click on a URL without a modifier key will show a notification explaining why no action was taken. This option is automatically switched to \`false\` after the first display of this notification.`,
          type: 'boolean',
          default: true,
          order: 3
        }
      },
    }
  };
}

async function setAutoShell () {
  if (!isWindows()) return;

  // On Windows, automatically prefer PowerShell if we can locate it and the
  // user hasn't customized it before we can act.
  if (Config.get('terminal.shell') !== getDefaultShell()) {
    return;
  }

  let command = await which('pwsh.exe', { nothrow: true });
  command ??= await which('powershell.exe', { nothrow: true });
  if (!command) return;

  atom.config.set('terminal.terminal.shell', command);
}

export async function possiblySetAutoShell () {
  if (localStorage.getItem('terminal.autoShellSet') !== null) {
    return;
  }
  // We set the flag before we even run this logic. This means we'll set it
  // even if the logic fails/errors, but that's OK; we don't want more than one
  // bite at the apple.
  localStorage.setItem('terminal.autoShellSet', 'true');
  return await setAutoShell();
}
