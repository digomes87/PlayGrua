/** Rope, hook block, slung payload and the payloads standing on the site. */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { Vec3 } from '../physics/vec3';
import type { Payload } from '../sim/payloads';
import type { GroundLoad } from '../sim/rigging';
import { PALETTE } from './palette';

const ROPE_POINTS = 14;
const FALL_SPACING = 0.28;
const SLING_LEGS = 4;
/** Below this the hook is right on the payload and the slings have no direction to lean in. */
const SLING_MIN_LENGTH = 1e-6;
const DOWN = new Vector3(0, -1, 0);

const PAYLOAD_COLOURS: Readonly<Record<string, number>> = {
  rebar: PALETTE.rebar,
  block: PALETTE.concrete,
  panel: PALETTE.panel,
  beam: PALETTE.beam,
};

export interface RigPose {
  readonly pivot: Vec3;
  readonly hook: Vec3;
  /** Unstretched rope paid out, to draw the sag of a slack rope. */
  readonly ropeLength: number;
  readonly slewAngle: number;
  readonly cargo: CarriedPose | null;
}

export interface CarriedPose {
  readonly payload: Payload;
  /** Centre of gravity. */
  readonly position: Vec3;
  readonly yaw: number;
}

/** Payload mesh with its origin at the centre of the underside. */
function payloadMesh(payload: Payload): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(payload.size.x, payload.size.y, payload.size.z),
    new MeshStandardMaterial({ color: PAYLOAD_COLOURS[payload.id] ?? PALETTE.concrete, roughness: 0.8 }),
  );
  mesh.geometry.translate(0, payload.size.y / 2, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Top corners of the payload in its own frame, where the sling legs attach. */
const slingAnchors = (payload: Payload): Vector3[] =>
  [-1, 1].flatMap((x) =>
    [-1, 1].map((z) => new Vector3((x * payload.size.x) / 2, payload.size.y / 2, (z * payload.size.z) / 2)),
  );

/** Sag at mid-span of a rope longer than the straight distance (shallow parabola approximation). */
const sagOf = (ropeLength: number, distance: number): number =>
  Math.sqrt((3 * Math.max(ropeLength - distance, 0) * distance) / 8);

export class RigModel {
  readonly root = new Group();
  private readonly rope: Line;
  private readonly hookBlock: Mesh;
  private readonly carried = new Group();
  private readonly slings: LineSegments;
  private readonly standing = new Map<string, Mesh>();
  private carriedId = '';

  constructor() {
    const ropeGeometry = new BufferGeometry();
    ropeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(ROPE_POINTS * 2 * 3), 3));
    this.rope = new Line(ropeGeometry, new LineBasicMaterial({ color: PALETTE.rope }));
    this.rope.frustumCulled = false;
    this.hookBlock = new Mesh(
      new BoxGeometry(0.5, 0.6, 0.35),
      new MeshStandardMaterial({ color: PALETTE.hookBlock, roughness: 0.5, metalness: 0.3 }),
    );
    this.hookBlock.castShadow = true;
    const slingGeometry = new BufferGeometry();
    slingGeometry.setAttribute('position', new BufferAttribute(new Float32Array(SLING_LEGS * 2 * 3), 3));
    this.slings = new LineSegments(slingGeometry, new LineBasicMaterial({ color: PALETTE.sling }));
    this.slings.frustumCulled = false;
    this.root.add(this.rope, this.hookBlock, this.carried, this.slings);
  }

  update(pose: RigPose, groundLoads: readonly GroundLoad[]): void {
    const pivot = new Vector3(pose.pivot.x, pose.pivot.y, pose.pivot.z);
    const hook = new Vector3(pose.hook.x, pose.hook.y, pose.hook.z);
    this.drawRope(pivot, hook, pose);
    this.hookBlock.position.copy(hook).setY(hook.y + 0.3);
    this.hookBlock.rotation.y = -pose.slewAngle;
    this.placeCarried(hook, pose.cargo);
    this.placeStanding(groundLoads);
  }

  /** Two falls from the trolley sheaves down to the block and back, sagging when slack. */
  private drawRope(pivot: Vector3, hook: Vector3, pose: RigPose): void {
    const positions = this.rope.geometry.getAttribute('position') as BufferAttribute;
    const along = new Vector3(Math.cos(pose.slewAngle), 0, Math.sin(pose.slewAngle)).multiplyScalar(FALL_SPACING);
    const sag = sagOf(pose.ropeLength, pivot.distanceTo(hook));
    const top = new Vector3().copy(hook).setY(hook.y + 0.6);
    for (let index = 0; index < ROPE_POINTS; index += 1) {
      const fraction = index / (ROPE_POINTS - 1);
      const droop = -4 * sag * fraction * (1 - fraction);
      const down = new Vector3().lerpVectors(pivot, top, fraction).addScaledVector(along, 1 - fraction * 0.6);
      const up = new Vector3().lerpVectors(top, pivot, fraction).addScaledVector(along, -(0.4 + fraction * 0.6));
      positions.setXYZ(index, down.x, down.y + droop, down.z);
      positions.setXYZ(ROPE_POINTS + index, up.x, up.y + droop, up.z);
    }
    positions.needsUpdate = true;
  }

  /** The payload hangs from the hook on its slings, leaning with them and turned to its own heading. */
  private placeCarried(hook: Vector3, cargo: CarriedPose | null): void {
    this.carried.visible = cargo !== null;
    this.slings.visible = cargo !== null;
    if (cargo === null) {
      this.carriedId = '';
      return;
    }
    this.swapCarried(cargo.payload);
    const centre = new Vector3(cargo.position.x, cargo.position.y, cargo.position.z);
    const lean = new Vector3().subVectors(centre, hook);
    const slingDirection = lean.length() > SLING_MIN_LENGTH && lean.y < 0 ? lean.normalize() : DOWN;
    const tilt = new Quaternion().setFromUnitVectors(DOWN, slingDirection);
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -cargo.yaw);
    this.carried.position.copy(centre);
    this.carried.quaternion.copy(tilt.multiply(yaw));
    this.carried.updateMatrixWorld(true);
    this.drawSlings(hook, cargo.payload);
  }

  private drawSlings(hook: Vector3, payload: Payload): void {
    const positions = this.slings.geometry.getAttribute('position') as BufferAttribute;
    slingAnchors(payload).forEach((anchor, index) => {
      const corner = anchor.applyMatrix4(this.carried.matrixWorld);
      positions.setXYZ(index * 2, hook.x, hook.y, hook.z);
      positions.setXYZ(index * 2 + 1, corner.x, corner.y, corner.z);
    });
    positions.needsUpdate = true;
  }

  private swapCarried(payload: Payload): void {
    if (payload.id === this.carriedId) return;
    this.carriedId = payload.id;
    this.carried.clear();
    const mesh = payloadMesh(payload);
    mesh.position.y = -payload.size.y / 2;
    this.carried.add(mesh);
  }

  private placeStanding(groundLoads: readonly GroundLoad[]): void {
    this.standing.forEach((mesh) => {
      mesh.visible = false;
    });
    groundLoads.forEach((load) => {
      const mesh = this.standingMesh(load.payload);
      mesh.visible = true;
      mesh.position.set(load.position.x, load.position.y, load.position.z);
      mesh.rotation.y = -load.yaw;
    });
  }

  private standingMesh(payload: Payload): Object3D {
    const existing = this.standing.get(payload.id);
    if (existing !== undefined) return existing;
    const mesh = payloadMesh(payload);
    this.standing.set(payload.id, mesh);
    this.root.add(mesh);
    return mesh;
  }
}
