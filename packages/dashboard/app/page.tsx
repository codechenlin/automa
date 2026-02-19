import { DashboardClient } from "@/components/dashboard-client";
import { getRuntimeConfig } from "@/lib/server/core";

export const dynamic = "force-dynamic";

export default function Page() {
  try {
    const config = getRuntimeConfig();
    return <DashboardClient automatonName={config.name} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return (
      <main className="main error-main">
        <section className="section">
          <h1 className="title">Automaton Dashboard</h1>
          <p className="muted">{message}</p>
        </section>
      </main>
    );
  }
}
