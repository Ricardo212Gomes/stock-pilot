import { ZONES, type Zone } from "@/lib/market-valuation";

// Where today sits in the index's history: a bar from the cheapest month (left) to the dearest (right), split into
// the zones, with a marker at today's percentile. The zones are named in a legend under it (the narrow ones at the
// right have no room for a label of their own), so colour is never the only cue.
export function PercentileBar({ percentile, zone, label }: { percentile: number; zone: Zone; label: string }) {
  const at = Math.min(100, Math.max(0, percentile));
  return (
    <figure className="mv-percentile">
      <div className="mv-percentile-track" role="img" aria-label={`${label} is higher than ${Math.round(at)}% of its history: ${zone.label}`}>
        {ZONES.map((item) => (
          <span key={item.id} className={`mv-zone-${item.id}`} style={{ width: `${item.to - item.from}%` }} />
        ))}
        <span className="mv-percentile-marker" style={{ left: `${at}%` }} />
      </div>
      <div className="mv-percentile-scale" aria-hidden="true">
        <span>Cheapest</span>
        <span>Dearest</span>
      </div>
      <figcaption className="mv-percentile-legend">
        {ZONES.map((item) => (
          <span key={item.id} className={`vix-zone-tag mv-zone-${item.id}${item.id === zone.id ? " mv-percentile-current" : ""}`}>
            <span className="vix-zone-swatch" aria-hidden="true" />
            {item.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
