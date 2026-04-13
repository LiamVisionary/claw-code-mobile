import raw from './app.json';
import type { ExpoConfig } from 'expo/config';

const base = (raw as { expo: ExpoConfig }).expo;
const { eas: baseEas, ...baseExtra } = base.extra ?? {};
const { projectId: _ignoredProjectId, ...remainingEas } = baseEas ?? {};
const easProjectId =
  process.env.EAS_PROJECT_ID ?? '9d2797ed-2d4b-4664-8ace-4c766228ab5f';
const expoOwner = process.env.EXPO_OWNER;

const config: ExpoConfig = {
  ...base,
  name: 'Claw Code Mobile',
  slug: 'claw-code-mobile',
  ...(expoOwner ? { owner: expoOwner } : {}),
  scheme: 'clawcodemobile',
  extra: {
    ...baseExtra,
    ...(easProjectId
      ? {
          eas: {
            ...remainingEas,
            projectId: easProjectId,
          },
        }
      : Object.keys(remainingEas).length > 0
        ? {
            eas: remainingEas,
          }
        : {}),
  },
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
