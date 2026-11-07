import { dataSourceStatuses } from "@/lib/data-sources";

// Settings › Data sources: each source, what it's used for, its free plan and its status (see lib/data-sources).
export function DataSources() {
  const sources = dataSourceStatuses();
  return (
    <section className="settings-card data-sources" aria-labelledby="data-sources-heading">
      <h2 id="data-sources-heading">Data sources</h2>
      <p>Where each page&apos;s data comes from, and how each source has been doing since the server last started. See docs/data-sources.md for which is used when.</p>
      <div className="table-scroll">
        <table className="financial-table data-sources-table">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col" className="data-sources-optional">Used for</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.name}>
                <th scope="row">
                  <strong>{source.name}</strong>
                  <small>{source.limits}</small>
                </th>
                <td className="data-sources-optional">{source.usedFor}</td>
                <td>
                  <span className={`data-sources-status data-sources-${source.tone}`}>{source.status}</span>
                  {source.note && <small>{source.note}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
