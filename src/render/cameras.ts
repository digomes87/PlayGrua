/** Operator cab, external orbit and trolley-mounted hook camera. */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Vec3 } from '../physics/vec3';

export type CameraMode = 'cab' | 'orbit' | 'hook';

const ORDER: readonly CameraMode[] = ['cab', 'orbit', 'hook'];
const CAB_OFFSET = { along: 4.6, down: 1.7, side: 1.9 };
const HOOK_VIEW_WIDTH = 9;
const ORBIT_SENSITIVITY = 0.005;
const ZOOM_SENSITIVITY = 0.0012;

export interface CameraSubject {
  readonly pivot: Vec3;
  readonly hook: Vec3;
  readonly slewAngle: number;
}

interface Orbit {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
}

export class CameraRig {
  readonly camera = new PerspectiveCamera(58, 1, 0.3, 1500);
  private current: CameraMode = 'cab';
  private orbit: Orbit = { yaw: -0.9, pitch: 0.42, distance: 120 };

  constructor(surface: HTMLElement) {
    surface.addEventListener('pointermove', (event) => this.drag(event));
    surface.addEventListener('wheel', (event) => this.zoom(event), { passive: true });
  }

  get mode(): CameraMode {
    return this.current;
  }

  next(): CameraMode {
    this.current = ORDER[(ORDER.indexOf(this.current) + 1) % ORDER.length]!;
    return this.current;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(subject: CameraSubject): void {
    if (this.current === 'cab') return this.fromCab(subject);
    if (this.current === 'hook') return this.fromTrolley(subject);
    return this.fromOutside(subject);
  }

  /** Operator's eye: beside the jib root, looking down at the hook. */
  private fromCab(subject: CameraSubject): void {
    const along = new Vector3(Math.cos(subject.slewAngle), 0, Math.sin(subject.slewAngle));
    const across = new Vector3(-Math.sin(subject.slewAngle), 0, Math.cos(subject.slewAngle));
    this.camera.position
      .set(0, subject.pivot.y - CAB_OFFSET.down, 0)
      .addScaledVector(along, CAB_OFFSET.along)
      .addScaledVector(across, CAB_OFFSET.side);
    this.setLens(58, new Vector3(0, 1, 0));
    this.camera.lookAt(subject.hook.x, subject.hook.y, subject.hook.z);
  }

  /** Straight down the rope, jib pointing up the screen, zooming with the rope length. */
  private fromTrolley(subject: CameraSubject): void {
    const drop = Math.max(subject.pivot.y - subject.hook.y, 1);
    const fieldOfView = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(HOOK_VIEW_WIDTH / drop)), 10, 70);
    this.camera.position.set(subject.pivot.x, subject.pivot.y - 0.6, subject.pivot.z);
    this.setLens(fieldOfView, new Vector3(Math.cos(subject.slewAngle), 0, Math.sin(subject.slewAngle)));
    this.camera.lookAt(subject.pivot.x, subject.hook.y, subject.pivot.z);
  }

  private fromOutside(subject: CameraSubject): void {
    const target = new Vector3(subject.hook.x * 0.5, 18, subject.hook.z * 0.5);
    const { yaw, pitch, distance } = this.orbit;
    const offset = new Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    this.camera.position.copy(target).addScaledVector(offset, distance);
    this.setLens(50, new Vector3(0, 1, 0));
    this.camera.lookAt(target);
  }

  private setLens(fieldOfView: number, up: Vector3): void {
    this.camera.up.copy(up);
    if (this.camera.fov === fieldOfView) return;
    this.camera.fov = fieldOfView;
    this.camera.updateProjectionMatrix();
  }

  private drag(event: PointerEvent): void {
    if (this.current !== 'orbit' || event.buttons === 0) return;
    this.orbit = {
      ...this.orbit,
      yaw: this.orbit.yaw + event.movementX * ORBIT_SENSITIVITY,
      pitch: MathUtils.clamp(this.orbit.pitch + event.movementY * ORBIT_SENSITIVITY, 0.05, 1.45),
    };
  }

  private zoom(event: WheelEvent): void {
    if (this.current !== 'orbit') return;
    const distance = MathUtils.clamp(this.orbit.distance * Math.exp(event.deltaY * ZOOM_SENSITIVITY), 25, 320);
    this.orbit = { ...this.orbit, distance };
  }
}
