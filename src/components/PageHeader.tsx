import { SampleSizeBadge } from "@/components/StatsTable";

/**
 * The header block every list page opens with: one component, the real type
 * scale (--text-display), so the pages share a rhythm.
 *
 * No eyebrow ("TIER LIST", "RANKINGS") and no "New" pill any more
 * (2026-09-28): small spaced capitals above every title are the most
 * recognisable tic of generated sites, and the nav already says where you are.
 */
export function PageHeader({
  title,
  description,
  totalMatches,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  /** Renders the shared sample-size line when provided. */
  totalMatches?: number;
  /** Extra notes under the description (caveats, cross-links). */
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-7">
      <h1 className="font-display text-display font-semibold tracking-tight text-primary">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-secondary">{description}</p>}
      {children}
      {totalMatches !== undefined && (
        <div className="mt-4">
          <SampleSizeBadge totalMatches={totalMatches} />
        </div>
      )}
    </header>
  );
}
