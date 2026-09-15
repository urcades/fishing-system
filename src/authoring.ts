import { recommended } from './schema.js';
/** Optional authoring conventions matching Rust's profile helpers.
 * Games may bypass this module and build Config directly.
 */
import type { Fish, Bait, Rod, Definition, Loadout, Encounter, Selection, Parameters, Segment, Nibbles } from './types.js';
import { wire, bounded, createConfig, validateSeed } from './validation.js';
import { random, DT } from './dynamics.js';
import { clamp } from './geometry.js';
export type { Fish, Bait, Rod, Definition, Loadout, Encounter, Selection } from './types.js';
const MIN_POSITIVE = 2.2250738585072014e-308;
const byteLength = (s: string): number => new TextEncoder().encode(s).length;
function fish(value: Fish): Fish {
    const f = wire<Fish>('Fish', value);
    bounded(f.pondWeight, MIN_POSITIVE, 10, 'pondWeight');
    if (byteLength(f.preference) > 64)
        throw new RangeError('preference exceeds 64 bytes');
    return f;
}
function bait(value: Bait): Bait {
    const b = wire<Bait>('Bait', value);
    for (const [k, v] of Object.entries(b.affinity)) {
        if (byteLength(k) > 64)
            throw new RangeError('affinity key exceeds 64 bytes');
        bounded(v, MIN_POSITIVE, 5, 'affinity');
    }
    return b;
}
const affinity = (b: Bait, key: string): number => Object.hasOwn(b.affinity, key) ? b.affinity[key] : 1;
/** Resolve the reference profile model without consuming randomness. */
export function resolve(definition: Definition, loadout: Loadout, seed: number): Encounter {
    validateSeed(seed);
    const d = wire<Required<Omit<Definition, 'parameters' | 'pattern' | 'nibbles'>> & {
        parameters?: Parameters;
        pattern: Segment[];
        nibbles: Nibbles;
    }>('Definition', definition);
    const l = wire<Loadout>('Loadout', loadout), f = fish(l.fish), r = wire<Rod>('Rod', l.rod), b = bait(l.bait);
    const p = wire<Parameters>('Parameters', d.parameters ?? {});
    if (p.waitMin > p.waitMax)
        throw new RangeError('wait range');
    if (d.mode !== 'hook') {
        for (const key of ['strength', 'surge', 'rest', 'fatigue', 'recovery'] as const)
            p[key] = f[key];
        p.reelRate = r.reelRate;
        p.lineCapacity = r.lineCapacity;
    }
    if (d.mode === 'tracking') {
        for (const key of ['fishSpeed', 'targetCenter', 'targetSpread', 'restWander'] as const)
            p[key] = f[key];
        for (const key of ['windowSize', 'tackleAcceleration', 'tackleDamping', 'tackleSpeed'] as const)
            p[key] = r[key];
    }
    const notes: string[] = [], configured = d.timing === 'configured', a = affinity(b, f.preference);
    function cap(value: number, lo: number, hi: number, name: string): number {
        const n = clamp(value, lo, hi);
        if (value !== n)
            notes.push(`${name} capped at ${n.toFixed(2)} to stay within the model bounds.`);
        return n;
    }
    p.waitMin = cap((configured ? p.waitMin : 1.5) / (b.attraction * a), configured ? DT : .4, configured ? 600 : 5, 'Minimum wait');
    p.waitMax = cap((configured ? p.waitMax : 3) / (b.attraction * a), configured ? DT : .4, configured ? 600 : 8, 'Maximum wait');
    p.biteWindow = cap(f.biteWindow + d.hookBonus + b.biteBonus, configured ? DT : .5, configured ? 600 : 2, 'Bite duration');
    const config = createConfig({ mode: d.mode, dimensions: d.dimensions, capture: d.capture, parameters: p,
        pattern: d.mode !== 'hook' && f.pattern?.length ? f.pattern : d.pattern, nibbles: d.nibbles, maxTicks: d.maxTicks });
    return { version: 2, config, seed, notes };
}
/** One weighted draw, in pool order. The returned seed continues the encounter. */
export function select(pool: Fish[], baitProfile: Bait, seed: number): Selection {
    if (!Array.isArray(pool) || pool.length < 1 || pool.length > 64)
        throw new RangeError('pool requires 1..64 fish');
    validateSeed(seed);
    const b = bait(baitProfile), weights = pool.map(v => { const f = fish(v); return f.pondWeight * affinity(b, f.preference); });
    if (weights.some(v => !Number.isFinite(v) || v <= 0))
        throw new RangeError('invalid selection weight');
    let sum = 0;
    for (const w of weights)
        sum += w;
    const odds = weights.map(w => w / sum), [next, r] = random(seed);
    let cumulative = 0, index = odds.length - 1;
    for (let i = 0; i < odds.length; i++) {
        cumulative += odds[i];
        if (r < cumulative) {
            index = i;
            break;
        }
    }
    return { index, seed: next, odds };
}

/** Optional original-demo tuning check, independent of broad simulation validity. */
export function validateRecommended(value: Partial<Parameters>): void {
    const p = wire<Parameters>('Parameters', value);
    for (const key of Object.keys(recommended) as Array<keyof Parameters>) {
        const [lo, hi] = recommended[key];
        bounded(p[key], lo, hi, key);
    }
    if (p.waitMin > p.waitMax) throw new RangeError('wait range');
}
