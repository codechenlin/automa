/**
 * Conway Strategy Parameter Optimizer
 *
 * Phase 1 — Grid search: 5,120 parameter combinations run on 1h data.
 *            Ranked by Sharpe ratio → win rate → total P&L.
 *
 * Phase 2 — Validation: top 10 results re-run on 15m data for
 *            finer-granularity confirmation before live adoption.
 *
 * Total combinations: 4 × 4 × 4 × 4 × 4 × 5 = 5,120
 */

import {
  backtest,
  fetchBacktestCandles,
  type BacktestParams,
  type BacktestResult,
  type OHLCVCandle,
} from "./backtester.js";

// ─── Parameter Grid Definition ───────────────────────────────────

const RSI_ENTRY_VALUES    = [25, 30, 35, 40]     as const;
const RSI_EXIT_VALUES     = [60, 65, 70, 75]     as const;
const BB_PCT_ENTRY_VALUES = [-10, -20, -30, -40] as const;
const STOP_LOSS_VALUES    = [2, 3, 4, 5]         as const;
const TAKE_PROFIT_VALUES  = [3, 5, 7, 10]        as const;
const TIME_LIMIT_VALUES   = [2, 4, 6, 8, 12]     as const;

export const TOTAL_COMBINATIONS =
  RSI_ENTRY_VALUES.length    *   // 4
  RSI_EXIT_VALUES.length     *   // 4
  BB_PCT_ENTRY_VALUES.length *   // 4
  STOP_LOSS_VALUES.length    *   // 4
  TAKE_PROFIT_VALUES.length  *   // 4
  TIME_LIMIT_VALUES.length;      // 5  →  5,120

/** Build the flat list of every parameter combination. */
export function buildParamGrid(): BacktestParams[] {
  const combos: BacktestParams[] = [];
  for (const rsiEntry of RSI_ENTRY_VALUES) {
    for (const rsiExit of RSI_EXIT_VALUES) {
      for (const bbPctEntry of BB_PCT_ENTRY_VALUES) {
        for (const stopLossPct of STOP_LOSS_VALUES) {
          for (const takeProfitPct of TAKE_PROFIT_VALUES) {
            for (const timeLimitHours of TIME_LIMIT_VALUES) {
              combos.push({
                rsiEntry,
                rsiExit,
                bbPctEntry,
                stopLossPct,
                takeProfitPct,
                timeLimitHours,
              });
            }
          }
        }
      }
    }
  }
  return combos;
}

// ─── Ranking ─────────────────────────────────────────────────────

/**
 * Sort results by:
 *   1. Sharpe ratio  (descending) — primary
 *   2. Win rate      (descending) — tiebreaker
 *   3. Total P&L     (descending) — final tiebreaker
 */
function rankResults(results: BacktestResult[]): BacktestResult[] {
  return [...results].sort((a, b) => {
    const ma = a.metrics;
    const mb = b.metrics;
    if (mb.sharpe  !== ma.sharpe)  return mb.sharpe  - ma.sharpe;
    if (mb.winRate !== ma.winRate) return mb.winRate - ma.winRate;
    return mb.totalPnl - ma.totalPnl;
  });
}

// ─── Result Types ─────────────────────────────────────────────────

/** A single parameter set validated on both 1h and 15m data. */
export interface ValidatedResult {
  rank:      number;
  params:    BacktestParams;
  result1h:  BacktestResult;   // phase-1 result (basis for ranking)
  result15m: BacktestResult;   // phase-2 result (finer granularity)
}

/** Full output of a completed optimization run. */
export interface OptimizerResult {
  symbol:            string;
  candleCount1h:     number;
  candleCount15m:    number;
  totalCombinations: number;
  validResults:      number;    // combos with ≥ 1 trade
  top10:             BacktestResult[];     // ranked by phase-1 metrics
  validated:         ValidatedResult[];    // top 10 cross-validated on 15m
  ranAt:             string;
}

// ─── Phase 1: Grid Search ─────────────────────────────────────────

/**
 * Run the full grid search on a pre-fetched candle series.
 * Pure / synchronous — no I/O.  Designed to be called after the
 * caller has already fetched candles so progress can be streamed.
 *
 * @param candles     1h OHLCV candles
 * @param symbol      Symbol label (cosmetic only)
 * @param topN        How many top results to return
 * @param onProgress  Optional callback called after each combo
 */
export function gridSearch(
  candles:     OHLCVCandle[],
  symbol:      string,
  topN        = 10,
  onProgress?: (done: number, total: number) => void,
): BacktestResult[] {
  const grid = buildParamGrid();
  const results: BacktestResult[] = [];

  for (let i = 0; i < grid.length; i++) {
    results.push(backtest(candles, grid[i], symbol));
    onProgress?.(i + 1, grid.length);
  }

  const valid = results.filter((r) => r.metrics.numTrades > 0);
  return rankResults(valid).slice(0, topN);
}

// ─── Phase 2: 15m Validation ──────────────────────────────────────

/**
 * Re-run a set of parameter sets on 15m candles.
 * Returns a ValidatedResult for each, pairing the 1h result with
 * the 15m result for side-by-side comparison.
 */
export function validateOn15m(
  top10:     BacktestResult[],
  candles15m: OHLCVCandle[],
): ValidatedResult[] {
  return top10.map((r, i) => ({
    rank:      i + 1,
    params:    r.params,
    result1h:  r,
    result15m: backtest(candles15m, r.params, r.symbol),
  }));
}

// ─── Full Async Optimizer ─────────────────────────────────────────

/**
 * End-to-end optimizer: fetches candles, runs grid search on 1h,
 * then validates top results on 15m.
 *
 * @param symbol          Token symbol (e.g. "ETH", "BTC")
 * @param candleLimit1h   Number of 1h candles for grid search  (default 500 ≈ 20 days)
 * @param candleLimit15m  Number of 15m candles for validation   (default 1000 ≈ 10 days)
 * @param topN            Number of top results to retain         (default 10)
 * @param onProgress      Progress callback fired after each combo
 */
export async function runOptimizer(
  symbol:         string,
  candleLimit1h   = 500,
  candleLimit15m  = 1_000,
  topN            = 10,
  onProgress?:    (done: number, total: number) => void,
): Promise<OptimizerResult> {

  // ── Phase 1: 1h grid search ───────────────────────────────────
  const candles1h = await fetchBacktestCandles(symbol, candleLimit1h, "1h");
  const top10     = gridSearch(candles1h, symbol, topN, onProgress);

  // ── Phase 2: 15m validation ───────────────────────────────────
  const candles15m  = await fetchBacktestCandles(symbol, candleLimit15m, "15m");
  const validated   = validateOn15m(top10, candles15m);

  return {
    symbol:            symbol.toUpperCase(),
    candleCount1h:     candles1h.length,
    candleCount15m:    candles15m.length,
    totalCombinations: TOTAL_COMBINATIONS,
    validResults:      top10.length,
    top10,
    validated,
    ranAt:             new Date().toISOString(),
  };
}
