#!/bin/bash
# Create a branded DMG installer with drag-to-Applications layout.
# Usage: create-dmg.sh <app-path> <dmg-path> <volume-name> <bg-script>
set -euo pipefail

APP_PATH="$1"
DMG_PATH="$2"
VOL_NAME="$3"
BG_SCRIPT="$4"

DIR="$(dirname "$DMG_PATH")"
STAGING="$DIR/dmg-staging"
TMP_DMG="$DIR/tmp.dmg"

# ── Clean slate ──────────────────────────────────────────────
rm -rf "$STAGING" "$TMP_DMG" "$DMG_PATH"

# ── Stage contents ───────────────────────────────────────────
mkdir -p "$STAGING"
cp -R "$APP_PATH" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

# ── Create read-write DMG ───────────────────────────────────
# Extra space for the background image we'll add after mounting
hdiutil create -volname "$VOL_NAME" \
  -srcfolder "$STAGING" \
  -ov -format UDRW -fs HFS+ \
  -size 40m \
  "$TMP_DMG"

# ── Eject any stale mount ────────────────────────────────────
hdiutil detach "/Volumes/$VOL_NAME" -force 2>/dev/null || true

# ── Mount ────────────────────────────────────────────────────
DEVICE=$(hdiutil attach -readwrite -noverify "$TMP_DMG" | \
  grep "Apple_HFS" | awk '{print $1}')
MOUNT="/Volumes/$VOL_NAME"
sleep 1

# ── Copy background into the mounted volume ─────────────────
mkdir -p "$MOUNT/.background"
python3 "$BG_SCRIPT" "$MOUNT/.background/bg.png"

# ── Customise Finder window ─────────────────────────────────
# Use full POSIX path converted to alias for background reference
osascript <<EOF
tell application "Finder"
  tell disk "$VOL_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {200, 200, 840, 620}
    set opts to icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 80
    set background picture of opts to file ".background:bg.png"
    set position of item "${VOL_NAME}.app" of container window to {160, 200}
    set position of item "Applications" of container window to {480, 200}
    close
    open
    update without registering applications
    delay 1
    close
  end tell
end tell
EOF

sleep 1
sync
hdiutil detach "$DEVICE" -force 2>/dev/null || \
  hdiutil detach "$MOUNT" -force 2>/dev/null || true

# ── Convert to compressed read-only ─────────────────────────
hdiutil convert "$TMP_DMG" \
  -format UDZO -imagekey zlib-level=9 \
  -o "$DMG_PATH"

# ── Tidy up ─────────────────────────────────────────────────
rm -f "$TMP_DMG"
rm -rf "$STAGING"

echo "DMG created: $DMG_PATH"
