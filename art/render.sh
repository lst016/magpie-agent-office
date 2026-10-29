#!/bin/sh
# Renders every sprite, then packs them for the page.
#   sh art/render.sh [mascot.glb] [--quick]
# Blender's glTF importer can't read paths with non-ASCII characters on some setups,
# so the model is copied to a temp path first.
set -e
cd "$(dirname "$0")/.."
GLB="${1:-art/models/mascot.glb}"
[ "$GLB" = "--quick" ] && GLB=art/models/mascot.glb
[ $# -gt 0 ] && [ "$1" != "--quick" ] && shift
TMP="$(mktemp -d /tmp/agent-office-art.XXXXXX)"
cp "$GLB" "$TMP/mascot.glb"
for part in room:light room:dark mascot; do
  blender -b -P art/render.py -- "$TMP/mascot.glb" "$TMP/out" --part=$part "$@" 2>&1 | grep -E "^rendered|Error|Traceback" || true
done
python3 -I art/pack.py "$TMP/out" server/public/sprites
echo "renders kept in $TMP/out"
