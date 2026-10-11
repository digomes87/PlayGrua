/** Target zone: a ring on the landing surface and a faint column so it can be found from the cab. */
import { CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { Zone } from '../sim/missions';
import { PALETTE } from './palette';

const COLUMN_HEIGHT = 14;
const SURFACE_GAP = 0.04;

export function buildZoneMarker(zone: Zone): Group {
  const ring = new Mesh(
    new RingGeometry(zone.radius * 0.86, zone.radius, 48),
    new MeshBasicMaterial({ color: PALETTE.zone, side: DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  const column = new Mesh(
    new CylinderGeometry(zone.radius, zone.radius, COLUMN_HEIGHT, 32, 1, true),
    new MeshBasicMaterial({ color: PALETTE.zone, transparent: true, opacity: 0.12, side: DoubleSide, depthWrite: false }),
  );
  column.position.y = COLUMN_HEIGHT / 2;
  const marker = new Group();
  marker.add(ring, column);
  marker.position.set(zone.center.x, zone.center.y + SURFACE_GAP, zone.center.z);
  return marker;
}
