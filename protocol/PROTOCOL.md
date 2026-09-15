# Fishing Protocol — draft 0.2

Status: a working, versioned draft for native ports. Schema revision `2` is independent of the crate's `0.2.0` release version. Do not claim stable-v1 compatibility yet. The canonical implementation is Rust; the independent Python port and Rust/WASM build run the same conformance corpus.

The protocol describes a hybrid state machine: discrete phases and fish behaviors coupled to bounded numerical dynamics. It does not prescribe rendering, device controls, game assets, inventory, economy, networking, or a host framework. A conforming implementation requires both this document and the schemas/fixtures; JSON structure alone is insufficient.

## Public functions

| Function | Meaning |
| --- | --- |
| `resolve(definition, loadout, seed) → Encounter` | Validate and resolve full fish/rod/bait profiles into immutable configuration. Does not consume randomness. |
| `create_state(seed, config) → State` | Start an encounter at ready, tick zero. |
| `step(state, input, config) → Transition` | Advance exactly one simulated tick; return state and ordered events. Ready without a fresh press and terminal states are no-ops. |
| `observe(state, config) → Observation` | Derive overlap, effort and rates without advancing state or RNG. Pressure rates use the last primary input stored in state. |
| `select(pool, bait, seed) → Selection` | Optional authoring helper: one weighted fish draw with returned RNG state. A pinned fish bypasses selection. |

Rust returns `Result<T, String>` on validated boundaries. The JSON transports use `{ "ok": T }` or `{ "error": "description" }`. Error wording is diagnostic, not normative. Invalid inputs must be rejected; there is no silent fallback to another game mode. Functions never mutate their arguments or read clocks, IO, globals, render geometry, callbacks, or hidden randomness.

A full `Encounter` holds `version`, resolved `config`, starting `seed`, and up to three resolution notes. Use that same config for every tick. A replay bundles the resolved config, starting seed and ordered inputs. Resumption bundles that config and a full snapshot. Changing config mid-encounter is outside the contract. Mode/dimension/version mismatches are explicitly rejected.

## Mechanisms and state

Config specifies `mode` and `dimensions`:

| Mode | Dimensions | Struggle rule |
| --- | --- | --- |
| `hook` | 0 | Fresh hook immediately catches; no struggle. |
| `pressure` | 0 | Primary input controls reeling and release. |
| `tracking` | 1 | Inertial vertical movement; interval capture. |
| `tracking` | 2 | Vertical and lateral movement; rectangle or polygon capture. |

These mechanism combinations are the supported draft operator set. Example names are not protocol identifiers. New movement or coupling laws require an explicit protocol extension/version; arbitrary host callbacks cannot be encoded as portable recipes.

`State` contains version, mechanisms, total/phase/behavior tick counters, duration, phase, behavior, progress P, normalized line strain T, fish energy E, previous primary input, uint32 RNG, optional terminal reason, and optional motion. Motion is null in nonspatial modes. One-dimensional motion uses the same bounded motion record with inert horizontal members initialized to x=.5, velocity=0, steer=0. In two dimensions all members are active. Derived overlap/rates are not accumulated state.

Lifecycle:

```text
ready → waiting → bite → struggle → caught
                    │        └───→ escaped
                    ├────────────→ escaped (missed bite)
                    └────────────→ caught  (hook mode)

Optional false bites: waiting → nibble → waiting (repeat, then real bite)
Within struggle: rest → warning → surge → rest, or a configured segment sequence
```

Initial state: tick/elapsed timers/durations 0; rest behavior; P=.25, T=0, E=1; primary=0; no reason; RNG=provided seed; segmentIndex=0 and nibblesLeft=config.nibbles.count. Tracking starts fish/tackle/targets at .5, velocities and steer at 0.

Input is `{primary, steer}`. Missing members default to zero. Finite primary saturates to [0,1]; finite steer saturates to [-1,1]. Reject nonfinite numbers and unknown members. A fresh press means current normalized primary >0 and previous primary ==0. Primary is an abstract channel: the host maps Space/touch/etc. Steering only affects two-dimensional movement. The browser compatibility adapter alone treats nonfinite device readings as release before crossing the protocol boundary.

## Tick order and boundary semantics

1. Validate config, state and input. Terminal states return unchanged state and no events. Ready without a fresh press also returns unchanged state and no events.
2. Increment total and phase ticks, store normalized primary. Previous state remains the source for all computations.
3. Ready: draw the waiting duration, enter waiting with phaseTicks=0; emit `cast`.
4. Waiting: when incremented phaseTicks reaches duration, enter nibble if nibblesLeft>0, decrement nibblesLeft, and emit `nibble`; otherwise enter bite and emit `bite`. Set phaseTicks=0 and the corresponding resolved duration. A press on this transition does not hook. The player must release and press again.
5. Nibble: test expiry before the press. On expiry enter waiting for the configured gap, emitting no event. Otherwise a fresh press escapes with `early_hook`. Bite: test expiry before the press. If incremented phaseTicks >= duration, escape with `missed_bite`. Otherwise a fresh press emits `hooked`, then either `caught` (hook mode) or enters the first segment and emits its label (or rest/`rest` for the classic cycle). Thus a state with phaseTicks=duration−1 is already too late to hook on its next step.
6. Struggle: compute rates from OLD resources/geometry; pressure uses THIS tick's normalized primary. Integrate resources once. Move bodies using OLD energy/behavior, velocity-first integration. New positions affect scoring on the following tick. Increment behaviorTicks.
7. Check raw resource results BEFORE clamping for outcomes, in order: T>=1 → `line_broke`; P<=0 → `got_away`; P>=1 → `landed`. Clamp stored resources to [0,1]. A terminal result clears phaseTicks/duration, sets phase/reason, and emits only the terminal event.
8. If no resource outcome and incremented behaviorTicks reaches behaviorDuration, enter the next behavior and emit its name. Targets/random draws occur here, after integration.
9. If no earlier terminal return and total tick >=config.maxTicks, escape with `timeout`. This overrides nonterminal events from that tick. Catch takes precedence over timeout.

Events are ordered strings: `cast`, `nibble`, `bite`, `hooked`, `rest`, `warning`, `surge`, `caught`, `escaped`. At most two per call. Terminal input is absorbing; reset is a new `create_state` call, not another transition.

## Arithmetic and portability

- Fixed HZ=60; DT is the binary64 value of `1.0 / 60.0`. No variable dt or wall-clock input.
- Real arithmetic uses IEEE-754 binary64, round-to-nearest ties-to-even for basic operations. Preserve the written evaluation order. Do not enable fast-math, reassociation, fused multiply-add or substitute float32. No runtime trigonometry is used in the core.
- Duration conversion is `min(36000, max(1, floor(seconds × 60 + 0.5)))`; **not Python's ties-to-even round**.
- Seeds/counters are unsigned integers; accepted seeds are 0..4294967295, no implicit seed wrapping in the core. The browser's legacy adapter normalizes its old seed input before calling Rust.
- RNG is `next = (1664525 × rng + 1013904223) mod 2^32`, with `value = next / 4294967296`. The multiply/add wrap as unsigned integers; never compute that product as an imprecise float.
- Stored numbers must be finite. NaN/infinity are invalid wire data. Preserve enough JSON digits to round-trip binary64; do not round snapshots to UI precision. Signed zero has no semantic distinction. Object key ordering and JSON whitespace do not matter.
- Conformance requires exact modes, phases, reasons, event order, counters and RNG; numerical fixture checkpoints use absolute tolerance **1e−12**. This tolerance does not permit different transition ticks or outcomes. It is a test criterion, not a proof that all possible ports agree for all threshold-adjacent inputs.

The current Rust/WASM compatibility tests also preserve exact historic SHA-256 trajectories for the accepted spatial and pressure demos. That stronger regression result applies to those specific fixtures; it does not promise cross-language bit-identical replay for every possible input. Fixed-point arithmetic would be a future arithmetic-profile change, not a silent implementation substitution.

## Coupled resource laws

Parameters and their defaults/bounds are in [parameters.json](https://github.com/urcades/fishing-examples/blob/main/spec/parameters.json) and the Rust API field documentation. Let `F = strength × E × intensity`, where intensity is the current segment's intensity, or 1 during classic surge and .15 during classic rest/warning. C is lineCapacity; transmitted effort is T×C. All derivatives are zero outside struggle; capture observation can still be shown.

For tracking, q is the capture fraction:

```text
dP = reelRate*q − escapeRate*(.4+F)*(1−q)
T_target = (baseTension*q + F*(.3+1.1*(1−q))) / C
dT = (T_target−T) / response
dE = recovery*(1−q)*(1−E) − fatigue*q*(T*C)*E
```

For pressure, u is normalized primary:

```text
dP = reelRate*u − escapeRate*F*(1−u)
T_target = u*(baseTension+F) / C
dT = (T_target−T) / response
dE = recovery*(1−u)*(1−E) − fatigue*(T*C)*E
```

Each resource advances by `old + derivative*DT`. Stronger line reduces strain for the same effort without inadvertently reducing fish fatigue.

## Motion and behavior

Motion integration is `v' = clamp(v + a*DT, −speedLimit, speedLimit)` then `rawPosition = position + v'*DT`. Clamp position to its allowed interval; set outward velocity to zero whenever rawPosition <=lower or >=upper.

Vertical tackle acceleration is `(2*primary−1)*tackleAcceleration − tackleDamping*velocity`. Lateral acceleration is `steer*tackleAcceleration − tackleDamping*velocityX`. Tackle limits are half-window to 1−half-window; top speed is tackleSpeed.

Fish vigor is `.35 + .65*E`. Acceleration per axis is `7*vigor*(target−position) − 3*velocity`. Speed limit is `fishSpeed*vigor*pace`, where pace=1.7 in surge and .65 otherwise. Fish bounds are .03 to .97. During warning use current fish position as the movement target, slowing the fish before its signaled surge. The stored next target remains visible to a renderer.

Entering rest or surge consumes one random duration sample: `durationSeconds = configuredDuration*(1+(2*r−1)*jitter)`. Warning duration is fixed and consumes no duration draw. Entering rest/warning in tracking then consumes a vertical target draw, followed by a horizontal target draw only for dimensions=2. Surge reuses the announced target.

Vertical raw targets: rest → clamp(position+(2*r−1)*restWander,.08,.92); warning → .6+.3*r when below .5, otherwise .1+.3*r. Neutral home=.5 and spread=1 keep that raw value directly. Otherwise transform to clamp(home+(raw−.5)*spread,.08,.92). Horizontal uses the same raw-target rules with rest wander .16, and no home/spread transformation. Pressure draws duration samples only.

### Declarative patterns

`Config.pattern` is empty for the classic rules above, or an ordered array of
1..16 segments, repeated cyclically. Each segment has behavior (rest/warning/surge),
intensity [0,100], pace [0,10], duration [DT,600] seconds, jitter [0,1], and a target
rule. Omitted segment fields default to rest, .15, .65, 1.2, 0 and Keep.
Behavior is a label/event; custom warning does not implicitly stop motion.
Custom effort and speed use intensity and pace directly. On entering struggle,
enter segment 0. On duration expiry, advance `segmentIndex` modulo pattern length.
This index distinguishes adjacent segments with identical behavior labels.

Every segment entry consumes one duration draw, even with jitter=0, using
`duration*(1+(2*r-1)*jitter)` and the saturating tick conversion. Then evaluate
the target rule for vertical followed by horizontal when present:

| Target kind | Effect | Target draws |
| --- | --- | --- |
| `keep` | Keep the previous stored target. | None |
| `hold` | Store current position; each movement tick decelerates toward current position. | None |
| `point` | Fixed normalized [x,y], clamped to [.03,.97]; 1D uses y. | None |
| `wander` | clamp(position+(2*r−1)*distance,.03,.97), distance [0,1]. | One per active axis |
| `opposite` | .6+.3*r below .5, otherwise .1+.3*r. | One per active axis |

Custom targets do not apply classic home/spread transforms. Pressure consumes
only the duration draw; movement rules have no effect without spatial axes.
The last segment's velocity can persist into the next, so snapshot velocity
validation uses the maximum pace across the pattern, independent of current energy.

`Config.nibbles` defaults to count=0, duration=.25, gap=.6. Count is an integer
0..8; duration and gap are [DT,600] seconds. The initial wait still uses its usual
single RNG draw; nibbles and gaps consume none. Every nibble is followed by a gap,
including the last before the real bite. A held button never creates a fresh hook
edge. Nibble expiry precedes a simultaneous press, just like bite expiry.

## Geometry

One-dimensional capture is the length of overlap between fish interval (radius .03) and tackle interval (half-window), divided by .06 and clamped to [0,1]. A two-dimensional rectangle preserves `q = qx*qy` in that order.

Polygon capture is covered fish-box area / fish-box area. Vertices use [0,1] coordinates inside a square tackle bounding window, y upwards. Accept one simple outer polygon and optionally one strictly contained, non-touching simple hole. Each ring has 3..48 vertices, no repeated closing vertex, no duplicate adjacent vertices, no self intersections, and area >1e−12. Reject invalid geometry. Vertex order is preserved; either winding direction is allowed. The schema covers size/type bounds; geometric validity requires the implementation checks.

Transform the fish box into local tackle coordinates. Clip each ring against minX, maxX, minY, maxY in that order (Sutherland–Hodgman, preserving emitted vertex order). Use absolute shoelace area, subtract hole area, divide by `(2*fishRadius/windowSize)^2`, clamp to [0,1]. Four passes, at most two bounded input rings, no adaptive solver or sampled gameplay scoring.

Circles, ovals and starbursts are canonical vertex tables in example data. Ports must read those values, not independently regenerate them with sin/cos. SVG fill and path generation belong in a renderer. Shape, size and config are fixed throughout an encounter.

## Profile resolution and selection

`Definition` supplies mechanisms, base parameters, capture geometry and hookBonus in [0,600]. `Loadout` supplies complete numeric fish/rod/bait profiles. Metadata, names and IDs stay outside the protocol. An active profile field replaces its matching base parameter:

- Fish strength/surge/rest/fatigue/recovery and rod reelRate/lineCapacity apply to pressure/tracking.
- Fish speed/home/spread/wander and rod window/acceleration/damping/speed apply to tracking.
- Inactive profile fields do nothing. Base definition fields retain their values; they are not secretly repurposed.
- Fish bite duration and bait apply to all modes. With default `timing="classic"`, resolve waitMin=`1.5/(attraction*affinity)` capped [.4,5], waitMax=`3/(attraction*affinity)` capped [.4,8], biteWindow=`fish.biteWindow + definition.hookBonus + bait.biteBonus` capped [.5,2]. Report each cap in notes. With `timing="configured"`, use definition waitMin/waitMax divided by attraction*affinity, and the same additive bite formula, all capped to [DT,600].

A nonempty fish `pattern` overrides the definition pattern in struggle modes; otherwise the definition pattern applies. Hook mode has no pattern. Definition nibbles and maxTicks pass through unchanged. All supplied fish patterns validate even in hook mode, where they are inactive.

Bait affinity is a map keyed by the fish preference string; missing keys mean 1. Strings are limited to 64 UTF-8 bytes, maps to 64 entries. Pond weights are positive through 10, affinities positive through 5. Profile ranges are defined in the schema. Fish/rod/bait profiles must validate even when some attributes are inactive.

Optional `select` accepts 1..64 fish profiles. Weight=`pondWeight*affinity`; normalize in pool order. Consume exactly one RNG sample, pick the first cumulative probability strictly greater than the sample, defaulting to the last item for accumulated rounding. Return index, normalized odds and the consumed seed. Preserve pool order. Resolve the chosen fish using that returned seed; retain original source seed/selection metadata in the host if desired. Reject zero/nonfinite computed selection weights. Attraction changes waiting, not relative species probabilities.

## Validation, bounds and extensions

Schemas are in [fishing.schema.json](https://github.com/urcades/fishing-examples/blob/main/spec/fishing.schema.json); select the named `$defs` entry corresponding to the value being validated. Defaults are expanded before simulation. Resolved configs should be stored in full. Unknown members are rejected. Integer fields use integer JSON values. Semantic validation additionally checks mode/dimensions, geometry, wait ordering, matching state/config, terminal reasons, required/null motion, timer consistency and config-dependent velocity bounds. Validation checks structural invariants, not proof that a snapshot was reachable from a particular seed.

P/T/E, primary and positions are [0,1]; velocities use finite configured caps. All timers are bounded by MAX_TICKS=36,000; elapsed phase/behavior timers cannot exceed total ticks. Config.maxTicks is 1..36,000, default 3,600. Every active tick advances the total tick; terminal resolution occurs by that encounter limit. Ready time is deliberately outside simulated encounter time. Hosts can record at most maxTicks advancing inputs and maxTicks+1 snapshots per encounter. No requirement is imposed on how many encounters a host may manage.

The optional JSON CLI/WASM transport caps one request at 65,536 bytes. Native typed calls validate collection cardinalities. All allocation and clock scheduling at an embedding boundary remain host responsibilities. The examples repository’s WASM module has no imports; its JS bridge releases each input/output allocation after a call.

A new mechanic, state layout, RNG algorithm/draw order, arithmetic policy or integration order requires an explicit versioned change with new fixtures. Adding example profiles/valid geometry within existing bounds is data-only. Draft fixtures have provenance from the accepted demo; never silently regenerate expected results from an implementation merely to make a failing test pass.

## Revision 2 migration and conformance

This draft widens finite numerical limits rather than using demo tuning as the
validity boundary. Zero strength and rates are supported; duration and response
remain at least DT, windowSize at least .001, and lineCapacity at least .01.
The parameter table records both structural and recommended bounds.
`Parameters::validate_recommended()` is an optional authoring check, not a
simulation requirement. A one-tick bite window is valid but cannot be hooked
because expiry precedes the press; profiles can deliberately encode such rules.

Schema-1 states are rejected. For a valid original config/snapshot, explicitly
change state version to 2, add segmentIndex=0 and nibblesLeft=0, and expand config
extension defaults. Old configs omit pattern/nibbles/maxTicks and preserve their
original simulation and RNG draws. Encounter metadata also becomes version 2.
Rust Config adds pattern/nibbles/max_ticks; Definition adds those plus timing;
Fish adds pattern. These struct additions and new enum variants are breaking
changes permitted by the 0.2 minor release. Original reachable snapshots remain
valid; fabricated struggle snapshots with zero behavior duration are now rejected.

The core ships four representative original traces, all eight edge cases, geometry
and profile fixtures, and hand-derived extension checkpoints. Historical numerical
expectations remain unchanged; harnesses explicitly migrate only schema metadata
and disabled fields. The examples retain all 12 original traces and full regression
hashes, and run independent Python/Rust-WASM extension trajectories, including
all target rules and snapshot resumption. The old .01-window rejection is now an
acceptance test under the wider bounds. Never regenerate the old corpus to bless
an accidental simulation change.
