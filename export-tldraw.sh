#!/bin/bash
set -euo pipefail

VAULT="/Users/asafdayan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian"
CONTENT_DIR="$(dirname "$0")/content/pictures"
TMPDIR_BASE="$(mktemp -d)"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export npm_config_yes="true"

# All tldraw .md files referenced in the lecture
TLDRAW_FILES=(
  "Tldraw 2026-04-12 9.29AM (0).md"
  "Tldraw 2026-04-12 9.30AM.md"
  "Tldraw 2026-04-12 9.31AM.md"
  "Tldraw 2026-04-12 9.38AM.md"
  "Tldraw 2026-04-12 9.40AM.md"
  "Tldraw 2026-04-12 9.52AM.md"
  "Tldraw 2026-04-12 10.39AM.md"
)

for mdfile in "${TLDRAW_FILES[@]}"; do
  src="$VAULT/pictures/$mdfile"
  base="${mdfile%.md}"
  tldr="$TMPDIR_BASE/$base.tldr"
  png="$CONTENT_DIR/$base.png"

  if [ ! -f "$src" ]; then
    echo "SKIP (not found): $mdfile"
    continue
  fi

  echo "Processing: $mdfile"

  # Extract JSON from the markdown
  # The data is between START and END markers, and has a "raw" key with the .tldr content
  node -e "
    const fs = require('fs');
    const content = fs.readFileSync(process.argv[1], 'utf8');
    // Find JSON between the START/END markers
    const start = content.indexOf('!!!_START_OF_TLDRAW_DATA__DO_NOT_CHANGE_THIS_PHRASE_!!!');
    const end = content.indexOf('!!!_END_OF_TLDRAW_DATA__DO_NOT_CHANGE_THIS_PHRASE_!!!');
    if (start === -1 || end === -1) { console.error('No tldraw data found'); process.exit(1); }
    // JSON starts after the first newline after the START marker
    const jsonStart = content.indexOf('\n', start) + 1;
    // JSON ends at the last newline before END marker
    const jsonStr = content.substring(jsonStart, end).trim();
    const parsed = JSON.parse(jsonStr);
    const tldrData = parsed.raw || parsed;
    fs.writeFileSync(process.argv[2], JSON.stringify(tldrData));
  " "$src" "$tldr"

  # Use @tldraw/cli to export to PNG
  npx -y @kitschpatrol/tldraw-cli export "$tldr" --format png --output "$CONTENT_DIR" --name "$base" --transparent --scale 0.75

  echo "Exported: $png"
done

rm -rf "$TMPDIR_BASE"
echo "Done!"
