#!/usr/bin/env bash
# Capture the Chrome Web Store promotional tiles (1280×800, 24-bit PNG, no
# alpha) from the dev-only artboards at apps/site/src/app/dev/store-tiles/<n>.
#
# Usage:  scripts/store-tiles.sh [n ...]     # default: every tile route
# Output: apps/extension/store-tiles/tile<n>.png
#
# Reuses a site dev server already running on :3002; otherwise starts one and
# stops it when done. Needs a Chromium-based browser and ImageMagick.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
routes_dir="$root/apps/site/src/app/dev/store-tiles"
out_dir="$root/apps/extension/store-tiles"
url_base="http://localhost:3002/dev/store-tiles"

browser="$(command -v brave-browser || command -v google-chrome || command -v chromium || true)"
[ -n "$browser" ] || { echo "No Chromium-based browser found" >&2; exit 1; }
command -v magick >/dev/null || { echo "ImageMagick (magick) not found" >&2; exit 1; }

tiles=("$@")
if [ ${#tiles[@]} -eq 0 ]; then
  for d in "$routes_dir"/*/; do tiles+=("$(basename "$d")"); done
fi

# Server: reuse a running one, else start our own and clean it up on exit.
server_pid=""
if ! curl -so /dev/null -m 2 "$url_base/${tiles[0]}"; then
  echo "Starting site dev server…"
  # setsid gives the server its own process group so the trap can kill the
  # whole pnpm → next tree, not just the pnpm wrapper.
  setsid pnpm --filter @aziru/site dev >/dev/null 2>&1 &
  server_pid=$!
  trap '[ -n "$server_pid" ] && kill -- "-$server_pid" 2>/dev/null' EXIT
  for _ in $(seq 1 60); do
    curl -so /dev/null -m 2 "$url_base/${tiles[0]}" && break
    sleep 2
  done
fi

mkdir -p "$out_dir"
tmp="$(mktemp -d)"
for n in "${tiles[@]}"; do
  echo "Capturing tile $n…"
  # 2× device scale renders crisp text; magick then downscales to 1280×800 and
  # strips the alpha channel (the Web Store rejects PNGs that carry one).
  "$browser" --headless "--screenshot=$tmp/tile$n.png" \
    --window-size=1280,800 --force-device-scale-factor=2 --hide-scrollbars \
    --virtual-time-budget=10000 "$url_base/$n" 2>/dev/null
  magick "$tmp/tile$n.png" -resize 1280x800 -alpha remove -alpha off \
    "PNG24:$out_dir/tile$n.png"
done
rm -rf "$tmp"

echo "Done → $out_dir"
