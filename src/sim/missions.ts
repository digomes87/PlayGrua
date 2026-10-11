/** Mission catalogue for v1. Positions are world coordinates with the tower at the origin. */
import { degToRad, kmhToMs } from '../physics/units';
import { type Vec3, vec3 } from '../physics/vec3';
import { CALM, type WindConfig } from '../physics/wind';
import { CONCRETE_BLOCK, FORMWORK_PANEL, PRECAST_BEAM, REBAR_BUNDLE } from './payloads';
import type { GroundLoad } from './rigging';

export type MissionId = 'free' | 'basic' | 'limit' | 'wind' | 'precision';

export interface Zone {
  /** Centre on the supporting surface. */
  readonly center: Vec3;
  readonly radius: number;
}

export interface PlaceGoal {
  readonly kind: 'place';
  readonly payloadId: string;
  readonly zone: Zone;
  /** Largest rope angle allowed at touchdown, radians. */
  readonly maxTouchdownSwing: number;
}

export interface ReachGoal {
  readonly kind: 'reach';
  readonly payloadId: string;
  readonly utilization: number;
  readonly tolerance: number;
  readonly holdSeconds: number;
}

export type Goal = PlaceGoal | ReachGoal;

export interface Mission {
  readonly id: MissionId;
  readonly title: string;
  readonly briefing: string;
  readonly wind: WindConfig;
  readonly start: { readonly radius: number; readonly hookHeight: number; readonly slewAngle: number };
  readonly loads: readonly GroundLoad[];
  readonly goal: Goal | null;
  /** Reference time for scoring, seconds. */
  readonly parSeconds: number;
}

const ANY_SWING = Number.POSITIVE_INFINITY;
const onGround = (x: number, z: number, yaw = 0): Pick<GroundLoad, 'position' | 'yaw'> => ({
  position: vec3(x, 0, z),
  yaw,
});

const LIGHT_BREEZE: WindConfig = {
  ...CALM,
  meanSpeed: kmhToMs(10),
  meanDirection: degToRad(35),
  turbulenceIntensity: 0.18,
  peakSpeed: kmhToMs(20),
  directionSpread: degToRad(12),
  seed: 11,
};

const GUSTY: WindConfig = {
  ...CALM,
  meanSpeed: kmhToMs(26),
  meanDirection: degToRad(20),
  turbulenceIntensity: 0.2,
  peakSpeed: kmhToMs(40),
  directionSpread: degToRad(15),
  seed: 4040,
};

export const MISSIONS: readonly Mission[] = [
  {
    id: 'free',
    title: 'Treino livre',
    briefing: 'Sem cronômetro. Todas as cargas no pátio e todos os instrumentos ligados.',
    wind: LIGHT_BREEZE,
    start: { radius: 14, hookHeight: 12, slewAngle: degToRad(-15) },
    loads: [
      { payload: REBAR_BUNDLE, ...onGround(12, 0) },
      { payload: CONCRETE_BLOCK, ...onGround(12, 5) },
      { payload: FORMWORK_PANEL, ...onGround(20, -12) },
      { payload: PRECAST_BEAM, ...onGround(8, 7) },
    ],
    goal: null,
    parSeconds: 0,
  },
  {
    id: 'basic',
    title: 'Içamento básico',
    briefing: 'Pegue 2 t de ferragem a 12 m de raio e pouse na laje a 30 m de altura.',
    wind: CALM,
    start: { radius: 9, hookHeight: 10, slewAngle: degToRad(-20) },
    loads: [{ payload: REBAR_BUNDLE, ...onGround(12, 0) }],
    goal: { kind: 'place', payloadId: REBAR_BUNDLE.id, zone: { center: vec3(0, 30, 30), radius: 3 }, maxTouchdownSwing: ANY_SWING },
    parSeconds: 240,
  },
  {
    id: 'limit',
    title: 'Carga no limite',
    briefing: 'Leve 3 t até o raio em que o momento chega a 95 % e segure 3 s, sem acionar o bloqueio do LMI.',
    wind: CALM,
    start: { radius: 9, hookHeight: 8, slewAngle: degToRad(10) },
    loads: [{ payload: CONCRETE_BLOCK, ...onGround(12, 0) }],
    goal: { kind: 'reach', payloadId: CONCRETE_BLOCK.id, utilization: 0.95, tolerance: 0.01, holdSeconds: 3 },
    parSeconds: 150,
  },
  {
    id: 'wind',
    title: 'Vento',
    briefing: 'Posicione o painel de forma sobre o embasamento com rajadas de até 40 km/h.',
    wind: GUSTY,
    start: { radius: 16, hookHeight: 12, slewAngle: degToRad(-10) },
    loads: [{ payload: FORMWORK_PANEL, ...onGround(20, -12) }],
    goal: { kind: 'place', payloadId: FORMWORK_PANEL.id, zone: { center: vec3(25, 6, -39), radius: 2 }, maxTouchdownSwing: ANY_SWING },
    parSeconds: 300,
  },
  {
    id: 'precision',
    title: 'Precisão',
    briefing: 'Pouse o bloco dentro do alvo de 0,5 m de raio com balanço residual menor que 2°.',
    wind: CALM,
    start: { radius: 9, hookHeight: 8, slewAngle: degToRad(10) },
    loads: [{ payload: CONCRETE_BLOCK, ...onGround(12, 0) }],
    goal: { kind: 'place', payloadId: CONCRETE_BLOCK.id, zone: { center: vec3(-14, 0, 14), radius: 0.5 }, maxTouchdownSwing: degToRad(2) },
    parSeconds: 240,
  },
];

export const missionById = (id: MissionId): Mission => MISSIONS.find((mission) => mission.id === id) ?? MISSIONS[0]!;
