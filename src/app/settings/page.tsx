import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { TelegramSettings } from "./telegram-settings";
import { currentUserId, isAuthConfigured, signIn } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { getNotificationSettings, telegramStartLink } from "@/lib/notification-settings";
import { botUsername, isTelegramConfigured } from "@/lib/telegram";

export const metadata: Metadata = {
  title: "Settings — StockPilot",
  description: "Notifications for your favorites.",
};

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="empty-state empty-state-info" role="status">
      <span className="empty-state-icon" aria-hidden="true">i</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

async function SettingsBody() {
  if (!isAuthConfigured() || !isDatabaseConfigured()) {
    return <Notice title="Accounts aren't set up"><p>Settings need Google sign-in and a database (see docs/auth.md and docs/favorites.md).</p></Notice>;
  }
  const userId = await currentUserId();
  if (!userId) {
    return (
      <Notice title="Sign in to change your settings">
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/settings" });
          }}
        >
          <button className="favorites-sign-in" type="submit">Sign in with Google</button>
        </form>
      </Notice>
    );
  }
  if (!isTelegramConfigured()) {
    return (
      <Notice title="Telegram isn't set up yet">
        <p>Create a bot with @BotFather and add TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME to the environment file (see docs/notifications.md).</p>
      </Notice>
    );
  }

  const settings = await getNotificationSettings(userId);
  return (
    <TelegramSettings
      botUsername={botUsername()}
      telegramName={settings.telegramName}
      pendingLink={settings.linkCode ? telegramStartLink(settings.linkCode) : null}
      earningsAlerts={settings.earningsAlerts}
      transcriptSummaries={settings.transcriptSummaries}
    />
  );
}

export default function SettingsPage() {
  return (
    <AppShell contentClassName="dashboard-content" activeSection="settings" headerLabel="Settings" dataSource="Notifications sent with Telegram">
      <section className="company-heading">
        <div>
          <p className="section-label">ACCOUNT</p>
          <div className="company-title-row">
            <h1>Notifications</h1>
          </div>
          <p className="company-subtitle">
            Alerts about your <Link href="/favorites">favorites</Link>, sent to Telegram.
          </p>
        </div>
      </section>
      <SettingsBody />
    </AppShell>
  );
}
