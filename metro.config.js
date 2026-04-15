// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Exclude the upstream claw-code repo (Rust sources, docs, huge target/ dirs
// if someone builds in-place). Metro shouldn't try to resolve modules there,
// and watching it is what crashed the dev server when cargo was writing
// transient files into rust/target/debug/deps/.
const EXCLUDED = /^.*\/claw-code\/.*$/;
config.resolver.blockList = Array.isArray(config.resolver.blockList)
  ? [...config.resolver.blockList, EXCLUDED]
  : config.resolver.blockList
  ? [config.resolver.blockList, EXCLUDED]
  : [EXCLUDED];

module.exports = config;
