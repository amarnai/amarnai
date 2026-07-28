"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { readEdgeColors } from "./tokens.js";

type TaxonomyEdgeData = { targetIgnored: boolean };

export function TaxonomyEdgeRenderer({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Four states: an edge can be warning (its target is unreachable) and selected
  // independently, and both need to read on the same line.
  const targetIgnored =
    (data as TaxonomyEdgeData | undefined)?.targetIgnored ?? false;
  const colors = readEdgeColors();
  const strokeColor =
    targetIgnored && selected
      ? colors.warnSelected
      : selected
        ? colors.selected
        : targetIgnored
          ? colors.warn
          : colors.default;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      {...(markerEnd !== undefined ? { markerEnd } : {})}
      style={{ stroke: strokeColor, strokeWidth: selected ? 2.5 : 1.5 }}
    />
  );
}
