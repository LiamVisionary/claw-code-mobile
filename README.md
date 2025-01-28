# Expo AI


https://github.com/user-attachments/assets/851bab04-837b-4b0c-aaae-2853c95577c2


This is the Expo Router AI demo from my [React Conf talk](https://www.youtube.com/watch?v=djhEgxQf3Kw). This project uses universal React Server Components in Expo Router to render native UI on the server and stream it down as part of an AI chat response.

## Features

- [Expo Router](https://docs.expo.dev/router/introduction/) — The universal React framework.
  - Universal routing and rendering for native and web platforms.
  - Full deep linking support everywhere.
  - React Server Functions and streamed responses from the edge.
  - Native navigation, gestures, and animations.
- [AI SDK](https://sdk.vercel.ai/docs) — Uses experimental RSC support in the `ai` package for tool calls to OpenAI.


## APIs

You need to use the environment variables defined below in your `.env.local` file to run this project. I recommend using [EAS Environment Variables](https://docs.expo.dev/eas/using-environment-variables/#create-environment-variables) to securely store and share your environment variables since they should never be committed to git or exposed publicly.

- `OPENAI_API_KEY` — [OpenAI](https://platform.openai.com/docs/overview) model (this can be swapped out for others)
- `WEATHER_API_KEY` — [Weather API](https://www.weatherapi.com/) for realtime data.
- `TMDB_READ_ACCESS_TOKEN` — [The MovieDB](https://developer.themoviedb.org/docs/getting-started)
- `TMDB_API_KEY` — [The MovieDB](https://developer.themoviedb.org/docs/getting-started)
- `GOOGLE_MAPS_API_KEY` - [Google Maps API](https://console.cloud.google.com/google/maps-apis/home) for fetching locations.
- `EXPO_PUBLIC_APPLE_MAPKIT_JS_KEY` - [Apple Maps API](https://developer.apple.com/account/resources/services/maps-tokens) for web maps.

## Development

Install the project dependencies and run `npx expo` to see the project. This project can be opened in Expo Go, development builds, and in the web—no Xcode needed!

# Deployment

> Expo RSC is still in developer preview and subject to breaking changes! Production deployment is not officially supported yet.

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
4. Open [Proxyman](https://proxyman.com/) to inspect network traffic.

Using the latest Expo CLI, you can also test the release production build with the host:

1. `eas deploy` -> put URL in the origin field.
2. `npx expo run:ios --unstable-rebundle --configuration Release` -- This will quickly rebuild the existing native iOS app with different JS and assets.
3. **Results:** The app should launch with URL set to the production origin.

You will want to make a clean build before sending to the store.

### Full iOS deployment

This will require the following:

1. Ensure hosting is setup for the project by deploying once locally first. `npx expo export -p web && eas deploy`
2. Set the `EXPO_UNSTABLE_DEPLOY_SERVER=1` environment variable in your `.env`. This will be used to deploy and link the server during EAS Build.
3. Create an `EXPO_TOKEN` for the project. https://expo.dev/accounts/[account]/settings/access-tokens
4. Set the `owner` field in the `app.json` to the owner of the project (this is your EAS username).
5. Ensure all the environment variables are set in the EAS project dashboard.
6. Ensure the `origin` field is **NOT** set in the `app.json` or in the `expo.extra.router.origin` field. Also ensure you aren't using `app.config.js` as this is not supported with automatically linked deployments yet.

Then run `eas build --platform ios` to build the app and deploy a versioned a server.

## Known Issues

- `react-server-dom-webpack` must be patched for native to work because Hermes doesn't support promises correctly.
- The deterministic module IDs are not the same across machines, meaning a publish from your local computer will not match a client build from EAS Build.
- The `origin` field is a bit pesky to keep track of. This is a WIP.
- The `ai` package needs to be patched manually in the package.json to support the SSR-pass. Add `"require"` field and set it to the client file (`import` field) in the `./rsc` specifier.
- A number of fixes may be landed on main and not in the latest release. You may need to build Expo CLI from source.
