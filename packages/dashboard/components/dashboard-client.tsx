"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AskResponse,
  LogsResponse,
  OverviewResponse,
  SerializedTurn,
} from "@/lib/shared/types";

const LOG_PAGE_SIZE = 40;

export function DashboardClient({ automatonName }: { automatonName: string }) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [fromInput, setFromInput] = useState(() =>
    toLocalDateTimeInput(new Date(Date.now() - 24 * 60 * 60 * 1000)),
  );
  const [toInput, setToInput] = useState("");
  const [liveModeEnabled, setLiveModeEnabled] = useState(true);

  const [logs, setLogs] = useState<SerializedTurn[]>([]);
  const [logsMeta, setLogsMeta] = useState("Loading logs...");
  const [logsLive, setLogsLive] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [question, setQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState("Ask a question to generate a summary from filtered logs.");
  const [askSources, setAskSources] = useState<AskResponse["sources"]>([]);
  const [asking, setAsking] = useState(false);

  const sentinelRef = useRef<HTMLParagraphElement | null>(null);
  const requestIdRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const streamCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const loadedRef = useRef(0);
  const totalRef = useRef(0);
  const logIdsRef = useRef<Set<string>>(new Set());
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const didFilterEffectRef = useRef(false);

  const setHasMoreState = useCallback((next: boolean) => {
    hasMoreRef.current = next;
    setHasMore(next);
  }, []);

  const setLoadingState = useCallback((next: boolean) => {
    loadingRef.current = next;
    setLoadingLogs(next);
  }, []);

  const setCounterMeta = useCallback((loaded: number, total: number, customText?: string) => {
    loadedRef.current = loaded;
    totalRef.current = total;
    if (customText) {
      setLogsMeta(customText);
      return;
    }
    setLogsMeta(`${loaded} of ${total} log entries loaded`);
  }, []);

  const stopLogStream = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const getFilterBaseParams = useCallback(() => {
    const params = new URLSearchParams();
    const q = search.trim();
    const fromIso = toIso(fromInput);
    const toIsoValue = toIso(toInput);

    if (q) params.set("q", q);
    if (fromIso) params.set("from", fromIso);
    if (!liveModeEnabled && toIsoValue) params.set("to", toIsoValue);
    if (stateFilter) params.set("state", stateFilter);

    return params;
  }, [fromInput, liveModeEnabled, search, stateFilter, toInput]);

  const appendLogs = useCallback((incoming: SerializedTurn[], prepend: boolean): number => {
    const fresh = incoming.filter((log) => {
      if (!log?.id) return false;
      if (logIdsRef.current.has(log.id)) return false;
      logIdsRef.current.add(log.id);
      return true;
    });

    if (fresh.length === 0) return 0;

    setLogs((prev) => (prepend ? [...fresh, ...prev] : [...prev, ...fresh]));
    return fresh.length;
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!liveModeEnabled) return;
    if (reconnectTimerRef.current !== null) return;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      startLogStream(streamCursorRef.current);
    }, 3000);
  }, [liveModeEnabled]);

  const ingestLiveLogs = useCallback(
    (payload: unknown) => {
      const parsed = payload as { logs?: SerializedTurn[]; cursor?: string };
      const incoming = Array.isArray(parsed.logs) ? parsed.logs : [];
      if (incoming.length === 0) return;

      const inserted = appendLogs(incoming, true);
      if (inserted > 0) {
        const nextLoaded = loadedRef.current + inserted;
        const nextTotal = totalRef.current + inserted;
        setCounterMeta(nextLoaded, nextTotal);
      }

      if (typeof parsed.cursor === "string" && parsed.cursor) {
        streamCursorRef.current = parsed.cursor;
      }
    },
    [appendLogs, setCounterMeta],
  );

  const startLogStream = useCallback(
    (cursor: string | null) => {
      if (!liveModeEnabled) {
        stopLogStream();
        setLogsLive("Live: off. Showing a static filtered snapshot.");
        return;
      }

      if (!("EventSource" in window)) {
        setLogsLive("Live updates unavailable in this browser.");
        return;
      }

      stopLogStream();
      streamCursorRef.current = cursor;
      setLogsLive("Live: connecting...");

      const params = getFilterBaseParams();
      params.set("limit", "120");
      if (streamCursorRef.current) {
        params.set("cursor", streamCursorRef.current);
      }

      const source = new EventSource(`/api/logs/stream?${params.toString()}`);
      sourceRef.current = source;

      source.addEventListener("ready", (event) => {
        const payload = safeJsonParse(event.data) as { cursor?: string };
        if (typeof payload.cursor === "string" && payload.cursor) {
          streamCursorRef.current = payload.cursor;
        }
        setLogsLive("Live: connected. Streaming new logs for current filters.");
      });

      source.addEventListener("logs", (event) => {
        ingestLiveLogs(safeJsonParse(event.data));
      });

      source.onerror = () => {
        if (sourceRef.current !== source) return;
        source.close();
        sourceRef.current = null;
        setLogsLive("Live: reconnecting...");
        scheduleReconnect();
      };
    },
    [getFilterBaseParams, ingestLiveLogs, liveModeEnabled, scheduleReconnect, stopLogStream],
  );

  const resetLogsState = useCallback(() => {
    stopLogStream();
    requestIdRef.current += 1;
    cursorRef.current = null;
    streamCursorRef.current = null;
    hasMoreRef.current = true;
    loadingRef.current = false;
    loadedRef.current = 0;
    totalRef.current = 0;
    logIdsRef.current = new Set();

    setLogs([]);
    setHasMore(true);
    setLoadingLogs(false);
    setLogsLive("");
    setLogsMeta("Loading logs...");
  }, [stopLogStream]);

  const loadLogsPage = useCallback(
    async (reset: boolean) => {
      if (reset) {
        resetLogsState();
      }

      if (loadingRef.current || !hasMoreRef.current) {
        return;
      }

      setLoadingState(true);
      const requestId = requestIdRef.current;

      try {
        const params = getFilterBaseParams();
        params.set("limit", String(LOG_PAGE_SIZE));
        if (cursorRef.current) {
          params.set("cursor", cursorRef.current);
        }

        const resp = await fetch(`/api/logs?${params.toString()}`, {
          cache: "no-store",
        });
        const data = (await resp.json()) as Partial<LogsResponse> & { error?: string };
        if (!resp.ok) {
          throw new Error(data.error || "Failed to load logs");
        }

        if (requestId !== requestIdRef.current) return;

        const incoming = Array.isArray(data.logs) ? data.logs : [];
        const totalMatched =
          typeof data.total === "number" ? data.total : totalRef.current;

        if (loadedRef.current === 0 && incoming.length === 0) {
          setLogs([]);
          setHasMoreState(false);
          cursorRef.current = null;
          setCounterMeta(0, 0, "No logs matched the current filters.");

          if (reset) {
            streamCursorRef.current =
              typeof data.headCursor === "string" && data.headCursor
                ? data.headCursor
                : null;
            if (liveModeEnabled) {
              startLogStream(streamCursorRef.current);
            } else {
              setLogsLive("Live: off. Showing a static filtered snapshot.");
            }
          }
          return;
        }

        const inserted = appendLogs(incoming, false);
        const nextLoaded = loadedRef.current + inserted;
        setCounterMeta(nextLoaded, totalMatched);

        cursorRef.current =
          typeof data.nextCursor === "string" && data.nextCursor
            ? data.nextCursor
            : null;
        setHasMoreState(!!cursorRef.current);

        if (reset) {
          streamCursorRef.current =
            typeof data.headCursor === "string" && data.headCursor
              ? data.headCursor
              : null;
          if (liveModeEnabled) {
            startLogStream(streamCursorRef.current);
          } else {
            setLogsLive("Live: off. Showing a static filtered snapshot.");
          }
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setHasMoreState(false);
        setLogsMeta(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingState(false);
        }
      }
    },
    [
      appendLogs,
      getFilterBaseParams,
      liveModeEnabled,
      resetLogsState,
      setCounterMeta,
      setHasMoreState,
      setLoadingState,
      startLogStream,
    ],
  );

  const loadOverview = useCallback(async () => {
    const resp = await fetch("/api/overview", { cache: "no-store" });
    const data = (await resp.json()) as OverviewResponse & { error?: string };
    if (!resp.ok) {
      throw new Error(data.error || "Failed to load overview");
    }
    setOverview(data);
  }, []);

  const refreshAll = useCallback(async () => {
    await loadOverview();
    await loadLogsPage(true);
  }, [loadLogsPage, loadOverview]);

  const askLogs = useCallback(async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) return;

    setAsking(true);
    setAskAnswer("Generating answer...");
    setAskSources([]);

    try {
      const payload = {
        question: trimmedQuestion,
        q: search.trim() || undefined,
        state: stateFilter || undefined,
        from: toIso(fromInput) || undefined,
        to: liveModeEnabled ? undefined : toIso(toInput) || undefined,
        limit: 120,
      };

      const resp = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await resp.json()) as AskResponse & { error?: string };
      if (!resp.ok) {
        throw new Error(data.error || "Ask request failed");
      }

      setAskAnswer(data.answer || "");
      setAskSources(Array.isArray(data.sources) ? data.sources : []);
    } catch (err) {
      setAskAnswer(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  }, [fromInput, liveModeEnabled, question, search, stateFilter, toInput]);

  useEffect(() => {
    void refreshAll().catch((err) => {
      setLogsMeta(err instanceof Error ? err.message : String(err));
    });

    const timer = window.setInterval(() => {
      void loadOverview().catch(() => {
        // ignore periodic refresh failures
      });
    }, 15000);

    return () => {
      window.clearInterval(timer);
      stopLogStream();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [loadOverview, refreshAll, stopLogStream]);

  useEffect(() => {
    if (!didFilterEffectRef.current) {
      didFilterEffectRef.current = true;
      return;
    }
    void loadLogsPage(true);
  }, [stateFilter, fromInput, toInput, liveModeEnabled, loadLogsPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        void loadLogsPage(false);
      },
      {
        root: null,
        rootMargin: "500px 0px 500px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadLogsPage]);

  const sentinelText = useMemo(() => {
    if (loadingLogs) return "Loading more logs...";
    if (!hasMore) {
      return loadedRef.current === 0 ? "" : "All matching logs are loaded.";
    }
    return "Scroll down to load more.";
  }, [hasMore, loadingLogs]);

  const metaText = logsMeta;

  const toggleLive = () => {
    setLiveModeEnabled((prev) => {
      const next = !prev;
      if (!next && !toInput) {
        setToInput(toLocalDateTimeInput(new Date()));
      }
      return next;
    });
  };

  return (
    <>
      <header className="header">
        <h1 className="title">Automaton Logbook</h1>
        <p className="subtitle">
          <span className="mono">{automatonName}</span> observability dashboard
        </p>
        <nav className="nav">
          <a href="#overview">Overview</a>
          <a href="#ask">Ask</a>
          <a href="#logs">Logs</a>
        </nav>
      </header>

      <main className="main">
        <section id="overview" className="section">
          <h2>Runtime Overview</h2>
          <div className="stat-grid">
            <StatCard label="State" value={<Badge value={overview?.runtime.state || "-"} />} />
            <StatCard label="Tier" value={<Badge value={overview?.runtime.tier || "-"} />} />
            <StatCard label="Active Model" value={<span className="mono">{overview?.model.active || "-"}</span>} />
            <StatCard label="Credits" value={formatMoney(overview?.balances.creditsCents || 0)} />
            <StatCard
              label="USDC"
              value={
                overview?.balances.usdc === null || overview?.balances.usdc === undefined
                  ? "-"
                  : Number(overview.balances.usdc).toFixed(6)
              }
            />
            <StatCard label="Turn Count" value={String(overview?.runtime.turnCount || 0)} />
            <StatCard label="Last Turn" value={<span className="mono small">{formatTime(overview?.runtime.lastTurnAt)}</span>} />
            <StatCard
              label="Last Heartbeat"
              value={<span className="mono small">{formatTime(overview?.runtime.lastHeartbeatAt)}</span>}
            />
          </div>
          <p className="muted small" id="overviewMeta">
            {overview
              ? `Configured model: ${overview.model.configured} | Last inference model: ${overview.model.lastUsed || "-"} | Credits source: ${overview.balances.source}${overview.distress ? " | Distress active" : ""}`
              : "Loading overview..."}
          </p>
        </section>

        <section id="ask" className="section">
          <h2>Ask the Logs</h2>
          <div className="ask-grid">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What has the agent been up to in the last day?"
            />
            <button className="primary" type="button" onClick={() => void askLogs()} disabled={asking}>
              {asking ? "Asking..." : "Ask"}
            </button>
          </div>
          <div className="answer">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{askAnswer}</ReactMarkdown>
          </div>
          <ol className="sources muted">
            {askSources.map((source) => (
              <li key={source.id} className="small">
                {formatTime(source.timestamp)} [{source.state}] {source.snippet}
              </li>
            ))}
          </ol>
        </section>

        <section id="logs" className="section">
          <h2>Logs</h2>
          <div className="controls">
            <label className="control-field" htmlFor="searchInput">
              <span className="control-label">Search</span>
              <input
                id="searchInput"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void loadLogsPage(true);
                }}
                placeholder="Search thoughts, tools, and input..."
              />
            </label>

            <label className="control-field" htmlFor="stateInput">
              <span className="control-label">State</span>
              <select
                id="stateInput"
                value={stateFilter}
                onChange={(event) => {
                  setStateFilter(event.target.value);
                }}
              >
                <option value="">All states</option>
                <option value="running">running</option>
                <option value="sleeping">sleeping</option>
                <option value="low_compute">low_compute</option>
                <option value="critical">critical</option>
                <option value="dead">dead</option>
                <option value="waking">waking</option>
                <option value="setup">setup</option>
              </select>
            </label>

            <div className="control-actions">
              <button
                id="liveModeBtn"
                className="primary"
                type="button"
                aria-pressed={liveModeEnabled}
                onClick={toggleLive}
              >
                {liveModeEnabled ? "Live: On" : "Live: Off"}
              </button>
              <button
                id="refreshBtn"
                className="primary"
                type="button"
                onClick={() => void loadLogsPage(true)}
              >
                Refresh
              </button>
            </div>

            <div className="control-field control-range">
              <p className="control-label">Date Range</p>
              <div className="control-range-inputs">
                <input
                  id="fromInput"
                  type="datetime-local"
                  aria-label="From date and time"
                  value={fromInput}
                  onChange={(event) => setFromInput(event.target.value)}
                />
                {liveModeEnabled ? (
                  <div className="to-live-hint">Open-ended while live mode is on</div>
                ) : (
                  <input
                    id="toInput"
                    type="datetime-local"
                    aria-label="To date and time"
                    value={toInput}
                    onChange={(event) => setToInput(event.target.value)}
                  />
                )}
              </div>
            </div>
          </div>

          <p className="muted small">{metaText}</p>
          <p className="muted small">{logsLive}</p>

          <div className="turn-list">
            {logs.length === 0 && !loadingLogs ? (
              <p className="muted">No logs in this range.</p>
            ) : (
              logs.map((log) => <TurnCard key={log.id} log={log} />)
            )}
          </div>

          <p ref={sentinelRef} className="scroll-sentinel muted small">
            {sentinelText}
          </p>
        </section>
      </main>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <article className="card">
      <p className="card-label">{label}</p>
      <p className="card-value">{value}</p>
    </article>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`badge ${value || ""}`}>{value || "-"}</span>;
}

function TurnCard({ log }: { log: SerializedTurn }) {
  return (
    <article className={`turn ${log.hasError ? "error" : ""}`}>
      <div className="turn-head">
        <div className="mono small">{formatTime(log.timestamp)}</div>
        <Badge value={log.state} />
      </div>

      <p>{log.summary || log.thinking || "No activity summary available."}</p>
      <p className="meta">
        Tools: {log.toolNames.length > 0 ? log.toolNames.join(", ") : "none"} | Tokens: {" "}
        {typeof log.tokenUsage.totalTokens === "number" ? log.tokenUsage.totalTokens : 0} | Cost:{" "}
        {formatMoney(log.costCents || 0)}
      </p>

      <details>
        <summary className="small muted">Details</summary>
        {log.input ? (
          <pre>{`Input (${log.inputSource || "unknown"}):\n${log.input}`}</pre>
        ) : null}
        {log.tools.map((tool) => (
          <pre key={`${log.id}-${tool.id || tool.name}`}>
            {`Tool: ${tool.name} | Duration: ${tool.durationMs || 0}ms\n${tool.error ? `ERROR: ${tool.error}` : tool.result || "(empty result)"}`}
          </pre>
        ))}
      </details>
    </article>
  );
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIso(inputValue: string): string {
  if (!inputValue) return "";
  const parsed = new Date(inputValue);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

function formatMoney(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return `$${(safe / 100).toFixed(2)}`;
}
