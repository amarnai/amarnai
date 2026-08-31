import { TileShell } from "@/components/store-tiles/TileShell";
import { Tile4 } from "@/components/store-tiles/Tile4";

/**
 * Dev-only artboard for Chrome Web Store promotional tile 4 (1280×800).
 * Capture every tile with `scripts/store-tiles.sh`.
 */
export default function StoreTile4Page() {
  return (
    <TileShell>
      <Tile4 />
    </TileShell>
  );
}
