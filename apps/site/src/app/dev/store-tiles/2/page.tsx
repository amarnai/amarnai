import { TileShell } from "@/components/store-tiles/TileShell";
import { Tile2 } from "@/components/store-tiles/Tile2";

/**
 * Dev-only artboard for Chrome Web Store promotional tile 2 (1280×800).
 * Capture every tile with `scripts/store-tiles.sh`.
 */
export default function StoreTile2Page() {
  return (
    <TileShell>
      <Tile2 />
    </TileShell>
  );
}
