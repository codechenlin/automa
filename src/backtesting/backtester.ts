/**
 * Conway Strategy Backtester
 *
 * Simulates Conway's mean-reversion long-only strategy on historical
 * 1h OHLC candles sourced from Binance.
 *
 * Entry  : RSI(14) < rsiEntry  AND  %B(20) < bbPctEntry
 * Exits  : stop loss | take profit | RSI overbought | time limit | end-of-data
 *
 * Position sizing: $100 × ($50 / ATR14), clamped $10–$500
 * Starting virtual capital: $1,000 (matches SESSION_START_BALANCE_USDC)
 */

import { atrPositionSize, toBinanceSymbol } from "../trading/atr.js";
import { computeMetrics, type Metrics, type TradeForMetrics } from "./metrics.js";

// ─── Candle Type ─────────────────────────────────────────────────

/** Full OHLCV candle with open-time timestamp (unix ms). */
export interface OHLCVCandle {
  timestamp: number;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume?:   number;   // present when fetched from Binance or a volume-bearing CSV
}

// ─── Strategy Parameters ─────────────────────────────────────────

export interface BacktestParams {
  /** RSI(14) must be below this to trigger a long entry. */
  rsiEntry:       number;
  /** RSI(14) must be above this to trigger an RSI-based exit. */
  rsiExit:        number;
  /**
   * Bollinger %B must be below this to trigger entry.
   * Formula: %B = (close − lowerBand) / (upperBand − lowerBand) × 100
   *   100 = price at upper band
   *     0 = price at lower band
   *   < 0 = price below lower band (more extreme oversold)
   */
  bbPctEntry:     number;
  /** Stop loss as % below entry price (e.g. 3 = −3%). */
  stopLossPct:    number;
  /** Take profit as % above entry price (e.g. 5 = +5%). */
  takeProfitPct:  number;
  /** Maximum trade duration; exit at close if exceeded. */
  timeLimitHours: number;
}

/** Conway's current live strategy parameters — used as baseline. */
export const DEFAULT_PARAMS: BacktestParams = {
  rsiEntry:       35,
  rsiExit:        65,
  bbPctEntry:     20,
  stopLossPct:    3,
  takeProfitPct:  5,
  timeLimitHours: 4,
};

// ─── Trade Record ────────────────────────────────────────────────

export type ExitReason =
  | "stop_loss"
  | "take_profit"
  | "rsi_exit"
  | "time_limit"
  | "end_of_data";

export interface Trade {
  entryIndex:    number;
  exitIndex:     number;
  entryTime:     number;   // unix ms
  exitTime:      number;   // unix ms
  entryPrice:    number;
  exitPrice:     number;
  size:          number;   // USD position size (ATR-based)
  pnl:           number;   // realized P&L in USD
  pnlPct:        number;   // P&L as % of position size
  durationHours: number;
  exitReason:    ExitReason;
  // Indicator snapshots at entry (for analysis)
  entryRsi:    number;
  entryBbPct:  number;
  entryAtr:    number;
}

// ─── Backtest Result ─────────────────────────────────────────────

export interface BacktestResult {
  symbol:      string;
  strategy?:   string;                      // "A" | "B_trend" | "C" | "D" | "E_range" …
  params:      BacktestParams;
  extra?:      Record<string, unknown>;     // strategy-specific params beyond BacktestParams
  trades:      Trade[];
  equityCurve: number[];   // portfolio value at close of each candle (post-warmup)
  metrics:     Metrics;
  candleCount: number;
  ranAt:       string;
}

// ─── Indicator Constants ─────────────────────────────────────────

const RSI_PERIOD = 14;
const BB_PERIOD  = 20;
const BB_MULT    = 2;
const ATR_PERIOD = 14;

/**
 * Minimum candles needed before the first trade can be evaluated.
 * Needs (BB_PERIOD=20) for %B, (RSI_PERIOD+1=15) for RSI, (ATR_PERIOD+1=15) for ATR.
 */
export const WARMUP_BARS = Math.max(RSI_PERIOD + 1, BB_PERIOD, ATR_PERIOD + 1); // 20

// ─── Indicator Calculations ──────────────────────────────────────

/**
 * Simple-SMA-seeded RSI(14).
 * endIdx is the index of the current (most recent) candle.
 */
function calcRsi(
  candles: OHLCVCandle[],
  period:  number,
  endIdx:  number,
): number {
  if (endIdx < period) return 50; // not enough data → neutral

  let gains = 0;
  let losses = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) gains += d;
    else       losses -= d;
  }
  if (losses === 0) return 100;
  if (gains  === 0) return 0;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/**
 * Bollinger %B(20, 2σ).
 * %B = (close − lower) / (upper − lower) × 100
 * Negative values mean price is below the lower band.
 */
function calcBbPct(
  candles: OHLCVCandle[],
  period:  number,
  mult:    number,
  endIdx:  number,
): number {
  if (endIdx < period - 1) return 50;

  const start = endIdx - period + 1;
  let sum = 0;
  for (let i = start; i <= endIdx; i++) sum += candles[i].close;
  const mean = sum / period;

  let varSum = 0;
  for (let i = start; i <= endIdx; i++) varSum += (candles[i].close - mean) ** 2;
  const std = Math.sqrt(varSum / period);

  if (std === 0) return 50;
  const upper = mean + mult * std;
  const lower = mean - mult * std;
  return ((candles[endIdx].close - lower) / (upper - lower)) * 100;
}

/**
 * ATR(14) — simple mean of True Range over the last `period` bars.
 * TR = max(H−L, |H−prevC|, |L−prevC|)
 */
function calcAtr(
  candles: OHLCVCandle[],
  period:  number,
  endIdx:  number,
): number {
  if (endIdx < period) return 0;

  let trSum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const prev = candles[i - 1].close;
    trSum += Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prev),
      Math.abs(candles[i].low  - prev),
    );
  }
  return trSum / period;
}

// ─── Core Backtester ─────────────────────────────────────────────

const INITIAL_EQUITY = 1_000; // $1,000 — matches SESSION_START_BALANCE_USDC
const MS_PER_HOUR    = 3_600_000;

/**
 * Run a single backtest over the provided candles with the given params.
 *
 * Exit priority (checked in order each candle):
 *   1. Stop loss    — intracandle low  ≤ entryPrice × (1 − SL%)
 *   2. Take profit  — intracandle high ≥ entryPrice × (1 + TP%)
 *   3. RSI exit     — RSI(14) at close ≥ rsiExit
 *   4. Time limit   — elapsed time     ≥ timeLimitHours
 *   5. End of data  — last candle in series
 *
 * Stop/TP exits use the exact barrier price (not close) for realism.
 */
export function backtest(
  candles: OHLCVCandle[],
  params:  BacktestParams = DEFAULT_PARAMS,
  symbol = "UNKNOWN",
): BacktestResult {
  const {
    rsiEntry, rsiExit, bbPctEntry,
    stopLossPct, takeProfitPct, timeLimitHours,
  } = params;

  const trades: Trade[]        = [];
  const equityCurve: number[]  = [INITIAL_EQUITY];
  let cashEquity = INITIAL_EQUITY;

  // Open-position state
  let inPosition   = false;
  let entryIdx     = 0;
  let entryPrice   = 0;
  let entryTime    = 0;
  let positionSize = 0;
  let entryRsi     = 0;
  let entryBbPct   = 0;
  let entryAtr     = 0;

  const stopMult    = 1 - stopLossPct    / 100;
  const tpMult      = 1 + takeProfitPct  / 100;
  const timeLimitMs = timeLimitHours * MS_PER_HOUR;

  for (let i = WARMUP_BARS; i < candles.length; i++) {
    const c = candles[i];

    // ── Check exit conditions ─────────────────────────────────────
    if (inPosition) {
      const stopPrice = entryPrice * stopMult;
      const tpPrice   = entryPrice * tpMult;
      const elapsed   = c.timestamp - entryTime;

      let exitPrice:  number | null = null;
      let exitReason: ExitReason | null = null;

      if (c.low <= stopPrice) {
        // Price touched stop intracandle — exit at the stop level
        exitPrice  = stopPrice;
        exitReason = "stop_loss";
      } else if (c.high >= tpPrice) {
        // Price touched take-profit intracandle — exit at TP level
        exitPrice  = tpPrice;
        exitReason = "take_profit";
      } else if (calcRsi(candles, RSI_PERIOD, i) >= rsiExit) {
        exitPrice  = c.close;
        exitReason = "rsi_exit";
      } else if (elapsed >= timeLimitMs) {
        exitPrice  = c.close;
        exitReason = "time_limit";
      } else if (i === candles.length - 1) {
        exitPrice  = c.close;
        exitReason = "end_of_data";
      }

      if (exitPrice !== null && exitReason !== null) {
        const pnlFrac     = (exitPrice - entryPrice) / entryPrice;
        const pnl         = positionSize * pnlFrac;
        const durationHrs = elapsed / MS_PER_HOUR;

        trades.push({
          entryIndex:    entryIdx,
          exitIndex:     i,
          entryTime,
          exitTime:      c.timestamp,
          entryPrice,
          exitPrice,
          size:          positionSize,
          pnl,
          pnlPct:        pnlFrac * 100,
          durationHours: durationHrs,
          exitReason,
          entryRsi,
          entryBbPct,
          entryAtr,
        });

        cashEquity += pnl;
        inPosition  = false;
      }
    }

    // ── Check entry conditions (also fires in the same candle after exit) ──
    if (!inPosition) {
      const currentRsi   = calcRsi(candles, RSI_PERIOD, i);
      const currentBbPct = calcBbPct(candles, BB_PERIOD, BB_MULT, i);
      const currentAtr   = calcAtr(candles, ATR_PERIOD, i);

      if (currentRsi < rsiEntry && currentBbPct < bbPctEntry) {
        inPosition   = true;
        entryIdx     = i;
        entryPrice   = c.close;   // fill at candle close on signal bar
        entryTime    = c.timestamp;
        entryRsi     = currentRsi;
        entryBbPct   = currentBbPct;
        entryAtr     = currentAtr;
        // Position size: $100 × ($50 / ATR), clamped $10–$500
        positionSize = atrPositionSize(currentAtr);
      }
    }

    // ── Record equity at candle close ──────────────────────────────
    if (inPosition) {
      const unrealized = positionSize * (c.close - entryPrice) / entryPrice;
      equityCurve.push(cashEquity + unrealized);
    } else {
      equityCurve.push(cashEquity);
    }
  }

  // ── Compute metrics ──────────────────────────────────────────────
  const tradeMetas: TradeForMetrics[] = trades.map((t) => ({
    pnl:           t.pnl,
    pnlPct:        t.pnlPct,
    durationHours: t.durationHours,
  }));

  return {
    symbol:      symbol.toUpperCase(),
    params,
    trades,
    equityCurve,
    metrics:     computeMetrics(tradeMetas, equityCurve),
    candleCount: candles.length,
    ranAt:       new Date().toISOString(),
  };
}

// ─── Data Fetcher ─────────────────────────────────────────────────

// ─── Data Fetching ────────────────────────────────────────────────

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 * Fetch historical OHLCV candles from Binance (no API key needed).
 * Defaults to 1h interval, 500 candles ≈ 20 days.
 * Candles are returned oldest → newest.
 */
export async function fetchBacktestCandles(
  symbol:   string,
  limit   = 500,
  interval: CandleInterval = "1h",
): Promise<OHLCVCandle[]> {
  const pair = toBinanceSymbol(symbol);
  const url  =
    `https://api.binance.com/api/v3/klines` +
    `?symbol=${encodeURIComponent(pair)}` +
    `&interval=${interval}` +
    `&limit=${limit}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance API ${res.status} for ${pair} ${interval}: ${body}`);
  }

  // Binance kline: [openTime, open, high, low, close, vol, closeTime, ...]
  const rows = (await res.json()) as unknown[][];
  return rows.map((k) => ({
    timestamp: k[0] as number,
    open:      parseFloat(k[1] as string),
    high:      parseFloat(k[2] as string),
    low:       parseFloat(k[3] as string),
    close:     parseFloat(k[4] as string),
    volume:    parseFloat(k[5] as string),
  }));
}

// ─── CSV Reader ───────────────────────────────────────────────────

import { readFile } from "fs/promises";

/**
 * Load OHLCV candles from a local CSV file (no external parser needed).
 *
 * Expected header (case-insensitive):
 *   timestamp,open,high,low,close
 *
 * timestamp may be unix-ms, unix-s, or ISO-8601 string.
 * Lines starting with # are treated as comments and skipped.
 */
export async function loadCandlesFromCsv(path: string): Promise<OHLCVCandle[]> {
  const raw = await readFile(path, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) {
    throw new Error(`CSV "${path}" has no data rows`);
  }

  // Parse header to find column indices (case-insensitive)
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const idx = (name: string, required = true): number => {
    const i = header.indexOf(name);
    if (i === -1 && required) throw new Error(`CSV missing column "${name}"`);
    return i;
  };
  const tsIdx    = idx("timestamp");
  const openIdx  = idx("open");
  const highIdx  = idx("high");
  const lowIdx   = idx("low");
  const closeIdx = idx("close");
  const volIdx   = idx("volume", false);  // optional

  const candles: OHLCVCandle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const rawTs = cols[tsIdx].trim();

    // Detect timestamp format
    let timestamp: number;
    if (/^\d{10}$/.test(rawTs)) {
      timestamp = parseInt(rawTs, 10) * 1_000;     // unix-s → ms
    } else if (/^\d{13}$/.test(rawTs)) {
      timestamp = parseInt(rawTs, 10);              // already unix-ms
    } else {
      timestamp = new Date(rawTs).getTime();        // ISO-8601
    }

    if (isNaN(timestamp)) {
      throw new Error(`CSV line ${i + 1}: cannot parse timestamp "${rawTs}"`);
    }

    candles.push({
      timestamp,
      open:   parseFloat(cols[openIdx].trim()),
      high:   parseFloat(cols[highIdx].trim()),
      low:    parseFloat(cols[lowIdx].trim()),
      close:  parseFloat(cols[closeIdx].trim()),
      ...(volIdx >= 0 && cols[volIdx] ? { volume: parseFloat(cols[volIdx].trim()) } : {}),
    });
  }

  // Sort oldest → newest (defensive — most CSVs are already sorted)
  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
}
