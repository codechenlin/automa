/**
 * Multi-Timeframe Market Snapshot
 *
 * Fetches OHLC+V data from Binance at three timeframes in parallel and
 * derives a trend direction for each.  The result is returned by the
 * `fetch_market_context` tool so Conway always has timeframe context before
 * making a trading decision.
 *
 * Trend logic (per timeframe, last 4 candles):
 *   close[3] vs close[0]:  >+0.3% → up | <-0.3% → down | else → flat
 *
 * Confluence:
 *   3× up   → STRONG LONG BIAS
 *   2× up   → LONG BIAS (or WEAK LONG if one is down)
 *   mixed   → MIXED — wait for alignment
 *   2× down → SHORT BIAS (or WEAK SHORT if one is up)
 *   3× down → STRONG SHORT BIAS
 *
 * Momentum Acceleration (1h):
 *   momentumAccel = RSI[now] - RSI[4 bars ago]
 *   > +1.0  → RSI turning up  → safe to enter long
 *   < -1.0  → RSI still falling → DO NOT enter (catching a falling knife)
 *   ± 1.0   → flat momentum    → wait for confirmation
 *
 * Volume Confirmation (1h):
 *   volumeRatio = latestVolume / avg(20 bars)
 *   > 1.2   → volume confirms move
 *   0.8–1.2 → neutral (can trade, reduced size)
 *   < 0.8   → dead market, sit on hands
 */

import { toBinanceSymbol } from "./atr.js";
import type { Candle } from "./atr.js";

// ─── Types ─────────────────────────────────────────────────────

export type TrendDirection = "up" | "down" | "flat";

export interface TimeframeTrend {
  timeframe:  string;
  direction:  TrendDirection;
  openPrice:  number;
  closePrice: number;
  changePct:  number;
}

export interface MomentumSignal {
  /** Current RSI(14) value on the 1h timeframe. */
  rsi:          number;
  /** RSI[now] − RSI[now−4]: positive = turning up, negative = still falling. */
  momentumAccel: number;
  /** "up" (>+1), "down" (<−1), or "flat" (±1). */
  accelSignal:  "up" | "down" | "flat";
  /** Latest 1h volume ÷ 20-bar average. */
  volumeRatio:  number;
  /** "confirm" (>1.2), "neutral" (0.8–1.2), or "dead" (<0.8). */
  volumeSignal: "confirm" | "neutral" | "dead";
  /**
   * Combined long-entry assessment:
   *   GO    — accel up AND volume confirms or neutral
   *   WAIT  — accel flat, or accel up but volume neutral
   *   BLOCK — accel down (falling knife) OR volume dead
   */
  entrySignal:  "GO" | "WAIT" | "BLOCK";
}

export interface MultiTimeframeSnapshot {
  symbol:      string;
  binancePair: string;
  spotPrice:   number;
  trends: {
    "1h": TimeframeTrend;
    "4h": TimeframeTrend;
    "1d": TimeframeTrend;
  };
  confluence: string;
  momentum:   MomentumSignal;
  fetchedAt:  string;
}

// ─── Config ────────────────────────────────────────────────────

/** Price change below this threshold is classified as "flat" (percent). */
const FLAT_THRESHOLD_PCT = 0.3;

/** Number of candles used for trend direction (last N candles). */
const CANDLES_FOR_TREND = 4;

/**
 * Number of 1h candles fetched for RSI + volume calculation.
 * RSI(14) needs 15 closes; +4 lag for accel = 19 minimum.
 * Volume avg(20) needs 20. Fetch 25 for a comfortable buffer.
 */
const CANDLES_FOR_SIGNALS = 25;

// ─── Internal Candle Type with Volume ─────────────────────────

interface CandleWithVolume {
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

// ─── Candle Fetching ───────────────────────────────────────────

/**
 * Fetch OHLC candles from Binance (no volume).
 * Returns candles oldest → newest.
 */
export async function fetchCandles(
  binancePair: string,
  interval: "1h" | "4h" | "1d",
  limit: number,
): Promise<Candle[]> {
  const url =
    `https://api.binance.com/api/v3/klines` +
    `?symbol=${encodeURIComponent(binancePair)}` +
    `&interval=${interval}` +
    `&limit=${limit}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Binance ${res.status} for ${binancePair} ${interval}: ${body}`,
    );
  }

  // Binance kline: [openTime, open, high, low, close, vol, closeTime, ...]
  const rows = (await res.json()) as unknown[][];
  return rows.map((k) => ({
    high:  parseFloat(k[2] as string),
    low:   parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
  }));
}

/**
 * Fetch OHLCV candles from Binance (includes volume).
 * Returns candles oldest → newest.
 */
async function fetchCandlesWithVolume(
  binancePair: string,
  interval: "1h" | "4h" | "1d",
  limit: number,
): Promise<CandleWithVolume[]> {
  const url =
    `https://api.binance.com/api/v3/klines` +
    `?symbol=${encodeURIComponent(binancePair)}` +
    `&interval=${interval}` +
    `&limit=${limit}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Binance ${res.status} for ${binancePair} ${interval}: ${body}`,
    );
  }

  const rows = (await res.json()) as unknown[][];
  return rows.map((k) => ({
    high:   parseFloat(k[2] as string),
    low:    parseFloat(k[3] as string),
    close:  parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

// ─── Indicators ────────────────────────────────────────────────

/**
 * Wilder's RSI(14).
 * Returns an array of RSI values; first value corresponds to close[14].
 * Needs at least `period + 1` closes to produce any output.
 */
function computeRSI14(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain += Math.max(0, change);
    avgLoss += Math.max(0, -change);
  }
  avgGain /= period;
  avgLoss /= period;

  const rsi: number[] = [];
  rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
    rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));
  }

  return rsi;
}

/**
 * Compute the full MomentumSignal from 1h candles.
 * Returns null if there aren't enough candles.
 */
function computeMomentumSignal(
  candles: CandleWithVolume[],
): MomentumSignal | null {
  const closes  = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const rsiArr = computeRSI14(closes);
  if (rsiArr.length < 5) return null;      // need [now] and [now−4]
  if (volumes.length < 20) return null;    // need avg(20)

  // RSI
  const rsi          = rsiArr[rsiArr.length - 1];
  const rsiLag       = rsiArr[rsiArr.length - 5];   // 4 RSI bars ago
  const momentumAccel = rsi - rsiLag;

  const accelSignal: "up" | "down" | "flat" =
    momentumAccel > 1.0  ? "up" :
    momentumAccel < -1.0 ? "down" :
    "flat";

  // Volume ratio
  const last20Vols = volumes.slice(-20);
  const avgVol     = last20Vols.reduce((a, b) => a + b, 0) / last20Vols.length;
  const latestVol  = volumes[volumes.length - 1];
  const volumeRatio = latestVol / (avgVol || 1e-10);

  const volumeSignal: "confirm" | "neutral" | "dead" =
    volumeRatio > 1.2 ? "confirm" :
    volumeRatio < 0.8 ? "dead" :
    "neutral";

  // Combined entry signal
  let entrySignal: "GO" | "WAIT" | "BLOCK";
  if (accelSignal === "down" || volumeSignal === "dead") {
    entrySignal = "BLOCK";
  } else if (accelSignal === "up") {
    entrySignal = "GO";   // volume is confirm or neutral — always GO when accel is up
  } else {
    entrySignal = "WAIT"; // flat accel
  }

  return {
    rsi:           Math.round(rsi * 10) / 10,
    momentumAccel: Math.round(momentumAccel * 100) / 100,
    accelSignal,
    volumeRatio:   Math.round(volumeRatio * 100) / 100,
    volumeSignal,
    entrySignal,
  };
}

// ─── Trend Derivation ──────────────────────────────────────────

/**
 * Derive trend direction from a candle series.
 * Compares the close of the first candle to the close of the last.
 */
export function deriveTrend(
  candles: Candle[] | CandleWithVolume[],
  timeframe: string,
): TimeframeTrend {
  const open  = candles[0].close;
  const close = candles[candles.length - 1].close;
  const changePct = ((close - open) / open) * 100;

  let direction: TrendDirection;
  if (Math.abs(changePct) < FLAT_THRESHOLD_PCT) {
    direction = "flat";
  } else {
    direction = changePct > 0 ? "up" : "down";
  }

  return { timeframe, direction, openPrice: open, closePrice: close, changePct };
}

// ─── Confluence ────────────────────────────────────────────────

type TrendMap = { "1h": TimeframeTrend; "4h": TimeframeTrend; "1d": TimeframeTrend };

/**
 * Derive a human-readable confluence signal from the three trend directions.
 *
 * Conway should trade in the direction of confluence and stand aside when mixed.
 */
export function deriveConfluence(trends: TrendMap): string {
  const dirs = [
    trends["1h"].direction,
    trends["4h"].direction,
    trends["1d"].direction,
  ];
  const up   = dirs.filter((d) => d === "up").length;
  const down = dirs.filter((d) => d === "down").length;

  if (up === 3)               return "STRONG LONG BIAS — all 3 timeframes bullish";
  if (up === 2 && down === 0) return "LONG BIAS — 2 timeframes bullish, 1 flat";
  if (up === 2)               return "WEAK LONG BIAS — 2 bullish, 1 bearish";
  if (down === 3)             return "STRONG SHORT BIAS — all 3 timeframes bearish";
  if (down === 2 && up === 0) return "SHORT BIAS — 2 timeframes bearish, 1 flat";
  if (down === 2)             return "WEAK SHORT BIAS — 2 bearish, 1 bullish";
  return                           "MIXED — no confluence, wait for alignment";
}

// ─── Main Export ───────────────────────────────────────────────

/**
 * Fetch spot price + 1h / 4h / 1d trend context for a symbol.
 * Also computes RSI momentum acceleration and volume ratio on the 1h.
 * All three timeframe requests are fired in parallel.
 */
export async function fetchMultiTimeframeSnapshot(
  symbol: string,
): Promise<MultiTimeframeSnapshot> {
  const pair = toBinanceSymbol(symbol);

  // 1h: fetch CANDLES_FOR_SIGNALS candles with volume (for RSI + vol ratio).
  // 4h and 1d: fetch CANDLES_FOR_TREND candles (trend only, no extra needed).
  const [c1h_full, c4h, c1d] = await Promise.all([
    fetchCandlesWithVolume(pair, "1h", CANDLES_FOR_SIGNALS),
    fetchCandles(pair, "4h", CANDLES_FOR_TREND),
    fetchCandles(pair, "1d", CANDLES_FOR_TREND),
  ]);

  // Use only the last 4 1h candles for the trend reading (same window as other TFs).
  const c1h_trend = c1h_full.slice(-CANDLES_FOR_TREND);

  const trends: TrendMap = {
    "1h": deriveTrend(c1h_trend, "1h"),
    "4h": deriveTrend(c4h, "4h"),
    "1d": deriveTrend(c1d, "1d"),
  };

  // Compute momentum signal from all 25 1h candles.
  const momentumRaw = computeMomentumSignal(c1h_full);
  const momentum: MomentumSignal = momentumRaw ?? {
    rsi:           0,
    momentumAccel: 0,
    accelSignal:   "flat",
    volumeRatio:   1,
    volumeSignal:  "neutral",
    entrySignal:   "WAIT",
  };

  return {
    symbol:      symbol.toUpperCase(),
    binancePair: pair,
    spotPrice:   c1h_full[c1h_full.length - 1].close,
    trends,
    confluence:  deriveConfluence(trends),
    momentum,
    fetchedAt:   new Date().toISOString(),
  };
}
