import { TileShell } from "@/components/store-tiles/TileShell";
import { Tile5 } from "@/components/store-tiles/Tile5";

/**
 * Dev-only artboard for Chrome Web Store promotional tile 5 (1280×800).
 * Capture every tile with `scripts/store-tiles.sh`.
 */
export default function StoreTile5Page() {
  return (
    <TileShell>
      <Tile5 />
    </TileShell>
  );
}
