/**
 * Multi-Timeframe Market Snapshot
 *
 * Fetches OHLC data from Binance at three timeframes in parallel and
 * derives a trend direction for each.  The result is returned by the
 * `fetch_prices` tool so Conway always has timeframe context before
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
 */

import { toBinanceSymbol } from "./atr.js";
import type { Candle } from "./atr.js";

// ─── Types ─────────────────────────────────────────────────────

export type TrendDirection = "up" | "down" | "flat";

export interface TimeframeTrend {
  timeframe: string;
  direction: TrendDirection;
  openPrice: number;
  closePrice: number;
  changePct: number;
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
  fetchedAt:  string;
}

// ─── Config ────────────────────────────────────────────────────

/** Price change below this threshold is classified as "flat" (percent). */
const FLAT_THRESHOLD_PCT = 0.3;

/** Number of candles fetched per timeframe to compute trend. */
const CANDLES_PER_TIMEFRAME = 4;

// ─── Candle Fetching ───────────────────────────────────────────

/**
 * Fetch OHLC candles from Binance for any interval.
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

// ─── Trend Derivation ──────────────────────────────────────────

/**
 * Derive trend direction from a candle series.
 * Compares the close of the first candle to the close of the last.
 */
export function deriveTrend(
  candles: Candle[],
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

  if (up === 3)              return "STRONG LONG BIAS — all 3 timeframes bullish";
  if (up === 2 && down === 0) return "LONG BIAS — 2 timeframes bullish, 1 flat";
  if (up === 2)              return "WEAK LONG BIAS — 2 bullish, 1 bearish";
  if (down === 3)            return "STRONG SHORT BIAS — all 3 timeframes bearish";
  if (down === 2 && up === 0) return "SHORT BIAS — 2 timeframes bearish, 1 flat";
  if (down === 2)            return "WEAK SHORT BIAS — 2 bearish, 1 bullish";
  return                          "MIXED — no confluence, wait for alignment";
}

// ─── Main Export ───────────────────────────────────────────────

/**
 * Fetch spot price + 1h / 4h / 1d trend context for a symbol.
 * All three timeframe requests are fired in parallel.
 */
export async function fetchMultiTimeframeSnapshot(
  symbol: string,
): Promise<MultiTimeframeSnapshot> {
  const pair = toBinanceSymbol(symbol);

  const [c1h, c4h, c1d] = await Promise.all([
    fetchCandles(pair, "1h", CANDLES_PER_TIMEFRAME),
    fetchCandles(pair, "4h", CANDLES_PER_TIMEFRAME),
    fetchCandles(pair, "1d", CANDLES_PER_TIMEFRAME),
  ]);

  const trends: TrendMap = {
    "1h": deriveTrend(c1h, "1h"),
    "4h": deriveTrend(c4h, "4h"),
    "1d": deriveTrend(c1d, "1d"),
  };

  return {
    symbol:      symbol.toUpperCase(),
    binancePair: pair,
    spotPrice:   c1h[c1h.length - 1].close,
    trends,
    confluence:  deriveConfluence(trends),
    fetchedAt:   new Date().toISOString(),
  };
}
