/**
 * Hand-written report charts: inline SVG marks inside HTML layout so text stays crisp at any width.
 * Colours come from theme tokens (data-tone -> CSS in styles/reports.css); every chart also carries text
 * labels and values, so colour is never the only cue. Each figure summarises its data in aria-label, and
 * individual marks carry a <title> tooltip. Server components: no client JavaScript.
 */
import type { ReactNode } from "react";
import { donutArcs, fmt, niceMax, pct, ticks, type Datum } from "./scale";

export type Tone = "ink" | "muted" | "signal" | "ok" | "warn" | "faint";
export interface Series { name: string; tone: Tone; values: number[] }
type Format = (n: number) => string;
const plain: Format = (n) => fmt(n);

export function ChartFigure({ title, caption, summary, children, footer, className }: {
  title: string; caption?: ReactNode; summary: string; children: ReactNode; footer?: ReactNode; className?: string;
}) {
  return (
    <figure className={className ? `chart ${className}` : "chart"}>
      <figcaption className="chart-cap"><span className="chart-title">{title}</span>{caption && <span className="chart-sub">{caption}</span>}</figcaption>
      <div role="img" aria-label={summary} className="chart-body">{children}</div>
      {footer && <div className="chart-foot">{footer}</div>}
    </figure>
  );
}

function Legend({ items }: { items: Array<{ label: string; tone: Tone; value?: string }> }) {
  return (
    <ul className="chart-legend">
      {items.map((i) => (
        <li key={i.label}><span className="rc-swatch" data-tone={i.tone} aria-hidden="true" /><span>{i.label}</span>{i.value !== undefined && <strong className="num">{i.value}</strong>}</li>
      ))}
    </ul>
  );
}

/** Vertical columns, one or more series grouped per category. */
export function ColumnChart({ title, caption, categories, series, format = plain, unit = "", height = 180 }: {
  title: string; caption?: ReactNode; categories: string[]; series: Series[]; format?: Format; unit?: string; height?: number;
}) {
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const tk = ticks(max, 4);
  const n = Math.max(1, categories.length);
  const slot = 100 / n;
  const inner = slot * 0.72;
  const barW = inner / Math.max(1, series.length);
  const every = Math.ceil(n / 10); // label at most ~10 categories; every bar still has a tooltip
  const summary = `${title}. ${categories.map((c, i) => `${c}: ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}${unit}`).join(", ")}`).join("; ")}.`;
  return (
    <ChartFigure title={title} caption={caption} summary={summary} footer={series.length > 1 ? <Legend items={series.map((s) => ({ label: s.name, tone: s.tone }))} /> : undefined}>
      <div className="cc" style={{ ["--cc-h" as string]: `${height}px` }}>
        <div className="cc-y" aria-hidden="true">{[...tk].reverse().map((t) => <span key={t}>{format(t)}</span>)}</div>
        <div className="cc-plot">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="cc-svg" aria-hidden="true" focusable="false">
            {tk.map((t) => <line key={t} x1="0" x2="100" y1={100 - pct(t, max)} y2={100 - pct(t, max)} className={t === 0 ? "axis" : "grid"} vectorEffect="non-scaling-stroke" />)}
            {categories.map((c, i) => series.map((s, j) => {
              const v = s.values[i] ?? 0;
              const h = pct(v, max);
              return (
                <rect key={`${c}-${s.name}`} className="bar bar-y" data-tone={s.tone} x={i * slot + (slot - inner) / 2 + j * barW} width={Math.max(0.4, barW - 0.6)} y={100 - h} height={h}>
                  <title>{`${c} · ${s.name}: ${format(v)}${unit}`}</title>
                </rect>
              );
            }))}
          </svg>
          <div className="cc-x" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>{categories.map((c, i) => <span key={c} title={c}>{i % every === 0 ? c : ""}</span>)}</div>
        </div>
      </div>
    </ChartFigure>
  );
}

/** Ranked horizontal bars with direct labels and values; reads as a list, so the data is never only in the picture. */
export function HBarChart({ title, caption, data, format = plain, max, tone = "ink", toneOf, emptyText = "Nothing recorded." }: {
  title: string; caption?: ReactNode; data: Datum[]; format?: Format; max?: number; tone?: Tone; toneOf?: (d: Datum) => Tone; emptyText?: string;
}) {
  const top = max ?? Math.max(0, ...data.map((d) => d.value));
  const summary = data.length ? `${title}. ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}${max !== undefined ? `, out of ${format(max)}` : ""}.` : `${title}. ${emptyText}`;
  return (
    <ChartFigure title={title} caption={caption} summary={summary}>
      {data.length === 0 ? <p className="chart-empty">{emptyText}</p> : (
        <ul className="hbar">
          {data.map((d) => (
            <li key={d.label}>
              <span className="hbar-label" title={d.label}>{d.label}</span>
              <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="hbar-track" aria-hidden="true" focusable="false">
                <rect x="0" y="0" width="100" height="10" rx="0" className="track" />
                <rect x="0" y="0" width={pct(d.value, top)} height="10" className="bar bar-x" data-tone={toneOf ? toneOf(d) : tone}><title>{`${d.label}: ${format(d.value)}`}</title></rect>
              </svg>
              <span className="hbar-value num">{format(d.value)}{max !== undefined && <span className="muted"> / {format(max)}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </ChartFigure>
  );
}

/** Part-to-whole donut with a legend that carries label, value and share. Use for 2–6 categories. */
export function Donut({ title, caption, data, tones, centerValue, centerLabel, format = plain }: {
  title: string; caption?: ReactNode; data: Datum[]; tones: Tone[]; centerValue?: string; centerLabel?: string; format?: Format;
}) {
  const arcs = donutArcs(data, 1.2);
  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0);
  const toneFor = (label: string) => tones[data.findIndex((d) => d.label === label) % tones.length] ?? "ink";
  const summary = total ? `${title}. ${arcs.map((a) => `${a.label} ${format(a.value)} (${Math.round(a.share)}%)`).join(", ")}; total ${format(total)}.` : `${title}. No records.`;
  return (
    <ChartFigure title={title} caption={caption} summary={summary}>
      {total === 0 ? <p className="chart-empty">No records for this filter.</p> : (
        <div className="donut">
          <div className="donut-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
              <circle cx="60" cy="60" r="46" className="donut-track" />
              {arcs.map((a) => (
                <circle key={a.label} cx="60" cy="60" r="46" pathLength={100} className="donut-arc" data-tone={toneFor(a.label)}
                  strokeDasharray={`${a.length} 100`} transform={`rotate(${a.rotate} 60 60)`} style={{ ["--arc" as string]: a.length }}>
                  <title>{`${a.label}: ${format(a.value)} (${Math.round(a.share)}%)`}</title>
                </circle>
              ))}
            </svg>
            <div className="donut-center" aria-hidden="true"><strong className="num">{centerValue ?? format(total)}</strong><span>{centerLabel ?? "total"}</span></div>
          </div>
          <Legend items={arcs.map((a) => ({ label: a.label, tone: toneFor(a.label), value: `${format(a.value)} · ${Math.round(a.share)}%` }))} />
        </div>
      )}
    </ChartFigure>
  );
}

/** Small trend line for a KPI card. Values are oldest first; labels name each point. */
export function Sparkline({ label, values, labels, format = plain }: { label: string; values: number[]; labels: string[]; format?: Format }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const y = (v: number) => 28 - (v / max) * 24;
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const summary = `${label}: ${values.map((v, i) => `${labels[i]} ${format(v)}`).join(", ")}.`;
  return (
    <div className="spark" role="img" aria-label={summary}>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <line x1="0" x2="100" y1="28" y2="28" className="axis" vectorEffect="non-scaling-stroke" />
        <polygon points={`0,28 ${pts} 100,28`} className="spark-area" />
        <polyline points={pts} className="spark-line" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => <rect key={labels[i]} x={Math.max(0, i * step - step / 2)} width={step} y="0" height="30" className="hit"><title>{`${labels[i]}: ${format(v)}`}</title></rect>)}
      </svg>
      <div className="spark-x" aria-hidden="true"><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></div>
    </div>
  );
}

/** One value against a scale, with an optional reference marker (e.g. a provisional target). */
export function Meter({ label, value, max = 100, reference, referenceLabel, tone = "ink", format = (n: number) => `${fmt(n)}%` }: {
  label: string; value: number; max?: number; reference?: number; referenceLabel?: string; tone?: Tone; format?: Format;
}) {
  const summary = `${label}: ${format(value)} of ${format(max)}${reference !== undefined ? `; ${referenceLabel ?? "reference"} ${format(reference)}` : ""}.`;
  return (
    <div className="rc-meter" role="img" aria-label={summary}>
      <div className="rc-meter-head"><span>{label}</span><strong className="num">{format(value)}</strong></div>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect x="0" y="0" width="100" height="10" className="track" />
        <rect x="0" y="0" width={pct(value, max)} height="10" className="bar bar-x" data-tone={tone}><title>{`${label}: ${format(value)}`}</title></rect>
        {reference !== undefined && <line x1={pct(reference, max)} x2={pct(reference, max)} y1="-2" y2="12" className="ref" vectorEffect="non-scaling-stroke" />}
      </svg>
      {reference !== undefined && <div className="rc-meter-ref small" aria-hidden="true">{referenceLabel ?? "Reference"} {format(reference)}</div>}
    </div>
  );
}

/** One bar split into mutually exclusive parts that sum to a whole (e.g. on time / late / missing). */
export function StackBar({ title, caption, parts, format = plain }: { title: string; caption?: ReactNode; parts: Array<Datum & { tone: Tone }>; format?: Format }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  let x = 0;
  const summary = `${title}. ${parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")} of ${format(total)}.`;
  return (
    <ChartFigure title={title} caption={caption} summary={summary} footer={<Legend items={parts.map((p) => ({ label: p.label, tone: p.tone, value: `${format(p.value)}${total ? ` · ${Math.round(pct(p.value, total))}%` : ""}` }))} />}>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="stack-bar" aria-hidden="true" focusable="false">
        <rect x="0" y="0" width="100" height="10" className="track" />
        {total > 0 && parts.map((p) => {
          const w = pct(p.value, total);
          const r = <rect key={p.label} x={x} width={w} y="0" height="10" className="bar bar-x" data-tone={p.tone}><title>{`${p.label}: ${format(p.value)} of ${format(total)}`}</title></rect>;
          x += w;
          return r;
        })}
      </svg>
    </ChartFigure>
  );
}
