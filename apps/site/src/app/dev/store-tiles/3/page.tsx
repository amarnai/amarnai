import { TileShell } from "@/components/store-tiles/TileShell";
import { Tile3 } from "@/components/store-tiles/Tile3";

/**
 * Dev-only artboard for Chrome Web Store promotional tile 3 (1280×800).
 * Capture every tile with `scripts/store-tiles.sh`.
 */
export default function StoreTile3Page() {
  return (
    <TileShell>
      <Tile3 />
    </TileShell>
  );
}
