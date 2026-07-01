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
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const targetIgnored =
    (data as TaxonomyEdgeData | undefined)?.targetIgnored ?? false;
  const colors = readEdgeColors();
  const strokeColor = targetIgnored ? colors.warn : colors.default;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      {...(markerEnd !== undefined ? { markerEnd } : {})}
      style={{ stroke: strokeColor, strokeWidth: 1.5 }}
    />
  );
}
