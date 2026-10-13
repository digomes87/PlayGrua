/**
 * Scripted operator for tests: flies a mission through the same Session API the application uses,
 * with nothing but joystick demands. It steers the trolley to where the load needs it, allowing
 * for the steady offset the wind gives the load.
 */
import { type CraneCommand, IDLE_COMMAND, jibDirection, jibTangent, trolleyPosition } from '../src/physics/crane';
import { FIXED_STEP } from '../src/physics/units';
import { type Vec3, dot, subtract, vec3 } from '../src/physics/vec3';
import type { Session } from '../src/sim/session';
import { hookPoint } from '../src/sim/simulation';
import { SPEC } from './helpers';

const TIME_LIMIT = 900;
/** Much longer than a swing period, so the pilot follows the mean wind offset and not the swing. */
const OFFSET_FILTER_TIME = 45;
/** Trolley speed asked per metre of position error, 1/s. */
const POSITION_GAIN = 0.35;
/** Trolley speed asked per metre of swing: chasing the load is what damps it, 1/s. */
const SWAY_GAIN = 0.45;

export interface Hover {
  /** Horizontal point the load must be brought over. */
  readonly target: Vec3;
  readonly tolerance: number;
  /** Largest joystick deflection the pilot uses. */
  readonly authority: number;
}

type Demand = Partial<CraneCommand>;

const clampTo = (value: number, limit: number): number => Math.min(Math.max(value, -limit), limit);

const flat = (point: Vec3): Vec3 => vec3(point.x, 0, point.z);

function drive(session: Session, demand: Demand, done: () => boolean, limit = TIME_LIMIT): void {
  const command = { ...IDLE_COMMAND, ...demand };
  for (let time = 0; time < limit && !done(); time += FIXED_STEP) session.advance(FIXED_STEP, command);
}

export const wait = (session: Session, seconds: number): void => drive(session, {}, () => false, seconds);

const isMoving = (session: Session): boolean =>
  Math.abs(session.state.crane.slew.rate) > 0.0005 || Math.abs(session.state.crane.trolley.speed) > 0.005;

/**
 * Brings the load over `target` and holds it there. The suspension point is asked to move towards
 * the target, corrected by the mean offset the wind gives the load, and to chase the swinging load,
 * which takes the energy out of the swing the way an operator catches it.
 */
export function hover(session: Session, plan: Hover, hoist = 0): void {
  const loadAt = (): Vec3 => flat((session.state.cargo?.body ?? session.state.body).position);
  const hangingAt = (): Vec3 => subtract(loadAt(), flat(trolleyPosition(session.state.crane, SPEC)));
  let offset = hangingAt();
  const blend = FIXED_STEP / OFFSET_FILTER_TIME;
  for (let time = 0; time < TIME_LIMIT; time += FIXED_STEP) {
    const state = session.state;
    const pivot = flat(trolleyPosition(state.crane, SPEC));
    const lag = subtract(loadAt(), pivot);
    offset = vec3(offset.x + (lag.x - offset.x) * blend, 0, offset.z + (lag.z - offset.z) * blend);
    const error = subtract(subtract(flat(plan.target), offset), pivot);
    const sway = subtract(lag, offset);
    const loadError = subtract(flat(plan.target), loadAt());
    const isThere = Math.hypot(loadError.x, loadError.z) < plan.tolerance && !isMoving(session);
    if (isThere && hoist === 0) return;
    const wanted = vec3(error.x * POSITION_GAIN + sway.x * SWAY_GAIN, 0, error.z * POSITION_GAIN + sway.z * SWAY_GAIN);
    const angle = state.crane.slew.angle;
    const slewRate = dot(wanted, jibTangent(angle)) / state.crane.trolley.radius;
    session.advance(FIXED_STEP, {
      ...IDLE_COMMAND,
      trolley: clampTo(dot(wanted, jibDirection(angle)) / SPEC.trolley.maxSpeed, plan.authority),
      slew: clampTo(slewRate / SPEC.slew.maxRate, plan.authority),
      hoist,
    });
    if (hoist < 0 && (state.cargo?.body ?? state.body).grounded) return;
  }
}

/** Hoists or lowers to `height`, releasing the joystick early enough for the ramp to stop there. */
export function hoistTo(session: Session, height: number): void {
  const coast = (): number => session.state.crane.hoist.rate ** 2 / (2 * SPEC.hoist.deceleration);
  const hook = (): number => hookPoint(session.state).y;
  const isRaising = hook() < height;
  const isClose = (): boolean => (isRaising ? hook() + coast() >= height : hook() - coast() <= height);
  drive(session, { hoist: isRaising ? 1 : -1 }, isClose);
  drive(session, {}, () => session.state.crane.hoist.rate === 0, 10);
}

/** Puts the hook over a load standing at `where` and slings it. */
export function pickUp(session: Session, where: Vec3): void {
  hover(session, { target: where, tolerance: 0.15, authority: 1 });
  drive(session, { hoist: -1, fine: true }, () => session.canRig());
  session.toggleRigging();
}

/** Lowers the slung load onto whatever is below, slackens the rope and unhooks. */
export function setDown(session: Session, plan: Hover): void {
  hover(session, plan, -0.25);
  drive(session, { hoist: -1, fine: true }, () => session.canRelease(), 60);
  session.toggleRigging();
}
