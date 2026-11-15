import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { DataSources } from "./data-sources";
import { currentUserId, isAuthConfigured } from "@/auth";

export const metadata: Metadata = {
  title: "Data sources — StockPilot",
  description: "The status of the app's data sources.",
};

// Data sources (the account menu's "Data sources"). Notification settings moved to /notifications?tab=settings.
export default async function SettingsPage() {
  // Which services are set up isn't for everyone's eyes: signed-in users, or anyone when there are no accounts.
  const showSources = !isAuthConfigured() || Boolean(await currentUserId());
  return (
    <AppShell contentClassName="dashboard-content" activeSection="settings" headerLabel="Data sources">
      <section className="company-heading">
        <div>
          <p className="section-label">ACCOUNT</p>
          <div className="company-title-row">
            <h1>Data sources</h1>
          </div>
          <p className="company-subtitle">
            The data sources behind every page and whether each one is working. Notification settings are now in{" "}
            <Link href="/notifications?tab=settings">Notifications › Settings</Link>.
          </p>
        </div>
      </section>
      {showSources ? (
        <DataSources />
      ) : (
        <section className="empty-state empty-state-info" role="status">
          <span className="empty-state-icon" aria-hidden="true">i</span>
          <div>
            <h2>Sign in to see the data sources</h2>
            <p>Which services are set up is shown to signed-in users.</p>
          </div>
        </section>
      )}
    </AppShell>
  );
}
