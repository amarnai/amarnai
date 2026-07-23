-- Optional per-folder color override. Stores a palette KEY (never a raw hex);
-- null means "use the deterministic hash default". Rendering tolerates unknown
-- keys, so no backfill or constraint is needed.
ALTER TABLE "TaxonomyNode" ADD COLUMN "colorKey" TEXT;
