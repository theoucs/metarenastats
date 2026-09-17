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
 *
 * Le nombre affiché est celui DU SUJET de la page, pas celui de l'échantillon.
 * Il portait le total du patch — 7 476 matchs — sur la page d'un champion qui
 * en avait joué 1 122 : à côté d'un nom de champion, ce chiffre ne pouvait se
 * lire que comme le sien. La tier list annonce « Sett, 1 122 games » ; sa page
 * dit maintenant la même chose.
 */
export function PatchBadge({ patch, games }: { patch: string; games?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-full border border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-accent">
        Patch {patch}
      </span>
      {games !== undefined && (
        <span className="text-small text-muted">
          {games} game{games === 1 ? "" : "s"}
        </span>
      )}
    </span>
  );
}
