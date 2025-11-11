export declare class Config {
    static get(keyName?: string): any;
    static set<T extends unknown = unknown>(keyName: string, value: T): void;
}
export declare function getConfigSchema(): {
    terminal: {
        title: string;
        description: string;
        type: string;
        order: number;
        properties: {
            activeTerminalIndicator: {
                title: string;
                description: string;
                type: string;
                default: string;
                order: number;
            };
            command: {
                title: string;
                description: string;
                type: string;
                default: string;
                order: number;
            };
            args: {
                title: string;
                description: string;
                type: string;
                default: never[];
                items: {
                    type: string;
                };
                order: number;
            };
            terminalType: {
                title: string;
                description: string;
                type: string;
                default: string;
                order: number;
            };
            encoding: {
                title: string;
                description: string;
                type: string;
                default: string;
                order: number;
            };
            env: {
                title: string;
                description: string;
                type: string;
                order: number;
                properties: {
                    fallbackEnv: {
                        title: string;
                        description: string;
                        type: string;
                        default: string;
                        order: number;
                    };
                    overrideEnv: {
                        title: string;
                        description: string;
                        type: string;
                        default: string;
                        order: number;
                    };
                    deleteEnv: {
                        title: string;
                        description: string;
                        type: string;
                        default: string[];
                        order: number;
                    };
                };
            };
        };
    };
    xterm: {
        title: string;
        type: string;
        order: number;
        properties: {
            webgl: {
                title: string;
                description: string;
                type: string;
                order: number;
                default: boolean;
            };
            webLinks: {
                title: string;
                description: string;
                type: string;
                order: number;
                default: boolean;
            };
            additionalOptions: {
                title: string;
                description: string;
                type: string;
                order: number;
                default: string;
            };
        };
    };
    appearance: {
        title: string;
        type: string;
        order: number;
        properties: {
            fontFamily: {
                title: string;
                description: string;
                order: number;
                type: string;
                default: string;
            };
            useEditorFontFamily: {
                title: string;
                description: string;
                order: number;
                type: string;
                default: boolean;
            };
            fontSize: {
                title: string;
                description: string;
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                order: number;
            };
            useEditorFontSize: {
                title: string;
                description: string;
                order: number;
                type: string;
                default: boolean;
            };
            lineHeight: {
                title: string;
                description: string;
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                order: number;
            };
            useEditorLineHeight: {
                title: string;
                description: string;
                order: number;
                type: string;
                default: boolean;
            };
            theme: {
                title: string;
                description: string;
                type: string;
                enum: (string | {
                    value: string;
                    description: string;
                })[];
                default: string;
                order: number;
            };
            customThemeColors: {
                title: string;
                description: string;
                type: string;
                order: number;
                collapsed: boolean;
                properties: any;
            };
        };
    };
    behavior: {
        title: string;
        description: string;
        type: string;
        order: number;
        properties: {
            defaultContainer: {
                title: string;
                description: string;
                type: string;
                enum: string[];
                default: string;
                order: number;
            };
            activeTerminalLogic: {
                title: string;
                description: string;
                type: string;
                enum: {
                    value: string;
                    description: string;
                }[];
                default: string;
                order: number;
            };
            runInActive: {
                title: string;
                description: string;
                type: string;
                default: boolean;
                order: number;
            };
            leaveOpenAfterExit: {
                title: string;
                description: string;
                type: string;
                default: boolean;
                order: number;
            };
            relaunchTerminalsOnStartup: {
                title: string;
                description: string;
                type: string;
                default: boolean;
                order: number;
            };
            copyTextOnSelect: {
                title: string;
                description: string;
                type: string;
                default: string;
                order: number;
            };
        };
    };
    advanced: {
        title: string;
        type: string;
        order: number;
        collapsed: boolean;
        description: string;
        properties: {
            enableDebugLogging: {
                title: string;
                description: string;
                type: string;
                default: boolean;
                order: number;
            };
            allowedCommands: {
                title: string;
                description: string;
                type: string;
                default: never[];
                items: {
                    type: string;
                };
                order: number;
            };
        };
    };
};
