import { schema } from './schema.js';
import { validateGeometry } from './geometry.js';
import type { Config, State, Capture, ConfigInput } from './types.js';
type Rule = {
    $ref?: string;
    oneOf?: Rule[];
    const?: unknown;
    enum?: unknown[];
    type?: string;
    properties?: Record<string, Rule>;
    required?: string[];
    additionalProperties?: boolean | Rule;
    items?: Rule;
    minItems?: number;
    maxItems?: number;
    maxProperties?: number;
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    maxLength?: number;
    default?: unknown;
};
const definitions = schema as unknown as Record<string, Rule>;
const error = (path: string): never => { throw new RangeError(`Invalid ${path}`); };
/** Small decoder for the pinned wire schema. Cross-field laws are checked below. */
function decode(rule: Rule, value: unknown, path: string): unknown {
    if (value === undefined && 'default' in rule)
        value = rule.default;
    if (rule.$ref)
        return decode(definitions[rule.$ref.split('/').at(-1)!], value, path);
    if (rule.oneOf) {
        for (const option of rule.oneOf) {
            try {
                return decode(option, value, path);
            }
            catch { /* Try the next closed variant. */ }
        }
        return error(path);
    }
    if ('const' in rule) {
        if (value !== rule.const)
            error(path);
        return value;
    }
    if (rule.enum) {
        if (!rule.enum.includes(value))
            error(path);
        return value;
    }
    if (rule.type === 'number' || rule.type === 'integer') {
        if (typeof value !== 'number' || !Number.isFinite(value) || rule.type === 'integer' && !Number.isInteger(value))
            error(path);
        const n = value as number;
        if (rule.minimum !== undefined && n < rule.minimum || rule.maximum !== undefined && n > rule.maximum || rule.exclusiveMinimum !== undefined && n <= rule.exclusiveMinimum)
            error(path);
        return n;
    }
    if (rule.type === 'null') {
        if (value !== null)
            error(path);
        return null;
    }
    if (rule.type === 'string') {
        if (typeof value !== 'string' || rule.maxLength !== undefined && Array.from(value).length > rule.maxLength)
            error(path);
        return value;
    }
    if (rule.type === 'array') {
        if (!Array.isArray(value))
            return error(path);
        if (value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity))
            error(path);
        return value.map((v, i) => decode(rule.items!, v, `${path}[${i}]`));
    }
    if (rule.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return error(path);
        const obj = value as Record<string, unknown>, keys = Object.keys(obj), props = rule.properties ?? {};
        if (keys.length > (rule.maxProperties ?? Infinity))
            error(path);
        const entries: Array<[
            string,
            unknown
        ]> = [];
        for (const key of keys)
            if (!Object.hasOwn(props, key)) {
                if (rule.additionalProperties === false)
                    error(`${path}.${key}`);
                if (typeof rule.additionalProperties === 'object')
                    entries.push([key, decode(rule.additionalProperties, obj[key], `${path}.${key}`)]);
            }
        for (const [key, field] of Object.entries(props)) {
            const item = Object.hasOwn(obj, key) ? obj[key] : undefined;
            if (item !== undefined || 'default' in field)
                entries.push([key, decode(field, item, `${path}.${key}`)]);
            else if (rule.required?.includes(key))
                error(`${path}.${key}`);
        }
        return Object.fromEntries(entries);
    }
    return error(`unsupported schema at ${path}`);
}
export function wire<T>(name: string, value: unknown): T { return decode(definitions[name], value, name) as T; }
export function bounded(n: number, min: number, max: number, name: string): void {
    if (!Number.isFinite(n) || n < min || n > max)
        error(name);
}
/** Validate an explicit unsigned 32-bit seed; zero is valid. */
export function validateSeed(seed: number): void { bounded(seed, 0, 0xffffffff, 'seed'); if (!Number.isInteger(seed))
    error('seed'); }
/** Validate and copy untrusted capture data. */
export function validateCapture(value: unknown): Capture { const c = wire<Capture>('Capture', value); validateGeometry(c); return c; }
/** Expand defaults, copy caller-owned data and validate the resolved rules. */
export function createConfig(value: ConfigInput): Config {
    const c = wire<Config>('Config', value);
    c.parameters = wire('Parameters', c.parameters ?? {});
    if (c.mode === 'tracking' ? ![1, 2].includes(c.dimensions) : c.dimensions !== 0)
        error('mode/dimensions');
    if (c.dimensions !== 2 && c.capture.kind !== 'rectangle')
        error('capture dimensions');
    if (c.mode === 'hook' && c.pattern.length)
        error('hook pattern');
    if (c.parameters.waitMin > c.parameters.waitMax)
        error('wait range');
    validateGeometry(c.capture);
    return c;
}
/** Validate a snapshot against its fixed encounter rules. No reachability proof is implied. */
export function validateState(value: unknown, config: ConfigInput): State {
    return stateFor(value, createConfig(config));
}
export function stateFor(value: unknown, c: Config): State {
    const s = wire<State>('State', value);
    if (s.mode !== c.mode || s.dimensions !== c.dimensions)
        error('state mechanisms');
    const terminal = s.phase === 'caught' || s.phase === 'escaped';
    if (s.phaseTicks > s.tick || s.behaviorTicks > s.tick)
        error('elapsed timers');
    if (s.tick > c.maxTicks || !terminal && s.tick === c.maxTicks)
        error('tick limit');
    if (terminal !== (s.reason !== null))
        error('terminal reason');
    if (s.phase === 'caught' && (s.reason !== 'landed' || s.progress !== 1) || s.phase === 'escaped' && s.reason === 'landed')
        error('outcome');
    if (s.phase === 'struggle' && c.mode === 'hook')
        error('hook struggle');
    if (['waiting', 'bite', 'nibble'].includes(s.phase) && (s.duration === 0 || s.phaseTicks >= s.duration))
        error('phase timer');
    if (s.nibblesLeft > c.nibbles.count || s.phase === 'nibble' && c.nibbles.count === 0)
        error('nibble state');
    if (s.segmentIndex >= Math.max(1, c.pattern.length))
        error('segment index');
    if (s.phase === 'struggle') {
        if (c.pattern.length && s.behavior !== c.pattern[s.segmentIndex].behavior)
            error('segment behavior');
        if (s.behaviorDuration === 0 || s.behaviorTicks >= s.behaviorDuration)
            error('behavior timer');
    }
    if (c.mode === 'tracking') {
        if (!s.motion)
            return error('motion required');
        const pace = c.pattern.length ? Math.max(...c.pattern.map(p => p.pace)) : 1.7;
        for (const v of [s.motion.fishVelocity, s.motion.fishVelocityX])
            bounded(v, -c.parameters.fishSpeed * pace, c.parameters.fishSpeed * pace, 'fish velocity');
        for (const v of [s.motion.tackleVelocity, s.motion.tackleVelocityX])
            bounded(v, -c.parameters.tackleSpeed, c.parameters.tackleSpeed, 'tackle velocity');
    }
    else if (s.motion !== null)
        error('nonspatial motion');
    return s;
}
