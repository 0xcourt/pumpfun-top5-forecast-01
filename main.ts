// pumpfun-top5-forecast-01 entry (Node 22, standard library only).
//
// Method: horizon-aware Monte Carlo over the coins' log market caps.
//  - Read every mark of /input/history.ndjson; for each mint fit the recent
//    log10(cap in SOL) trend (linear regression over its observed marks,
//    shrunk by observation count, blended with the last step), and project
//    it forward to the answer reads. The projection horizon H is read from
//    task.json (mean read time minus last mark time): ~0.7h in the rehearsal,
//    ~10h in the final. Growth is mean-reverting: the drift is applied over
//    H_eff = tau*(1-exp(-H/tau)) with tau=2.5h, so a coin cannot compound
//    its last-hour growth for ten hours, and a small common decay applies.
//  - Pool (graduated) coins are projected as-is; curve / migrating coins
//    take a mean penalty and extra variance (they must graduate to rank).
//  - Future log caps are simulated (4000 draws, fixed seed, deterministic)
//    with per-coin sd growing with H, so at long horizons the forecast
//    spreads honestly instead of betting everything on the last snapshot.
//    Place frequencies over the draws give the probabilities.
//  - A large unnamed share is left per place (0.40 + 0.025*H, capped 0.60):
//    in the rehearsal 3 of the 5 coins at the last answer read were launched
//    after the history ended, so a newcomer taking a place scores only from
//    the unnamed share -- naming too much destroys that score.
//  - Sizes: per place, the simulated place-cap distribution, blended toward
//    a long-run anchor (log10 ~3.55 for place 1) with weight exp(-H/4) and
//    widened with H, turned into bin probabilities with a normal CDF.
//
// Deterministic: fixed seed, no Date.now / Math.random / network.
// Reads $MAKEFUN_INPUT_DIR / $MAKEFUN_OUTPUT_DIR, else /input / /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MICRO = 1_000_000;
const SIMS = 4000;
const TAU_H = 2.5;

interface Row {
  rank: number;
  mint: string;
  market_cap_lamports: string | number;
  venue?: string;
  created_at?: string;
  complete?: boolean;
  mayhem?: boolean;
}

interface Mark {
  ok: boolean;
  at: string;
  rows: Row[] | null;
}

const task = JSON.parse(readFileSync(join(INPUT_DIR, 'task.json'), 'utf8')) as {
  places: number;
  output: string;
  size: { edges: number[] };
  reads?: string[];
};
const lines = readFileSync(join(INPUT_DIR, 'history.ndjson'), 'utf8').split('\n').filter((l) => l !== '');
const marks = lines
  .map((l) => JSON.parse(l) as Mark)
  .filter((m) => m.ok === true && Array.isArray(m.rows));
if (marks.length === 0) throw new Error('the history holds no ok mark');
const lastMark = marks[marks.length - 1]!;
const tLast = Date.parse(lastMark.at);
const lastChart = [...lastMark.rows!].sort((a, b) => a.rank - b.rank);
if (lastChart.length < task.places) throw new Error(`the last mark ranks ${lastChart.length} coins, fewer than the ${task.places} places`);

// Horizon H (hours) from task.json reads to the last mark.
let H = 1;
if (task.reads && task.reads.length > 0) {
  const meanRead = task.reads.reduce((s, r) => s + Date.parse(r), 0) / task.reads.length;
  H = Math.max(0, Math.min(24, (meanRead - tLast) / 3600000));
}
const hEff = TAU_H * (1 - Math.exp(-H / TAU_H));
const unnamedShare = Math.min(0.6, Math.max(0.4, 0.4 + 0.025 * H));

// Per-mint series.
interface Pt { t: number; logCap: number; venue: string; complete: boolean; created: number }
const series = new Map<string, Pt[]>();
for (const m of marks) {
  const t = Date.parse(m.at);
  for (const r of m.rows!) {
    const logCap = Math.log10(Number(BigInt(r.market_cap_lamports))) - 9;
    const arr = series.get(r.mint) ?? [];
    arr.push({ t, logCap, venue: r.venue ?? 'curve', complete: !!r.complete, created: r.created_at ? Date.parse(r.created_at) : t });
    series.set(r.mint, arr);
  }
}

interface Cand { mint: string; mean: number; sd: number; lastLog: number }
const cands: Cand[] = [];
for (const [mint, pts] of series) {
  const n = pts.length;
  const last = pts[n - 1]!;
  const lastLog = last.logCap;
  // Linear regression of logCap on time (hours since first obs).
  let slope = 0;
  if (n >= 2) {
    const t0 = pts[0]!.t;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) {
      const x = (p.t - t0) / 3600000;
      sx += x; sy += p.logCap; sxx += x * x; sxy += x * p.logCap;
    }
    const den = n * sxx - sx * sx;
    if (den > 1e-9) slope = (n * sxy - sx * sy) / den;
    // Blend with the last step's slope (most recent momentum).
    const a = pts[n - 2]!, b = pts[n - 1]!;
    const dtH = (b.t - a.t) / 3600000;
    if (dtH > 0) {
      const lastSlope = (b.logCap - a.logCap) / dtH;
      slope = 0.5 * slope + 0.5 * lastSlope;
    }
  }
  // Shrink by observation count; clamp to plausible pump.fun moves.
  // (Calmer than the raw fits: 2-3 points over 20-30 min overstate a
  // coin's hourly growth, and the rehearsal backtest favours the calmer fit.)
  slope = slope * (n / (n + 3));
  slope = Math.max(-0.6, Math.min(0.6, slope));
  let mean = lastLog + slope * hEff - 0.02 * H;
  let sd = 0.28 + 0.055 * H;
  if (n < 3) sd += 0.12;
  const ageH = Math.max(0, (tLast - last.created) / 3600000);
  if (ageH < 0.5) sd += 0.1;
  if (last.venue !== 'pool') { mean -= 0.35; sd += 0.18; }
  if (last.venue === 'migrating') mean += 0.2; // already complete, pool imminent
  if (!last.complete && last.venue === 'curve') mean -= 0.1;
  sd = Math.min(0.95, sd);
  cands.push({ mint, mean, sd, lastLog });
}
cands.sort((a, b) => b.mean - a.mean || (a.mint < b.mint ? -1 : 1));
const pool = cands.slice(0, 60);

// Deterministic PRNG (mulberry32) + Box-Muller.
let seed = 20261112;
function rnd(): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let spare: number | null = null;
function gauss(): number {
  if (spare !== null) { const v = spare; spare = null; return v; }
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  v = rnd();
  const r = Math.sqrt(-2 * Math.log(u));
  const th = 2 * Math.PI * v;
  spare = r * Math.sin(th);
  return r * Math.cos(th);
}

// Monte Carlo.
const placeCounts: Array<Map<string, number>> = Array.from({ length: task.places }, () => new Map());
const placeLogs: number[][] = Array.from({ length: task.places }, () => []);
const rankSum = new Map<string, number>();
for (let s = 0; s < SIMS; s++) {
  const drawn = pool.map((c) => ({ mint: c.mint, v: c.mean + c.sd * gauss() }));
  drawn.sort((a, b) => b.v - a.v || (a.mint < b.mint ? -1 : 1));
  for (let p = 0; p < task.places; p++) {
    const row = drawn[p]!;
    placeCounts[p]!.set(row.mint, (placeCounts[p]!.get(row.mint) ?? 0) + 1);
    placeLogs[p]!.push(row.v);
  }
  for (let i = 0; i < drawn.length; i++) rankSum.set(drawn[i]!.mint, (rankSum.get(drawn[i]!.mint) ?? 0) + i + 1);
}

// Probabilities, scaled to leave the unnamed share for newcomers / movers.
const probabilities: Array<{ mint: string; place: number; p: number }> = [];
for (let p = 0; p < task.places; p++) {
  const counts = placeCounts[p]!;
  for (const [mint, cnt] of counts) {
    const prob = (cnt / SIMS) * (1 - unnamedShare);
    const floored = Math.floor(prob * MICRO) / MICRO;
    if (floored >= 0.002) probabilities.push({ mint, place: p + 1, p: floored });
  }
}

// top5 by mean simulated rank, then by projected mean cap.
const byRank = [...pool].sort((a, b) => {
  const ra = (rankSum.get(a.mint) ?? 999) / SIMS;
  const rb = (rankSum.get(b.mint) ?? 999) / SIMS;
  return ra - rb || b.mean - a.mean;
});
const top5 = byRank.slice(0, task.places).map((c) => c.mint);

// Sizes: normal CDF around a per-place mean taken from the *deterministic*
// ranked projection (the k-th largest projected mean), plus a small
// max/newcomer uplift -- NOT the simulated max, whose mean is biased up by
// ~2 sd over 60 independent draws. Blend toward a long-run anchor with
// weight exp(-H/4) and widen with H.
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const above = (x: number, mean: number, sd: number): number => (x === -Infinity ? 1 : x === Infinity ? 0 : 0.5 * erfc((x - mean) / (sd * Math.SQRT2)));
const wAnchor = Math.exp(-H / 4);
const sizes: Array<{ place: number; bin: number; p: number }> = [];
const edges = task.size.edges;
const rankedMeans = [...pool].sort((a, b) => b.mean - a.mean || (a.mint < b.mint ? -1 : 1)).map((c) => c.mean);
const maxUplift = [0.18, 0.1, 0.06, 0.03, 0];
for (let p = 0; p < task.places; p++) {
  const logs = placeLogs[p]!;
  const simMean = logs.reduce((s, v) => s + v, 0) / logs.length;
  const simVar = logs.reduce((s, v) => s + (v - simMean) * (v - simMean), 0) / logs.length;
  const simSd = Math.sqrt(simVar);
  const anchor = 3.55 - 0.06 * p;
  const rawMean = (rankedMeans[p] ?? simMean) + (maxUplift[p] ?? 0);
  const mean = wAnchor * rawMean + (1 - wAnchor) * anchor;
  const sd = Math.min(0.9, Math.max(simSd * 0.6, 0.35 + 0.04 * H));
  for (let bin = 0; bin <= edges.length; bin++) {
    const lo = bin === 0 ? -Infinity : edges[bin - 1]!;
    const hi = bin === edges.length ? Infinity : edges[bin]!;
    const u = Math.floor((above(lo, mean, sd) - above(hi, mean, sd)) * MICRO);
    if (u > 0) sizes.push({ place: p + 1, bin, p: u / MICRO });
  }
}

writeFileSync(join(OUTPUT_DIR, task.output), `${JSON.stringify({ probabilities, top5, sizes })}\n`);
