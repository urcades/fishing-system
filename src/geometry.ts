import type { Capture, Point } from './types.js';
export const clamp = (n: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, n));
function area(points: Point[]): number {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i], n = points[(i + 1) % points.length];
        sum += p[0] * n[1] - n[0] * p[1];
    }
    return Math.abs(sum) / 2;
}
const cross = (a: Point, b: Point, c: Point): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const on = (a: Point, b: Point, p: Point): boolean => cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
    const u = cross(a, b, c), v = cross(a, b, d), w = cross(c, d, a), z = cross(c, d, b);
    return ((u > 0 && v < 0 || u < 0 && v > 0) && (w > 0 && z < 0 || w < 0 && z > 0)) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
function inside(p: Point, ring: Point[]): boolean {
    let hit = false, j = ring.length - 1;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])
            hit = !hit;
        j = i;
    }
    return hit;
}
/** Semantic polygon checks, after wire structure and finite coordinates are checked. */
export function validateGeometry(c: Capture): void {
    if (c.kind === 'rectangle')
        return;
    for (const ring of c.rings) {
        if (area(ring) <= 1e-12)
            throw new RangeError('degenerate capture ring');
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            if (a[0] === b[0] && a[1] === b[1])
                throw new RangeError('duplicate adjacent vertices');
            for (let j = i + 1; j < ring.length; j++)
                if (j !== i + 1 && !(i === 0 && j === ring.length - 1) && intersects(a, b, ring[j], ring[(j + 1) % ring.length]))
                    throw new RangeError('self-intersecting ring');
        }
    }
    if (c.rings.length === 2) {
        const [outer, hole] = c.rings;
        for (let i = 0; i < hole.length; i++) {
            if (!inside(hole[i], outer))
                throw new RangeError('hole outside outer ring');
            for (let j = 0; j < outer.length; j++)
                if (intersects(hole[i], hole[(i + 1) % hole.length], outer[j], outer[(j + 1) % outer.length]))
                    throw new RangeError('hole touches outer ring');
        }
    }
}
/** Low-level overlap; callers provide validated geometry and positive size/radius. */
export function intervalAlignment(fish: number, tackle: number, size: number, radius: number): number {
    return clamp((Math.min(fish + radius, tackle + size / 2) - Math.max(fish - radius, tackle - size / 2)) / (2 * radius));
}
function clip(points: Point[], axis: 0 | 1, bound: number, greater: boolean): Point[] {
    const out: Point[] = [];
    if (!points.length)
        return out;
    let prev = points[points.length - 1], was = greater ? prev[axis] >= bound : prev[axis] <= bound;
    for (const p of points) {
        const yes = greater ? p[axis] >= bound : p[axis] <= bound;
        if (yes !== was) {
            const t = (bound - prev[axis]) / (p[axis] - prev[axis]);
            out.push([prev[0] + t * (p[0] - prev[0]), prev[1] + t * (p[1] - prev[1])]);
        }
        if (yes)
            out.push(p);
        prev = p;
        was = yes;
    }
    return out;
}
/** Covered fish-box area. Four bounded clipping passes, with holes subtracted. */
export function alignment(c: Capture, fish: Point, tackle: Point, size: number, radius: number): number {
    if (c.kind === 'rectangle')
        return intervalAlignment(fish[0], tackle[0], size, radius) * intervalAlignment(fish[1], tackle[1], size, radius);
    const left = tackle[0] - size / 2, bottom = tackle[1] - size / 2;
    const minX = (fish[0] - radius - left) / size, maxX = (fish[0] + radius - left) / size, minY = (fish[1] - radius - bottom) / size, maxY = (fish[1] + radius - bottom) / size;
    if (maxX <= 0 || minX >= 1 || maxY <= 0 || minY >= 1)
        return 0;
    let coverage = 0;
    for (const [i, r] of c.rings.entries()) {
        const a = area(clip(clip(clip(clip(r, 0, minX, true), 0, maxX, false), 1, minY, true), 1, maxY, false));
        if (i === 0)
            coverage = a;
        else
            coverage -= a;
    }
    const side = 2 * radius / size;
    return clamp(coverage / (side * side));
}
