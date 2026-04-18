# Development Guidelines
- Less is more. Opt for simplicity in everything, but remember simplicity doesn't have to mean low code complexity, but rather low frontend complication.
- Reduce user friction AS MUCH as possible. E.g. don't add in a redundant save button on a modal sheet, when the user can just swipe away the modal to save. Additionally, don't add an x button to a swipe to close sheet modal, its redundant and not clean.
- Don't make the user have to do anything on their own if they don't have to. E.g. with our obsidian integration, it auto-detects if obsidian is installed and if not it shows an 'Install Obsidian Headless' button that handles the installation and initializiation intuitively. This is good UX. Always prioritize seamless UX.
- Persist data the user is likely to use again in the very near future. E.g. if the user starts a chat in a particular directory, persist the chat location in the directory picker for when the user starts another chat later, the user can always back out of that directory anyways. 
- Opt for the right way, not for the shortcut. Dev time is no longer a concern. We opt for correctness, not for hacky, fragile solutions liable to break in the future.

