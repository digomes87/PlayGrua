/** Sky dome, light, fog and the ground with radius rings around the tower. */
import {
  BackSide,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { PALETTE } from './palette';

const GROUND_RADIUS = 260;
/** Radius covered by the detailed texture; beyond it the ground is plain. */
const YARD_RADIUS = 80;
const TEXTURE_SIZE = 2048;
const RING_SPACING = 10;
const FOG_DENSITY = 0.0026;
const SHADOW_RANGE = 85;

const SKY_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = `
uniform vec3 topColor;
uniform vec3 horizonColor;
varying vec3 vDirection;
void main() {
  float height = clamp(vDirection.y, 0.0, 1.0);
  gl_FragColor = vec4(mix(horizonColor, topColor, pow(height, 0.55)), 1.0);
}`;

function buildSky(): Mesh {
  const material = new ShaderMaterial({
    uniforms: { topColor: { value: new Color(PALETTE.skyTop) }, horizonColor: { value: new Color(PALETTE.skyHorizon) } },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  return new Mesh(new SphereGeometry(900, 24, 12), material);
}

/** Deterministic speckle so the ground looks the same on every load. */
function speckle(context: CanvasRenderingContext2D): void {
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  context.fillStyle = PALETTE.groundSpeckle;
  for (let index = 0; index < 5000; index += 1) {
    context.globalAlpha = 0.15 + next() * 0.25;
    context.fillRect(next() * TEXTURE_SIZE, next() * TEXTURE_SIZE, 2 + next() * 10, 2 + next() * 10);
  }
  context.globalAlpha = 1;
}

function drawRings(context: CanvasRenderingContext2D, reach: number): void {
  const centre = TEXTURE_SIZE / 2;
  const pixelsPerMetre = TEXTURE_SIZE / (2 * YARD_RADIUS);
  context.font = '600 34px sans-serif';
  context.textAlign = 'center';
  for (let radius = RING_SPACING; radius <= reach; radius += RING_SPACING) {
    const isLimit = radius >= reach;
    context.strokeStyle = isLimit ? PALETTE.reachLimit : PALETTE.ring;
    context.fillStyle = context.strokeStyle;
    context.lineWidth = isLimit ? 7 : 3;
    context.beginPath();
    context.arc(centre, centre, radius * pixelsPerMetre, 0, 2 * Math.PI);
    context.stroke();
    context.fillText(`${radius} m`, centre + radius * pixelsPerMetre * Math.SQRT1_2 + 16, centre - radius * pixelsPerMetre * Math.SQRT1_2 - 8);
  }
}

function groundTexture(reach: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  if (context === null) return new CanvasTexture(canvas);
  context.fillStyle = PALETTE.ground;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  speckle(context);
  drawRings(context, reach);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function buildGround(reach: number): Group {
  const yard = new Mesh(new CircleGeometry(YARD_RADIUS, 64), new MeshStandardMaterial({ map: groundTexture(reach), roughness: 1 }));
  const beyond = new Mesh(
    new RingGeometry(YARD_RADIUS, GROUND_RADIUS, 64),
    new MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 }),
  );
  const ground = new Group();
  ground.add(yard, beyond);
  ground.rotation.x = -Math.PI / 2;
  ground.children.forEach((part) => {
    part.receiveShadow = true;
  });
  return ground;
}

function buildSun(): DirectionalLight {
  const sun = new DirectionalLight(PALETTE.sun, 2.6);
  sun.position.set(70, 120, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SHADOW_RANGE;
  sun.shadow.camera.right = SHADOW_RANGE;
  sun.shadow.camera.top = SHADOW_RANGE;
  sun.shadow.camera.bottom = -SHADOW_RANGE;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  return sun;
}

export function addEnvironment(scene: Scene, reach: number): void {
  scene.fog = new FogExp2(PALETTE.fog, FOG_DENSITY);
  scene.add(buildSky(), buildGround(reach), buildSun(), new HemisphereLight(PALETTE.skyHorizon, 0x6d6658, 1.1));
}
