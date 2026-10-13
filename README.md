# PlayGrua

**English** · [Português](README.pt-BR.md)

A tower crane operation simulator that runs entirely in the browser. It is not an arcade game: the
crane has inertia, the load swings like a real pendulum, the load moment limiter blocks motions and
the wind pushes both the load and the jib. Wherever playable and realistic pulled in different
directions, realistic won, and the parameter is in [`src/craneSpec.ts`](src/craneSpec.ts).

Live at: <https://digomes87.github.io/PlayGrua/>

The interface is available in English (the default) and Brazilian Portuguese. The flags at the top
of the menu switch between them, and the choice is remembered in the browser.

## Running locally

Requires Node 22 or newer.

```bash
npm install
npm run dev        # development server
npm test           # physics and simulation tests (Vitest)
npm run test:e2e   # browser tests: Chrome, Firefox and WebKit (npx playwright install firefox webkit)
npm run build      # writes dist/
npm run preview    # serves the build at /PlayGrua/
```

## Controls

| Keyboard | Action |
| --- | --- |
| `A` / `D` | Slew left / right |
| `W` / `S` | Trolley out / in |
| `↑` / `↓` | Hoist up / down |
| `Shift` | Fine mode (25 % of the speed) |
| `Space` or `E` | Sling the load under the hook / release the load once it is standing |
| `T` | Tag lines: riggers hold the heading of the slung load (press again to let go) |
| `C` | Cycle cameras: cab, external, hook |
| `H` | Horn |
| `X` | Emergency stop (latches; `X` again resets it) |
| `V` | Weathervane mode: releases the slew brake |
| `R` / `Esc` | Restart the mission / menu |

Gamepad in the cab layout: left stick X slews and Y moves the trolley; right stick Y hoists (pull
back to raise). `A` slings, `B` emergency stop, `X` horn, `Y` camera, `LB` fine mode, `RB`
weathervane, `RT` tag lines. Expo curve and deadzone are adjustable in the menu. Keyboard and gamepad
work together.

The joystick commands a **target speed**, never a position. Releasing it does not stop the crane:
each axis decelerates on its ramp and the load keeps swinging.

To sling a load, bring the hook within 1.2 m of its centre and at most 3 m above it; an off-centre
pick leaves the load swinging. To release it, the load must be standing and the rope slack (lower
until the slack-rope switch stops the hoist).

## Missions

1. **Free training**: no clock, four loads in the yard.
2. **Basic lift**: 2 t of rebar from 12 m radius onto the slab 30 m up.
3. **Load at the limit**: 3 t out to the radius where the moment reaches 95 %,
   held for 3 s, without tripping the cutoff.
4. **Wind**: a 12 m² formwork panel in gusts up to 40 km/h.
5. **Precision**: a 0.5 m radius target with less than 2° of swing at touchdown.
6. **Heavy beam**: 5 t in the slow hoist gear to the cradle on the far side of the tower.

When a mission ends, **Review the operation** replays it at 4×. The replay is not a video: the
simulation is deterministic, so it runs the mission again from the recorded commands and reaches the
same state.

The score starts at 1000 and loses points for time over par, maximum swing, landing speed, moment
peaks and collisions. An overload above 110 % is a grave failure. Best results are kept in
`localStorage`.

## Physical model

Everything is SI, in `src/physics`, with no dependency on Three.js. A fixed 120 Hz step is decoupled
from the frame rate (accumulator), and the state is interpolated for rendering. The simulation is
deterministic: the same input and the same wind seed give the identical state. This is tested on a
single machine; identical results across different machines or JavaScript engines have not been
checked.

### Load: a double pendulum

Hook block and payload are two masses. The rope joins the trolley to the hook block and the slings
join the hook block to the payload; both are **spring-dampers that can only pull**. The equations
are Newton's in the inertial frame, in Cartesian coordinates, integrated together with RK4:

```
m₁·a₁ = m₁·g − T·d̂₁ + S·d̂₂ + hook block drag − c·v⊥
m₂·a₂ = m₂·g − S·d̂₂ + F_aero(ψ)
I_z·ψ̈ = M_aero(ψ) + M_rope − c_swivel·ψ̇
T     = max(0, k·(|d₁| − L) + c_axial·d(|d₁| − L)/dt)
k     = 1 / (1/(E·A/(L + L_fixed)) + 1/k_structure)
```

where `d₁` runs from the trolley to the hook block, `d₂` from the hook block to the payload, `L(t)`
is the rope paid out and `ψ` is the heading of the payload about the vertical. Because the
suspension point really moves (trolley travel and jib rotation), the centripetal and tangential
accelerations and the Coriolis term of the changing `L` appear by themselves, with no small-angle
assumption. What follows from the model, with no special rule:

- a slack rope or sling does not push: the load falls freely or stays where it stands;
- snatching a load produces a tension peak, and the LMI shows it;
- shortening the rope of a swinging load widens its swing angle;
- rope and slings make an angle with each other: a light load on long slings swings in the slow mode
  of the double pendulum, slower than `2π√(L/g)` (measured frequency within 1 % of the analytic one);
- an off-centre pick leaves the slings slanted and the load swings as it lifts.

**Wind on the payload.** Each pair of vertical faces is a flat plate: the normal force follows the
Rayleigh-Kirchhoff law, scaled to give the payload's `Cd` when it faces the wind, and acts at a
centre of pressure that moves towards the leading edge at low incidence. So the drag depends on the
heading (a panel edge-on catches a fraction of the wind) and the wind turns the panel until it lies
across the flow. The payload does not follow the slewing jib: only the weak torque of the two rope
falls brings it back in line.

On the ground the load has Coulomb friction (static μ 0.5, kinetic 0.4): a small side pull does not
move it, above the limit it is dragged, and it leaves the ground only when the vertical component of
the pull exceeds its weight. A load that lands with sideways speed skids until friction stops it.

### Drives

All three axes share one drive model: the joystick moves a ramped speed reference, the motor follows
it as far as its force allows, and with the joystick released and the reference at zero the brake
closes, with limited capacity.

- **Slew**: two inertias joined by the torsion of tower and jib. Motor and brake act on the drive;
  wind and rope act on the jib: `I(r)·ω̇ = τ_torsion + τ_wind + τ_rope − 2·m_trolley·r·ṙ·ω`. The
  inertia `I` is computed from the masses of jib, counter-jib, counterweight and trolley; the load
  enters through the real pull of the rope on the trolley, so a heavy load at the tip slows the
  acceleration and a swinging load pulls the jib. The jib lags on starting and rings after the brake
  closes, with `T = 2π√(I/K)` (about 2.5 s) and 5 % damping. The motor saturates at 220 kN·m and the
  brake at 300 kN·m, and a strong wind makes it slip.
- **Trolley**: the component of the rope pull along the jib and the centrifugal force act on the
  trolley. The motor gives up to 9 kN and the brake holds 14 kN; a heavy load swinging hard drags
  the trolley.
- **Hoist**: the rope tension acts on the drum. The gears are force limits (55 kN at 1.2 m/s,
  106 kN at 0.6 m/s, the same power), so a peak above them makes the hoist give way instead of
  lifting. It slows down before its travel limits and has a slack-rope switch.
- **Emergency stop**: all three brakes close at full capacity.

### Load chart and LMI

A discrete, interpolated table: 8 t up to 15 m, then roughly constant moment,
`Q(r) ≈ 90/(r − 3.75)` t, closing at 1.6 t at 60 m. The measured load comes from the rope tension
(payload + hook block + dynamic effect) through a 0.1 s filter.

| Moment | Effect |
| --- | --- |
| 90 % | intermittent audible and visual alarm |
| 100 % | blocks hoisting up and trolleying out; lowering and trolleying in stay available |
| 110 % | recorded as an overload, a grave failure in a mission |

The cutoff is only released below 97 %.

### Wind

A mean speed plus gusts from a seeded Ornstein-Uhlenbeck process, a slowly veering direction and a
speed profile with height (power law, exponent 0.15). The wind on jib, counter-jib and counterweight
produces a slewing torque, and the crane tends to turn the jib downwind. The wind on the payload is
described above. An alert sounds from 50 km/h. Above 72 km/h operation is locked out (only lowering
the load stays available) and the operator must release the slew with `V`.

### Tag lines

Ropes from the ends of the payload to riggers on the ground (or on the slab below it). With `T`
they start holding the heading the payload has at that moment. A rope only pulls, so the torque
comes from one rigger hauling on one end: it is limited to 250 N on half the payload length
(500 N·m on the 4 m panel), and the same pull drags the payload sideways and down. The lines only
reach 20 m above whoever holds them. Edge-on to a gale the panel still gets away.

### Validation of the panel in wind

The free panel (600 kg, 4 × 3 m, 20 m of rope) in a steady wind, 10 simulated minutes:

| Wind | Free panel | With tag lines |
| --- | --- | --- |
| 4 m/s (14 km/h) | stable: hunts 0.2° and 0.1 m | not measured |
| 6 to 10 m/s (22 to 36 km/h) | turns right round and sways sideways up to 12 to 15 m | heading within 5°, sway below 0.5 m |
| 11 m/s (40 km/h) | stable: 4° and 0.5 m | stable |

What was checked and what was not:

- **Numerical solution: verified.** At 120, 240 and 480 Hz the motion is the same while it is still
  regular (heading difference below 0.01 rad after 90 s), so the instability belongs to the model,
  not to the integrator. There is a test for it.
- **Rotation of the free panel: consistent with the literature.** The hook is a free joint and the
  load turns in strong wind ([Mechanical Engineering Journal, 2020](https://doaj.org/article/33a4a32dab8b4893b0eade1762f7a8a5));
  plates hinged on a vertical axis go from fluttering to continuous rotation above a dimensionless
  moment of inertia of the order of 0.1 to 0.2
  ([Bakhshandehrostami and Fernandes](https://apps-eprint4-l.ncl.ac.uk/249828)), and the panel in
  air is far above that (tens, by a simple estimate of the added inertia of the air).
- **Amplitude of the sideways sway: not validated, and probably overestimated.** No measurement of
  a panel hanging in wind was found to compare the 12 to 15 m against. The aerodynamics here are
  quasi-static, and on plates that move freely the measured torque is one to two orders of magnitude
  smaller than on a plate held at a fixed angle
  ([Andersen, Pesavento and Wang, JFM 2005](https://dragonfly.tam.cornell.edu/publications/2005_JFM_Andersen_Pesavento_Wang_a.pdf)).
  Treat that number as an upper bound of the model, not as a prediction.
- A theoretical correction (incidence taken at three quarters of the chord) was tried and did not
  change the picture; it was not adopted.

In practice the uncertain range is that of the panel without tag lines. With the riggers holding
it, the load stays where the model is stable and the broadside drag (`½·ρ·Cd·A·v²`) dominates.

### Safety systems

- **LMI**: from 90 % hoisting up and trolleying out run at 25 % of the speed, so the 100 % cutoff is
  reached slowly and without a peak.
- **Zoning**: the trolley does not enter a forbidden zone (the street beyond the fence). The system
  refuses the slew or trolley motion that would bring the suspension point within 2 m of the zone
  and leaves the motion away from it free.
- **Rope against the structure**: if the straight line from the trolley to the hook block passes
  through a building, the panel raises an alarm and the mission counts it as a collision. The rope
  does not bend round the corner: this is detection only.

### Collisions

Payload and hook block against the ground, the buildings, the stacks and the other loads, all as
axis-aligned blocks. The top of any block is a landing surface, as long as the centre of gravity of
the load is over it: with the centre past the edge the load is not supported and falls. A landing
faster than 0.5 m/s counts as hard.

## Tests

`npm test` runs 260 tests, including the required ones:

- pendulum period against `2π√(L/g)` for 5, 20 and 40 m of rope, error below 1 %;
- slow-mode frequency of the double pendulum against the analytic solution, error below 1 %;
- energy conservation with no damping and no actuation: drift below 0.5 % in 60 s;
- load chart at the table points and monotonic interpolation;
- LMI cutoff at 100 %, in isolation and with the crane working;
- determinism: two runs with the same input and seed end in the identical state.

There are also tests for conservation of the angular momentum of jib, hook block and payload with
the slew free (drift below 1 % in 30 s), four placing missions played from start to finish by a
scripted pilot, the torsional ringing of the jib, the force limits of the drives, ground friction,
slack rope, snatch load peaks, wind on the load, tag lines, weathervaning, zoning, collisions,
replay, missions, scoring and persistence.

## Known limitations

- The payload aerodynamics are quasi-static. The sway of the free panel between 6 and 10 m/s has not
  been validated against measurement and is probably overestimated (see "Validation of the panel in
  wind").
- The payload turns only about the vertical: it does not topple or tilt beyond the angle of the
  slings. The tag lines are a limited torque with the matching force, without the geometry of each
  line or the position of the riggers.
- The flexibility of the structure is two springs: torsion between the slew drive and the jib, and a
  vertical stiffness in series with the rope. The jib has no bending modes of its own.
- Simplified collisions: the payload is a square-based prism (the mean of its two sides, whatever
  its heading). Rope and jib do not collide with the buildings.
- Loads standing on a surface are not moved by the wind.
- No full out-of-service mode, no equipment failures, no telemetry chart and no editor for the crane
  specification in the interface (the values live in `src/craneSpec.ts`).
- The gamepad mapping is unit-tested but has not been tried with a physical controller.

## Layout

```
src/
  craneSpec.ts   every reference value of the crane
  physics/       pure, testable physics core
  sim/           simulation step, collisions, rigging, missions, scoring, replay
  i18n/          interface languages and the text of each one
  render/        Three.js scene, procedural models, cameras
  input/         keyboard, gamepad, response curves
  ui/            instrument panel, menus, audio
tests/           Vitest tests
e2e/             Playwright tests
```

## Deployment

The [`deploy.yml`](.github/workflows/deploy.yml) workflow tests, builds and publishes `main` to
GitHub Pages. In the repository, under *Settings → Pages*, the source must be **GitHub Actions**.
The Vite `base` is set to `/PlayGrua/`.

Branches follow gitflow with automatic promotion: `feature/*` goes into `develop`; when the CI of
`develop` passes (types, tests and build), the `promote` job merges it into `main`, creates the tag
for the `package.json` version if it does not exist yet and starts the deployment. Nobody pushes to
`main` directly.

Documentation is written in English; [README.pt-BR.md](README.pt-BR.md) is kept as the Portuguese
version and should be updated together with this file.
