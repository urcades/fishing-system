import type { Config, ConfigInput, State, Input, Transition, Motion, Behavior, Phase, Reason, Observation, Event } from './types.js';
import { createConfig, stateFor, validateSeed, wire } from './validation.js';
import { clamp, alignment, intervalAlignment } from './geometry.js';
export const VERSION = 2;
export const HZ = 60;
export const DT = 1 / 60;
export const MAX_TICKS = 36000;
export const FISH_RADIUS = .03;
/** Wrapping uint32 LCG. Math.imul avoids floating-point multiplication of seeds. */
export function random(seed: number): [
    number,
    number
] {
    validateSeed(seed);
    const next = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return [next, next / 4294967296];
}
const ticks = (seconds: number): number => clamp(Math.floor(seconds * 60 + .5), 1, MAX_TICKS);
export const isTerminal = (s: State): boolean => s.phase === 'caught' || s.phase === 'escaped';
/** Start at ready without consuming a random draw. */
export function createState(seed: number, config: ConfigInput): State {
    const c = createConfig(config);
    validateSeed(seed);
    return { version: 2, mode: c.mode, dimensions: c.dimensions, segmentIndex: 0, nibblesLeft: c.nibbles.count,
        tick: 0, phase: 'ready', phaseTicks: 0, duration: 0, behavior: 'rest', behaviorTicks: 0, behaviorDuration: 0,
        progress: .25, tension: 0, energy: 1, primary: 0, rng: seed, reason: null,
        motion: c.mode === 'tracking' ? { fishPosition: .5, fishVelocity: 0, fishTarget: .5, tacklePosition: .5, tackleVelocity: 0,
            fishX: .5, fishVelocityX: 0, fishTargetX: .5, tackleX: .5, tackleVelocityX: 0, steer: 0 } : null };
}
// Mutation is limited to an owned next-state copy. No caller-owned data is modified.
function draw(s: State): number { const [seed, r] = random(s.rng); s.rng = seed; return r; }
function enterClassic(s: State, b: Behavior, c: Config): void {
    const p = c.parameters, r = b === 'warning' ? .5 : draw(s);
    s.behavior = b;
    s.behaviorTicks = 0;
    s.behaviorDuration = ticks(p[b] * (1 + (r * 2 - 1) * p.jitter));
    const m = s.motion;
    if (!m || b === 'surge')
        return;
    const y = draw(s);
    const raw = b === 'rest' ? clamp(m.fishPosition + (y * 2 - 1) * p.restWander, .08, .92) : m.fishPosition < .5 ? .6 + y * .3 : .1 + y * .3;
    m.fishTarget = p.targetCenter === .5 && p.targetSpread === 1 ? raw : clamp(p.targetCenter + (raw - .5) * p.targetSpread, .08, .92);
    if (c.dimensions === 2) {
        const x = draw(s);
        m.fishTargetX = b === 'rest' ? clamp(m.fishX + (x * 2 - 1) * .16, .08, .92) : m.fishX < .5 ? .6 + x * .3 : .1 + x * .3;
    }
}
function enterSegment(s: State, index: number, c: Config): void {
    const segment = c.pattern[index];
    s.segmentIndex = index;
    s.behavior = segment.behavior;
    s.behaviorTicks = 0;
    s.behaviorDuration = ticks(segment.duration * (1 + (2 * draw(s) - 1) * segment.jitter));
    const m = s.motion;
    if (!m)
        return;
    // Duration draw first; vertical target draw before horizontal, when applicable.
    for (let axis = 0; axis < c.dimensions; axis++) {
        const position = axis === 0 ? m.fishPosition : m.fishX, key = axis === 0 ? 'fishTarget' : 'fishTargetX', target = segment.target;
        switch (target.kind) {
            case 'keep': break;
            case 'hold':
                m[key] = position;
                break;
            case 'point':
                m[key] = clamp(target.point[axis === 0 ? 1 : 0], .03, .97);
                break;
            case 'wander':
                m[key] = clamp(position + (2 * draw(s) - 1) * target.distance, .03, .97);
                break;
            case 'opposite': {
                const r = draw(s);
                m[key] = position < .5 ? .6 + .3 * r : .1 + .3 * r;
                break;
            }
        }
    }
}
function rates(s: State, c: Config, primary: number): Observation {
    const p = c.parameters, active = s.phase === 'struggle';
    const pull = active ? p.strength * s.energy * (c.pattern[s.segmentIndex]?.intensity ?? (s.behavior === 'surge' ? 1 : .15)) : 0;
    let q = 0, qx = 0, qy = 0;
    if (s.motion) {
        const m = s.motion;
        qy = intervalAlignment(m.fishPosition, m.tacklePosition, p.windowSize, .03);
        q = qy;
        if (c.dimensions === 2) {
            qx = intervalAlignment(m.fishX, m.tackleX, p.windowSize, .03);
            q = alignment(c.capture, [m.fishX, m.fishPosition], [m.tackleX, m.tacklePosition], p.windowSize, .03);
        }
    }
    let target = 0, progress = 0, energy = 0;
    if (active && c.mode === 'pressure') {
        target = primary * (p.baseTension + pull) / p.lineCapacity;
        progress = p.reelRate * primary - p.escapeRate * pull * (1 - primary);
        energy = p.recovery * (1 - primary) * (1 - s.energy) - p.fatigue * (s.tension * p.lineCapacity) * s.energy;
    }
    else if (active) {
        target = (p.baseTension * q + pull * (.3 + 1.1 * (1 - q))) / p.lineCapacity;
        progress = p.reelRate * q - p.escapeRate * (.4 + pull) * (1 - q);
        energy = p.recovery * (1 - q) * (1 - s.energy) - p.fatigue * q * (s.tension * p.lineCapacity) * s.energy;
    }
    return { alignment: q, pull, targetTension: target, progressRate: progress, tensionRate: active ? (target - s.tension) / p.response : 0, energyRate: energy, alignmentX: qx, alignmentY: qy };
}
/** Derive current geometry/rates; pressure rates use the state's stored input. */
export function observe(value: State, config: ConfigInput): Observation {
    const c = createConfig(config), s = stateFor(value, c);
    return rates(s, c, s.primary);
}
function moveAxis(pos: number, vel: number, acc: number, limit: number, min: number, max: number): [
    number,
    number
] {
    const speed = clamp(vel + acc * DT, -limit, limit), raw = pos + speed * DT;
    return [clamp(raw, min, max), raw <= min || raw >= max ? 0 : speed];
}
function movement(s: State, c: Config, u: number, steer: number): Motion | null {
    const m = s.motion;
    if (!m)
        return null;
    const n = { ...m }, p = c.parameters, vigor = .35 + .65 * s.energy, segment = c.pattern[s.segmentIndex];
    const hold = segment ? segment.target.kind === 'hold' : s.behavior === 'warning';
    const pace = segment ? segment.pace : s.behavior === 'surge' ? 1.7 : .65;
    [n.tacklePosition, n.tackleVelocity] = moveAxis(m.tacklePosition, m.tackleVelocity, (2 * u - 1) * p.tackleAcceleration - p.tackleDamping * m.tackleVelocity, p.tackleSpeed, p.windowSize / 2, 1 - p.windowSize / 2);
    const target = hold ? m.fishPosition : m.fishTarget;
    [n.fishPosition, n.fishVelocity] = moveAxis(m.fishPosition, m.fishVelocity, 7 * vigor * (target - m.fishPosition) - 3 * m.fishVelocity, p.fishSpeed * vigor * pace, .03, .97);
    if (c.dimensions === 2) {
        [n.tackleX, n.tackleVelocityX] = moveAxis(m.tackleX, m.tackleVelocityX, steer * p.tackleAcceleration - p.tackleDamping * m.tackleVelocityX, p.tackleSpeed, p.windowSize / 2, 1 - p.windowSize / 2);
        const targetX = hold ? m.fishX : m.fishTargetX;
        [n.fishX, n.fishVelocityX] = moveAxis(m.fishX, m.fishVelocityX, 7 * vigor * (targetX - m.fishX) - 3 * m.fishVelocityX, p.fishSpeed * vigor * pace, .03, .97);
        n.steer = steer;
    }
    return n;
}
function finish(s: State, phase: Phase, reason: Reason): Transition {
    s.phase = phase;
    s.phaseTicks = 0;
    s.duration = 0;
    s.reason = reason;
    return { state: s, events: [phase === 'caught' ? 'caught' : 'escaped'] };
}
/** Advance one fixed tick. Validation precedes absorbing-state checks.
 * Rates and movement read old state; raw thresholds precede clamping and segment changes.
 */
export function step(value: State, input: Input, config: ConfigInput): Transition {
    const c = createConfig(config), s = stateFor(value, c), controls = wire<Required<Input>>('Input', input);
    if (isTerminal(s))
        return { state: s, events: [] };
    const u = clamp(controls.primary), steer = clamp(controls.steer, -1, 1), pressed = u > 0 && s.primary === 0;
    if (s.phase === 'ready' && !pressed)
        return { state: s, events: [] };
    const n: State = { ...s, motion: s.motion ? { ...s.motion } : null, tick: s.tick + 1, phaseTicks: s.phaseTicks + 1, primary: u };
    const events: Event[] = [];
    switch (s.phase) {
        case 'ready':
            n.phase = 'waiting';
            n.phaseTicks = 0;
            n.duration = ticks(c.parameters.waitMin + draw(n) * (c.parameters.waitMax - c.parameters.waitMin));
            events.push('cast');
            break;
        case 'waiting':
            if (n.phaseTicks >= s.duration) {
                n.phaseTicks = 0;
                if (s.nibblesLeft > 0) {
                    n.nibblesLeft--;
                    n.phase = 'nibble';
                    n.duration = ticks(c.nibbles.duration);
                    events.push('nibble');
                }
                else {
                    n.phase = 'bite';
                    n.duration = ticks(c.parameters.biteWindow);
                    events.push('bite');
                }
            }
            break;
        case 'nibble':
            if (n.phaseTicks >= s.duration) {
                n.phase = 'waiting';
                n.phaseTicks = 0;
                n.duration = ticks(c.nibbles.gap);
            }
            else if (pressed)
                return finish(n, 'escaped', 'early_hook');
            break;
        case 'bite':
            if (n.phaseTicks >= s.duration)
                return finish(n, 'escaped', 'missed_bite');
            if (pressed) {
                if (c.mode === 'hook') {
                    n.progress = 1;
                    const r = finish(n, 'caught', 'landed');
                    r.events.unshift('hooked');
                    return r;
                }
                n.phase = 'struggle';
                n.phaseTicks = 0;
                n.duration = 0;
                if (c.pattern.length)
                    enterSegment(n, 0, c);
                else
                    enterClassic(n, 'rest', c);
                events.push('hooked', n.behavior);
            }
            break;
        case 'struggle': {
            const r = rates(s, c, u), progress = s.progress + r.progressRate * DT, tension = s.tension + r.tensionRate * DT;
            n.progress = clamp(progress);
            n.tension = clamp(tension);
            n.energy = clamp(s.energy + r.energyRate * DT);
            n.motion = movement(s, c, u, steer);
            n.behaviorTicks = s.behaviorTicks + 1;
            if (tension >= 1)
                return finish(n, 'escaped', 'line_broke');
            if (progress <= 0)
                return finish(n, 'escaped', 'got_away');
            if (progress >= 1)
                return finish(n, 'caught', 'landed');
            if (n.behaviorTicks >= s.behaviorDuration) {
                if (c.pattern.length)
                    enterSegment(n, (s.segmentIndex + 1) % c.pattern.length, c);
                else
                    enterClassic(n, s.behavior === 'rest' ? 'warning' : s.behavior === 'warning' ? 'surge' : 'rest', c);
                events.push(n.behavior);
            }
            break;
        }
    }
    if (n.tick >= c.maxTicks)
        return finish(n, 'escaped', 'timeout');
    return { state: n, events };
}
