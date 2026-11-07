import Link from "next/link";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { LEADERBOARDS, getLeaderboard, type LeaderboardId } from "@/lib/leaderboard";

function compact(value: number | null, prefix = ""): string {
  if (value === null) return "—";
  return prefix + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function price(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function change(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatSnapshotDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

// The Stocks page before a ticker is chosen: the largest companies and today's movers.
export async function Leaderboard({ list }: { list: LeaderboardId }) {
  const board = LEADERBOARDS.find((item) => item.id === list)!;
  const result = await getLeaderboard(list);
  const largest = list === "largest";
  // The snapshot has no prices; each company's page has them.
  const showPrice = !(result.ok && result.snapshotDate);

  return (
    <>
      <nav className="statement-tabs leaderboard-tabs" aria-label="Leaderboards">
        {LEADERBOARDS.map((item) => (
          <Link
            key={item.id}
            href={item.id === "largest" ? "/stock" : `/stock?list=${item.id}`}
            className={item.id === list ? "statement-tab-active" : ""}
            aria-current={item.id === list ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {!result.ok ? (
        <section className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">!</span>
          <div>
            <h2>We couldn&apos;t load this list</h2>
            <p>{providerFailureMessage(result.reason, `the ${board.label.toLowerCase()} list`)} You can still search for any company above.</p>
          </div>
        </section>
      ) : (
        <>
          <p className="earnings-summary">
            {board.description} Select a company to research it.
            {result.snapshotDate && (
              <>
                {" "}FMP&apos;s plan doesn&apos;t include its company screener right now, so this ranks a snapshot of the
                largest US companies from {formatSnapshotDate(result.snapshotDate)}, with today&apos;s market cap where FMP has it.
              </>
            )}
          </p>
          <div className="table-scroll">
            <table className="financial-table leaderboard-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Company</th>
                  {showPrice && <th scope="col">Price</th>}
                  {!largest && <th scope="col">Change</th>}
                  <th scope="col">{list === "active" ? "Volume" : "Market cap"}</th>
                  {largest && <th scope="col" className="leaderboard-optional">Sector</th>}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={row.symbol}>
                    <td className="leaderboard-rank">{index + 1}</td>
                    <th scope="row">
                      <Link className="leaderboard-company" href={`/stock?symbol=${encodeURIComponent(row.symbol)}`}>
                        <strong>{row.symbol}</strong>
                        <span>{row.name}</span>
                      </Link>
                    </th>
                    {showPrice && <td>{price(row.price)}</td>}
                    {!largest && (
                      <td className={row.changePercent === null ? "" : row.changePercent >= 0 ? "positive-value" : "negative-value"}>
                        {change(row.changePercent)}
                      </td>
                    )}
                    <td>{list === "active" ? compact(row.volume) : compact(row.marketCap, "$")}</td>
                    {largest && <td className="leaderboard-optional leaderboard-sector">{row.sector ?? "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
