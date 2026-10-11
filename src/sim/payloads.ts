/** Things the crane can lift. Mass in kg, size in metres, drag area = Cd * A in square metres. */
import type { Vec3 } from '../physics/vec3';

export interface Payload {
  readonly id: string;
  readonly label: string;
  readonly mass: number;
  readonly dragArea: number;
  /** Bounding box: x along the jib, y vertical, z across the jib. */
  readonly size: Vec3;
}

export const REBAR_BUNDLE: Payload = {
  id: 'rebar',
  label: 'Ferragem 2 t',
  mass: 2000,
  dragArea: 1.2 * 2.4,
  size: { x: 0.6, y: 0.4, z: 6 },
};

export const CONCRETE_BLOCK: Payload = {
  id: 'block',
  label: 'Bloco 3 t',
  mass: 3000,
  dragArea: 1.05 * 1.3,
  size: { x: 1.1, y: 1.05, z: 1.1 },
};

export const FORMWORK_PANEL: Payload = {
  id: 'panel',
  label: 'Painel de forma 0,6 t',
  mass: 600,
  dragArea: 1.3 * 12,
  size: { x: 0.3, y: 3, z: 4 },
};

export const PRECAST_BEAM: Payload = {
  id: 'beam',
  label: 'Viga pré-moldada 5 t',
  mass: 5000,
  dragArea: 1.2 * 3.2,
  size: { x: 0.5, y: 0.8, z: 5 },
};

/** Half-width used for collisions; the load does not yaw in the physics, so it is a mean of both sides. */
export const footprintOf = (payload: Payload): number => (payload.size.x + payload.size.z) / 4;
