/** Simulation only. Optional fish/rod/bait policies are exported by fishing-system/authoring. */
export type { Config, ConfigInput, Parameters, State, Input, Transition, Motion, Observation, Point, Capture, Segment, Nibbles, TargetRule, Mode, Phase, Behavior, Reason, Event } from './types.js';
export { VERSION, HZ, DT, MAX_TICKS, FISH_RADIUS, random, createState, step, observe, isTerminal } from './dynamics.js';
export { createConfig, validateState, validateCapture } from './validation.js';
export { alignment, intervalAlignment } from './geometry.js';
