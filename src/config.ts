import * as path from 'path';
import * as os from 'os';
import { isWindows, isMac } from './utils';

const PACKAGE_NAME = 'terminal';

const THEME_COLORS = [
  {
    name: 'Text',
    default: '#ffffff'
  },
  {
    name: 'Background',
    default: '#000000'
  },
  {
    name: 'Cursor',
    default: '#ffffff'
  },
  {
    name: 'Cursor Text',
    short: 'cursorText',
    default: '#000000'
  },
  {
    name: 'Selection Background',
    short: 'selectionBackground',
    default: '#4d4d4d'
  },
  {
    name: 'ANSI Black',
    short: 'black',
    description: '`\\x1b[30m`',
    default: '#2e3436'
  },
  {
    name: 'ANSI Red',
    short: 'red',
    description: '`\\x1b[31m`',
    default: '#cc0000'
  },
  {
    name: 'ANSI Green',
    short: 'green',
    description: '`\\x1b[32m`',
    default: '#4e9a06'
  },
  {
    name: 'ANSI Yellow',
    short: 'yellow',
    description: '`\\x1b[33m`',
    default: '#c4a000'
  },
  {
    name: 'ANSI Blue',
    short: 'blue',
    description: '`\\x1b[34m`',
    default: '#3465a4'
  },
  {
    name: 'ANSI Magenta',
    short: 'magenta',
    description: '`\\x1b[35m`',
    default: '#75507b'
  },
  {
    name: 'ANSI Cyan',
    short: 'cyan',
    description: '`\\x1b[36m`',
    default: '#06989a'
  },
  {
    name: 'ANSI White',
    short: 'white',
    description: '`\\x1b[37m`',
    default: '#d3d7cf'
  },
  {
    name: 'ANSI Bright Black',
    short: 'brightBlack',
    description: '`\\x1b[1;30m`',
    default: '#555753'
  },
  {
    name: 'ANSI Bright Red',
    short: 'brightRed',
    description: '`\\x1b[1;31m`',
    default: '#ef2929'
  },
  {
    name: 'ANSI Bright Green',
    short: 'brightGreen',
    description: '`\\x1b[1;32m`',
    default: '#8ae234'
  },
  {
    name: 'ANSI Bright Yellow',
    short: 'brightYellow',
    description: '`\\x1b[1;33m`',
    default: '#fce94f'
  },
  {
    name: 'ANSI Bright Blue',
    short: 'brightBlue',
    description: '`\\x1b[1;34m`',
    default: '#729fcf'
  },
  {
    name: 'ANSI Bright Magenta',
    short: 'brightMagenta',
    description: '`\\x1b[1;35m`',
    default: '#ad7fa8'
  },
  {
    name: 'ANSI Bright Cyan',
    short: 'brightCyan',
    description: '`\\x1b[1;36m`',
    default: '#34e2e2'
  },
  {
    name: 'ANSI Bright White',
    short: 'brightWhite',
    description: '`\\x1b[1;37m`',
    default: '#eeeeec'
  }
]

const RAW_CONFIG_DEFAULTS = {
  debug: false,
  activeIndicator: '*',
  args: '[]',
  terminalType: process.env.TERM || 'xterm-256color',
  cwd: isWindows() ? process.env.USERPROFILE : process.env.HOME,
  projectCwd: false,
  webgl: true,
  webLinks: true,
  env: '',
  setEnv: '{}',
  deleteEnv: '["NODE_ENV"]',
  encoding: '',
  fontSize: 14,
  minimumFontSize: 8,
  maximumFontSize: 100,
  useEditorFont: true,
  fontFamily: atom.config.get('editor.fontFamily') || 'monospace',
  theme: {
    name: 'Custom',
    foreground: '#ffffff',
    background: '#000000',
    cursor: '#ffffff',
    cursorAccent: '#000000',
    selectionBackground: '#4d4d4d',
    black: '#2e3436',
    red: '#cc0000',
    green: '#4e9a06',
    yellow: '#c4a000',
    blue: '#3465a4',
    magenta: '#75507b',
    cyan: '#06989a',
    white: '#d3d7cf',
    brightBlack: '#555753',
    brightRed: '#ef2929',
    brightGreen: '#8ae234',
    brightYellow: '#fce94f',
    brightBlue: '#729fcf',
    brightMagenta: '#ad7fa8',
    brightCyan: '#34e2e2',
    brightWhite: '#eeeeec',
  },
  allowHiddenToStayActive: false,
  runInActive: false,
  leaveOpenAfterExit: true,
  allowRelaunchingTerminalsOnStartup: true,
  relaunchTerminalOnStartup: true,
  title: '',
  xtermOptions: '{}',
  promptToStartup: false,
  copyOnSelect: false,
  showNotifications: true,
  apiOpenPosition: 'Center'
};

export class Config {
  static get (keyName?: string) {
    if (!keyName) {
      return atom.config.get(PACKAGE_NAME);
    }
    let keyPath = `${PACKAGE_NAME}.${keyName}`;
    return atom.config.get(keyPath);
  }
  static set<T extends unknown = unknown>(keyName: string, value: T) {
    return atom.config.set(keyName, value);
  }
}

export function getConfigSchema () {
  let defaultTerminalCommand = isWindows() ?
    (process.env.COMSPEC || 'cmd.exe') :
    (process.env.SHELL || '/bin/sh');

  let defaultCwd = isWindows() ? process.env.USERPROFILE : process.env.HOME;

  let colorSchemaObject: any = {};
  for (let item of THEME_COLORS) {
    let schema: any = {};
    schema.title = item.name;
    schema.type = 'color';
    schema.default = item.default;
    if (item.description) {
      schema.description = item.description;
    }
    let key = schema.short ?? item.name.toLowerCase();
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
          description: `Character(s) to use to indicate the active terminal.`,
          type: 'string',
          default: '⦿ ',
          order: 0
        },
        command: {
          description: `Command to run to initialize the shell.`,
          type: 'string',
          default: defaultTerminalCommand,
          order: 1
        },
        args: {
          title: 'Arguments',
          description: 'Arguments to pass to the initialize command (comma-separated).',
          type: 'array',
          default: [],
          order: 2
        },
        terminalType: {
          description: 'The type of terminal to use.',
          type: 'string',
          default: process.env.TERM || 'xterm-256color',
          order: 3
        },
        cwd: {
          title: 'Working Directory',
          description: 'The working directory to use when launching a terminal.',
          type: 'string',
          default: defaultCwd,
          order: 4
        },
        useProjectRootAsCwd: {
          title: 'Use Project Root as Working Directory',
          description: 'Overrides the setting above when working in a project.',
          type: 'boolean',
          default: true,
          order: 5
        },
        fallbackEnv: {
          title: 'Fallback Environment Variables',
          description: `Environment variables that should always be present, even if the environment does not define them. Accepts a stringified JSON object.`,
          type: 'string',
          default: '{}',
          order: 6
        },
        overrideEnv: {
          title: 'Overridden Environment Variables',
          description: `Environment variables that should always be present _and_ take precedence over values that may already be defined in the environment. Accepts a stringified JSON object.`,
          type: 'object',
          default: '{}',
          order: 7
        },
        deleteEnv: {
          title: 'Deleted Environment Variables',
          description: `Environment variables that should be deleted from a terminal environment whenever present on startup. Separate multiple entries with commas.`,
          type: 'array',
          default: [],
          order: 8
        },
        encoding: {
          title: 'Character Encoding',
          description: 'The encoding to use in a spawned terminal.',
          type: 'string',
          default: 'utf8',
          order: 9
        }
      }
    },
    xterm: {
      title: 'XTerm Configuration',
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
          description: `Options to apply to XTerm terminal objects; [consult the reference](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#properties).`,
          type: 'object',
          order: 2,
          default: {}
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
        theme: {
          title: 'Color Theme',
          description: 'Which set of colors to use in the terminal. Can be one of the preset themes or “Custom,” which prefers the values specified in the section below.',
          type: 'string',
          enum: [
            {
              value: 'Custom',
              description: 'Custom (uses colors specified below)'
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
          default: 'Custom',
          order: 3
        },
        customThemeColors: {
          title: 'Custom Theme Colors',
          type: 'object',
          order: 4,
          properties: colorSchemaObject
        }
      }
    },
    behavior: {
      title: 'Behavior',
      type: 'object',
      order: 3,
      properties: {
        defaultContainer: {
          title: 'Default Container',
          description: 'The destination of a terminal when one is not otherwise specified. (This can happen if you invoke **Terminal: Open** or if one is opened programmatically.)',
          type: 'string',
          enum: [
            'Center',
            'Split Up',
            'Split Down',
            'Split Left',
            'Split Right',
            'Bottom Dock',
            'Left Dock',
            'Right Dock'
          ],
          default: 'Center',
          order: 0
        },
        promptOnStartup: {
          title: 'Prompt On Startup',
          description: `Ask permission before running an initial command if it’s different from the configured initial command. (This could happen if a terminal was opened programmatically via the service API.)`,
          type: 'boolean',
          default: true,
          order: 1
        },
        activeTerminalLogic: {
          title: 'Active Terminal Logic',
          description: `How the “active” terminal is determined.`,
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
        runInActiveTerminal: {
          title: 'Run in Active Terminal',
          description: `When enabled, commands invoked via the service API will try to reuse the active terminal (if there is one) instead of opening a new terminal.`,
          type: 'boolean',
          default: true,
          order: 3
        },
        leaveOpenAfterExit: {
          title: 'Leave Open After Exit',
          description: 'When enabled, will leave terminals open even after their shells have exited.',
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
        }
      }
    }
  };
}

export function getConfigDefaults () {
  let appDataPath;
  if (isWindows()) {
    appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (isMac()) {
    appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    appDataPath = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  }
  let userDataPath = path.join(appDataPath, 'pulsar', 'terminal');

  let command;
  if (isWindows()) {
    command = process.env.COMSPEC || 'cmd.exe';
  } else {
    command = process.env.SHELL || '/bin/sh';
  }

  return {
    ...RAW_CONFIG_DEFAULTS,
    command,
    userDataPath
  };
}

// function configToData (object: Record<string, any>, prefix: string) {
//   let data = [];
//   for (let key in object) {
//     const keyPath = `${prefix}.${key}`;
//     if (object[key].type === 'object') {
//       data.push(...configToData(object[key].properties, keyPath));
//     } else {
//       let profileData = object[key].profileData;
//       if (profileData) {
//         profileData.profileKey = key in COLORS ? COLORS[key] : key;
//         delete object[key].profileData;
//       }
//       data.push({ ...object[key], ...profileData, keyPath });
//     }
//   }
//   return data;
// }
//
// function configOrder (object: Record<string, any>) {
//   let order = 1;
//   for (let name in object) {
//     object[name].order = order++;
//     if (object[name].type === 'object' && ('properties' in object[name])) {
//       configOrder(object[name].properties);
//     }
//   }
//   return object;
// }
//
// export const config = configOrder({
// 	debug: {
// 		title: 'Debug',
// 		description: 'Debug settings',
// 		type: 'boolean',
// 		default: configDefaults.debug,
// 		profileData: {
// 			defaultProfile: configDefaults.debug,
// 			toUrlParam: (val) => JSON.stringify(val),
// 			fromUrlParam: (val) => JSON.parse(val),
// 			checkUrlParam: (val) => (val !== null && val !== ''),
// 			toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.debug', configDefaults.debug),
// 			fromMenuSetting: (element, baseValue) => element.checked,
// 			toMenuSetting: (val) => val.toString(),
// 		},
// 	},
// 	spawnPtySettings: {
// 		title: 'Shell Process Settings',
// 		description: 'Settings related to the process running the shell.',
// 		type: 'object',
// 		properties: {
// 			activeIndicator: {
// 				title: 'Active Terminal Indicator',
// 				description: 'Character(s) to use to indicate the active terminal',
// 				type: 'string',
// 				default: configDefaults.activeIndicator,
// 				profileData: {
// 					defaultProfile: configDefaults.activeIndicator,
// 					toUrlParam: (val) => val,
// 					fromUrlParam: (val) => val,
// 					checkUrlParam: (val) => true,
// 					toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.spawnPtySettings.activeIndicator') || configDefaults.activeIndicator),
// 					fromMenuSetting: (element, baseValue) => (element.getModel().getText() || baseValue),
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			command: {
// 				title: 'Command',
// 				description: 'Command to run',
// 				type: 'string',
// 				default: configDefaults.command,
// 				profileData: {
// 					defaultProfile: configDefaults.command,
// 					toUrlParam: (val) => val,
// 					fromUrlParam: (val) => val,
// 					checkUrlParam: (val) => true,
// 					toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.spawnPtySettings.command') || configDefaults.command),
// 					fromMenuSetting: (element, baseValue) => (element.getModel().getText() || baseValue),
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			args: {
// 				title: 'Arguments',
// 				description: 'Arguments to pass to command, must be in a [JSON array](https://www.w3schools.com/JS/js_json_arrays.asp).',
// 				type: 'string',
// 				default: configDefaults.args,
// 				profileData: {
// 					defaultProfile: JSON.parse(configDefaults.args),
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => !!val,
// 					toBaseProfile: (previousValue) => validateJsonConfigSetting('x-terminal-reloaded.spawnPtySettings.args', configDefaults.args, previousValue),
// 					fromMenuSetting: (element, baseValue) => parseJson(element.getModel().getText(), baseValue, Array),
// 					toMenuSetting: (val) => JSON.stringify(val),
// 				},
// 			},
// 			name: {
// 				title: 'Terminal Type',
// 				description: 'The terminal type to use.',
// 				type: 'string',
// 				default: configDefaults.termType,
// 				profileData: {
// 					defaultProfile: configDefaults.termType,
// 					toUrlParam: (val) => val,
// 					fromUrlParam: (val) => val,
// 					checkUrlParam: (val) => true,
// 					toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.spawnPtySettings.name') || configDefaults.termType),
// 					fromMenuSetting: (element, baseValue) => (element.getModel().getText() || baseValue),
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			cwd: {
// 				title: 'Working Directory',
// 				description: 'The working directory to use when launching command.',
// 				type: 'string',
// 				default: configDefaults.cwd,
// 				profileData: {
// 					defaultProfile: configDefaults.cwd,
// 					toUrlParam: (val) => val,
// 					fromUrlParam: (val) => val,
// 					checkUrlParam: (val) => true,
// 					toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.spawnPtySettings.cwd') || configDefaults.cwd),
// 					fromMenuSetting: (element, baseValue) => (element.getModel().getText() || baseValue),
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			projectCwd: {
// 				title: 'Use Project Directory',
// 				description: 'Use project directory if cwd is in a project when launching command.',
// 				type: 'boolean',
// 				default: configDefaults.projectCwd,
// 				profileData: {
// 					defaultProfile: configDefaults.projectCwd,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.spawnPtySettings.projectCwd', configDefaults.projectCwd),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			env: {
// 				title: 'Environment',
// 				description: 'The environment to use when launching command, must be in a [JSON object](https://www.w3schools.com/JS/js_json_objects.asp). If not set, defaults to the current environment.',
// 				type: 'string',
// 				default: configDefaults.env,
// 				profileData: {
// 					defaultProfile: null,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => !!val,
// 					toBaseProfile: (previousValue) => {
// 						let env = validateJsonConfigSetting('x-terminal-reloaded.spawnPtySettings.env', 'null')
// 						if (!env || env.constructor !== Object) {
// 							env = null
// 						}
// 						return env
// 					},
// 					fromMenuSetting: (element, baseValue) => parseJson(element.getModel().getText(), baseValue, Object),
// 					toMenuSetting: (val) => convertNullToEmptyString(val),
// 				},
// 			},
// 			setEnv: {
// 				title: 'Environment Overrides',
// 				description: 'Environment variables to use in place of the Atom process environment, must be in a [JSON object](https://www.w3schools.com/JS/js_json_objects.asp).',
// 				type: 'string',
// 				default: configDefaults.setEnv,
// 				profileData: {
// 					defaultProfile: JSON.parse(configDefaults.setEnv),
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => !!val,
// 					toBaseProfile: (previousValue) => validateJsonConfigSetting('x-terminal-reloaded.spawnPtySettings.setEnv', configDefaults.setEnv),
// 					fromMenuSetting: (element, baseValue) => parseJson(element.getModel().getText(), baseValue, Object),
// 					toMenuSetting: (val) => JSON.stringify(val),
// 				},
// 			},
// 			deleteEnv: {
// 				title: 'Environment Deletions',
// 				description: 'Environment variables to delete from original environment, must be in a [JSON array](https://www.w3schools.com/JS/js_json_arrays.asp).',
// 				type: 'string',
// 				default: configDefaults.deleteEnv,
// 				profileData: {
// 					defaultProfile: JSON.parse(configDefaults.deleteEnv),
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => !!val,
// 					toBaseProfile: (previousValue) => validateJsonConfigSetting('x-terminal-reloaded.spawnPtySettings.deleteEnv', configDefaults.deleteEnv),
// 					fromMenuSetting: (element, baseValue) => parseJson(element.getModel().getText(), baseValue, Array),
// 					toMenuSetting: (val) => JSON.stringify(val),
// 				},
// 			},
// 			encoding: {
// 				title: 'Character Encoding',
// 				description: 'Character encoding to use in spawned terminal.',
// 				type: 'string',
// 				default: configDefaults.encoding,
// 				profileData: {
// 					defaultProfile: null,
// 					toUrlParam: (val) => val,
// 					fromUrlParam: (val) => (val === 'null' ? null : val),
// 					checkUrlParam: (val) => true,
// 					toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.spawnPtySettings.encoding') || null),
// 					fromMenuSetting: (element, baseValue) => (element.getModel().getText() || baseValue),
// 					toMenuSetting: (val) => convertNullToEmptyString(val),
// 				},
// 			},
// 		},
// 	},
// 	xtermAddons: {
// 		title: 'xterm.js Addons',
// 		description: 'Select the xterm.js addons to enable',
// 		type: 'object',
// 		properties: {
// 			webgl: {
// 				title: 'WebGL Renderer',
// 				description: 'Enable the WebGL-based renderer using the xterm.js [WebGL addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl)',
// 				type: 'boolean',
// 				default: configDefaults.webgl,
// 				profileData: {
// 					defaultProfile: configDefaults.webgl,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.xtermAddons.webgl', configDefaults.webgl),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			webLinks: {
// 				title: 'Web Links',
// 				description: 'Enable clickable web links using the xterm.js [Web links addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-web-links)',
// 				type: 'boolean',
// 				default: configDefaults.webLinks,
// 				profileData: {
// 					defaultProfile: configDefaults.webLinks,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.xtermAddons.webLinks', configDefaults.webLinks),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 		},
// 	},
// 	terminalSettings: {
// 		title: 'Terminal Emulator Settings',
// 		description: 'Settings for the terminal emulator.',
// 		type: 'object',
// 		properties: {
// 			title: {
// 				title: 'Terminal tab title',
// 				description: 'Title to use for terminal tabs.',
// 				type: 'string',
// 				default: configDefaults.title,
// 				profileData: {
// 					defaultProfile: null,
// 					toUrlParam: (val) => val,
// 					fromUrlParam: (val) => (val === 'null' ? null : val),
// 					checkUrlParam: (val) => true,
// 					toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.title') || configDefaults.title || null),
// 					fromMenuSetting: (element, baseValue) => (element.getModel().getText() || baseValue),
// 					toMenuSetting: (val) => (val || ''),
// 				},
// 			},
// 			xtermOptions: {
// 				title: 'xterm.js Terminal Options',
// 				description: 'Options to apply to xterm.js terminal objects, must be in a [JSON object](https://www.w3schools.com/JS/js_json_objects.asp). Read more on the supported [xterm.js API properties](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#properties).',
// 				type: 'string',
// 				default: configDefaults.xtermOptions,
// 				profileData: {
// 					terminalFrontEnd: true,
// 					defaultProfile: JSON.parse(configDefaults.xtermOptions),
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => !!val,
// 					toBaseProfile: (previousValue) => validateJsonConfigSetting('x-terminal-reloaded.terminalSettings.xtermOptions', configDefaults.xtermOptions, previousValue),
// 					fromMenuSetting: (element, baseValue) => parseJson(element.getModel().getText(), baseValue, Object),
// 					toMenuSetting: (val) => JSON.stringify(val),
// 				},
// 			},
// 			useEditorFont: {
// 				title: 'Use editor\'s Font Family',
// 				description: 'Use editor\'s Font Family setting in the terminal. (Overrides Font Family below)',
// 				type: 'boolean',
// 				default: configDefaults.useEditorFont,
// 				profileData: {
// 					defaultProfile: configDefaults.useEditorFont,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.terminalSettings.useEditorFont', configDefaults.useEditorFont),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			fontFamily: {
// 				title: 'Font Family',
// 				description: 'Font family used in terminal emulator.',
// 				type: 'string',
// 				default: configDefaults.fontFamily,
// 				profileData: {
// 					terminalFrontEnd: true,
// 					defaultProfile: configDefaults.fontFamily,
// 					toUrlParam: (val) => val,
// 					fromUrlParam: (val) => val,
// 					checkUrlParam: (val) => true,
// 					toBaseProfile: (previousValue) => getFontFamilyBaseProfile(),
// 					fromMenuSetting: (element, baseValue) => (element.getModel().getText() || baseValue),
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			fontSize: {
// 				title: 'Font Size',
// 				description: 'Font size used in terminal emulator.',
// 				type: 'integer',
// 				default: configDefaults.fontSize,
// 				minimum: configDefaults.minimumFontSize,
// 				maximum: configDefaults.maximumFontSize,
// 				profileData: {
// 					terminalFrontEnd: true,
// 					defaultProfile: configDefaults.fontSize,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => !!val,
// 					toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.fontSize') || configDefaults.fontSize),
// 					fromMenuSetting: (element, baseValue) => parseJson(element.getModel().getText(), baseValue, Number),
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			defaultOpenPosition: {
// 				title: 'Default Open Position',
// 				description: 'Position to open terminal through service API or x-terminal-reloaded:open.',
// 				type: 'string',
// 				enum: [
// 					'Center',
// 					'Split Up',
// 					'Split Down',
// 					'Split Left',
// 					'Split Right',
// 					'Bottom Dock',
// 					'Left Dock',
// 					'Right Dock',
// 				],
// 				default: configDefaults.apiOpenPosition,
// 			},
// 			promptToStartup: {
// 				title: 'Prompt to start command',
// 				description: 'Whether to prompt to start command in terminal on startup.',
// 				type: 'boolean',
// 				default: configDefaults.promptToStartup,
// 				profileData: {
// 					defaultProfile: configDefaults.promptToStartup,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.terminalSettings.promptToStartup', configDefaults.promptToStartup),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			allowHiddenToStayActive: {
// 				title: 'Allow Hidden Terminal To Stay Active',
// 				description: 'When an active terminal is hidden keep it active until another terminal is focused.',
// 				type: 'boolean',
// 				default: configDefaults.allowHiddenToStayActive,
// 			},
// 			runInActive: {
// 				title: 'Run in Active Terminal',
// 				description: 'Whether to run commands from the service API in the active terminal or in a new terminal.',
// 				type: 'boolean',
// 				default: configDefaults.runInActive,
// 			},
// 			leaveOpenAfterExit: {
// 				title: 'Leave Open After Exit',
// 				description: 'Whether to leave terminal emulators open after their shell processes have exited.',
// 				type: 'boolean',
// 				default: configDefaults.leaveOpenAfterExit,
// 				profileData: {
// 					defaultProfile: configDefaults.leaveOpenAfterExit,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.terminalSettings.leaveOpenAfterExit', configDefaults.leaveOpenAfterExit),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			allowRelaunchingTerminalsOnStartup: {
// 				title: 'Allow relaunching terminals on startup',
// 				description: 'Whether to allow relaunching terminals on startup.',
// 				type: 'boolean',
// 				default: configDefaults.allowRelaunchingTerminalsOnStartup,
// 			},
// 			relaunchTerminalOnStartup: {
// 				title: 'Relaunch terminal on startup',
// 				description: 'Whether to relaunch terminal on startup.',
// 				type: 'boolean',
// 				default: configDefaults.relaunchTerminalOnStartup,
// 				profileData: {
// 					defaultProfile: configDefaults.relaunchTerminalOnStartup,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.terminalSettings.relaunchTerminalOnStartup', configDefaults.relaunchTerminalOnStartup),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			copyOnSelect: {
// 				title: 'Copy On Select',
// 				description: 'Copy text to clipboard on selection.',
// 				type: 'boolean',
// 				default: configDefaults.copyOnSelect,
// 				profileData: {
// 					defaultProfile: configDefaults.copyOnSelect,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal-reloaded.terminalSettings.copyOnSelect', configDefaults.copyOnSelect),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			showNotifications: {
// 				title: 'Show notifications',
// 				description: 'Show terminal process exit success and failure notifications',
// 				type: 'boolean',
// 				default: configDefaults.showNotifications,
// 				profileData: {
// 					defaultProfile: configDefaults.showNotifications,
// 					toUrlParam: (val) => JSON.stringify(val),
// 					fromUrlParam: (val) => JSON.parse(val),
// 					checkUrlParam: (val) => (val !== null && val !== ''),
// 					toBaseProfile: (previousValue) => validateBooleanConfigSetting('x-terminal.terminalSettings.showNotifications', configDefaults.showNotifications),
// 					fromMenuSetting: (element, baseValue) => element.checked,
// 					toMenuSetting: (val) => val.toString(),
// 				},
// 			},
// 			colors: {
// 				title: 'Colors',
// 				description: 'Settings for the terminal colors.',
// 				type: 'object',
// 				properties: {
// 					theme: {
// 						title: 'Theme',
// 						description: 'Theme used in terminal emulator.',
// 						type: 'string',
// 						enum: [
// 							'Custom',
// 							'Atom Dark',
// 							'Atom Light',
// 							'Base16 Tomorrow Dark',
// 							'Base16 Tomorrow Light',
// 							'Christmas',
// 							'City Lights',
// 							'Dracula',
// 							'Grass',
// 							'Homebrew',
// 							'Inverse',
// 							'Linux',
// 							'Man Page',
// 							'Novel',
// 							'Ocean',
// 							'One Dark',
// 							'One Light',
// 							'Predawn',
// 							'Pro',
// 							'Red Sands',
// 							'Red',
// 							'Silver Aerogel',
// 							'Solarized Dark',
// 							'Solarized Light',
// 							'Solid Colors',
// 							'Standard',
// 						],
// 						default: configDefaults.theme,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.theme,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.theme') || configDefaults.theme),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					foreground: {
// 						title: 'Text Color',
// 						description: 'This will be overridden if the theme is not \'Custom\'.',
// 						type: 'color',
// 						default: configDefaults.colorForeground,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorForeground,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.foreground') || configDefaults.colorForeground),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					background: {
// 						title: 'Background Color',
// 						description: 'This will be overridden if the theme is not \'Custom\'.',
// 						type: 'color',
// 						default: configDefaults.colorBackground,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBackground,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.background') || configDefaults.colorBackground),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					cursor: {
// 						title: 'Cursor Color',
// 						description: 'Can be transparent. This will be overridden if the theme is not \'Custom\'.',
// 						type: 'color',
// 						default: configDefaults.colorCursor,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorCursor,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.cursor') || configDefaults.colorCursor),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					cursorAccent: {
// 						title: 'Cursor Text Color',
// 						description: 'Can be transparent. This will be overridden if the theme is not \'Custom\'.',
// 						type: 'color',
// 						default: configDefaults.colorCursorAccent,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorCursorAccent,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.cursorAccent') || configDefaults.colorCursorAccent),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					selectionBackground: {
// 						title: 'Selection Background Color',
// 						description: 'Can be transparent. This will be overridden if the theme is not \'Custom\'.',
// 						type: 'color',
// 						default: configDefaults.colorSelectionBackground,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorSelectionBackground,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.selectionBackground') || configDefaults.colorSelectionBackground),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					black: {
// 						title: 'ANSI Black',
// 						description: '`\\x1b[30m`',
// 						type: 'color',
// 						default: configDefaults.colorBlack,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBlack,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.black') || configDefaults.colorBlack),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					red: {
// 						title: 'ANSI Red',
// 						description: '`\\x1b[31m`',
// 						type: 'color',
// 						default: configDefaults.colorRed,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorRed,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.red') || configDefaults.colorRed),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					green: {
// 						title: 'ANSI Green',
// 						description: '`\\x1b[32m`',
// 						type: 'color',
// 						default: configDefaults.colorGreen,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorGreen,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.green') || configDefaults.colorGreen),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					yellow: {
// 						title: 'ANSI Yellow',
// 						description: '`\\x1b[33m`',
// 						type: 'color',
// 						default: configDefaults.colorYellow,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorYellow,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.yellow') || configDefaults.colorYellow),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					blue: {
// 						title: 'ANSI Blue',
// 						description: '`\\x1b[34m`',
// 						type: 'color',
// 						default: configDefaults.colorBlue,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBlue,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.blue') || configDefaults.colorBlue),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					magenta: {
// 						title: 'ANSI Magenta',
// 						description: '`\\x1b[35m`',
// 						type: 'color',
// 						default: configDefaults.colorMagenta,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorMagenta,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.magenta') || configDefaults.colorMagenta),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					cyan: {
// 						title: 'ANSI Cyan',
// 						description: '`\\x1b[36m`',
// 						type: 'color',
// 						default: configDefaults.colorCyan,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorCyan,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.cyan') || configDefaults.colorCyan),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					white: {
// 						title: 'ANSI White',
// 						description: '`\\x1b[37m`',
// 						type: 'color',
// 						default: configDefaults.colorWhite,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorWhite,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.white') || configDefaults.colorWhite),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					brightBlack: {
// 						title: 'ANSI Bright Black',
// 						description: '`\\x1b[1;30m`',
// 						type: 'color',
// 						default: configDefaults.colorBrightBlack,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBrightBlack,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.brightBlack') || configDefaults.colorBrightBlack),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					brightRed: {
// 						title: 'ANSI Bright Red',
// 						description: '`\\x1b[1;31m`',
// 						type: 'color',
// 						default: configDefaults.colorBrightRed,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBrightRed,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.brightRed') || configDefaults.colorBrightRed),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					brightGreen: {
// 						title: 'ANSI Bright Green',
// 						description: '`\\x1b[1;32m`',
// 						type: 'color',
// 						default: configDefaults.colorBrightGreen,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBrightGreen,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.brightGreen') || configDefaults.colorBrightGreen),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					brightYellow: {
// 						title: 'ANSI Bright Yellow',
// 						description: '`\\x1b[1;33m`',
// 						type: 'color',
// 						default: configDefaults.colorBrightYellow,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBrightYellow,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.brightYellow') || configDefaults.colorBrightYellow),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					brightBlue: {
// 						title: 'ANSI Bright Blue',
// 						description: '`\\x1b[1;34m`',
// 						type: 'color',
// 						default: configDefaults.colorBrightBlue,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBrightBlue,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.brightBlue') || configDefaults.colorBrightBlue),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					brightMagenta: {
// 						title: 'ANSI Bright Magenta',
// 						description: '`\\x1b[1;35m`',
// 						type: 'color',
// 						default: configDefaults.colorBrightMagenta,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBrightMagenta,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.brightMagenta') || configDefaults.colorBrightMagenta),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					brightCyan: {
// 						title: 'ANSI Bright Cyan',
// 						description: '`\\x1b[1;36m`',
// 						type: 'color',
// 						default: configDefaults.colorBrightCyan,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBrightCyan,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.brightCyan') || configDefaults.colorBrightCyan),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 					brightWhite: {
// 						title: 'ANSI Bright White',
// 						description: '`\\x1b[1;37m`',
// 						type: 'color',
// 						default: configDefaults.colorBrightWhite,
// 						profileData: {
// 							terminalFrontEnd: true,
// 							defaultProfile: configDefaults.colorBrightWhite,
// 							toUrlParam: (val) => val,
// 							fromUrlParam: (val) => val,
// 							checkUrlParam: (val) => true,
// 							toBaseProfile: (previousValue) => (atom.config.get('x-terminal-reloaded.terminalSettings.colors.brightWhite') || configDefaults.colorBrightWhite),
// 							fromMenuSetting: (element, baseValue) => (element.value || baseValue),
// 							toMenuSetting: (val) => val.toString(),
// 						},
// 					},
// 				},
// 			},
// 		},
// 	},
// })
//

// export const CONFIG_DATA = configToData(config, 'terminal');

export const CONFIG_DEFAULTS = getConfigDefaults();
