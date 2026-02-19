/**
 * Multi-Indicator Strategy Implementations
 *
 * Strategy B — RSI + BB% + ADX filter
 *   Entry: RSI < threshold AND BB% < threshold AND ADX passes filter
 *   ADX modes: "trend" (ADX > 25) or "range" (ADX < 20)
 *
 * Strategy C — Multi-Timeframe Confluence
 *   Entry: 1h RSI oversold AND 4h RSI bullish (rising over last 4 × 4h bars)
 *   4h candles derived by aggregating 4 consecutive 1h candles
 *
 * Strategy D — Momentum Acceleration (catches the turn)
 *   Entry: RSI < threshold AND BB% < threshold AND RSI acceleration > 0
 *   RSI acceleration = RSI[i] − RSI[i-4]
 *
 * Strategy E — Full Conway Enhanced (all signals + tranche exits)
 *   Entry: RSI + BB% + volume > 1.2× avg(20) + RSI accel > 0 + ADX filter
 *   Exit:  Triple barrier with two tranches (50% at TP/2, 50% at TP; stop → breakeven after TP1)
 *
 * All strategies use ATR-based position sizing: $100 × ($50/ATR), clamped $10–$500
 */

import { atrPositionSize } from "../trading/atr.js";
import { computeMetrics, computeAdxArray, type TradeForMetrics } from "./metrics.js";
import type { OHLCVCandle, Trade, BacktestResult, ExitReason } from "./backtester.js";

// ─── Constants ────────────────────────────────────────────────────

const RSI_PERIOD   = 14;
const BB_PERIOD    = 20;
const BB_MULT      = 2;
const ATR_PERIOD   = 14;
const ADX_PERIOD   = 14;
const ACCEL_BARS   = 4;    // RSI[i] − RSI[i−4]
const VOL_PERIOD   = 20;
const INITIAL_EQ   = 1_000;
const MS_PER_HOUR  = 3_600_000;

// Warmup requirements per strategy
export const WARMUP_B = ADX_PERIOD * 2;                          // 28 (+1 for safety → 29)
export const WARMUP_C = (RSI_PERIOD + ACCEL_BARS + 1) * 4;      // 76  (4h RSI direction)
export const WARMUP_D = RSI_PERIOD + ACCEL_BARS + 1;             // 19  (RSI + accel)
export const WARMUP_E = ADX_PERIOD * 2;                          // 28

// ─── Strategy Parameter Types ─────────────────────────────────────

export type AdxMode = "trend" | "range";

/** Entry: RSI + BB% + ADX filter. */
export interface StrategyBParams {
  rsiEntry:       number;
  rsiExit:        number;
  bbPctEntry:     number;
  stopLossPct:    number;
  takeProfitPct:  number;
  timeLimitHours: number;
  adxMode:        AdxMode;
}

/** Entry: 1h RSI oversold + 4h RSI bullish. */
export interface StrategyCParams {
  rsiEntry:       number;
  rsiExit:        number;
  stopLossPct:    number;
  takeProfitPct:  number;
  timeLimitHours: number;
}

/** Entry: RSI oversold + RSI acceleration > 0. */
export interface StrategyDParams {
  rsiEntry:       number;
  rsiExit:        number;
  bbPctEntry:     number;
  stopLossPct:    number;
  takeProfitPct:  number;
  timeLimitHours: number;
}

/** Entry: all signals combined. Tranche exits. */
export interface StrategyEParams {
  rsiEntry:       number;
  rsiExit:        number;
  bbPctEntry:     number;
  stopLossPct:    number;
  takeProfitPct:  number;   // TP2; TP1 = takeProfitPct / 2
  timeLimitHours: number;
  adxMode:        AdxMode;
}

// ─── Precomputed Indicator Arrays ─────────────────────────────────

/**
 * All indicator arrays precomputed once per candle series.
 * Passing this into a batch of backtests avoids redundant O(n×period) work.
 */
export interface PrecomputedIndicators {
  rsi:        number[];    // RSI(14) — 1h
  bbPct:      number[];    // Bollinger %B(20,2) — negative = below lower band
  atr:        number[];    // ATR(14)
  adx:        number[];    // ADX(14) — Wilder
  rsiAccel:   number[];    // RSI[i] − RSI[i−4]  (RSI momentum acceleration)
  volumeAvg:  number[];    // simple mean(volume, 20)
  rsi4h:      number[];    // 4h RSI mapped to 1h bars (last complete 4h bar)
  rsi4hBull:  boolean[];   // rsi4h[k] > rsi4h[k−4] at each 1h bar
}

// ─── Indicator Calculations ───────────────────────────────────────

function rsiArray(candles: OHLCVCandle[]): number[] {
  const n = candles.length;
  const r = new Array<number>(n).fill(50);
  for (let i = RSI_PERIOD; i < n; i++) {
    let gains = 0, losses = 0;
    for (let j = i - RSI_PERIOD + 1; j <= i; j++) {
      const d = candles[j].close - candles[j - 1].close;
      if (d > 0) gains += d; else losses -= d;
    }
    if (losses === 0) r[i] = 100;
    else if (gains === 0) r[i] = 0;
    else r[i] = 100 - 100 / (1 + gains / losses);
  }
  return r;
}

function bbPctArray(candles: OHLCVCandle[]): number[] {
  const n = candles.length;
  const b = new Array<number>(n).fill(50);
  for (let i = BB_PERIOD - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - BB_PERIOD + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / BB_PERIOD;
    let vSum = 0;
    for (let j = i - BB_PERIOD + 1; j <= i; j++) vSum += (candles[j].close - mean) ** 2;
    const std = Math.sqrt(vSum / BB_PERIOD);
    if (std === 0) continue;
    const upper = mean + BB_MULT * std;
    const lower = mean - BB_MULT * std;
    b[i] = ((candles[i].close - lower) / (upper - lower)) * 100;
  }
  return b;
}

function atrArray(candles: OHLCVCandle[]): number[] {
  const n = candles.length;
  const a = new Array<number>(n).fill(0);
  for (let i = ATR_PERIOD; i < n; i++) {
    let s = 0;
    for (let j = i - ATR_PERIOD + 1; j <= i; j++) {
      const p = candles[j - 1].close;
      s += Math.max(
        candles[j].high - candles[j].low,
        Math.abs(candles[j].high - p),
        Math.abs(candles[j].low  - p),
      );
    }
    a[i] = s / ATR_PERIOD;
  }
  return a;
}

function volumeAvgArray(candles: OHLCVCandle[]): number[] {
  const n = candles.length;
  const v = new Array<number>(n).fill(0);
  for (let i = VOL_PERIOD - 1; i < n; i++) {
    let s = 0;
    for (let j = i - VOL_PERIOD + 1; j <= i; j++) s += (candles[j].volume ?? 0);
    v[i] = s / VOL_PERIOD;
  }
  return v;
}

/**
 * Aggregate 1h candles into 4h candles by grouping consecutive sets of 4.
 * open = first[0], high = max, low = min, close = last[3].
 */
export function aggregate4h(candles1h: OHLCVCandle[]): OHLCVCandle[] {
  const out: OHLCVCandle[] = [];
  const n = candles1h.length;
  for (let i = 0; i + 3 < n; i += 4) {
    out.push({
      timestamp: candles1h[i].timestamp,
      open:      candles1h[i].open,
      high:      Math.max(candles1h[i].high, candles1h[i+1].high, candles1h[i+2].high, candles1h[i+3].high),
      low:       Math.min(candles1h[i].low,  candles1h[i+1].low,  candles1h[i+2].low,  candles1h[i+3].low),
      close:     candles1h[i + 3].close,
      volume:    (candles1h[i].volume ?? 0) + (candles1h[i+1].volume ?? 0) +
                 (candles1h[i+2].volume ?? 0) + (candles1h[i+3].volume ?? 0),
    });
  }
  return out;
}

// ─── Full Precompute ──────────────────────────────────────────────

/**
 * Compute all indicator arrays in a single pass over the candle series.
 * Call once per symbol and reuse across every strategy backtest to avoid
 * O(n×period) redundancy in the grid search.
 */
export function precompute(candles1h: OHLCVCandle[]): PrecomputedIndicators {
  const n = candles1h.length;

  const rsi       = rsiArray(candles1h);
  const bbPct     = bbPctArray(candles1h);
  const atr       = atrArray(candles1h);
  const adx       = computeAdxArray(candles1h, ADX_PERIOD);
  const volumeAvg = volumeAvgArray(candles1h);

  // RSI acceleration: RSI[i] − RSI[i − ACCEL_BARS]
  const rsiAccel = new Array<number>(n).fill(0);
  for (let i = ACCEL_BARS; i < n; i++) rsiAccel[i] = rsi[i] - rsi[i - ACCEL_BARS];

  // 4h RSI: compute on aggregated 4h candles, then map back to 1h indices
  const candles4h  = aggregate4h(candles1h);
  const rsi4hArr   = rsiArray(candles4h);

  const rsi4h     = new Array<number>(n).fill(0);
  const rsi4hBull = new Array<boolean>(n).fill(false);

  for (let i = 3; i < n; i++) {
    // Last complete 4h bar index at 1h bar i:
    //   4h bar k covers 1h bars 4k … 4k+3, completes at 1h bar 4k+3
    //   → k_last = floor((i − 3) / 4)
    const k = Math.floor((i - 3) / 4);
    if (k < 0 || k >= rsi4hArr.length) continue;
    rsi4h[i] = rsi4hArr[k];
    // "Rising over last 4 bars" on the 4h timeframe
    if (k >= RSI_PERIOD + ACCEL_BARS) {
      rsi4hBull[i] = rsi4hArr[k] > rsi4hArr[k - ACCEL_BARS];
    }
  }

  return { rsi, bbPct, atr, adx, rsiAccel, volumeAvg, rsi4h, rsi4hBull };
}

// ─── Shared Infrastructure ────────────────────────────────────────

interface OpenPos {
  entryIdx:   number;
  entryTime:  number;
  entryPrice: number;
  size:       number;
  entryRsi:   number;
  entryBbPct: number;
  entryAtr:   number;
}

/** Standard triple-barrier exit check. Returns result or null if still open. */
function tripleBarrier(
  c:           OHLCVCandle,
  i:           number,
  pos:         OpenPos,
  pc:          PrecomputedIndicators,
  stopMult:    number,
  tpMult:      number,
  timeLimitMs: number,
  rsiExit:     number,
  isLast:      boolean,
): { price: number; reason: ExitReason } | null {
  const stop    = pos.entryPrice * stopMult;
  const tp      = pos.entryPrice * tpMult;
  const elapsed = c.timestamp - pos.entryTime;

  if (c.low  <= stop)         return { price: stop,    reason: "stop_loss"   };
  if (c.high >= tp)           return { price: tp,      reason: "take_profit" };
  if (pc.rsi[i] >= rsiExit)  return { price: c.close, reason: "rsi_exit"    };
  if (elapsed >= timeLimitMs) return { price: c.close, reason: "time_limit"  };
  if (isLast)                 return { price: c.close, reason: "end_of_data" };
  return null;
}

function closeTrade(
  pos:      OpenPos,
  exitIdx:  number,
  exitC:    OHLCVCandle,
  exitPrice: number,
  exitReason: ExitReason,
  extraBbPct: number,
): Trade {
  const pnlFrac = (exitPrice - pos.entryPrice) / pos.entryPrice;
  return {
    entryIndex:    pos.entryIdx,
    exitIndex:     exitIdx,
    entryTime:     pos.entryTime,
    exitTime:      exitC.timestamp,
    entryPrice:    pos.entryPrice,
    exitPrice,
    size:          pos.size,
    pnl:           pos.size * pnlFrac,
    pnlPct:        pnlFrac * 100,
    durationHours: (exitC.timestamp - pos.entryTime) / MS_PER_HOUR,
    exitReason,
    entryRsi:      pos.entryRsi,
    entryBbPct:    pos.entryBbPct,
    entryAtr:      pos.entryAtr,
  };
}

function toResult(
  symbol:      string,
  strategy:    string,
  params:      object,
  trades:      Trade[],
  equityCurve: number[],
  candleCount: number,
): BacktestResult {
  // Pull common fields for BacktestParams (best-effort; extras land in `extra`)
  const p = params as Record<string, unknown>;
  const baseParams = {
    rsiEntry:       (p["rsiEntry"]       as number)  ?? 35,
    rsiExit:        (p["rsiExit"]        as number)  ?? 65,
    bbPctEntry:     (p["bbPctEntry"]     as number)  ?? 20,
    stopLossPct:    (p["stopLossPct"]    as number)  ?? 3,
    takeProfitPct:  (p["takeProfitPct"]  as number)  ?? 5,
    timeLimitHours: (p["timeLimitHours"] as number)  ?? 4,
  };
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!(k in baseParams)) extra[k] = v;
  }

  const metas: TradeForMetrics[] = trades.map((t) => ({
    pnl:           t.pnl,
    pnlPct:        t.pnlPct,
    durationHours: t.durationHours,
  }));

  return {
    symbol:      symbol.toUpperCase(),
    strategy,
    params:      baseParams,
    extra,
    trades,
    equityCurve,
    metrics:     computeMetrics(metas, equityCurve),
    candleCount,
    ranAt:       new Date().toISOString(),
  };
}

// ─── Strategy B ───────────────────────────────────────────────────

/**
 * Strategy B — RSI + BB% + ADX filter.
 * Entry when RSI and %B are oversold AND the ADX condition is met.
 * "trend" mode (ADX > 25): trade dips within trending markets.
 * "range" mode (ADX < 20): classic mean-reversion in ranging markets.
 */
export function backtestB(
  candles: OHLCVCandle[],
  params:  StrategyBParams,
  pc?:     PrecomputedIndicators,
  symbol = "UNKNOWN",
): BacktestResult {
  const ind = pc ?? precompute(candles);
  const { rsiEntry, rsiExit, bbPctEntry, stopLossPct, takeProfitPct, timeLimitHours, adxMode } = params;
  const stopMult    = 1 - stopLossPct    / 100;
  const tpMult      = 1 + takeProfitPct  / 100;
  const timeLimitMs = timeLimitHours * MS_PER_HOUR;
  const adxOk       = (v: number) => adxMode === "trend" ? v > 25 : v < 20;

  const trades: Trade[]       = [];
  const curve:  number[]      = [INITIAL_EQ];
  let cash = INITIAL_EQ;
  let pos: OpenPos | null = null;

  for (let i = WARMUP_B; i < candles.length; i++) {
    const c = candles[i];

    if (pos) {
      const ex = tripleBarrier(c, i, pos, ind, stopMult, tpMult, timeLimitMs, rsiExit, i === candles.length - 1);
      if (ex) {
        const t = closeTrade(pos, i, c, ex.price, ex.reason, ind.bbPct[pos.entryIdx]);
        trades.push(t);
        cash += t.pnl;
        pos = null;
      }
    }

    if (!pos && ind.rsi[i] < rsiEntry && ind.bbPct[i] < bbPctEntry && adxOk(ind.adx[i])) {
      pos = { entryIdx: i, entryTime: c.timestamp, entryPrice: c.close,
              size: atrPositionSize(ind.atr[i]), entryRsi: ind.rsi[i],
              entryBbPct: ind.bbPct[i], entryAtr: ind.atr[i] };
    }

    curve.push(pos ? cash + pos.size * (c.close - pos.entryPrice) / pos.entryPrice : cash);
  }

  return toResult(symbol, `B_${adxMode}`, params, trades, curve, candles.length);
}

// ─── Strategy C ───────────────────────────────────────────────────

/**
 * Strategy C — Multi-Timeframe Confluence.
 * Entry when 1h RSI is oversold AND 4h RSI is currently bullish
 * (rising over the last 4 × 4h bars).
 *
 * 4h candles are derived by aggregating 4 consecutive 1h candles.
 * Requires WARMUP_C = 76 bars before the first valid 4h RSI direction.
 */
export function backtestC(
  candles: OHLCVCandle[],
  params:  StrategyCParams,
  pc?:     PrecomputedIndicators,
  symbol = "UNKNOWN",
): BacktestResult {
  const ind = pc ?? precompute(candles);
  const { rsiEntry, rsiExit, stopLossPct, takeProfitPct, timeLimitHours } = params;
  const stopMult    = 1 - stopLossPct    / 100;
  const tpMult      = 1 + takeProfitPct  / 100;
  const timeLimitMs = timeLimitHours * MS_PER_HOUR;

  const trades: Trade[]  = [];
  const curve:  number[] = [INITIAL_EQ];
  let cash = INITIAL_EQ;
  let pos: OpenPos | null = null;

  for (let i = WARMUP_C; i < candles.length; i++) {
    const c = candles[i];

    if (pos) {
      const ex = tripleBarrier(c, i, pos, ind, stopMult, tpMult, timeLimitMs, rsiExit, i === candles.length - 1);
      if (ex) {
        const t = closeTrade(pos, i, c, ex.price, ex.reason, ind.bbPct[pos.entryIdx]);
        trades.push(t);
        cash += t.pnl;
        pos = null;
      }
    }

    if (!pos && ind.rsi[i] < rsiEntry && ind.rsi4hBull[i]) {
      pos = { entryIdx: i, entryTime: c.timestamp, entryPrice: c.close,
              size: atrPositionSize(ind.atr[i]), entryRsi: ind.rsi[i],
              entryBbPct: ind.bbPct[i], entryAtr: ind.atr[i] };
    }

    curve.push(pos ? cash + pos.size * (c.close - pos.entryPrice) / pos.entryPrice : cash);
  }

  return toResult(symbol, "C", params, trades, curve, candles.length);
}

// ─── Strategy D ───────────────────────────────────────────────────

/**
 * Strategy D — Momentum Acceleration.
 * Entry when RSI is oversold AND RSI has already started turning up
 * (RSI[i] > RSI[i−4] → positive acceleration).
 *
 * This catches the bottom AFTER the turn, reducing false entries
 * during sustained downtrends.
 */
export function backtestD(
  candles: OHLCVCandle[],
  params:  StrategyDParams,
  pc?:     PrecomputedIndicators,
  symbol = "UNKNOWN",
): BacktestResult {
  const ind = pc ?? precompute(candles);
  const { rsiEntry, rsiExit, bbPctEntry, stopLossPct, takeProfitPct, timeLimitHours } = params;
  const stopMult    = 1 - stopLossPct    / 100;
  const tpMult      = 1 + takeProfitPct  / 100;
  const timeLimitMs = timeLimitHours * MS_PER_HOUR;
  const warmup      = Math.max(WARMUP_D, RSI_PERIOD + ACCEL_BARS + 1);

  const trades: Trade[]  = [];
  const curve:  number[] = [INITIAL_EQ];
  let cash = INITIAL_EQ;
  let pos: OpenPos | null = null;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i];

    if (pos) {
      const ex = tripleBarrier(c, i, pos, ind, stopMult, tpMult, timeLimitMs, rsiExit, i === candles.length - 1);
      if (ex) {
        const t = closeTrade(pos, i, c, ex.price, ex.reason, ind.bbPct[pos.entryIdx]);
        trades.push(t);
        cash += t.pnl;
        pos = null;
      }
    }

    if (!pos && ind.rsi[i] < rsiEntry && ind.bbPct[i] < bbPctEntry && ind.rsiAccel[i] > 0) {
      pos = { entryIdx: i, entryTime: c.timestamp, entryPrice: c.close,
              size: atrPositionSize(ind.atr[i]), entryRsi: ind.rsi[i],
              entryBbPct: ind.bbPct[i], entryAtr: ind.atr[i] };
    }

    curve.push(pos ? cash + pos.size * (c.close - pos.entryPrice) / pos.entryPrice : cash);
  }

  return toResult(symbol, "D", params, trades, curve, candles.length);
}

// ─── Strategy E ───────────────────────────────────────────────────

/**
 * Strategy E — Full Conway Enhanced.
 * Entry requires ALL of: RSI oversold, BB% oversold, volume surge,
 *                        RSI turning up, AND ADX mode passes.
 *
 * Tranche exit:
 *   TP1 = takeProfitPct / 2  → close 50%, move stop to breakeven
 *   TP2 = takeProfitPct      → close remaining 50%
 *   If both hit same candle, entire position closes at TP2.
 *   Volume multiplier is fixed at 1.2 × avg(20).
 */
export function backtestE(
  candles: OHLCVCandle[],
  params:  StrategyEParams,
  pc?:     PrecomputedIndicators,
  symbol = "UNKNOWN",
): BacktestResult {
  const ind = pc ?? precompute(candles);
  const { rsiEntry, rsiExit, bbPctEntry, stopLossPct, takeProfitPct, timeLimitHours, adxMode } = params;
  const stopMult    = 1 - stopLossPct            / 100;
  const tp1Mult     = 1 + (takeProfitPct / 2)    / 100;
  const tp2Mult     = 1 + takeProfitPct           / 100;
  const timeLimitMs = timeLimitHours * MS_PER_HOUR;
  const adxOk       = (v: number) => adxMode === "trend" ? v > 20 : v < 20;
  const VOL_MULT    = 1.2;

  const trades: Trade[]  = [];
  const curve:  number[] = [INITIAL_EQ];
  let cash = INITIAL_EQ;

  let pos:        OpenPos | null = null;
  let halfClosed  = false;
  let lockedPnl   = 0;      // P&L already realized from first tranche
  let remainStop  = 0;      // breakeven stop after TP1

  for (let i = WARMUP_E; i < candles.length; i++) {
    const c      = candles[i];
    const isLast = i === candles.length - 1;

    if (pos) {
      const elapsed  = c.timestamp - pos.entryTime;
      const tp1Price = pos.entryPrice * tp1Mult;
      const tp2Price = pos.entryPrice * tp2Mult;
      const slPrice  = halfClosed ? remainStop : pos.entryPrice * stopMult;

      let exitPrice:  number | null = null;
      let exitReason: ExitReason | null = null;

      if (!halfClosed) {
        // ── First tranche: check SL → TP2 → TP1 → RSI/time ───────
        if (c.low <= slPrice) {
          exitPrice = slPrice; exitReason = "stop_loss";          // full position stopped
        } else if (c.high >= tp2Price) {
          exitPrice = tp2Price; exitReason = "take_profit";       // both legs hit same candle
        } else if (c.high >= tp1Price) {
          // TP1 hit — close first half, move stop to breakeven
          const half1Pnl = (pos.size / 2) * (tp1Price - pos.entryPrice) / pos.entryPrice;
          lockedPnl  = half1Pnl;
          cash      += half1Pnl;
          halfClosed = true;
          remainStop = pos.entryPrice;
        } else if (ind.rsi[i] >= rsiExit)   { exitPrice = c.close; exitReason = "rsi_exit";    }
        else if (elapsed >= timeLimitMs)     { exitPrice = c.close; exitReason = "time_limit";  }
        else if (isLast)                     { exitPrice = c.close; exitReason = "end_of_data"; }

      } else {
        // ── Second tranche: check SL (breakeven) → TP2 → RSI/time ─
        if (c.low <= remainStop) {
          exitPrice = remainStop; exitReason = "stop_loss";
        } else if (c.high >= tp2Price) {
          exitPrice = tp2Price;  exitReason = "take_profit";
        } else if (ind.rsi[i] >= rsiExit)  { exitPrice = c.close; exitReason = "rsi_exit";    }
        else if (elapsed >= timeLimitMs)    { exitPrice = c.close; exitReason = "time_limit";  }
        else if (isLast)                    { exitPrice = c.close; exitReason = "end_of_data"; }
      }

      if (exitPrice !== null && exitReason !== null) {
        // Determine closing size and compute combined P&L
        const closeSize = halfClosed ? pos.size / 2 : pos.size;
        const leg2Pnl   = closeSize * (exitPrice - pos.entryPrice) / pos.entryPrice;
        const totalPnl  = lockedPnl + leg2Pnl;

        trades.push({
          entryIndex:    pos.entryIdx,
          exitIndex:     i,
          entryTime:     pos.entryTime,
          exitTime:      c.timestamp,
          entryPrice:    pos.entryPrice,
          exitPrice,
          size:          pos.size,
          pnl:           totalPnl,
          pnlPct:        (totalPnl / pos.size) * 100,
          durationHours: elapsed / MS_PER_HOUR,
          exitReason,
          entryRsi:      pos.entryRsi,
          entryBbPct:    pos.entryBbPct,
          entryAtr:      pos.entryAtr,
        });

        cash      += leg2Pnl;
        pos        = null;
        halfClosed = false;
        lockedPnl  = 0;
      }
    }

    // ── Entry ───────────────────────────────────────────────────
    if (!pos) {
      const vol    = candles[i].volume ?? 0;
      const avgVol = ind.volumeAvg[i];
      const volOk  = avgVol > 0 ? vol > VOL_MULT * avgVol : true;

      if (
        ind.rsi[i]     < rsiEntry     &&
        ind.bbPct[i]   < bbPctEntry   &&
        ind.rsiAccel[i] > 0           &&
        adxOk(ind.adx[i])             &&
        volOk
      ) {
        pos        = { entryIdx: i, entryTime: c.timestamp, entryPrice: c.close,
                       size: atrPositionSize(ind.atr[i]), entryRsi: ind.rsi[i],
                       entryBbPct: ind.bbPct[i], entryAtr: ind.atr[i] };
        halfClosed = false;
        lockedPnl  = 0;
      }
    }

    // ── Equity at candle close ──────────────────────────────────
    if (pos) {
      const openSize   = halfClosed ? pos.size / 2 : pos.size;
      const unrealized = openSize * (c.close - pos.entryPrice) / pos.entryPrice;
      curve.push(cash + unrealized);
    } else {
      curve.push(cash);
    }
  }

  return toResult(symbol, `E_${adxMode}`, params, trades, curve, candles.length);
}
