#!/bin/bash
# macOS: double-click to start Gatekeeper. Closing this window closes the app.
cd "$(dirname "$0")" || exit 1
# Finder does not hand over your shell's PATH: look where Node is usually installed
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi
if ! command -v node >/dev/null 2>&1; then
  echo "Gatekeeper needs Node.js 22.12 or newer: https://nodejs.org"
  read -r -p "Press Return to close." _; exit 1
fi
node desktop/launch.mjs "$@" || read -r -p "Press Return to close." _
