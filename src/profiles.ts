import { Emitter } from "atom";
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { detailedDiff } from 'deep-object-diff';

import { Config, CONFIG_DEFAULTS } from './config';

export type ProfileData = Record<string, unknown>;

export const BASE_URI = `terminal://`;

// NOTE: most of this is copied from `x-terminal-reloaded`, but I expect that
// it will change quite a bit, or else be removed entirely unless I can be
// convinced that this is a feature worth all the added complexity.

export class Profiles {
  static emitter = new Emitter();
  static profilesConfigPath = path.join(
    CONFIG_DEFAULTS.userDataPath,
    'profiles.json'
  );

  static profiles: Record<string, ProfileData> = {};

  static baseProfile = this.getDefaultProfile();
  static previousBaseProfile: ProfileData | null = null;
  static profilesLoadPromise: Promise<void> | null = null;

  static initialize () {
    this.resetBaseProfile();
    this.profilesLoadPromise = null;
    this.reloadProfiles();
  }

  static async ready() {
    return await this.profilesLoadPromise;
  }

  static sortProfiles (profiles: Record<string, ProfileData>) {
    let orderedProfiles: Record<string, ProfileData> = {};
    for (let key of Object.keys(profiles).sort()) {
      orderedProfiles[key] = profiles[key];
    }
    return orderedProfiles;
  }

  static async reloadProfiles () {
    let resolveLoad: (value: void | PromiseLike<void>) => void;
    this.profilesLoadPromise = new Promise((resolve) => resolveLoad = resolve);

    try {
      let data = await fs.readJson(this.profilesConfigPath);
      this.profiles = this.sortProfiles(data);

      this.emitter.emit('did-reload-profiles', this.getSanitizedProfilesData());
      resolveLoad!();
    } catch (error) {
      // Create the profiles file.
      await this.updateProfiles({});
      this.emitter.emit('did-reload-profiles', this.getSanitizedProfilesData());
      resolveLoad!();
    }
  }

  static deepClone<T extends unknown>(data: T): T {
    return structuredClone(data);
  }

  static diffProfiles (oldProfile: ProfileData, newProfile: ProfileData) {
    let diff = detailedDiff(oldProfile, newProfile);
    return {
      ...diff.added,
      ...diff.updated
    };
  }

  static getDefaultProfile (): ProfileData {
    return Config.get();
    // let defaultProfile: ProfileData = {};
    // for (let data of CONFIG_DATA) {
    //   if (!data.profileKey) continue;
    //   defaultProfile[data.profileKey] = data.defaultProfile;
    // }
    // return defaultProfile;
  }

  static getBaseProfile (): ProfileData {
    return this.deepClone(this.baseProfile);
  }

  static resetBaseProfile () {
    // this.previousBaseProfile = this.deepClone(this.baseProfile);
    // this.baseProfile = {};
    // for (let data of CONFIG_DATA) {
    //   if (!data.profileKey) continue;
    //   this.baseProfile[data.profileKey] = data.toBaseProfile(this.previousBaseProfile[data.profileKey]);
    // }
    // this.emitter.emit('did-reset-base-profile', this.getBaseProfile());
  }

  static onDidReloadProfiles (
    callback: (profileDataTable: Record<string, ProfileData>) => unknown
  ) {
    return this.emitter.on('did-reload-profiles', callback);
  }

  static onDidResetBaseProfile (
    callback: (profileData: ProfileData) => unknown
  ) {
    return this.emitter.on('did-reset-base-profile', callback);
  }

  static sanitizeData (unsanitizedData: unknown) {
    if (!unsanitizedData) return {};
    if (typeof unsanitizedData !== 'object') return {};

    let sanitizedData = {};

    // for (let data of CONFIG_DATA) {
    //   if (!data.profileKey) continue;
    //   if (data.profileKey in unsanitizedData) {
    //     sanitizedData[data.profileKey] = unsanitizedData[data.profileKey];
    //   }
    // }

    return this.deepClone(sanitizedData);
  }

  static getSanitizedProfilesData () {
    let result: Record<string, ProfileData> = {};
    for (let key in this.profiles) {
      result[key] = this.sanitizeData(this.profiles[key]);
    }
    return result;
  }

  static async getProfiles () {
    await this.ready();
    return this.getSanitizedProfilesData();
  }

  static async getProfile (profileName: string) {
    await this.ready();
    return {
      ...this.deepClone(this.baseProfile),
      ...this.sanitizeData(this.profiles[profileName] || {})
    }
  }

  static async profileExists (profileName: string) {
    await this.ready();
    return profileName in this.profiles;
  }

  static async setProfile (profileName: string, data: ProfileData) {
    await this.ready();
    const profileData = {
      ...this.deepClone(this.baseProfile),
      ...this.sanitizeData(data)
    };
    const newProfilesConfigData = {
      ...this.deepClone(this.profiles)
    };
    newProfilesConfigData[profileName] = profileData;
    await this.updateProfiles(newProfilesConfigData);
  }

  static async updateProfiles (rawNewProfilesConfigData: Record<string, ProfileData>) {
    await fs.ensureDir(path.dirname(this.profilesConfigPath));
    let newProfilesConfigData = this.sortProfiles(rawNewProfilesConfigData);
    await fs.writeJSON(this.profilesConfigPath, newProfilesConfigData);
    this.profiles = newProfilesConfigData;
  }

  static async deleteProfile (profileName: string) {
    await this.ready();
    const newProfilesConfigData = {
      ...this.deepClone(this.profiles)
    };
    delete newProfilesConfigData[profileName];
    await this.updateProfiles(newProfilesConfigData);
  }

  static generateUri() {
    return `${BASE_URI}${crypto.randomUUID()}/`;
  }

  static generateUriFromProfileData (rawProfileData: ProfileData | unknown) {
    let profileData = this.sanitizeData(rawProfileData);
    let url = new URL(this.generateUri());
    // for (let data of CONFIG_DATA) {
    //   if (!data.profileKey) continue;
    //   if (!(data.profileKey in profileData)) continue;
    //   url.searchParams.set(
    //     data.profileKey,
    //     data.toUrlParam(profileData[data.profileKey])
    //   );
    // }
    return url;
  }

  static createProfileDataFromUri (uri: string) {
    let url = new URL(uri);
    const baseProfile = this.getBaseProfile();
    let profileData: ProfileData = {};
    // for (let data of CONFIG_DATA) {
    //   if (!data.profileKey) continue;
    //   let param = url.searchParams.get(data.profileKey);
    //   if (param) {
    //     profileData[data.profileKey] = data.fromUrlParam(param);
    //   }
    //   if (!param || !data.checkUrlParam(profileData[data.profileKey])) {
    //     profileData[data.profileKey] = baseProfile[data.profileKey];
    //   }
    // }
    return profileData;
  }
}
