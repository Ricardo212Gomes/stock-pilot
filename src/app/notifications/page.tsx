import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { NotificationIcon } from "../components/notification-icon";
import { NotificationMessage } from "../components/notification-message";
import { currentUserId, isAuthConfigured, signIn } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { normalizeTicker } from "@/lib/fmp";
import { listNotifications, notificationSymbols, PAGE_SIZE, unreadCount, type InboxNotification } from "@/lib/notification-inbox";
import { isNotificationKind, KIND_LABEL, NOTIFICATION_KINDS, notificationHref, TELEGRAM_STATUS_LABEL, type NotificationKind } from "@/lib/notification-kinds";
import { getNotificationSettings, telegramStartLink } from "@/lib/notification-settings";
import { botUsername, isTelegramConfigured } from "@/lib/telegram";
import { MarkAllReadButton, MarkReadButton } from "./mark-read";
import { NotificationSettings } from "./notification-settings";

export const metadata: Metadata = {
  title: "Notifications — StockPilot",
  description: "Every alert about your favorites and portfolio, and what to get.",
};

type Params = Promise<{ tab?: string | string[]; kind?: string | string[]; symbol?: string | string[]; page?: string | string[] }>;

const DATE_TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

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

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function historyHref(filter: { kind: NotificationKind | null; symbol: string | null; page?: number }): string {
  const query = new URLSearchParams();
  if (filter.kind) query.set("kind", filter.kind);
  if (filter.symbol) query.set("symbol", filter.symbol);
  if (filter.page && filter.page > 1) query.set("page", String(filter.page));
  const text = query.toString();
  return `/notifications${text ? `?${text}` : ""}`;
}

function NotificationCard({ item }: { item: InboxNotification }) {
  return (
    <article className={item.read ? "notification-card" : "notification-card notification-card-unread"} aria-labelledby={`notification-${item.id}`}>
      <header className="notification-card-heading">
        <NotificationIcon kind={item.kind} />
        <div>
          <h2 id={`notification-${item.id}`}>
            {!item.read && <span className="notification-dot" aria-label="Unread" />}
            {item.title}
          </h2>
          <p>
            {KIND_LABEL[item.kind]} · <time dateTime={item.createdAt}>{DATE_TIME.format(new Date(item.createdAt))} UTC</time>
            {" · "}
            <span className={item.telegramStatus === "failed" ? "negative-value" : undefined}>{TELEGRAM_STATUS_LABEL[item.telegramStatus]}</span>
          </p>
        </div>
        <div className="notification-card-actions">
          {!item.read && <MarkReadButton id={item.id} />}
          <Link className="text-button" href={notificationHref(item.kind, item.symbols)}>Open</Link>
        </div>
      </header>
      <NotificationMessage body={item.body} />
    </article>
  );
}

async function History({ userId, kind, symbol, page }: { userId: string; kind: NotificationKind | null; symbol: string | null; page: number }) {
  const [{ items, total }, symbols, unread] = await Promise.all([
    listNotifications(userId, { kind, symbol, page }),
    notificationSymbols(userId),
    unreadCount(userId),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = kind !== null || symbol !== null;

  return (
    <>
      <div className="notification-toolbar">
        <form className="notification-filters" action="/notifications">
          <label>
            <span>Kind</span>
            <select name="kind" defaultValue={kind ?? ""}>
              <option value="">All kinds</option>
              {NOTIFICATION_KINDS.map((option) => <option key={option} value={option}>{KIND_LABEL[option]}</option>)}
            </select>
          </label>
          <label>
            <span>Company</span>
            <select name="symbol" defaultValue={symbol ?? ""}>
              <option value="">All companies</option>
              {symbols.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <button className="settings-button settings-button-quiet" type="submit">Show</button>
          {filtered && <Link className="text-button" href="/notifications">Clear</Link>}
        </form>
        {unread > 0 && <MarkAllReadButton />}
      </div>
      <p className="earnings-summary">
        {total === 0 ? "No notifications" : `${total} notification${total === 1 ? "" : "s"}`}
        {filtered ? " matching" : ""}{unread > 0 ? `, ${unread} unread` : ""}. Kept for 90 days.
      </p>
      {items.length === 0 ? (
        <Notice title={filtered ? "Nothing matches" : "No notifications yet"}>
          <p>
            {filtered
              ? "Try another kind or company."
              : <>Alerts about your <Link href="/favorites">favorites</Link> (upcoming earnings, call summaries, news and SEC filings) and the weekly AI reviews of your portfolio show up here. Choose them in the <Link href="/notifications?tab=settings">Settings</Link> tab.</>}
          </p>
        </Notice>
      ) : (
        <div className="notification-cards">
          {items.map((item) => <NotificationCard key={item.id} item={item} />)}
        </div>
      )}
      {pages > 1 && (
        <nav className="notification-pager" aria-label="Pages">
          {page > 1 ? <Link href={historyHref({ kind, symbol, page: page - 1 })}>← Newer</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={historyHref({ kind, symbol, page: page + 1 })}>Older →</Link> : <span />}
        </nav>
      )}
    </>
  );
}

async function SettingsTab({ userId }: { userId: string }) {
  const settings = await getNotificationSettings(userId);
  const telegram = isTelegramConfigured();
  return (
    <NotificationSettings
      botUsername={telegram ? botUsername() : null}
      telegramName={settings.telegramName}
      pendingLink={telegram && settings.linkCode ? telegramStartLink(settings.linkCode) : null}
      initialPreferences={{
        earningsAlerts: settings.earningsAlerts,
        transcriptSummaries: settings.transcriptSummaries,
        newsAlerts: settings.newsAlerts,
        filingAlerts: settings.filingAlerts,
        reviewSummaries: settings.reviewSummaries,
        telegramAlerts: settings.telegramAlerts,
      }}
    />
  );
}

async function NotificationsBody({ params }: { params: Awaited<Params> }) {
  if (!isAuthConfigured() || !isDatabaseConfigured()) {
    return <Notice title="Accounts aren't set up"><p>Notifications need Google sign-in and a database (see docs/auth.md and docs/notifications.md).</p></Notice>;
  }
  const userId = await currentUserId();
  if (!userId) {
    return (
      <Notice title="Sign in to see your notifications">
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/notifications" });
          }}
        >
          <button className="favorites-sign-in" type="submit">Sign in with Google</button>
        </form>
      </Notice>
    );
  }

  const tab = one(params.tab) === "settings" ? "settings" : "history";
  const kindParam = one(params.kind);
  const kind = isNotificationKind(kindParam) ? kindParam : null;
  const symbol = normalizeTicker(one(params.symbol) ?? "");
  const page = Math.max(1, Math.min(1000, Number(one(params.page)) || 1));

  let body: React.ReactNode;
  try {
    body = tab === "settings" ? await SettingsTab({ userId }) : await History({ userId, kind, symbol, page });
  } catch {
    body = <Notice title="We couldn't load your notifications"><p>The database didn&apos;t respond. Check DATABASE_URL and that <code>npm run db:setup</code> has run.</p></Notice>;
  }

  return (
    <>
      <div className="statement-toolbar">
        <nav className="statement-tabs" aria-label="Notifications">
          <Link href="/notifications" className={tab === "history" ? "statement-tab-active" : ""} aria-current={tab === "history" ? "page" : undefined}>History</Link>
          <Link href="/notifications?tab=settings" className={tab === "settings" ? "statement-tab-active" : ""} aria-current={tab === "settings" ? "page" : undefined}>Settings</Link>
        </nav>
      </div>
      {body}
    </>
  );
}

export default async function NotificationsPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  return (
    <AppShell contentClassName="dashboard-content" activeSection="notifications" dataSource="Notifications also sent with Telegram">
      <section className="company-heading">
        <div>
          <p className="section-label">ACCOUNT</p>
          <div className="company-title-row">
            <h1>Notifications</h1>
          </div>
          <p className="company-subtitle">
            Alerts about your <Link href="/favorites">favorites</Link> and your portfolio, kept here for 90 days and sent to
            Telegram too when it&apos;s connected.
          </p>
        </div>
      </section>
      <NotificationsBody params={params} />
    </AppShell>
  );
}
