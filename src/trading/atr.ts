/**
 * ATR (Average True Range) — Position Sizing Helper
 *
 * Calculates ATR(14) from hourly candles sourced from the Binance
 * public API (no auth required). Conway uses ATR to size positions
 * inversely proportional to volatility:
 *
 *   size = $100 × ($50 / current_ATR)
 *
 * High vol → smaller size.  Low vol → larger size.
 */

// ─── Types ─────────────────────────────────────────────────────

export interface Candle {
  high: number;
  low: number;
  close: number;
}

// ─── Core Calculation ──────────────────────────────────────────

/**
 * True Range for one candle relative to the previous close.
 * TR = max(high−low, |high−prevClose|, |low−prevClose|)
 */
export function trueRange(candle: Candle, prevClose: number): number {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - prevClose),
    Math.abs(candle.low - prevClose),
  );
}

/**
 * ATR(period) — simple average of True Range over `period` bars.
 *
 * Requires at least (period + 1) candles: one extra is needed to
 * compute the first TR's prevClose reference.
 *
 * With only 15 candles for ATR(14) this is the standard seed
 * calculation (Wilder uses SMA for the first value anyway).
 */
export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) {
    throw new Error(
      `ATR(${period}) requires ≥${period + 1} candles, got ${candles.length}`,
    );
  }

  // Work only with the most-recent (period+1) candles
  const slice = candles.slice(-(period + 1));

  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += trueRange(slice[i], slice[i - 1].close);
  }
  return trSum / period;
}

// ─── Symbol Mapping ────────────────────────────────────────────

/**
 * Map common on-chain token names to Binance spot pair symbols.
 * WETH and CBBTC are Base chain wrappers — map them to their
 * underlying CEX equivalents for price data.
 */
export function toBinanceSymbol(symbol: string): string {
  const s = symbol.toUpperCase().trim();
  const ALIASES: Record<string, string> = {
    WETH:  "ETHUSDT",
    CBBTC: "BTCUSDT",
    WBTC:  "BTCUSDT",
    ETH:   "ETHUSDT",
    BTC:   "BTCUSDT",
    SOL:   "SOLUSDT",
    ARB:   "ARBUSDT",
    OP:    "OPUSDT",
    MATIC: "MATICUSDT",
    LINK:  "LINKUSDT",
    UNI:   "UNIUSDT",
  };
  return ALIASES[s] ?? `${s}USDT`;
}

// ─── Data Fetching ─────────────────────────────────────────────

/**
 * Fetch `limit` hourly OHLC candles from the Binance public klines
 * endpoint (no API key required).  Returns candles oldest→newest.
 */
export async function fetchHourlyCandles(
  symbol: string,
  limit = 15,
): Promise<Candle[]> {
  const pair = toBinanceSymbol(symbol);
  const url =
    `https://api.binance.com/api/v3/klines` +
    `?symbol=${encodeURIComponent(pair)}&interval=1h&limit=${limit}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance API ${res.status} for ${pair}: ${body}`);
  }

  // Binance kline array: [openTime, open, high, low, close, vol, closeTime, ...]
  const rows = (await res.json()) as unknown[][];
  return rows.map((k) => ({
    high:  parseFloat(k[2] as string),
    low:   parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
  }));
}

// ─── Position Sizing ───────────────────────────────────────────

/**
 * Recommended position size using the ATR-inverse formula.
 *
 *   size = baseSize × (baseAtr / currentAtr)
 *
 * Defaults: $100 base size at ATR = $50.
 * Clamped to [minSize, maxSize] to prevent extreme values.
 */
export function atrPositionSize(
  currentAtr: number,
  baseSize = 100,
  baseAtr = 50,
  minSize = 10,
  maxSize = 500,
): number {
  if (currentAtr <= 0) return baseSize;
  const raw = baseSize * (baseAtr / currentAtr);
  return Math.max(minSize, Math.min(maxSize, Math.round(raw * 100) / 100));
}
