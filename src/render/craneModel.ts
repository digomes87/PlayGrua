/** Flat-top tower crane built from primitives and instanced lattice; no external assets. */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';
import type { CraneSpec } from '../craneSpec';
import { boxTruss, latticeMesh } from './lattice';
import { PALETTE } from './palette';

const MAST_WIDTH = 2;
const JIB_WIDTH = 1.5;
const JIB_DEPTH = 1.7;
const BAY_LENGTH = 2;
const MEMBER_THICKNESS = 0.13;
const TURNTABLE_DROP = 1.2;

export interface CraneModel {
  readonly root: Group;
  /** Everything that turns with the jib. */
  readonly slewing: Group;
  readonly trolley: Object3D;
}

const steel = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: PALETTE.craneSteel, roughness: 0.55, metalness: 0.25 });

function block(width: number, height: number, depth: number, material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildMast(spec: CraneSpec): Object3D {
  const height = spec.geometry.trolleyHeight - TURNTABLE_DROP;
  const shape = { length: height, width: MAST_WIDTH, height: MAST_WIDTH, bays: Math.round(height / BAY_LENGTH) };
  const mast = latticeMesh(boxTruss(shape), MEMBER_THICKNESS * 1.3, steel());
  mast.rotation.z = Math.PI / 2;
  const base = block(5, 0.8, 5, new MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95 }));
  base.position.y = 0.4;
  const group = new Group();
  group.add(mast, base);
  return group;
}

function buildBoom(length: number, direction: 1 | -1, height: number): Object3D {
  const shape = { length, width: JIB_WIDTH, height: JIB_DEPTH, bays: Math.round(length / BAY_LENGTH) };
  const boom = latticeMesh(boxTruss(shape), MEMBER_THICKNESS, steel());
  boom.position.y = height + JIB_DEPTH / 2 + 0.25;
  boom.rotation.y = direction === 1 ? 0 : Math.PI;
  return boom;
}

function buildCounterweight(spec: CraneSpec): Object3D {
  const material = new MeshStandardMaterial({ color: PALETTE.counterweight, roughness: 0.9 });
  const group = new Group();
  [-1.3, 0, 1.3].forEach((offset) => {
    const slab = block(1.1, 2.6, 1.8, material);
    slab.position.set(-spec.masses.counterweightRadius + offset, spec.geometry.trolleyHeight - 0.7, 0);
    group.add(slab);
  });
  return group;
}

function buildCabin(spec: CraneSpec): Object3D {
  const cabin = new Group();
  const shell = block(2.2, 2.1, 1.6, new MeshStandardMaterial({ color: PALETTE.cabin, roughness: 0.6 }));
  const glass = block(0.9, 1.2, 1.5, new MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.15, metalness: 0.6 }));
  glass.position.set(0.75, 0.1, 0.06);
  cabin.add(shell, glass);
  cabin.position.set(2.4, spec.geometry.trolleyHeight - 1.6, 1.9);
  return cabin;
}

function buildTurntable(spec: CraneSpec): Object3D {
  const material = new MeshStandardMaterial({ color: PALETTE.craneDark, roughness: 0.6, metalness: 0.4 });
  const ring = new Mesh(new CylinderGeometry(1.7, 1.7, TURNTABLE_DROP, 24), material);
  ring.position.y = spec.geometry.trolleyHeight - TURNTABLE_DROP / 2;
  ring.castShadow = true;
  return ring;
}

function buildTrolley(spec: CraneSpec): Object3D {
  const trolley = block(1.6, 0.35, 1.3, new MeshStandardMaterial({ color: PALETTE.craneDark, roughness: 0.5, metalness: 0.5 }));
  trolley.position.y = spec.geometry.trolleyHeight + 0.1;
  return trolley;
}

export function buildCrane(spec: CraneSpec): CraneModel {
  const root = new Group();
  const slewing = new Group();
  const trolley = buildTrolley(spec);
  slewing.add(
    buildBoom(spec.geometry.jibLength + 1.5, 1, spec.geometry.trolleyHeight),
    buildBoom(spec.geometry.counterJibLength, -1, spec.geometry.trolleyHeight),
    buildCounterweight(spec),
    buildCabin(spec),
    buildTurntable(spec),
    trolley,
  );
  root.add(buildMast(spec), slewing);
  return { root, slewing, trolley };
}
