/**
 * Le patch sur lequel des stats sont calculées.
 *
 * Ce n'est pas décoratif : sans lui, rien ne distingue une tier list du patch
 * courant d'une tier list périmée, alors que c'est toute la différence entre
 * une recommandation et un souvenir.
 *
 * Sert aux pages qui n'ont pas de sélecteur (page de champion, où le patch
 * arrive par l'URL). Les tier lists, elles, affichent le patch à même leur
 * sélecteur — voir PatchSwitch.
 */
export function PatchBadge({ patch, matches }: { patch: string; matches?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-full border border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-accent">
        Patch {patch}
      </span>
      {matches !== undefined && (
        <span className="text-small text-muted">
          {matches} match{matches === 1 ? "" : "es"}
        </span>
      )}
    </span>
  );
}
