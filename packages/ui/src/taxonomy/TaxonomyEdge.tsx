"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { taxonomyTokens } from "./tokens.js";

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
  const strokeColor = targetIgnored
    ? taxonomyTokens.accent
    : taxonomyTokens.edgeDefault;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      {...(markerEnd !== undefined ? { markerEnd } : {})}
      style={{ stroke: strokeColor, strokeWidth: 1.5 }}
    />
  );
}
