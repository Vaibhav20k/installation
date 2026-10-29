/**
 * The Installation Manager's pipeline on the Overview: seven stage tiles in the order a kitchen moves, then the
 * records in the chosen tile, each with one button for the IM's next step (or a quiet "Waiting for ..." when the
 * step is someone else's). Every tile's list is rendered here once and StagePicker switches between them instantly,
 * keeping ?stage= in the address. Buttons open the dispatch's own step form, which makes the change and records it.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CaretRight, CheckCircle, Clock, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { shortDate } from "@/domain/install-schedule";
import type { PipelineRow, PipelineTile, TileKey } from "@/server/queries/im-pipeline";
import { StagePicker } from "./StagePicker";

const days = (n: number) => (n === 0 ? "since today" : `${n} day${n === 1 ? "" : "s"}`);

function Panel({ tile, rows }: { tile: PipelineTile; rows: PipelineRow[] }) {
  const id = `h-pipe-list-${tile.key}`;
  return (
    <>
      <div className="pipe-list-head">
        <h3 id={id}>{tile.label}{tile.sub ? ` · ${tile.sub}` : ""} <span className="pipe-count">{tile.n}</span></h3>
        <p className="small muted">{tile.hint}.{tile.key === "handover" ? " Counted per project: every dispatch installed and nothing left to send." : " Counted per dispatch (truckload)."}</p>
      </div>
      {rows.length === 0 ? (
        <p className="home-allclear"><CheckCircle size={22} weight="fill" aria-hidden /> Nothing in this stage right now.</p>
      ) : (
        <ul className="pipe-rows" aria-labelledby={id}>
          {rows.map((r) => (
            <li key={r.key} className="pipe-row" data-overdue={r.overdue ? "" : undefined}>
              <Link className="pipe-row-main" href={r.href}>
                <span className="pipe-row-title">{r.customer} · {r.project}</span>
                <span className="pipe-row-meta"><span className="code-tag">{r.code}</span> {r.what}</span>
                <span className="pipe-row-tags">
                  <span className="pipe-age"><Clock size={13} aria-hidden /> {tile.key === "handover" ? (r.days === 0 ? "Installed today" : `Installed ${days(r.days)} ago`) : `${r.stage_label}, ${days(r.days)}`}</span>
                  {r.overdue && <span className="pipe-flag" data-tone="bad">Overdue</span>}
                  {r.hold_until && <span className="pipe-flag" data-tone="warn">Site not ready until {shortDate(r.hold_until)}</span>}
                  {r.partial && <span className="pipe-flag" data-tone="warn">Partial: complaint open</span>}
                </span>
              </Link>
              {r.action
                ? <Link className="button primary pipe-go" href={r.action.href}>{r.action.label}<CaretRight size={14} weight="bold" aria-hidden /></Link>
                : <span className="pipe-wait">{r.waiting}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ImPipeline({ tiles, rows, selected, query, aside }: { tiles: PipelineTile[]; rows: Record<TileKey, PipelineRow[]>; selected: TileKey; query: Record<string, string>; aside?: ReactNode }) {
  const open = tiles.reduce((n, t) => n + t.n, 0);
  const late = tiles.reduce((n, t) => n + t.overdue, 0);
  const href = (key: TileKey) => `/?${new URLSearchParams({ ...query, stage: key }).toString()}`;
  return (
    <section className="plate im-pipe" aria-labelledby="h-pipe">
      <div className="plate-head">
        <h2 id="h-pipe" style={{ margin: 0 }}>Installations pipeline</h2>
        <span className="code-tag">{open} in progress{late ? ` · ${late} overdue` : ""}</span>
      </div>
      <StagePicker initial={selected} navLabel="Pipeline stages" stripClass="pipe-strip" bodyClass="pipe-body" listClass="pipe-list"
        aside={aside} asideLabel="Handover calendar"
        panels={Object.fromEntries(tiles.map((t) => [t.key, <Panel key={t.key} tile={t} rows={rows[t.key]} />]))}
        tiles={tiles.map((t, i) => ({
          key: t.key, href: href(t.key), overdue: t.overdue > 0, empty: t.n === 0,
          label: `${t.label}${t.sub ? ` (${t.sub})` : ""}: ${t.n}${t.overdue ? `, ${t.overdue} overdue` : ""}`,
          body: (
            <>
              <span className="pipe-n">{t.n}</span>
              <span className="pipe-text">
                <span className="pipe-label"><span className="pipe-step" aria-hidden>{i + 1}</span>{t.label}</span>
                {t.sub && <span className="pipe-sub">{t.sub}</span>}
                <span className="pipe-hint">{t.hint}</span>
              </span>
              {t.overdue > 0 && <span className="pipe-late"><WarningCircle size={12} weight="fill" aria-hidden /> {t.overdue} late</span>}
            </>
          ),
        }))} />
    </section>
  );
}
