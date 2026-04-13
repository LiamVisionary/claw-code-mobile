import raw from './app.json';
import type { ExpoConfig } from 'expo/config';

const base = (raw as { expo: ExpoConfig }).expo;

const config: ExpoConfig = {
  ...base,
  name: 'Claw Code Mobile',
  slug: 'claw-code-mobile',
  owner: 'LiamVisionary',
  scheme: 'clawcodemobile',
  ios: {
    ...base.ios,
    bundleIdentifier: 'com.liamvisionary.clawcodemobile',
    supportsTablet: false,
    infoPlist: {
      ...(base.ios?.infoPlist ?? {}),
      ITSAppUsesNonExemptEncryption: false,
    },
    appleTeamId: 'L7XLLTV3X7',
    entitlements: undefined,
    associatedDomains: undefined,
  },
};

export default config;
