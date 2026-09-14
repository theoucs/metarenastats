"use client";

import { useState } from "react";
import type { PatchContext } from "@/lib/patches";

/**
 * Bascule entre le patch courant et le précédent.
 *
 * Les deux vues sont rendues côté serveur et passées en props : React sait
 * transporter des éléments déjà rendus jusqu'à un composant client. La bascule
 * ne déclenche donc **aucune requête**, et la page reste entièrement statique —
 * c'est ce qui permet au CDN de continuer à absorber le trafic, ce que la
 * lecture d'un paramètre d'URL aurait fait perdre (elle rend la page dynamique
 * à chaque visite, y compris pour les visiteurs qui ne basculent jamais).
 *
 * Le prix est assumé : la page transporte les deux patchs, donc son poids
 * double. Mesuré avant/après sur la plus lourde (combos) : 63 → 126 Ko
 * compressés. Sur les cinq autres, on reste entre 24 et 66 Ko.
 */
export function PatchSwitch({
  context,
  views,
}: {
  context: PatchContext;
  /** Une vue par patch, déjà rendue côté serveur. */
  views: Record<string, React.ReactNode>;
}) {
  const [selected, setSelected] = useState(context.defaultPatch ?? "");

  // Un seul patch connu : pas de bascule à proposer, et surtout pas un
  // sélecteur à une seule option qui donnerait l'illusion d'un choix.
  if (context.options.length < 2) {
    return <>{views[selected] ?? null}</>;
  }

  // La mention se montre dès que le patch courant est trop maigre, quel que
  // soit l'onglet actif. Ne l'afficher que sur l'onglet du patch récent était
  // une erreur : c'est justement sur la vue PAR DÉFAUT qu'elle répond à la
  // question « pourquoi je vois 16.17 alors que 16.18 est sorti ? ».
  const current = context.current;
  const thinCurrentPatch = current !== null && context.showingPrevious;

  return (
    <>
      <div className="mb-3 flex flex-col items-start gap-1.5 text-small sm:flex-row sm:items-center sm:gap-2">
        <span className="shrink-0 text-muted">Patch:</span>
        <div className="inline-flex flex-wrap rounded-lg border border-subtle bg-inset p-1">
          {context.options.map((option) => {
            const active = option.patch === selected;
            return (
              <button
                key={option.patch}
                type="button"
                onClick={() => setSelected(option.patch)}
                aria-pressed={active}
                className={`rounded-md px-3 py-1.5 font-medium transition-[color,transform] duration-75 active:scale-[0.97] ${
                  active ? "bg-raised text-primary" : "text-muted hover:text-secondary"
                }`}
              >
                {option.patch}
                <span className={`ml-1.5 tabular-nums ${active ? "text-secondary" : "text-muted"}`}>
                  {option.matches}
                </span>
              </button>
            );
          })}
        </div>
        {thinCurrentPatch && (
          <span className="text-muted">
            {current.patch} just released — not enough games yet
          </span>
        )}
      </div>
      {views[selected] ?? null}
    </>
  );
}
