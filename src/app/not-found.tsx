import Link from "next/link";
import { AppShell } from "./components/app-shell";

export const metadata = { title: "Page not found — StockPilot" };

// Unknown routes keep the app's sidebar and search, so there's always a way back.
export default function NotFound() {
  return (
    <AppShell contentClassName="dashboard-content" activeSection="home" headerLabel="Page not found">
      <section className="projection-start">
        <p className="section-label">404</p>
        <h1>This page doesn&apos;t exist</h1>
        <p>
          Search for a company or ticker above, or go back <Link href="/">home</Link>.
        </p>
      </section>
    </AppShell>
  );
}
