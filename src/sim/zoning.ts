/** Working-range limitation: keeps the suspension point out of forbidden zones. */
import type { CraneSpec } from '../craneSpec';
import { type CraneState, jibDirection, jibTangent, trolleyPosition } from '../physics/crane';
import { OPEN_ZONES, type ZonePermits } from '../physics/interlocks';
import { type Vec3, add, scale } from '../physics/vec3';
import type { ForbiddenZone } from './site';

const isInside = (zone: ForbiddenZone, point: Vec3): boolean =>
  point.x > zone.minX && point.x < zone.maxX && point.z > zone.minZ && point.z < zone.maxZ;

export const zoneAt = (zones: readonly ForbiddenZone[], point: Vec3): ForbiddenZone | undefined =>
  zones.find((zone) => isInside(zone, point));

/**
 * A motion is refused when it would carry the suspension point to within the margin of a zone.
 * A point already inside is left free to move, so the operator can always drive out.
 */
export function zonePermits(crane: CraneState, zones: readonly ForbiddenZone[], spec: CraneSpec): ZonePermits {
  const point = trolleyPosition(crane, spec);
  if (zones.length === 0 || zoneAt(zones, point) !== undefined) return OPEN_ZONES;
  const along = jibDirection(crane.slew.angle);
  const across = jibTangent(crane.slew.angle);
  const isClear = (direction: Vec3, sign: number): boolean =>
    zoneAt(zones, add(point, scale(direction, sign * spec.zoneMargin))) === undefined;
  return {
    slewPositive: isClear(across, 1),
    slewNegative: isClear(across, -1),
    trolleyOut: isClear(along, 1),
    trolleyIn: isClear(along, -1),
  };
}
