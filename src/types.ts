import type * as Wire from './wire.js';
export type { Point, Capture, Motion, Observation, TargetRule, Rod, Bait, Selection } from './wire.js';
/** JSON authoring input; omitted fields receive the protocol defaults. */
export type ConfigInput = Wire.Config;
export type Parameters = Required<Wire.Parameters>;
export type Segment = Required<Wire.Segment>;
export type Nibbles = Required<Wire.Nibbles>;
/** Fully resolved rules. Keep fixed for the entire encounter. */
export type Config = Omit<Required<Wire.Config>, 'parameters' | 'pattern' | 'nibbles'> & {
    parameters: Parameters;
    pattern: Segment[];
    nibbles: Nibbles;
};
export type State = Required<Wire.State>;
export type Input = Wire.Input;
export type Transition = {
    state: State;
    events: Wire.Transition['events'];
};
export type Mode = State['mode'];
export type Phase = State['phase'];
export type Behavior = State['behavior'];
export type Reason = Exclude<State['reason'], null>;
export type Event = Transition['events'][number];
export type Fish = Wire.Fish;
export type Definition = Wire.Definition;
export type Loadout = Wire.Loadout;
export type Encounter = {
    version: 2;
    config: Config;
    seed: number;
    notes: string[];
};
