# Contributing

Thanks for wanting to help. This is a small project with strong opinions, so this doc is short — read it and [DEVELOPMENT_GUIDELINES.md](DEVELOPMENT_GUIDELINES.md) before opening a non-trivial PR.

## Before you start

- **Grab an open item from [ROADMAP.md](ROADMAP.md).** If you want to work on something not listed, open a short issue first so we can align before you sink time in.
- **Read [DESIGN_GUIDELINES.md](DESIGN_GUIDELINES.md) for any UI change.** The bar is "feels native on iOS" — no spinners where shimmer will do, no redundant close buttons on swipe-dismissable sheets, no settings toggles where a sensible default will do.
- **Read [DEVELOPMENT_GUIDELINES.md](DEVELOPMENT_GUIDELINES.md) for any code change.** The one-line summary: less is more, reduce user friction, persist what the user will want next, do it right not fast.

## Dev setup

See the [Quick Start](README.md#quick-start) in the README. The short version:

```bash
git clone https://github.com/LiamVisionary/claw-code-mobile
cd claw-code-mobile
npm install
npm run dev              # local LAN
# or
npm run dev:tunnel       # public tunnel + auto-injected token
```

Scan the Metro QR code with Expo Go. Backend runs on `:5000`, auto-discovered by the app.

## PR expectations

- **One logical change per PR.** Refactors that sneak in alongside a feature get asked to split.
- **Match the surrounding code.** Don't reformat files you're not editing. Don't introduce new patterns when an existing one fits.
- **No new dependencies without a reason.** If you're pulling in a package for one function, copy the function instead.
- **Test the happy path in Expo Go** for any UI change, and say so in the PR description. Type-checking passes is not enough — "I verified X on iOS simulator / device" is.
- **Commit messages describe the why, not the what.** The diff shows the what.

## Issue reports

When filing an issue, say which surface is broken:

- **Mobile app** — Expo build, model ID, device / simulator.
- **Gateway** — Node version, OS, bearer token mode (LAN / tunnel).
- **Claw binary** — that's upstream at [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code); file there unless it's the gateway's use of it.

A 30-second repro beats a 500-word description.

## What I'll say no to

- UX regressions for architectural cleanliness. If a "cleaner" refactor adds a tap or a settings toggle, it's not cleaner.
- Support matrix expansions (Android, web, desktop) without a clear maintainer stepping up. iOS + Expo Go is the target today.
- Feature flags and backwards-compat shims for code that isn't shipped to users yet.

## Licensing

By contributing, you agree your contributions are licensed under the same terms as the rest of the repo — see [LICENSE](LICENSE).
