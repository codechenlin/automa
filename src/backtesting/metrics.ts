/**
 * Performance Metrics Calculator
 *
 * Pure functions for computing trading strategy performance metrics
 * from a list of closed trades and an hourly equity curve.
 *
 * All ratio metrics are annualized assuming 24 × 365 hourly periods.
 */

// ─── Input Types ─────────────────────────────────────────────────

export interface TradeForMetrics {
  pnl:           number;   // realized P&L in USD
  pnlPct:        number;   // P&L as % of position size
  durationHours: number;
}

// ─── Output Types ────────────────────────────────────────────────

export interface DrawdownResult {
  usd: number;   // max drawdown in $
  pct: number;   // max drawdown as % of peak equity
}

export interface WinLossStats {
  avgWin:  number;   // average winning trade P&L (USD)
  avgLoss: number;   // average losing trade P&L (USD, negative)
}

export interface Metrics {
  sharpe:             number;   // annualized Sharpe ratio
  sortino:            number;   // annualized Sortino ratio
  maxDrawdownUsd:     number;   // max drawdown in USD
  maxDrawdownPct:     number;   // max drawdown as % of peak
  winRate:            number;   // % of trades with pnl > 0
  avgWin:             number;   // average winning trade USD
  avgLoss:            number;   // average losing trade USD (negative)
  profitFactor:       number;   // gross wins / gross losses
  avgDurationHours:   number;   // mean trade duration in hours
  expectancyPerTrade: number;   // average P&L per trade in USD
  numTrades:          number;
  totalPnl:           number;   // sum of all trade P&Ls
}

// ─── Annualisation ───────────────────────────────────────────────

/** Hourly periods in a year (1h × 24 × 365). */
const HOURS_PER_YEAR = 24 * 365;

// ─── Sharpe Ratio ────────────────────────────────────────────────

/**
 * Annualized Sharpe ratio from a series of hourly equity returns.
 *   Sharpe = (mean / std) × √(24 × 365)
 * Returns 0 when there are fewer than 2 data points or zero volatility.
 */
export function sharpeRatio(hourlyReturns: number[]): number {
  if (hourlyReturns.length < 2) return 0;

  const n    = hourlyReturns.length;
  const mean = hourlyReturns.reduce((s, r) => s + r, 0) / n;
  const variance =
    hourlyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(HOURS_PER_YEAR);
}

// ─── Sortino Ratio ───────────────────────────────────────────────

/**
 * Annualized Sortino ratio — uses only downside deviation as the
 * risk denominator so upside volatility is not penalised.
 *
 *   Downside deviation = √( Σ min(rᵢ, 0)² / n )   (target = 0)
 *   Sortino = (mean / downsideStd) × √(24 × 365)
 *
 * Returns Infinity when there are no losing periods (perfect upside).
 */
export function sortinoRatio(hourlyReturns: number[]): number {
  if (hourlyReturns.length < 2) return 0;

  const n    = hourlyReturns.length;
  const mean = hourlyReturns.reduce((s, r) => s + r, 0) / n;

  // Downside deviation denominator uses total n (not just negatives)
  const downsideVariance =
    hourlyReturns.reduce((s, r) => s + Math.min(r, 0) ** 2, 0) / n;
  const downsideStd = Math.sqrt(downsideVariance);

  if (downsideStd === 0) return mean > 0 ? Infinity : 0;
  return (mean / downsideStd) * Math.sqrt(HOURS_PER_YEAR);
}

// ─── Max Drawdown ────────────────────────────────────────────────

/**
 * Maximum peak-to-trough drawdown over an equity curve.
 * Returns both the absolute dollar amount and the percentage of peak equity.
 */
export function maxDrawdown(equityCurve: number[]): DrawdownResult {
  if (equityCurve.length === 0) return { usd: 0, pct: 0 };

  let peak   = equityCurve[0];
  let maxUsd = 0;
  let maxPct = 0;

  for (const val of equityCurve) {
    if (val > peak) peak = val;
    const dd    = peak - val;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd    > maxUsd) maxUsd = dd;
    if (ddPct > maxPct) maxPct = ddPct;
  }

  return { usd: maxUsd, pct: maxPct };
}

// ─── Win Rate ─────────────────────────────────────────────────────

/** Percentage of trades where pnl > 0, in the range [0, 100]. */
export function winRate(trades: TradeForMetrics[]): number {
  if (trades.length === 0) return 0;
  return (trades.filter((t) => t.pnl > 0).length / trades.length) * 100;
}

// ─── Average Win / Loss ──────────────────────────────────────────

/**
 * Mean P&L of winning and losing trades respectively.
 * avgLoss is negative (or zero if no losing trades).
 */
export function avgWinLoss(trades: TradeForMetrics[]): WinLossStats {
  const winners = trades.filter((t) => t.pnl > 0);
  const losers  = trades.filter((t) => t.pnl <= 0);

  const avgWin =
    winners.length > 0
      ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length
      : 0;

  const avgLoss =
    losers.length > 0
      ? losers.reduce((s, t) => s + t.pnl, 0) / losers.length
      : 0;

  return { avgWin, avgLoss };
}

// ─── Profit Factor ────────────────────────────────────────────────

/**
 * Profit factor = gross wins / |gross losses|.
 * Returns Infinity if there are zero losses, 0 if there are zero wins.
 */
export function profitFactor(trades: TradeForMetrics[]): number {
  const grossWin = trades
    .filter((t) => t.pnl > 0)
    .reduce((s, t) => s + t.pnl, 0);

  const grossLoss = Math.abs(
    trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0),
  );

  if (grossLoss === 0) return grossWin > 0 ? Infinity : 0;
  return grossWin / grossLoss;
}

// ─── Average Duration ─────────────────────────────────────────────

/** Mean trade duration in hours. Returns 0 if no trades. */
export function avgDuration(trades: TradeForMetrics[]): number {
  if (trades.length === 0) return 0;
  return trades.reduce((s, t) => s + t.durationHours, 0) / trades.length;
}

// ─── Expectancy ───────────────────────────────────────────────────

/**
 * Expectancy per trade — average P&L in USD across all trades.
 * Equivalent to: winRate × avgWin + (1 − winRate) × avgLoss
 */
export function expectancyPerTrade(trades: TradeForMetrics[]): number {
  if (trades.length === 0) return 0;
  return trades.reduce((s, t) => s + t.pnl, 0) / trades.length;
}

// ─── ADX ─────────────────────────────────────────────────────────

/**
 * Minimal OHLC bar required for ADX computation.
 * OHLCVCandle (from backtester.ts) is structurally compatible.
 */
export interface OHLCBar {
  high:  number;
  low:   number;
  close: number;
}

/**
 * Wilder's Average Directional Index (ADX) for all bars in the series.
 *
 * ADX measures trend STRENGTH, not direction:
 *   ADX > 25 → trending market   (directional strategies preferred)
 *   ADX < 20 → ranging market    (mean-reversion strategies preferred)
 *
 * Returns an array of the same length as `bars`.
 * Indices < (2 × period − 1) are 0 (insufficient history).
 *
 * Algorithm (Wilder smoothing):
 *   TR, +DM, -DM for each bar
 *   SmTR14 / Sm+DM14 / Sm-DM14 via Wilder's recursive formula
 *   +DI14 = 100 × Sm+DM14 / SmTR14
 *   -DI14 = 100 × Sm-DM14 / SmTR14
 *   DX    = 100 × |+DI14 − -DI14| / (+DI14 + -DI14)
 *   ADX   = Wilder-smoothed DX (first value = mean of `period` DX seeds)
 */
export function computeAdxArray(bars: OHLCBar[], period = 14): number[] {
  const n = bars.length;
  const result = new Array<number>(n).fill(0);
  if (n <= period * 2) return result;

  // ── True Range and Directional Movement ──────────────────────
  const tr  = new Array<number>(n).fill(0);
  const pdm = new Array<number>(n).fill(0);  // +DM
  const ndm = new Array<number>(n).fill(0);  // -DM

  for (let i = 1; i < n; i++) {
    const h  = bars[i].high,   l  = bars[i].low,   pc = bars[i - 1].close;
    const ph = bars[i - 1].high, pl = bars[i - 1].low;

    tr[i]  = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const up = h - ph, dn = pl - l;
    pdm[i] = (up > dn  && up > 0)  ? up  : 0;
    ndm[i] = (dn > up  && dn > 0)  ? dn  : 0;
  }

  // ── First smoothed values: simple sum of bars 1..period ───────
  let sTR = 0, sPDM = 0, sNDM = 0;
  for (let i = 1; i <= period; i++) {
    sTR += tr[i]; sPDM += pdm[i]; sNDM += ndm[i];
  }

  const dxNow = (): number => {
    if (sTR === 0) return 0;
    const pdi = (100 * sPDM) / sTR;
    const ndi = (100 * sNDM) / sTR;
    const sum = pdi + ndi;
    return sum === 0 ? 0 : (100 * Math.abs(pdi - ndi)) / sum;
  };

  // ── Seed ADX: collect `period` DX values ─────────────────────
  // First DX at bar `period` (index = period, using bars 1..period)
  const seedDx: number[] = [dxNow()];

  for (let i = period + 1; i < period * 2; i++) {
    sTR  = sTR  - sTR  / period + tr[i];
    sPDM = sPDM - sPDM / period + pdm[i];
    sNDM = sNDM - sNDM / period + ndm[i];
    seedDx.push(dxNow());
  }

  // First ADX = mean of seed DX values (placed at bar 2*period - 1)
  let adx = seedDx.reduce((s, v) => s + v, 0) / seedDx.length;
  result[period * 2 - 1] = adx;

  // ── Subsequent ADX values: Wilder smoothing ───────────────────
  for (let i = period * 2; i < n; i++) {
    sTR  = sTR  - sTR  / period + tr[i];
    sPDM = sPDM - sPDM / period + pdm[i];
    sNDM = sNDM - sNDM / period + ndm[i];
    adx  = (adx * (period - 1) + dxNow()) / period;
    result[i] = adx;
  }

  return result;
}

// ─── All-in-one ───────────────────────────────────────────────────

/**
 * Compute every metric in a single call.
 *
 * @param trades       Closed trade records
 * @param equityCurve  Portfolio value at the close of each hourly candle
 *                     (including unrealized P&L while in position)
 */
export function computeMetrics(
  trades: TradeForMetrics[],
  equityCurve: number[],
): Metrics {
  // Build hourly return series from equity curve
  const hourlyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev > 0) {
      hourlyReturns.push((equityCurve[i] - prev) / prev);
    }
  }

  const dd  = maxDrawdown(equityCurve);
  const wl  = avgWinLoss(trades);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  return {
    sharpe:             sharpeRatio(hourlyReturns),
    sortino:            sortinoRatio(hourlyReturns),
    maxDrawdownUsd:     dd.usd,
    maxDrawdownPct:     dd.pct,
    winRate:            winRate(trades),
    avgWin:             wl.avgWin,
    avgLoss:            wl.avgLoss,
    profitFactor:       profitFactor(trades),
    avgDurationHours:   avgDuration(trades),
    expectancyPerTrade: expectancyPerTrade(trades),
    numTrades:          trades.length,
    totalPnl,
  };
}
