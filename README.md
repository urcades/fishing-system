# fishing-system

Pure TypeScript state machines and coupled dynamics for casual fishing minigames.
No runtime dependencies, WebAssembly, clocks, renderer, or hidden randomness.
ES modules with TypeScript declarations; usable in Node and modern browsers.

```sh
npm install fishing-system
```

```ts
import { createConfig, createState, step, observe } from 'fishing-system';

const config = createConfig({
  mode: 'tracking',
  dimensions: 1,
  capture: { kind: 'rectangle' },
  parameters: { windowSize: 0.28 },
});
const state = createState(42, config);
const next = step(state, { primary: 1, steer: 0 }, config);
// next.state.phase === 'waiting'; state is still at 'ready'.
const observation = observe(next.state, config);
```

Call `step` once per simulated 1/60 second. It returns `{ state, events }` and
never mutates its arguments. Save the resolved configuration with snapshots;
keep it fixed throughout the encounter. Replay needs that configuration, seed,
and the same ordered inputs. Ready no-ops and terminal states consume no ticks.
Invalid input throws a diagnostic `RangeError`; messages are not a wire contract.

Hook-only, pressure/release, 1D tracking and 2D tracking share one lifecycle.
Spatial overlap drives progress, tension and energy. Capture can be a rectangle
or a bounded polygon with an optional hole. Fish can follow repeating segments
with separate duration, effort, pace and target rules. Optional false bites
precede the hook window. Runs default to 3,600 ticks and can extend to 36,000.

```ts
const darting = createConfig({
  mode: 'tracking', dimensions: 2, capture: { kind: 'rectangle' },
  nibbles: { count: 2 },
  pattern: [
    { behavior: 'warning', duration: 0.5, target: { kind: 'hold' } },
    { behavior: 'surge', duration: 0.4, pace: 2, intensity: 1,
      target: { kind: 'opposite' } },
    { behavior: 'surge', duration: 0.3, pace: 1.5, intensity: 0.7,
      target: { kind: 'opposite' } },
  ],
});
```

The root export is the simulation API: types, `createConfig`, `createState`,
`step`, `observe`, `validateState`, `validateCapture`, and geometry/RNG helpers.
`alignment` and `intervalAlignment` are low-level geometry operations that
require validated inputs and positive size/radius.

Optional profile conventions live separately:

```ts
import { resolve, select, validateRecommended } from 'fishing-system/authoring';
```

`validateRecommended` optionally checks the original demo tuning ranges.
The profile helpers reproduce Rust's fish/rod/bait formulas; they are not mandatory game design.
Your game can derive Config directly from skill, equipment, geography or other
rules. Rarity, price, inventory and reward policies remain game-owned. Performance
can be a separate fold over pre-step alignment on advancing struggle ticks,
including the terminal tick. `observe` uses the stored primary input for pressure
rates; `step` uses the new input when integrating the next tick.

## Relationship to Rust

This release implements **schema revision 2 / Rust `fishing` 0.2.0**. npm package
versions and protocol revisions are separate. This is a native port, not generated
Rust code: TypeScript wire declarations and validation data are generated from the
pinned schema; dynamics are implemented explicitly and checked against Rust.

[protocol/lock.json](protocol/lock.json) pins source commits and SHA-256 hashes for
the specification, schemas and immutable fixtures. `npm test` verifies those hashes
and checks generated files for drift. CI additionally verifies the upstream files
and runs the **published Rust crate** as an independent oracle against fixed inputs.
The schemas and complete historical corpus currently live in the companion examples
repo; their exact commits are pinned alongside the core specification.

To adopt a future protocol version, deliberately update the pinned files and lock,
run `npm run generate`, implement the changed laws, and pass both suites. Do not
regenerate golden expectations from this implementation. The runtime never fetches
protocol data or silently follows upstream changes. A local lock check detects
accidental drift; upstream verification ties the copied bytes to their source.

Original schema-1 fixtures are kept unchanged. Test harnesses explicitly migrate
version/default metadata; numerical values, events and RNG are preserved. To
resume your own original snapshot, explicitly migrate its version to 2 and add
`segmentIndex: 0` and `nibblesLeft: 0`, with extensions disabled in the configuration.

## Checks

```sh
npm ci --ignore-scripts
npm test
npm run test:rust                     # requires Cargo; uses fishing =0.2.0
node scripts/check-protocol.mjs --upstream
npm pack --dry-run
```

Tests cover the 12 original traces / 8,080 ticks, transition boundaries, geometry,
profile resolution, selection, invalid imports, extension checkpoints and a full
36,000-tick run. Differential checks cover all five target rules, 6,734 advancing
ticks, complete states/events/observations and configured profile resolution.
Discrete values match exactly; floating-point comparisons use absolute tolerance
1e-12. This is bounded conformance evidence, not proof of equivalence for every
possible threshold-adjacent input or architecture.

The [Rust specification](https://github.com/urcades/fishing/blob/fishing-v0.2.0/spec/PROTOCOL.md)
defines the arithmetic and transition ordering. The
[examples repository](https://github.com/urcades/fishing-examples) contains the four
playable demos and the game-owned preparation/reward example.

Licensed under MIT OR Apache-2.0, at your option.
