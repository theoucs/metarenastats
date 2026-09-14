import type { PatchContext } from "@/lib/patches";

/**
 * Le patch sur lequel une tier list est calculée.
 *
 * Ce n'est pas décoratif : sans lui, rien ne distingue une tier list du patch
 * courant d'une tier list périmée, alors que c'est toute la différence entre
 * une recommandation et un souvenir.
 *
 * Le cas « on affiche le patch précédent » est le seul qui mérite une phrase :
 * un visiteur qui voit 16.17 alors que 16.18 est sorti doit comprendre que
 * c'est un choix, pas un retard.
 */
export function PatchBadge({ context }: { context: PatchContext }) {
  if (!context.defaultPatch) return null;

  const shown = context.showingPrevious ? context.previous : context.current;
  if (!shown) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="rounded-full border border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] px-2.5 py-0.5 text-micro font-bold uppercase tracking-wide text-accent">
        Patch {shown.patch}
      </span>
      <span className="text-small text-muted">
        <span className="text-secondary">{shown.matches}</span> match
        {shown.matches === 1 ? "" : "es"} on this patch
      </span>
      {context.showingPrevious && context.current && (
        <span className="text-small text-muted">
          — {context.current.patch} just released, {context.current.matches} match
          {context.current.matches === 1 ? "" : "es"} so far
        </span>
      )}
    </div>
  );
}
