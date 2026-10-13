/** The 3D view: owns the renderer and turns a simulation pose into a frame. */
import { ACESFilmicToneMapping, Group, PCFShadowMap, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import type { CraneSpec } from '../craneSpec';
import { vec3 } from '../physics/vec3';
import type { Mission } from '../sim/missions';
import type { Session } from '../sim/session';
import type { Site } from '../sim/site';
import { type CameraMode, CameraRig } from './cameras';
import { type CraneModel, buildCrane } from './craneModel';
import { addEnvironment } from './environment';
import { RigModel } from './rigModel';
import { buildSite } from './siteModel';
import { buildZoneMarker } from './zoneMarker';

const MAX_PIXEL_RATIO = 2;

export class SceneView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly cameras: CameraRig;
  private readonly crane: CraneModel;
  private readonly rig = new RigModel();
  private readonly markers = new Group();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly spec: CraneSpec,
    site: Site,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.cameras = new CameraRig(canvas);
    this.crane = buildCrane(spec);
    addEnvironment(this.scene, spec.geometry.maxRadius);
    this.scene.add(this.crane.root, buildSite(site), this.rig.root, this.markers);
    this.resize();
  }

  get cameraMode(): CameraMode {
    return this.cameras.mode;
  }

  nextCamera(): CameraMode {
    return this.cameras.next();
  }

  /** Shows the target zone of a placing mission, or nothing. */
  showMission(mission: Mission): void {
    this.markers.clear();
    const goal = mission.goal;
    if (goal === null || goal.kind !== 'place') return;
    this.markers.add(buildZoneMarker(goal.zone));
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.cameras.resize(width / Math.max(height, 1));
  }

  render(session: Session): void {
    const pose = session.pose();
    const state = session.state;
    /** Jib and tower give under the load: the rope's upper end sits lower by tension over stiffness. */
    const droop = state.tension / this.spec.cable.structureStiffness;
    const height = this.spec.geometry.trolleyHeight - droop;
    const pivot = vec3(pose.radius * Math.cos(pose.slewAngle), height, pose.radius * Math.sin(pose.slewAngle));
    this.crane.slewing.rotation.y = -pose.slewAngle;
    this.crane.slewing.rotation.z = -droop / pose.radius;
    this.crane.trolley.position.x = pose.radius;
    this.rig.update(
      {
        pivot,
        hook: pose.hook,
        ropeLength: state.crane.hoist.length,
        slewAngle: pose.slewAngle,
        cargo: pose.cargo === null || state.cargo === null ? null : { ...pose.cargo, payload: state.cargo.payload },
      },
      state.groundLoads,
    );
    this.cameras.update({ pivot, hook: pose.hook, slewAngle: pose.slewAngle });
    this.renderer.render(this.scene, this.cameras.camera);
  }
}
