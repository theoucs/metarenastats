import { SampleSizeBadge } from "@/components/StatsTable";
import { PatchBadge } from "@/components/PatchBadge";
import type { PatchContext } from "@/lib/patches";

/**
 * The header block every list page opens with. Before this existed each page
 * hand-rolled its own out of leftover `text-zinc-*` / `text-2xl` classes that
 * predate the design tokens — so the six pages were subtly inconsistent while
 * looking copy-pasted. One component, the real type scale (--text-display /
 * --text-h1), and an eyebrow that says which *kind* of page you're on.
 */
export function PageHeader({
  eyebrow,
  title,
  isNew,
  description,
  totalMatches,
  patch,
  children,
}: {
  /** Short category label above the title — "Tier list", "Rankings", etc. */
  eyebrow: string;
  title: string;
  /** Renders a "New" pill beside the title. */
  isNew?: boolean;
  description?: React.ReactNode;
  /** Renders the shared sample-size line when provided. */
  totalMatches?: number;
  /** Renders the patch badge, and replaces the sample-size line: sur une page
   *  filtrée par patch, « N matchs suivis » induirait en erreur puisque le
   *  chiffre affiché ne couvre que ce patch. */
  patch?: PatchContext;
  /** Extra notes under the description (caveats, cross-links). */
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-7">
      <p className="text-micro font-semibold uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
        <h1 className="font-display text-display font-semibold tracking-tight text-primary">
          {title}
        </h1>
        {isNew && (
          <span className="rounded-full border border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-accent">
            New
          </span>
        )}
      </div>
      {description && <p className="mt-2 max-w-2xl text-secondary">{description}</p>}
      {children}
      {patch ? (
        <div className="mt-4">
          <PatchBadge context={patch} />
        </div>
      ) : (
        totalMatches !== undefined && (
          <div className="mt-4">
            <SampleSizeBadge totalMatches={totalMatches} />
          </div>
        )
      )}
    </header>
  );
}
