/**
 * Evidence on a saved record, for its author and reviewers. Images lazy-load; videos are click-to-play and
 * never preload or autoplay. Files are served through the permission-checked route only.
 */
import { FilePdf, FilmStrip } from "@phosphor-icons/react/dist/ssr";
import type { EvidenceItem } from "@/server/services/evidence";
import { when } from "@/lib/format";

export function EvidenceGallery({ items, title = "Attached evidence" }: { items: EvidenceItem[]; title?: string }) {
  if (!items.length) return null;
  return (
    <figure className="evidence-gallery" aria-label={title}>
      <figcaption className="small muted">{title} ({items.length}). Evidence supports review; it does not prove completion or change any recorded value.</figcaption>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            {i.mediaType === "document"
              ? <a href={`/api/evidence/file/${i.id}`} className="evidence-doc"><FilePdf size={28} aria-hidden /> Download PDF</a>
              : i.mediaType === "image"
              ? <a href={`/api/evidence/file/${i.id}`} target="_blank" rel="noreferrer"><img src={`/api/evidence/file/${i.id}`} alt={i.caption ?? i.name} loading="lazy" decoding="async" /></a>
              : <video controls preload="none" aria-label={i.caption ?? i.name}><source src={`/api/evidence/file/${i.id}`} type={i.mime} /><FilmStrip size={20} aria-hidden /> {i.name}</video>}
            <span className="small">{i.caption ?? i.name}</span>
            <span className="small muted">{i.by} · {when(i.at)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
