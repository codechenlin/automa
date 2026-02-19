#!/usr/bin/env node
/**
 * Conway Backtesting CLI
 *
 * Commands:
 *   backtest   — single run with baseline parameters
 *   optimize   — 5,120-combo grid search (original BB% range) + 15m validation
 *   optimize2  — multi-strategy grid search (A/B/C/D/E) + comparison table
 *   report     — detailed performance report with exit breakdown
 *
 * Flags:
 *   --symbol      <SYM>   Token to trade (default: ETH)
 *   --candles     <N>     Number of 1h candles (default: 500)
 *   --candles-15m <N>     Number of 15m candles for validation (default: 1000)
 *   --csv         <path>  Load candles from local CSV instead of Binance
 */

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import chalk from "chalk";

import {
  runAllStrategies,
  GRID_COUNTS,
  type MultiStrategyResult,
  type ComparisonRow,
  type ValidatedResult as ValidatedResult2,
} from "./optimizer2.js";

import {
  backtest,
  fetchBacktestCandles,
  loadCandlesFromCsv,
  DEFAULT_PARAMS,
  type BacktestResult,
  type Trade,
  type OHLCVCandle,
} from "./backtester.js";

import {
  runOptimizer,
  TOTAL_COMBINATIONS,
  type OptimizerResult,
  type ValidatedResult,
} from "./optimizer.js";

import type { Metrics } from "./metrics.js";

// ─── Arg Parsing ──────────────────────────────────────────────────

interface CliArgs {
  command:     string;
  symbol:      string;
  candles:     number;
  candles15m:  number;
  csvPath:     string | null;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const flag  = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };

  return {
    command:    argv[0] ?? "backtest",
    symbol:     flag("--symbol") ?? "ETH",
    candles:    parseInt(flag("--candles")    ?? "500",  10),
    candles15m: parseInt(flag("--candles-15m") ?? "1000", 10),
    csvPath:    flag("--csv"),
  };
}

// ─── Table Utilities ──────────────────────────────────────────────

const SEP = "  ";

function pad(
  val:   string | number,
  width: number,
  align: "l" | "r" = "r",
): string {
  const s = String(val);
  if (s.length >= width) return s.slice(0, width);
  return align === "r" ? s.padStart(width) : s.padEnd(width);
}

function hr(w: number, char = "─"): string {
  return char.repeat(w);
}

function fmt(n: number, dp = 2): string {
  return n.toFixed(dp);
}

function fmtPnl(n: number, dp = 2): string {
  const s = "$" + Math.abs(n).toFixed(dp);
  return n >= 0 ? chalk.green("+" + s) : chalk.red("-" + s);
}

function fmtPf(pf: number): string {
  return isFinite(pf) ? pf.toFixed(2) : "∞";
}

// ─── Trade Table ──────────────────────────────────────────────────

function printTradesTable(trades: Trade[]): void {
  if (trades.length === 0) {
    console.log(chalk.yellow("  (no trades executed)\n"));
    return;
  }

  type Col = { label: string; w: number; align: "l" | "r" };
  const cols: Col[] = [
    { label: "#",         w: 4,  align: "r" },
    { label: "Entry",     w: 16, align: "l" },
    { label: "Exit",      w: 16, align: "l" },
    { label: "EntryPx",  w: 10, align: "r" },
    { label: "ExitPx",   w: 10, align: "r" },
    { label: "Size$",    w: 7,  align: "r" },
    { label: "P&L$",     w: 9,  align: "r" },
    { label: "P&L%",     w: 7,  align: "r" },
    { label: "Hrs",      w: 5,  align: "r" },
    { label: "Reason",   w: 11, align: "l" },
    { label: "RSI",      w: 5,  align: "r" },
    { label: "BB%",      w: 6,  align: "r" },
  ];

  const header  = cols.map((c) => pad(c.label, c.w, c.align)).join(SEP);
  const divider = cols.map((c) => hr(c.w)).join(SEP);

  console.log(chalk.bold(header));
  console.log(chalk.dim(divider));

  for (let i = 0; i < trades.length; i++) {
    const t   = trades[i];
    const win = t.pnl >= 0;
    const pnlColor = win ? chalk.green : chalk.red;

    const cells = [
      pad(i + 1,                                    cols[0].w),
      pad(ts(t.entryTime),                          cols[1].w, "l"),
      pad(ts(t.exitTime),                           cols[2].w, "l"),
      pad(fmt(t.entryPrice),                        cols[3].w),
      pad(fmt(t.exitPrice),                         cols[4].w),
      pad(fmt(t.size, 0),                           cols[5].w),
      pnlColor(pad(fmt(t.pnl),                      cols[6].w)),
      pnlColor(pad(fmt(t.pnlPct) + "%",            cols[7].w)),
      pad(fmt(t.durationHours, 1),                  cols[8].w),
      pad(t.exitReason,                             cols[9].w,  "l"),
      pad(fmt(t.entryRsi, 1),                       cols[10].w),
      pad(fmt(t.entryBbPct, 1),                     cols[11].w),
    ];

    console.log(cells.join(SEP));
  }

  console.log(chalk.dim(divider));
}

function ts(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

// ─── Metrics Summary ──────────────────────────────────────────────

function printMetrics(m: Metrics, label = "Performance Summary"): void {
  console.log();
  console.log(chalk.bold(label));
  console.log(chalk.dim(hr(52)));

  const row = (label: string, value: string) =>
    console.log(`  ${label.padEnd(24)} ${value}`);

  row("Total P&L",          fmtPnl(m.totalPnl));
  row("# Trades",           String(m.numTrades));
  row("Win Rate",           fmt(m.winRate, 1) + "%");
  row("Avg Win",            chalk.green("$" + fmt(m.avgWin)));
  row("Avg Loss",           chalk.red( "$" + fmt(m.avgLoss)));
  row("Profit Factor",      fmtPf(m.profitFactor));
  row("Expectancy / Trade", "$" + fmt(m.expectancyPerTrade));
  row("Avg Duration",       fmt(m.avgDurationHours, 1) + "h");
  row("Sharpe (ann.)",      fmt(m.sharpe, 3));
  row("Sortino (ann.)",     fmt(m.sortino, 3));
  row("Max Drawdown",       chalk.red("$" + fmt(m.maxDrawdownUsd) + "  (" + fmt(m.maxDrawdownPct, 1) + "%)"));

  console.log(chalk.dim(hr(52)));
}

// ─── Params Block ─────────────────────────────────────────────────

function printParams(p: typeof DEFAULT_PARAMS): void {
  console.log(chalk.bold("Parameters"));
  console.log(chalk.dim(hr(40)));
  console.log(`  RSI Entry    < ${p.rsiEntry}`);
  console.log(`  RSI Exit     > ${p.rsiExit}`);
  console.log(`  BB%B Entry   < ${p.bbPctEntry}%`);
  console.log(`  Stop Loss      ${p.stopLossPct}%`);
  console.log(`  Take Profit    ${p.takeProfitPct}%`);
  console.log(`  Time Limit     ${p.timeLimitHours}h`);
  console.log(chalk.dim(hr(40)));
}

// ─── Optimizer Table ──────────────────────────────────────────────

function printOptimizerTable(
  results:   BacktestResult[],
  title:     string,
  timeframe: string,
): void {
  type Col = { label: string; w: number };
  const cols: Col[] = [
    { label: "#",       w: 4  },
    { label: "Sharpe",  w: 7  },
    { label: "Sortino", w: 7  },
    { label: "WinRate", w: 8  },
    { label: "P&L$",    w: 9  },
    { label: "MaxDD%",  w: 7  },
    { label: "PF",      w: 6  },
    { label: "Trades",  w: 6  },
    { label: "AvgHrs",  w: 6  },
    { label: "RSIen",   w: 5  },
    { label: "RSIex",   w: 5  },
    { label: "BB%en",   w: 6  },
    { label: "SL%",     w: 4  },
    { label: "TP%",     w: 4  },
    { label: "TimeH",   w: 5  },
  ];

  const header  = cols.map((c) => pad(c.label, c.w)).join(SEP);
  const divider = cols.map((c) => hr(c.w)).join(SEP);

  console.log();
  console.log(chalk.bold(`${title}  ${chalk.dim("[" + timeframe + "]")}`));
  console.log(chalk.bold(header));
  console.log(chalk.dim(divider));

  results.forEach((r, i) => {
    const { params: p, metrics: m } = r;
    const cells = [
      pad(i + 1,                           cols[0].w),
      pad(fmt(m.sharpe),                   cols[1].w),
      pad(fmt(m.sortino),                  cols[2].w),
      pad(fmt(m.winRate, 1) + "%",         cols[3].w),
      (m.totalPnl >= 0 ? chalk.green : chalk.red)(pad(fmt(m.totalPnl), cols[4].w)),
      pad(fmt(m.maxDrawdownPct, 1) + "%",  cols[5].w),
      pad(fmtPf(m.profitFactor),           cols[6].w),
      pad(m.numTrades,                     cols[7].w),
      pad(fmt(m.avgDurationHours, 1),      cols[8].w),
      pad(p.rsiEntry,                      cols[9].w),
      pad(p.rsiExit,                       cols[10].w),
      pad(p.bbPctEntry,                    cols[11].w),
      pad(p.stopLossPct,                   cols[12].w),
      pad(p.takeProfitPct,                 cols[13].w),
      pad(p.timeLimitHours,               cols[14].w),
    ];
    console.log(cells.join(SEP));
  });

  console.log(chalk.dim(divider));
}

// ─── Validation Table (1h vs 15m side-by-side) ───────────────────

function printValidationTable(validated: ValidatedResult[]): void {
  console.log();
  console.log(chalk.bold("Cross-Validation: 1h → 15m"));
  console.log(chalk.dim(hr(90)));

  type Col = { label: string; w: number };
  const cols: Col[] = [
    { label: "#",          w: 4  },
    { label: "Params",     w: 26 },
    { label: "1h Sharpe",  w: 9  },
    { label: "15m Sharpe", w: 10 },
    { label: "1h WinR",   w: 8  },
    { label: "15m WinR",  w: 8  },
    { label: "1h P&L$",   w: 9  },
    { label: "15m P&L$",  w: 9  },
    { label: "15m DD%",   w: 7  },
  ];

  const header  = cols.map((c) => pad(c.label, c.w)).join(SEP);
  const divider = cols.map((c) => hr(c.w)).join(SEP);

  console.log(chalk.bold(header));
  console.log(chalk.dim(divider));

  for (const v of validated) {
    const { params: p, result1h: r1, result15m: r15 } = v;
    const paramStr =
      `RSI${p.rsiEntry}/${p.rsiExit} BB${p.bbPctEntry}% SL${p.stopLossPct} TP${p.takeProfitPct} T${p.timeLimitHours}h`;
    const pnlColor1  = r1.metrics.totalPnl  >= 0 ? chalk.green : chalk.red;
    const pnlColor15 = r15.metrics.totalPnl >= 0 ? chalk.green : chalk.red;

    const cells = [
      pad(v.rank,                                cols[0].w),
      pad(paramStr,                              cols[1].w, "l"),
      pad(fmt(r1.metrics.sharpe),               cols[2].w),
      pad(fmt(r15.metrics.sharpe),              cols[3].w),
      pad(fmt(r1.metrics.winRate, 1) + "%",     cols[4].w),
      pad(fmt(r15.metrics.winRate, 1) + "%",    cols[5].w),
      pnlColor1(pad(fmt(r1.metrics.totalPnl),   cols[6].w)),
      pnlColor15(pad(fmt(r15.metrics.totalPnl), cols[7].w)),
      pad(fmt(r15.metrics.maxDrawdownPct, 1) + "%", cols[8].w),
    ];
    console.log(cells.join(SEP));
  }

  console.log(chalk.dim(divider));
}

// ─── Exit Reason Breakdown ────────────────────────────────────────

function printExitBreakdown(trades: Trade[]): void {
  if (trades.length === 0) return;

  const reasons: Record<string, number> = {};
  for (const t of trades) {
    reasons[t.exitReason] = (reasons[t.exitReason] ?? 0) + 1;
  }

  console.log();
  console.log(chalk.bold("Exit Reason Breakdown"));
  console.log(chalk.dim(hr(40)));
  for (const [reason, count] of Object.entries(reasons)) {
    const pct = ((count / trades.length) * 100).toFixed(1);
    console.log(`  ${reason.padEnd(20)} ${String(count).padStart(4)}  (${pct}%)`);
  }
  console.log(chalk.dim(hr(40)));
}

// ─── Candle Loader Helper ─────────────────────────────────────────

async function loadCandles(
  args:     CliArgs,
  interval: "1h" | "15m" = "1h",
  limit?:   number,
): Promise<OHLCVCandle[]> {
  if (args.csvPath) {
    console.log(chalk.dim(`  Loading candles from CSV: ${args.csvPath}`));
    return loadCandlesFromCsv(args.csvPath);
  }
  const n = limit ?? (interval === "15m" ? args.candles15m : args.candles);
  console.log(chalk.dim(`  Fetching ${n} × ${interval} candles for ${args.symbol.toUpperCase()}...`));
  return fetchBacktestCandles(args.symbol, n, interval);
}

// ─── Command: backtest ────────────────────────────────────────────

async function cmdBacktest(args: CliArgs): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan(`═══ Conway Backtester — ${args.symbol.toUpperCase()} ═══`));

  const candles = await loadCandles(args);
  console.log(chalk.dim(`  ${candles.length} candles loaded. Running backtest...\n`));

  printParams(DEFAULT_PARAMS);
  console.log();

  const result = backtest(candles, DEFAULT_PARAMS, args.symbol);

  console.log(chalk.bold(`Trades  (${result.metrics.numTrades})`));
  printTradesTable(result.trades);
  printMetrics(result.metrics);
  console.log();
}

// ─── Command: optimize ────────────────────────────────────────────

async function cmdOptimize(args: CliArgs): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan(`═══ Conway Optimizer — ${args.symbol.toUpperCase()} ═══`));
  console.log(chalk.dim(`  ${TOTAL_COMBINATIONS} parameter combinations`));

  const result = await runOptimizer(
    args.symbol,
    args.candles,
    args.candles15m,
    10,
    (done, total) => {
      const pct = Math.floor((done / total) * 100);
      if (pct % 10 === 0) {
        process.stdout.write(`\r  Phase 1: ${pct}%  (${done}/${total} combos)`);
      }
    },
  );
  process.stdout.write("\r" + " ".repeat(50) + "\r");

  // Phase 1 table
  printOptimizerTable(result.top10, "Phase 1 — Grid Search (1h)", "1h");

  // Phase 2 validation table
  printValidationTable(result.validated);

  // Top 5 console summary
  console.log();
  console.log(chalk.bold("Top 5 Parameter Sets (1h Sharpe-ranked)"));
  console.log(chalk.dim(hr(60)));
  result.top10.slice(0, 5).forEach((r, i) => {
    const { params: p, metrics: m } = r;
    console.log(
      `  ${i + 1}.  ` +
      chalk.yellow(`RSI ${p.rsiEntry}/${p.rsiExit}`) + "  " +
      chalk.cyan(`BB% ${p.bbPctEntry}`) + "  " +
      `SL ${p.stopLossPct}%  TP ${p.takeProfitPct}%  T ${p.timeLimitHours}h` +
      "  →  " +
      `Sharpe ${chalk.bold(fmt(m.sharpe))}  ` +
      `WinRate ${fmt(m.winRate, 1)}%  ` +
      fmtPnl(m.totalPnl),
    );
  });
  console.log(chalk.dim(hr(60)));
  console.log(
    chalk.dim(
      `\n  ${result.validResults}/${result.totalCombinations} combos with trades` +
      `  |  1h: ${result.candleCount1h} candles` +
      `  |  15m: ${result.candleCount15m} candles` +
      `  |  ${result.ranAt}`,
    ),
  );

  // Save to data/backtest_results.json
  await saveResults(result);
}

// ─── Command: report ──────────────────────────────────────────────

async function cmdReport(args: CliArgs): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan(`═══ Conway Performance Report — ${args.symbol.toUpperCase()} ═══`));

  const candles = await loadCandles(args);
  console.log(chalk.dim(`  ${candles.length} candles loaded.\n`));

  const result = backtest(candles, DEFAULT_PARAMS, args.symbol);
  const m = result.metrics;

  // Header block
  console.log(chalk.bold("═".repeat(60)));
  console.log(chalk.bold.cyan(`  Baseline Strategy Report — ${result.symbol}`));
  console.log(chalk.dim(`  Candles : ${result.candleCount} × 1h`));
  console.log(chalk.dim(`  Period  : ${ts(candles[0].timestamp)} → ${ts(candles[candles.length - 1].timestamp)}`));
  console.log(chalk.dim(`  Run at  : ${result.ranAt}`));
  console.log(chalk.bold("═".repeat(60)));
  console.log();

  printParams(result.params);
  console.log();

  // Extended metrics
  const row = (label: string, value: string) =>
    console.log(`  ${label.padEnd(26)} ${value}`);

  console.log(chalk.bold("Full Metrics"));
  console.log(chalk.dim(hr(54)));
  row("Starting Capital",   "$1,000.00");
  row("Ending Capital",     "$" + fmt(1000 + m.totalPnl));
  row("Total P&L",          fmtPnl(m.totalPnl));
  row("# Trades",           String(m.numTrades));
  row("Win Rate",           fmt(m.winRate, 1) + "%");
  row("Avg Win",            chalk.green("$" + fmt(m.avgWin)));
  row("Avg Loss",           chalk.red("$" + fmt(m.avgLoss)));
  row("Profit Factor",      fmtPf(m.profitFactor));
  row("Expectancy / Trade", "$" + fmt(m.expectancyPerTrade));
  row("Avg Duration",       fmt(m.avgDurationHours, 1) + "h");
  if (result.trades.length > 0) {
    const maxDur = Math.max(...result.trades.map((t) => t.durationHours));
    row("Max Duration",     fmt(maxDur, 1) + "h");
  }
  row("Sharpe (ann.)",      fmt(m.sharpe, 3));
  row("Sortino (ann.)",     fmt(m.sortino, 3));
  row("Max Drawdown $",     chalk.red("$" + fmt(m.maxDrawdownUsd)));
  row("Max Drawdown %",     chalk.red(fmt(m.maxDrawdownPct, 1) + "%"));
  console.log(chalk.dim(hr(54)));

  printExitBreakdown(result.trades);

  console.log();
  console.log(chalk.bold(`All Trades  (${m.numTrades})`));
  printTradesTable(result.trades);
  console.log();
}

// ─── Command: optimize2 ──────────────────────────────────────────

function printComparisonTable(comparison: ComparisonRow[]): void {
  type Col = { label: string; w: number };
  const cols: Col[] = [
    { label: "Strategy",  w: 10 },
    { label: "Trades",    w: 6  },
    { label: "WinRate",   w: 8  },
    { label: "Sharpe",    w: 7  },
    { label: "Sortino",   w: 7  },
    { label: "MaxDD%",    w: 7  },
    { label: "P&L$",      w: 9  },
    { label: "AvgHrs",    w: 6  },
    { label: "Params",    w: 38 },
  ];

  const header  = cols.map((c) => pad(c.label, c.w)).join(SEP);
  const divider = cols.map((c) => hr(c.w)).join(SEP);

  console.log();
  console.log(chalk.bold("Strategy Comparison  (ranked by Sharpe)"));
  console.log(chalk.bold(header));
  console.log(chalk.dim(divider));

  for (const row of comparison) {
    const pnlColor = row.totalPnl >= 0 ? chalk.green : chalk.red;
    const cells = [
      pad(row.strategy,                              cols[0].w, "l"),
      pad(row.trades,                                cols[1].w),
      pad(fmt(row.winRate, 1) + "%",                 cols[2].w),
      pad(fmt(row.sharpe),                           cols[3].w),
      pad(fmt(row.sortino),                          cols[4].w),
      pad(fmt(row.maxDrawdownPct, 1) + "%",          cols[5].w),
      pnlColor(pad(fmt(row.totalPnl),               cols[6].w)),
      pad(fmt(row.avgDurationHours, 1),              cols[7].w),
      pad(row.paramSummary,                          cols[8].w, "l"),
    ];
    console.log(cells.join(SEP));
  }

  console.log(chalk.dim(divider));
}

function printValidation2Table(validated: ValidatedResult2[]): void {
  type Col = { label: string; w: number };
  const cols: Col[] = [
    { label: "Strategy",   w: 10 },
    { label: "#",          w: 2  },
    { label: "1h Sharpe",  w: 9  },
    { label: "15m Sharpe", w: 10 },
    { label: "1h WinR",    w: 8  },
    { label: "15m WinR",   w: 8  },
    { label: "1h P&L$",    w: 9  },
    { label: "15m P&L$",   w: 9  },
  ];

  const header  = cols.map((c) => pad(c.label, c.w)).join(SEP);
  const divider = cols.map((c) => hr(c.w)).join(SEP);

  console.log();
  console.log(chalk.bold("15m Cross-Validation  (top 3 per strategy)"));
  console.log(chalk.bold(header));
  console.log(chalk.dim(divider));

  for (const v of validated) {
    const { result1h: r1, result15m: r15 } = v;
    const c1  = r1.metrics.totalPnl  >= 0 ? chalk.green : chalk.red;
    const c15 = r15.metrics.totalPnl >= 0 ? chalk.green : chalk.red;
    const cells = [
      pad(v.strategy,                              cols[0].w, "l"),
      pad(v.rank,                                  cols[1].w),
      pad(fmt(r1.metrics.sharpe),                  cols[2].w),
      pad(fmt(r15.metrics.sharpe),                 cols[3].w),
      pad(fmt(r1.metrics.winRate, 1) + "%",        cols[4].w),
      pad(fmt(r15.metrics.winRate, 1) + "%",       cols[5].w),
      c1(pad(fmt(r1.metrics.totalPnl),             cols[6].w)),
      c15(pad(fmt(r15.metrics.totalPnl),           cols[7].w)),
    ];
    console.log(cells.join(SEP));
  }
  console.log(chalk.dim(divider));
}

async function saveResultsV2(result: MultiStrategyResult): Promise<void> {
  const dir  = "data";
  const path = `${dir}/backtest_results_v2.json`;
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const slim = (r: import("./backtester.js").BacktestResult) => ({
    symbol:      r.symbol,
    strategy:    r.strategy,
    params:      r.params,
    extra:       r.extra,
    metrics:     r.metrics,
    candleCount: r.candleCount,
    ranAt:       r.ranAt,
  });

  const payload = {
    symbol:         result.symbol,
    ranAt:          result.ranAt,
    gridCounts:     result.gridCounts,
    candleCount1h:  result.candleCount1h,
    candleCount15m: result.candleCount15m,
    baseline:       slim(result.baseline),
    top3: Object.fromEntries(
      Object.entries(result.top3).map(([s, rs]) => [s, rs.map(slim)]),
    ),
    validated: result.validated.map((v) => ({
      strategy: v.strategy,
      rank:     v.rank,
      "1h":     { metrics: v.result1h.metrics,  candleCount: v.result1h.candleCount },
      "15m":    { metrics: v.result15m.metrics, candleCount: v.result15m.candleCount },
    })),
    comparison: result.comparison.map(({ result: _, ...rest }) => rest),
    best: { strategy: result.best.strategy, params: result.best.paramSummary, metrics: result.best.result.metrics },
  };

  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log();
  console.log(chalk.green(`  ✓ Results saved → ${path}`));
}

async function cmdOptimize2(args: CliArgs): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan(`═══ Conway Multi-Strategy Optimizer v2 — ${args.symbol.toUpperCase()} ═══`));
  console.log(chalk.dim(`  ${GRID_COUNTS.total.toLocaleString()} total combinations across 5 strategies`));
  console.log(chalk.dim(`  A:${GRID_COUNTS.A}  B:${GRID_COUNTS.B}  C:${GRID_COUNTS.C}  D:${GRID_COUNTS.D}  E:${GRID_COUNTS.E}`));
  console.log();

  let currentLabel = "";
  let lastPct = -1;
  const result = await runAllStrategies(
    args.symbol,
    args.candles,
    args.candles15m,
    (label, done, total) => {
      if (label !== currentLabel) { currentLabel = label; lastPct = -1; }
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct && pct % 20 === 0) {
        process.stdout.write(`\r  [${label.padEnd(8)}] ${pct}%  (${done}/${total})`);
        lastPct = pct;
      }
    },
  );
  process.stdout.write("\r" + " ".repeat(60) + "\r");

  // Comparison table
  printComparisonTable(result.comparison);

  // 15m validation
  printValidation2Table(result.validated);

  // Top 5 strategies
  console.log();
  console.log(chalk.bold("Top 5 Strategies (by 1h Sharpe)"));
  console.log(chalk.dim(hr(70)));
  result.comparison.slice(0, 5).forEach((row, i) => {
    const pnlStr = row.totalPnl >= 0
      ? chalk.green(`+$${row.totalPnl.toFixed(2)}`)
      : chalk.red(`-$${Math.abs(row.totalPnl).toFixed(2)}`);
    console.log(
      `  ${i + 1}. ` +
      chalk.yellow(row.strategy.padEnd(10)) +
      `Sharpe ${chalk.bold(fmt(row.sharpe))}  ` +
      `WinRate ${fmt(row.winRate, 1)}%  ` +
      `${pnlStr}  ` +
      chalk.dim(row.paramSummary),
    );
  });
  console.log(chalk.dim(hr(70)));

  // Best recommendation
  const best = result.best;
  console.log();
  console.log(chalk.bold.green("━━━ RECOMMENDATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold(`  Best strategy: ${chalk.yellow(best.strategy)}`));
  console.log(`  Parameters:    ${best.paramSummary}`);
  console.log(`  Sharpe:        ${fmt(best.sharpe)}   Sortino: ${fmt(best.sortino)}`);
  console.log(`  Win rate:      ${fmt(best.winRate, 1)}%   Trades: ${best.trades}   Avg: ${fmt(best.avgDurationHours, 1)}h`);
  console.log(`  Total P&L:     ${best.totalPnl >= 0 ? chalk.green("+$" + fmt(best.totalPnl)) : chalk.red("-$" + fmt(Math.abs(best.totalPnl)))}`);
  console.log(`  Max Drawdown:  ${fmt(best.maxDrawdownPct, 1)}%`);
  console.log(chalk.bold.green("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log();

  // Save
  await saveResultsV2(result);

  // Metadata footer
  console.log(chalk.dim(
    `\n  1h: ${result.candleCount1h} candles  |  15m: ${result.candleCount15m} candles  |  ${result.ranAt}`,
  ));

  // openclaw event
  const evText =
    `Done: Multi-strategy backtest complete. Best: ${best.strategy} ` +
    `with ${best.paramSummary} → Sharpe ${fmt(best.sharpe)}, ` +
    `WinRate ${fmt(best.winRate, 1)}%, PnL $${fmt(best.totalPnl)}`;

  try {
    const { execSync } = await import("child_process");
    execSync(`openclaw system event --text "${evText.replace(/"/g, "'")}" --mode now`, { stdio: "inherit" });
  } catch {
    // openclaw not available in all environments — print the text anyway
    console.log(chalk.dim(`\n  [openclaw] ${evText}`));
  }
}

// ─── Save Results ─────────────────────────────────────────────────

async function saveResults(result: OptimizerResult): Promise<void> {
  const dir  = "data";
  const path = `${dir}/backtest_results.json`;

  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  // Serialize without the full trade arrays for compactness (keep metrics)
  const payload = {
    ...result,
    top10: result.top10.map((r) => ({
      symbol:      r.symbol,
      params:      r.params,
      metrics:     r.metrics,
      candleCount: r.candleCount,
      ranAt:       r.ranAt,
    })),
    validated: result.validated.map((v) => ({
      rank:   v.rank,
      params: v.params,
      "1h":   { metrics: v.result1h.metrics,  candleCount: v.result1h.candleCount },
      "15m":  { metrics: v.result15m.metrics, candleCount: v.result15m.candleCount },
    })),
  };

  await writeFile(path, JSON.stringify(payload, null, 2));
  console.log();
  console.log(chalk.green(`  ✓ Results saved → ${path}`));
}

// ─── Entry Point ──────────────────────────────────────────────────

const USAGE =
  "Usage: tsx src/backtesting/cli.ts <backtest|optimize|optimize2|report> " +
  "[--symbol ETH] [--candles 500] [--candles-15m 1000] [--csv path.csv]";

const args = parseArgs();

const commands: Record<string, (a: CliArgs) => Promise<void>> = {
  backtest:  cmdBacktest,
  optimize:  cmdOptimize,
  optimize2: cmdOptimize2,
  report:    cmdReport,
};

const handler = commands[args.command];
if (!handler) {
  console.error(chalk.red(`Unknown command: "${args.command}"`));
  console.error(USAGE);
  process.exit(1);
}

handler(args).catch((err: unknown) => {
  console.error(
    chalk.red("\nError:"),
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
