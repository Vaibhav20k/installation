/**
 * The Factory workspace home (docs/plans/workspaces-design.md §2.2): six tiles in the order the factory works
 * (To send → At site check → Accounts → Ready to load → On the truck → Replacements), the chosen tile's list with one
 * button per row for the viewer's own department, then "Your steps" on complaints. Every tile's list is rendered once
 * and StagePicker switches instantly, keeping ?stage= in the address. Buttons open the record's own step form.
 */
import Link from "next/link";
import { ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { Db } from "@/server/db/client";
import type { Actor } from "@/server/auth/permissions";
import { TZ } from "@/lib/format";
import { PageHeader } from "@/components/ui/Notice";
import { defaultFactoryTile, factoryPipeline, isFTileKey, type FTileKey, type FactoryRow, type PhaseCount } from "@/server/queries/factory-pipeline";
import { FactoryRowItem } from "./FactoryRows";
import { StagePicker } from "@/components/home/StagePicker";

const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const STEPS_SHOWN = 6;

function PhaseRow({ phases }: { phases: PhaseCount[] }) {
  return (
    <nav aria-label="Replacements by phase">
      <ol className="fac-phases">
        {phases.map((p) => (
          <li key={p.code}>
            <Link href={`/complaints?phase=${p.code}`} data-zero={p.n === 0 || undefined} data-overdue={p.overdue > 0 || undefined}
              aria-label={`${p.label}: ${p.n} open${p.overdue ? `, ${p.overdue} overdue` : ""}`}>
              <span className="fac-phase-n">{p.n}</span>
              <span className="fac-phase-label">{p.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function YourSteps({ rows }: { rows: FactoryRow[] }) {
  const shown = rows.slice(0, STEPS_SHOWN);
  const late = rows.filter((r) => r.overdue).length;
  return (
    <section className="plate fac-steps" aria-labelledby="h-fac-steps">
      <div className="plate-head">
        <h2 id="h-fac-steps" style={{ margin: 0 }}>Your steps</h2>
        <span className="code-tag">{rows.length} waiting{late ? ` · ${late} overdue` : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="home-allclear"><CheckCircle size={22} weight="fill" aria-hidden /> No complaint step is waiting for your department.</p>
      ) : (
        <>
          <p className="small muted fac-note">Complaint steps your department does, oldest and overdue first.</p>
          <ul className="pipe-rows" aria-labelledby="h-fac-steps">{shown.map((r) => <FactoryRowItem key={r.key} r={r} />)}</ul>
          <Link className="fac-more" href="/complaints">
            {rows.length > shown.length ? `See all ${rows.length} in Complaints` : "Open Complaints"} <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        </>
      )}
    </section>
  );
}

function Panel({ tile, rows, phases }: { tile: { key: FTileKey; label: string; n: number; hint: string; unit: string }; rows: FactoryRow[]; phases: PhaseCount[] }) {
  const id = `h-fac-list-${tile.key}`;
  return (
    <>
      <div className="pipe-list-head">
        <h3 id={id}>{tile.label} <span className="pipe-count">{tile.n}</span></h3>
        <p className="small muted">{tile.hint}. {tile.unit}</p>
      </div>
      {tile.key === "replace" && <PhaseRow phases={phases} />}
      {rows.length === 0 ? (
        <p className="home-allclear"><CheckCircle size={22} weight="fill" aria-hidden /> Nothing here right now.</p>
      ) : (
        <ul className="pipe-rows" aria-labelledby={id}>{rows.map((r) => <FactoryRowItem key={r.key} r={r} />)}</ul>
      )}
    </>
  );
}

export async function FactoryHome({ db, actor, now, sp }: { db: Db; actor: Actor; now: number; sp: Record<string, string | undefined> }) {
  const p = await factoryPipeline(db, actor, now);
  const selected: FTileKey = isFTileKey(sp.stage) ? sp.stage : defaultFactoryTile(p.tiles);
  const open = p.tiles.filter((t) => t.key !== "send").reduce((n, t) => n + t.n, 0);
  const late = p.tiles.reduce((n, t) => n + t.overdue, 0);
  return (
    <>
      <PageHeader title="Factory" subtitle={`${dateFmt.format(now)}, Asia/Kolkata`} />
      <section className="plate fac-pipe" aria-labelledby="h-fac-pipe">
        <div className="plate-head">
          <h2 id="h-fac-pipe" style={{ margin: 0 }}>Factory pipeline</h2>
          <span className="code-tag">{p.tiles[0]!.n} to send · {open} in progress{late ? ` · ${late} overdue` : ""}</span>
        </div>
        <StagePicker initial={selected} navLabel="Factory stages" stripClass="pipe-strip fac-strip" listClass="pipe-list fac-list"
          panels={Object.fromEntries(p.tiles.map((t) => [t.key, <Panel key={t.key} tile={t} rows={p.rows[t.key]} phases={p.phases} />]))}
          tiles={p.tiles.map((t, i) => ({
            key: t.key, href: `/?stage=${t.key}`, overdue: t.overdue > 0, empty: t.n === 0,
            label: `${t.label}: ${t.n}${t.overdue ? `, ${t.overdue} overdue` : ""}${t.mine ? `, ${t.mine} for you` : ""}`,
            body: (
              <>
                <span className="pipe-n">{t.n}</span>
                <span className="pipe-text">
                  <span className="pipe-label"><span className="pipe-step" aria-hidden>{i + 1}</span>{t.label}</span>
                  <span className="pipe-hint">{t.hint}</span>
                </span>
                {t.overdue > 0 && <span className="pipe-late"><WarningCircle size={12} weight="fill" aria-hidden /> {t.overdue} late</span>}
              </>
            ),
          }))} />
      </section>
      {p.yourSteps && <YourSteps rows={p.yourSteps} />}
    </>
  );
}
