/**
 * Second Optimization Pass — Multi-Strategy Grid Search
 *
 * Runs five strategies through their respective parameter grids,
 * cross-validates the top 3 of each on 15m data, then produces a
 * side-by-side comparison table.
 *
 * Strategy A — Baseline mean-reversion with RELAXED BB% [5,10,15,20]
 * Strategy B — RSI + BB% + ADX filter  (trend AND range modes)
 * Strategy C — MTF: 1h RSI + 4h RSI bullish direction
 * Strategy D — RSI + BB% + RSI acceleration > 0
 * Strategy E — All signals + volume + tranche exits (trend AND range)
 *
 * Grid sizes:
 *   A         4×4×4×4×4×5 =  5,120
 *   B trend   4×4×4×4×4×5 =  5,120  ┐
 *   B range   4×4×4×4×4×5 =  5,120  ┘ 10,240 total
 *   C         4×4×4×4×5   =  1,280
 *   D         4×4×4×4×4×5 =  5,120
 *   E trend   4×4×4×4×4×5 =  5,120  ┐
 *   E range   4×4×4×4×4×5 =  5,120  ┘ 10,240 total
 *   ─────────────────────────────────
 *   TOTAL                   37,120
 */

import {
  backtest,
  fetchBacktestCandles,
  DEFAULT_PARAMS,
  type BacktestResult,
  type OHLCVCandle,
  type BacktestParams,
} from "./backtester.js";

import {
  backtestB, backtestC, backtestD, backtestE,
  precompute,
  type StrategyBParams,
  type StrategyCParams,
  type StrategyDParams,
  type StrategyEParams,
  type PrecomputedIndicators,
} from "./strategies.js";

import type { Metrics } from "./metrics.js";

// ─── Shared Grid Axes ─────────────────────────────────────────────

const RSI_ENTRY    = [25, 30, 35, 40]      as const;
const RSI_EXIT     = [60, 65, 70, 75]      as const;
const BB_PCT       = [5, 10, 15, 20]       as const;   // relaxed (was -10…-40)
const STOP_LOSS    = [2, 3, 4, 5]          as const;
const TAKE_PROFIT  = [3, 5, 7, 10]         as const;
const TIME_LIMIT   = [2, 4, 6, 8, 12]      as const;

// ─── Grid Builders ────────────────────────────────────────────────

function gridA(): BacktestParams[] {
  const out: BacktestParams[] = [];
  for (const rsiEntry of RSI_ENTRY)
    for (const rsiExit of RSI_EXIT)
      for (const bbPctEntry of BB_PCT)
        for (const stopLossPct of STOP_LOSS)
          for (const takeProfitPct of TAKE_PROFIT)
            for (const timeLimitHours of TIME_LIMIT)
              out.push({ rsiEntry, rsiExit, bbPctEntry, stopLossPct, takeProfitPct, timeLimitHours });
  return out;
}

function gridB(adxMode: "trend" | "range"): StrategyBParams[] {
  const out: StrategyBParams[] = [];
  for (const rsiEntry of RSI_ENTRY)
    for (const rsiExit of RSI_EXIT)
      for (const bbPctEntry of BB_PCT)
        for (const stopLossPct of STOP_LOSS)
          for (const takeProfitPct of TAKE_PROFIT)
            for (const timeLimitHours of TIME_LIMIT)
              out.push({ rsiEntry, rsiExit, bbPctEntry, stopLossPct, takeProfitPct, timeLimitHours, adxMode });
  return out;
}

function gridC(): StrategyCParams[] {
  const out: StrategyCParams[] = [];
  for (const rsiEntry of RSI_ENTRY)
    for (const rsiExit of RSI_EXIT)
      for (const stopLossPct of STOP_LOSS)
        for (const takeProfitPct of TAKE_PROFIT)
          for (const timeLimitHours of TIME_LIMIT)
            out.push({ rsiEntry, rsiExit, stopLossPct, takeProfitPct, timeLimitHours });
  return out;
}

function gridD(): StrategyDParams[] {
  const out: StrategyDParams[] = [];
  for (const rsiEntry of RSI_ENTRY)
    for (const rsiExit of RSI_EXIT)
      for (const bbPctEntry of BB_PCT)
        for (const stopLossPct of STOP_LOSS)
          for (const takeProfitPct of TAKE_PROFIT)
            for (const timeLimitHours of TIME_LIMIT)
              out.push({ rsiEntry, rsiExit, bbPctEntry, stopLossPct, takeProfitPct, timeLimitHours });
  return out;
}

function gridE(adxMode: "trend" | "range"): StrategyEParams[] {
  const out: StrategyEParams[] = [];
  for (const rsiEntry of RSI_ENTRY)
    for (const rsiExit of RSI_EXIT)
      for (const bbPctEntry of BB_PCT)
        for (const stopLossPct of STOP_LOSS)
          for (const takeProfitPct of TAKE_PROFIT)
            for (const timeLimitHours of TIME_LIMIT)
              out.push({ rsiEntry, rsiExit, bbPctEntry, stopLossPct, takeProfitPct, timeLimitHours, adxMode });
  return out;
}

// ─── Combo Counts ────────────────────────────────────────────────

export const GRID_COUNTS = {
  A:       RSI_ENTRY.length * RSI_EXIT.length * BB_PCT.length * STOP_LOSS.length * TAKE_PROFIT.length * TIME_LIMIT.length,
  B:       RSI_ENTRY.length * RSI_EXIT.length * BB_PCT.length * STOP_LOSS.length * TAKE_PROFIT.length * TIME_LIMIT.length * 2,
  C:       RSI_ENTRY.length * RSI_EXIT.length * STOP_LOSS.length * TAKE_PROFIT.length * TIME_LIMIT.length,
  D:       RSI_ENTRY.length * RSI_EXIT.length * BB_PCT.length * STOP_LOSS.length * TAKE_PROFIT.length * TIME_LIMIT.length,
  E:       RSI_ENTRY.length * RSI_EXIT.length * BB_PCT.length * STOP_LOSS.length * TAKE_PROFIT.length * TIME_LIMIT.length * 2,
  get total() { return this.A + this.B + this.C + this.D + this.E; },
} as const;

// ─── Ranking ─────────────────────────────────────────────────────

function rank(results: BacktestResult[]): BacktestResult[] {
  return [...results].sort((a, b) => {
    const ma = a.metrics, mb = b.metrics;
    if (mb.sharpe  !== ma.sharpe)  return mb.sharpe  - ma.sharpe;
    if (mb.winRate !== ma.winRate) return mb.winRate - ma.winRate;
    return mb.totalPnl - ma.totalPnl;
  });
}

function topN(results: BacktestResult[], n: number): BacktestResult[] {
  const valid = results.filter((r) => r.metrics.numTrades >= 3);
  return rank(valid).slice(0, n);
}

// ─── Validated Result ────────────────────────────────────────────

export interface ValidatedResult {
  rank:      number;
  strategy:  string;
  result1h:  BacktestResult;
  result15m: BacktestResult;
}

// ─── Comparison Row ───────────────────────────────────────────────

export interface ComparisonRow {
  strategy:         string;   // "Baseline" | "A" | "B_trend" | …
  paramSummary:     string;   // e.g. "RSI30/65 BB10% SL3 TP7 T4h"
  trades:           number;
  winRate:          number;
  sharpe:           number;
  sortino:          number;
  maxDrawdownPct:   number;
  totalPnl:         number;
  avgDurationHours: number;
  result:           BacktestResult;   // full result for drill-down
}

function toRow(strategy: string, r: BacktestResult): ComparisonRow {
  const p = r.params;
  const extra = r.extra ?? {};
  const adxMode = (extra["adxMode"] as string | undefined) ?? "";
  const paramSummary =
    `RSI${p.rsiEntry}/${p.rsiExit}` +
    (p.bbPctEntry !== undefined ? ` BB${p.bbPctEntry}%` : "") +
    ` SL${p.stopLossPct} TP${p.takeProfitPct} T${p.timeLimitHours}h` +
    (adxMode ? ` ADX:${adxMode}` : "");

  return {
    strategy,
    paramSummary,
    trades:           r.metrics.numTrades,
    winRate:          r.metrics.winRate,
    sharpe:           r.metrics.sharpe,
    sortino:          r.metrics.sortino,
    maxDrawdownPct:   r.metrics.maxDrawdownPct,
    totalPnl:         r.metrics.totalPnl,
    avgDurationHours: r.metrics.avgDurationHours,
    result:           r,
  };
}

// ─── Full Multi-Strategy Optimizer ───────────────────────────────

export interface MultiStrategyResult {
  symbol:        string;
  candleCount1h: number;
  candleCount15m: number;
  gridCounts:    typeof GRID_COUNTS;
  baseline:      BacktestResult;
  top3:          Record<string, BacktestResult[]>;       // per strategy
  validated:     ValidatedResult[];                      // top-3 × each strategy on 15m
  comparison:    ComparisonRow[];                        // one row per strategy
  best:          ComparisonRow;                          // highest Sharpe across all
  ranAt:         string;
}

/** Progress callback: (label, done, total) */
export type ProgressFn = (label: string, done: number, total: number) => void;

/**
 * Run all five strategies with their full grids on 1h data,
 * cross-validate the top 3 of each on 15m data, and produce
 * a side-by-side comparison table.
 */
export async function runAllStrategies(
  symbol:        string,
  candleLimit1h  = 500,
  candleLimit15m = 1_000,
  onProgress?:   ProgressFn,
): Promise<MultiStrategyResult> {

  // ── Fetch candles ──────────────────────────────────────────────
  const candles1h  = await fetchBacktestCandles(symbol, candleLimit1h,  "1h");
  const candles15m = await fetchBacktestCandles(symbol, candleLimit15m, "15m");

  // ── Precompute indicators once each ───────────────────────────
  const pc1h  = precompute(candles1h);
  const pc15m = precompute(candles15m);

  // ── Baseline ──────────────────────────────────────────────────
  const baseline = backtest(candles1h, DEFAULT_PARAMS, symbol);
  baseline.strategy = "Baseline";

  // ── Helper: run a grid and report progress ─────────────────────
  function runGrid<P>(
    label:   string,
    grid:    P[],
    runner:  (candles: OHLCVCandle[], p: P, pc: PrecomputedIndicators, sym: string) => BacktestResult,
  ): BacktestResult[] {
    const results: BacktestResult[] = [];
    for (let i = 0; i < grid.length; i++) {
      results.push(runner(candles1h, grid[i], pc1h, symbol));
      onProgress?.(label, i + 1, grid.length);
    }
    return results;
  }

  // ── Run all grids ─────────────────────────────────────────────
  const resultsA  = runGrid("A",       gridA(),        (c, p, pc, s) => { const r = backtest(c, p, s); r.strategy = "A"; return r; });
  const resultsBt = runGrid("B_trend", gridB("trend"), backtestB);
  const resultsBr = runGrid("B_range", gridB("range"), backtestB);
  const resultsC  = runGrid("C",       gridC(),        backtestC);
  const resultsD  = runGrid("D",       gridD(),        backtestD);
  const resultsEt = runGrid("E_trend", gridE("trend"), backtestE);
  const resultsEr = runGrid("E_range", gridE("range"), backtestE);

  // ── Top 3 per strategy ────────────────────────────────────────
  const top3: Record<string, BacktestResult[]> = {
    A:       topN(resultsA,                    3),
    B_trend: topN(resultsBt,                   3),
    B_range: topN(resultsBr,                   3),
    C:       topN(resultsC,                    3),
    D:       topN(resultsD,                    3),
    E_trend: topN(resultsEt,                   3),
    E_range: topN(resultsEr,                   3),
  };

  // ── 15m cross-validation ──────────────────────────────────────
  const validated: ValidatedResult[] = [];
  for (const [strat, results] of Object.entries(top3)) {
    results.forEach((r1h, i) => {
      let r15m: BacktestResult;
      if (strat === "A") {
        r15m = backtest(candles15m, r1h.params, symbol);
        r15m.strategy = "A";
      } else if (strat.startsWith("B")) {
        r15m = backtestB(candles15m, { ...r1h.params, adxMode: r1h.extra?.["adxMode"] as "trend" | "range" }, pc15m, symbol);
      } else if (strat === "C") {
        r15m = backtestC(candles15m, r1h.params as StrategyCParams, pc15m, symbol);
      } else if (strat === "D") {
        r15m = backtestD(candles15m, r1h.params as StrategyDParams, pc15m, symbol);
      } else {
        r15m = backtestE(candles15m, { ...r1h.params, adxMode: r1h.extra?.["adxMode"] as "trend" | "range" }, pc15m, symbol);
      }
      validated.push({ rank: i + 1, strategy: strat, result1h: r1h, result15m: r15m });
    });
  }

  // ── Best per strategy (for comparison table) ──────────────────
  // Pick the #1 result from each strategy variant
  const champions: [string, BacktestResult][] = [
    ["Baseline", baseline],
    ...Object.entries(top3).map(([s, rs]) => [s, rs[0]] as [string, BacktestResult]).filter(([, r]) => r !== undefined),
  ];

  const comparison: ComparisonRow[] = champions.map(([s, r]) => toRow(s, r));

  // Sort comparison by Sharpe descending
  comparison.sort((a, b) => b.sharpe - a.sharpe);

  const best = comparison[0];

  return {
    symbol:         symbol.toUpperCase(),
    candleCount1h:  candles1h.length,
    candleCount15m: candles15m.length,
    gridCounts:     GRID_COUNTS,
    baseline,
    top3,
    validated,
    comparison,
    best,
    ranAt:          new Date().toISOString(),
  };
}
