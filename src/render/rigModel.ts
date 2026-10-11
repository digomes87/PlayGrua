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
import type { GroundLoad, Rigged } from '../sim/rigging';
import { PALETTE } from './palette';

const ROPE_POINTS = 14;
const FALL_SPACING = 0.28;
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
  readonly rigged: Rigged | null;
  readonly isGrounded: boolean;
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

/** Four sling legs from the hook (local origin) to the top corners of the payload. */
function slingGeometry(payload: Payload, slingDepth: number): BufferGeometry {
  const top = -(slingDepth - payload.size.y);
  const corners = [-1, 1].flatMap((x) => [-1, 1].map((z) => [(x * payload.size.x) / 2, top, (z * payload.size.z) / 2]));
  const points = corners.flatMap((corner) => [0, 0, 0, ...corner]);
  return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
}

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
    this.slings = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: PALETTE.sling }));
    this.carried.add(this.slings);
    this.root.add(this.rope, this.hookBlock, this.carried);
  }

  update(pose: RigPose, groundLoads: readonly GroundLoad[]): void {
    const pivot = new Vector3(pose.pivot.x, pose.pivot.y, pose.pivot.z);
    const hook = new Vector3(pose.hook.x, pose.hook.y, pose.hook.z);
    this.drawRope(pivot, hook, pose);
    this.hookBlock.position.copy(hook).setY(hook.y + 0.3);
    this.hookBlock.rotation.y = -pose.slewAngle;
    this.placeCarried(pivot, hook, pose);
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

  /** Hook, slings and payload hang as one rigid link in line with the rope. */
  private placeCarried(pivot: Vector3, hook: Vector3, pose: RigPose): void {
    this.carried.visible = pose.rigged !== null;
    if (pose.rigged === null) {
      this.carriedId = '';
      return;
    }
    this.swapCarried(pose.rigged);
    const ropeDirection = pose.isGrounded ? DOWN : new Vector3().subVectors(hook, pivot).normalize();
    const tilt = new Quaternion().setFromUnitVectors(DOWN, ropeDirection);
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -pose.slewAngle);
    this.carried.position.copy(hook);
    this.carried.quaternion.copy(tilt.multiply(yaw));
  }

  private swapCarried(rigged: Rigged): void {
    const id = `${rigged.payload.id}:${rigged.slingDepth.toFixed(3)}`;
    if (id === this.carriedId) return;
    this.carriedId = id;
    this.carried.children.filter((child) => child !== this.slings).forEach((child) => this.carried.remove(child));
    const mesh = payloadMesh(rigged.payload);
    mesh.position.y = -rigged.slingDepth;
    this.carried.add(mesh);
    this.slings.geometry.dispose();
    this.slings.geometry = slingGeometry(rigged.payload, rigged.slingDepth);
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
