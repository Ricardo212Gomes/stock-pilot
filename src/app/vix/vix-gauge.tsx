import { VIX_ZONES, type VixZone } from "@/lib/vix";

// A half dial from extreme fear (left) to extreme greed (right), one fifth per zone, each named beside
// its arc so the colour is never the only cue.
const CX = 220;
const CY = 190;
const OUTER = 150;
const INNER = 124;
const LABEL_RADIUS = 164;
const NEEDLE = 112;
// The 2px surface gap between segments, as an angle at the outer edge.
const GAP_DEGREES = (2 / OUTER) * (180 / Math.PI);

function point(radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [CX + radius * Math.cos(radians), CY - radius * Math.sin(radians)];
}

function arc(from: number, to: number): string {
  const [x1, y1] = point(OUTER, from);
  const [x2, y2] = point(OUTER, to);
  const [x3, y3] = point(INNER, to);
  const [x4, y4] = point(INNER, from);
  return `M${x1} ${y1}A${OUTER} ${OUTER} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${INNER} ${INNER} 0 0 0 ${x4} ${y4}Z`;
}

function range(zone: VixZone): string {
  if (zone.from === null) return `VIX below ${zone.to}`;
  if (zone.to === null) return `VIX ${zone.from} and above`;
  return `VIX ${zone.from} to ${zone.to}`;
}

// `score` runs from 0 (extreme fear) to 100 (extreme greed).
export function VixGauge({ score, zone, value }: { score: number; zone: VixZone; value: number }) {
  // Left to right: the zones in fear-to-greed order.
  const zones = [...VIX_ZONES].reverse();
  const step = 180 / zones.length;
  const needle = point(NEEDLE, 180 - score * 1.8);

  return (
    // Room either side for the stacked "Extreme" labels, which the CSS enlarges on phones.
    <svg className="vix-gauge" viewBox="-30 0 500 206" role="img" aria-label={`Gauge: the VIX at ${value.toFixed(2)} reads ${zone.label}`}>
      {zones.map((item, index) => {
        const from = 180 - index * step;
        const to = from - step;
        const middle = from - step / 2;
        const [x, y] = point(LABEL_RADIUS, middle);
        const anchor = middle > 100 ? "end" : middle < 80 ? "start" : "middle";
        const words = item.label.split(" ");
        return (
          <g key={item.id} className={`vix-zone-${item.id}${item.id === zone.id ? " vix-gauge-current" : ""}`}>
            <path d={arc(from - (index === 0 ? 0 : GAP_DEGREES / 2), to + (index === zones.length - 1 ? 0 : GAP_DEGREES / 2))}>
              <title>{`${item.label}: ${range(item)}`}</title>
            </path>
            {/* Two-word names stack, centred on the label point, so the ends fit beside the dial. */}
            <text x={x} y={y} textAnchor={anchor}>
              {words.map((word, line) => (
                <tspan key={word} x={x} dy={line === 0 ? `${-(words.length - 1) * 0.55}em` : "1.1em"}>{word}</tspan>
              ))}
            </text>
          </g>
        );
      })}
      <line className="vix-gauge-needle" x1={CX} y1={CY} x2={needle[0]} y2={needle[1]} />
      <circle className="vix-gauge-hub" cx={CX} cy={CY} r={9} />
    </svg>
  );
}
