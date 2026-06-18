export type StrokeShape = {
  kind: 'path' | 'rect';
  /** SVG path d attribute (for kind='path') */
  d?: string;
  /** Rect geometry (for kind='rect') */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rx?: number;
  stroke: string;
  strokeWidth: number;
  strokeLinecap?: 'round' | 'square' | 'butt';
  strokeLinejoin?: 'round' | 'miter' | 'bevel';
};

export type FillShape = {
  kind: 'path';
  d: string;
  fill: string;
  fillRule?: 'evenodd' | 'nonzero';
};

export type IconShape = StrokeShape | FillShape;

export type IconDef = {
  viewBox: string;
  shapes: IconShape[];
};

export const navIconDefs = {
  emails: {
    viewBox: '0 0 16 16',
    shapes: [
      { kind: 'rect', x: 1.5, y: 3, w: 13, h: 10, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 },
      { kind: 'path', d: 'M1.5 5.5l6.5 4.5 6.5-4.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
    ] as IconShape[],
  },
  taxonomy: {
    viewBox: '0 0 16 16',
    shapes: [
      { kind: 'rect', x: 1, y: 5.75, w: 4.5, h: 2.5, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 },
      { kind: 'rect', x: 10, y: 2.75, w: 4.5, h: 2.5, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 },
      { kind: 'rect', x: 10, y: 8.75, w: 4.5, h: 2.5, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 },
      { kind: 'path', d: 'M5.5 7H8V4H10M8 7V10H10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
    ] as IconShape[],
  },
  settings: {
    viewBox: '0 0 16 16',
    shapes: [
      {
        kind: 'path',
        d: 'M9.46 1.15 9.04 3.11A5 5 0 0 1 11.72 4.65L13.2 3.32A7 7 0 0 1 14.66 5.84L12.76 6.46A5 5 0 0 1 12.76 9.55L14.66 10.16A7 7 0 0 1 13.2 12.69L11.72 11.35A5 5 0 0 1 9.04 12.89L9.46 14.85A7 7 0 0 1 6.54 14.85L6.96 12.89A5 5 0 0 1 4.28 11.35L2.8 12.69A7 7 0 0 1 1.34 10.16L3.25 9.55A5 5 0 0 1 3.25 6.46L1.34 5.84A7 7 0 0 1 2.8 3.32L4.28 4.65A5 5 0 0 1 6.96 3.11L6.54 1.15A7 7 0 0 1 9.46 1.15Z M8 5.7A2.3 2.3 0 1 0 8 10.3A2.3 2.3 0 1 0 8 5.7Z',
        fill: 'currentColor',
        fillRule: 'evenodd',
      },
    ] as IconShape[],
  },
} satisfies Record<string, { viewBox: string; shapes: IconShape[] }>;

export type NavIconName = keyof typeof navIconDefs;
