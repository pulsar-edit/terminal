export type ShellIntegrationInjection = {
    args: string[];
    env: Record<string, string>;
};
export type ShellIntegrationResult = {
    enabled: true;
    injection: ShellIntegrationInjection;
} | {
    enabled: false;
    reason: string;
};
/**
 * Given the shell command and args the user has configured, decides whether
 * shell integration can be injected, and if so, returns the additional args
 * and environment variables needed to do it. Callers should merge these into
 * the args/env they'd otherwise pass to `Pty`.
 *
 * `env` is the environment the shell is about to be spawned with — used only
 * to read a preexisting `ZDOTDIR`, if any, before we override it for zsh.
 */
export declare function getShellIntegrationInjection(shellCommand: string, shellArgs: string[], env: Record<string, string>): Promise<ShellIntegrationResult>;
