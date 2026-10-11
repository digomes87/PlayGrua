/** Buildings under construction and material stacks, generated from the site obstacles. */
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Obstacle, Site } from '../sim/site';
import { PALETTE } from './palette';

const STOREY_HEIGHT = 3;
const SLAB_THICKNESS = 0.3;
const COLUMN_SIZE = 0.45;
const COLUMN_SPACING = 6;

const STACK_COLOURS: Readonly<Record<string, number>> = {
  'stack-timber': PALETTE.timber,
  'stack-pipes': PALETTE.pipes,
};

const widthOf = (obstacle: Obstacle): number => obstacle.maxX - obstacle.minX;
const depthOf = (obstacle: Obstacle): number => obstacle.maxZ - obstacle.minZ;
const centreX = (obstacle: Obstacle): number => (obstacle.minX + obstacle.maxX) / 2;
const centreZ = (obstacle: Obstacle): number => (obstacle.minZ + obstacle.maxZ) / 2;

/** Evenly spaced positions from `low` to `high`, both ends included. */
function spread(low: number, high: number, spacing: number): number[] {
  const count = Math.max(1, Math.round((high - low) / spacing));
  return Array.from({ length: count + 1 }, (_unused, index) => low + ((high - low) * index) / count);
}

function instancedBoxes(matrices: readonly Matrix4[], material: MeshStandardMaterial): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, matrices.length);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const boxMatrix = (x: number, y: number, z: number, width: number, height: number, depth: number): Matrix4 =>
  new Matrix4().makeScale(width, height, depth).setPosition(x, y, z);

/** Slab levels: every storey plus the roof slab, whose top is the landing surface. */
function slabLevels(height: number): number[] {
  const storeys = Math.max(1, Math.round(height / STOREY_HEIGHT));
  return Array.from({ length: storeys }, (_unused, index) => (height * (index + 1)) / storeys);
}

function buildFrame(obstacle: Obstacle): Object3D {
  const levels = slabLevels(obstacle.height);
  const slabs = levels.map((level) =>
    boxMatrix(centreX(obstacle), level - SLAB_THICKNESS / 2, centreZ(obstacle), widthOf(obstacle), SLAB_THICKNESS, depthOf(obstacle)),
  );
  const inset = COLUMN_SIZE / 2;
  const columns = spread(obstacle.minX + inset, obstacle.maxX - inset, COLUMN_SPACING).flatMap((x) =>
    spread(obstacle.minZ + inset, obstacle.maxZ - inset, COLUMN_SPACING).map((z) =>
      boxMatrix(x, obstacle.height / 2, z, COLUMN_SIZE, obstacle.height, COLUMN_SIZE),
    ),
  );
  const core = boxMatrix(centreX(obstacle), obstacle.height / 2, centreZ(obstacle), 4, obstacle.height - 0.2, 4);
  const group = new Group();
  group.add(
    instancedBoxes(slabs, new MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.9 })),
    instancedBoxes([...columns, core], new MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95 })),
  );
  return group;
}

function buildStack(obstacle: Obstacle): Object3D {
  const colour = STACK_COLOURS[obstacle.id] ?? PALETTE.concreteDark;
  const stack = new Mesh(
    new BoxGeometry(widthOf(obstacle), obstacle.height, depthOf(obstacle)),
    new MeshStandardMaterial({ color: colour, roughness: 0.85 }),
  );
  stack.position.set(centreX(obstacle), obstacle.height / 2, centreZ(obstacle));
  stack.castShadow = true;
  stack.receiveShadow = true;
  return stack;
}

export function buildSite(site: Site): Group {
  const group = new Group();
  site.obstacles.forEach((obstacle) => {
    group.add(obstacle.kind === 'building' ? buildFrame(obstacle) : buildStack(obstacle));
  });
  return group;
}
