import { Emitter } from "atom";
export type ProfileData = Record<string, unknown>;
export declare const BASE_URI = "terminal://";
export declare class Profiles {
    static emitter: Emitter<{
        [key: string]: any;
    }, {}>;
    static profilesConfigPath: string;
    static profiles: Record<string, ProfileData>;
    static baseProfile: ProfileData;
    static previousBaseProfile: ProfileData | null;
    static profilesLoadPromise: Promise<void> | null;
    static initialize(): void;
    static ready(): Promise<void | null>;
    static sortProfiles(profiles: Record<string, ProfileData>): Record<string, ProfileData>;
    static reloadProfiles(): Promise<void>;
    static deepClone<T extends unknown>(data: T): T;
    static diffProfiles(oldProfile: ProfileData, newProfile: ProfileData): {};
    static getDefaultProfile(): ProfileData;
    static getBaseProfile(): ProfileData;
    static resetBaseProfile(): void;
    static onDidReloadProfiles(callback: (profileDataTable: Record<string, ProfileData>) => unknown): import("atom").Disposable;
    static onDidResetBaseProfile(callback: (profileData: ProfileData) => unknown): import("atom").Disposable;
    static sanitizeData(unsanitizedData: unknown): {};
    static getSanitizedProfilesData(): Record<string, ProfileData>;
    static getProfiles(): Promise<Record<string, ProfileData>>;
    static getProfile(profileName: string): Promise<{}>;
    static profileExists(profileName: string): Promise<boolean>;
    static setProfile(profileName: string, data: ProfileData): Promise<void>;
    static updateProfiles(rawNewProfilesConfigData: Record<string, ProfileData>): Promise<void>;
    static deleteProfile(profileName: string): Promise<void>;
    static generateUri(): string;
    static generateUriFromProfileData(rawProfileData: ProfileData | unknown): URL;
    static createProfileDataFromUri(uri: string): ProfileData;
}
