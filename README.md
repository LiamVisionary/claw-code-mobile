# Welcome to your Expo app 👋

# Publishing

Ensure the environment variables are all configured, check the `.env` file for a template. Set the environment variables in your EAS project dashboard.

## Web

> `npx expo export -p web` and `eas deploy`

The `ai` package needs to be patched manually in the package.json to support the SSR-pass. Add `"require"` field and set it to the client file (`import` field) in the `./rsc` specifier:

```json
    "./rsc": {
      "types": "./rsc/dist/index.d.ts",
      "react-server": "./rsc/dist/rsc-server.mjs",
      "import": "./rsc/dist/rsc-client.mjs",
      "require": "./rsc/dist/rsc-client.mjs"
    },
```

You'll then hit `Error: Could not find file in server action manifest:` which means you need to bundle with latest Expo CLI.

You can test locally with `npx expo serve`.

## iOS

### Testing release iOS build locally

Since the hosted environment is a bit different to the local one, it's useful to have a sanity test on the local build first.

1. `npx expo export -p ios` and `npx expo serve`
2. Set the generated origin in the `app.json`'s `origin` field. Ensure no generated value is in `expo.extra.router.origin`. This should be `https://localhost:8081` (assuming `npx expo serve` is running on the default port).
3. Build the app in release mode on to a simulator: `EXPO_NO_DEPLOY=1 npx expo run:ios --configuration Release`
4. Open Proxyman to inspect network traffic.

Using the latest Expo CLI, you can also test the release production build with the host:

1. `eas deploy` -> put URL in the origin field.
2. `npx expo run:ios --unstable-rebundle --configuration Release`
3. App should relaunch with URL set to the new field.

You will want to make a clean build before sending to the store.

### Full deployment

~~I'm currently publishing from Xcode directly instead of using EAS.~~ I'm using EAS now.

1. `npx expo export -p ios` and `eas deploy`
2. Set the generated origin in the `app.json`'s `origin` field. Ensure no generated value is in `expo.extra.router.origin`.
3. Bump the build number in Xcode.
4. Set the configuration to `Release` and run `Archive`.
5. Distribute the archive to the App Store Connect.
6. Run experimental EAS TestFlight script to make the latest version the default (non-expo team can do this manually from dashboard). `exapple beta:submit --bundle-id app.bacon.expoai`

### Building from EAS

This will require the following:

- Ensure hosting is setup for the project by deploying once locally first. `npx expo export -p web && eas deploy`
- Set the `EXPO_UNSTABLE_DEPLOY_SERVER=1` environment variable in your `.env`. This will be used to deploy and link the server during EAS Build.
- Create an `EXPO_TOKEN` for the project. https://expo.dev/accounts/[account]/settings/access-tokens
- Set the `owner` field in the `app.json` to the owner of the project (this is your EAS username).
- Install `eas-cli` locally in the project (Pending [PR](https://github.com/expo/expo/pull/34070)).
- Ensure all the environment variables are set in the EAS project dashboard.
- Ensure the `origin` field is **NOT** set in the `app.json` or in the `expo.extra.router.origin` field. You can set this to an alias if you want the app to pull whatever is the latest version from the server.

Then run `eas build --platform ios` to build the app.

**Known Issues**

- The deterministic module IDs are not the same across machines, meaning a publish from your local computer will not match a client build from EAS Build.
- The `origin` field is a bit pesky to keep track of.
- Environment variables are hard to keep aligned.
- Avoid using anything besides generated module IDs.
- HMR in the server doesn't work. Restart Expo CLI to see changes. This is due to the multiple recursions back to the server environment from nested server actions.
- The `ai` package needs to be patched manually in the package.json to support the SSR-pass. Add `"require"` field and set it to the client file (`import` field) in the `./rsc` specifier.
- `react-server-dom-webpack` must be patched for native to work because Hermes doesn't support promises correctly.
- A number of fixes may be landed on main and not in the latest release. You may need to build Expo CLI from source.
- First response from the server on iOS is sometimes broken. Perhaps an issue with `expo/fetch` streaming?
