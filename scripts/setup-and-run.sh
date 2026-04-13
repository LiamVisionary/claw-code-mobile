#!/usr/bin/env bash
set -e

# Install deps
yarn install --ignore-scripts
npx --yes patch-package

# Ensure react-native-screens and its deps are properly installed
if [ ! -f "node_modules/react-native-screens/package.json" ]; then
  echo "[setup] Reinstalling react-native-screens..."
  curl -sLo /tmp/rns.tgz https://registry.npmjs.org/react-native-screens/-/react-native-screens-4.16.0.tgz
  tar -xzf /tmp/rns.tgz -C /tmp
  cp -r /tmp/package node_modules/react-native-screens
fi

# react-native-screens deps that yarn may not install correctly
for pkg in "react-freeze" "react-native-is-edge-to-edge" "warn-once"; do
  if [ ! -f "node_modules/${pkg}/package.json" ]; then
    echo "[setup] Reinstalling ${pkg}..."
    SAFE=$(echo "$pkg" | tr '/' '-')
    INFO=$(curl -sf "https://registry.npmjs.org/${pkg}/latest")
    VER=$(echo "$INFO" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).version))")
    curl -sLo "/tmp/${SAFE}.tgz" "https://registry.npmjs.org/${pkg}/-/${SAFE}-${VER}.tgz"
    tar -xzf "/tmp/${SAFE}.tgz" -C /tmp
    mkdir -p "node_modules/${pkg}"
    cp -r /tmp/package/. "node_modules/${pkg}/"
  fi
done

# Patch @expo/cli AsyncNgrok.js to use personal ngrok token instead of Expo's shared one
ASYNC_NGROK="node_modules/@expo/cli/build/src/start/server/AsyncNgrok.js"
if grep -q "5W1bR67GNbWcXqmxZzBG1_56GezNeaX6sSRvn8npeQ8" "$ASYNC_NGROK" 2>/dev/null; then
  echo "[setup] Patching AsyncNgrok.js with personal ngrok token..."
  node -e "
    const fs = require('fs');
    let src = fs.readFileSync('$ASYNC_NGROK', 'utf8');
    src = src.replace(
      \"authToken: '5W1bR67GNbWcXqmxZzBG1_56GezNeaX6sSRvn8npeQ8'\",
      \"authToken: '2CmWmqJnyC1RiayWKRKqjSrLr0Q_fMDN6b6iszPpgdMdKinD'\"
    );
    src = src.replace(
      \"domain: 'exp.direct'\",
      \"domain: 'ngrok.io'\"
    );
    src = src.replace(
      /async _getConnectionPropsAsync\(\) \{[\s\S]*?^\    \}/m,
      'async _getConnectionPropsAsync() {\n        return {};\n    }'
    );
    fs.writeFileSync('$ASYNC_NGROK', src);
  "
  echo "[setup] AsyncNgrok.js patched."
fi

# Configure ngrok with personal auth token so @expo/ngrok-bin can use it
mkdir -p ~/.expo
echo "authtoken: $NGROK_AUTHTOKEN" > ~/.expo/ngrok.yml
echo "[setup] Configured ngrok with NGROK_AUTHTOKEN"

# Run tunnel share script
exec node scripts/start-tunnel-share.mjs
