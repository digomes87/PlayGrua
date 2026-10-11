/** Procedural lattice trusses drawn as one instanced mesh per structure. */
import { BoxGeometry, InstancedMesh, type Material, Matrix4, Quaternion, Vector3 } from 'three';

export interface Member {
  readonly from: Vector3;
  readonly to: Vector3;
}

export interface TrussShape {
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly bays: number;
}

const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const corner = (shape: TrussShape, station: number, index: number): Vector3 => {
  const [side, level] = CORNERS[index % CORNERS.length]!;
  return new Vector3(station, (level * shape.height) / 2, (side * shape.width) / 2);
};

/** Chords, frame and one diagonal per face for a single bay starting at `station`. */
function bayMembers(shape: TrussShape, bay: number): Member[] {
  const start = (bay * shape.length) / shape.bays;
  const end = ((bay + 1) * shape.length) / shape.bays;
  return CORNERS.flatMap((_unused, index) => {
    const leaning = (bay + index) % 2 === 0;
    return [
      { from: corner(shape, start, index), to: corner(shape, end, index) },
      { from: corner(shape, start, index), to: corner(shape, start, index + 1) },
      { from: corner(shape, start, leaning ? index : index + 1), to: corner(shape, end, leaning ? index + 1 : index) },
    ];
  });
}

/** Box truss running along +X from the origin, centred on the Y and Z axes. */
export function boxTruss(shape: TrussShape): Member[] {
  const bays = Array.from({ length: shape.bays }, (_unused, bay) => bayMembers(shape, bay));
  const endFrame = CORNERS.map((_unused, index) => ({
    from: corner(shape, shape.length, index),
    to: corner(shape, shape.length, index + 1),
  }));
  return [...bays.flat(), ...endFrame];
}

const ALONG_X = new Vector3(1, 0, 0);

function memberMatrix(member: Member, thickness: number): Matrix4 {
  const span = new Vector3().subVectors(member.to, member.from);
  const length = span.length();
  const middle = new Vector3().addVectors(member.from, member.to).multiplyScalar(0.5);
  const rotation = new Quaternion().setFromUnitVectors(ALONG_X, span.normalize());
  return new Matrix4().compose(middle, rotation, new Vector3(length, thickness, thickness));
}

export function latticeMesh(members: readonly Member[], thickness: number, material: Material): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, members.length);
  members.forEach((member, index) => mesh.setMatrixAt(index, memberMatrix(member, thickness)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  return mesh;
}
