import { TileShell } from "@/components/store-tiles/TileShell";
import { Tile1 } from "@/components/store-tiles/Tile1";

/**
 * Dev-only artboard for Chrome Web Store promotional tile 1 (1280×800).
 * Capture every tile with `scripts/store-tiles.sh`.
 */
export default function StoreTile1Page() {
  return (
    <TileShell>
      <Tile1 />
    </TileShell>
  );
}
