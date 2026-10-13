/** Construction site geometry: axis-aligned blocks standing on the ground. */

export interface Obstacle {
  readonly id: string;
  readonly kind: 'building' | 'stack';
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Top surface height; loads can be landed on it. */
  readonly height: number;
}

/** Area the suspension point must stay out of, such as a street beyond the fence. */
export interface ForbiddenZone {
  readonly id: string;
  readonly label: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface Site {
  readonly obstacles: readonly Obstacle[];
  readonly zones: readonly ForbiddenZone[];
}

export const GROUND_HEIGHT = 0;

export const DEFAULT_SITE: Site = {
  obstacles: [
    { id: 'tower-a', kind: 'building', minX: -9, maxX: 9, minZ: 21, maxZ: 39, height: 30 },
    { id: 'tower-b', kind: 'building', minX: -44, maxX: -26, minZ: -12, maxZ: 8, height: 15 },
    { id: 'podium', kind: 'building', minX: 16, maxX: 34, minZ: -46, maxZ: -32, height: 6 },
    { id: 'stack-timber', kind: 'stack', minX: 6, maxX: 9, minZ: -10, maxZ: -6, height: 1.6 },
    { id: 'stack-blocks', kind: 'stack', minX: 16, maxX: 19, minZ: 8, maxZ: 11, height: 1.2 },
    { id: 'stack-pipes', kind: 'stack', minX: -16, maxX: -11, minZ: -22, maxZ: -19, height: 1.4 },
  ],
  zones: [{ id: 'street', label: 'Rua', minX: -80, maxX: 80, minZ: 48, maxZ: 80 }],
};
