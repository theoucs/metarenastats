"use client";

import { useState } from "react";
import type { PatchContext } from "@/lib/patches";
import { HeadlineRow, HeaderAside } from "@/components/HeadlineRow";

/**
 * Bascule entre le patch courant et le précédent.
 *
 * ─── POURQUOI LES DEUX VUES SONT DÉJÀ RENDUES ───────────────────────────────
 *
 * Les deux vues sont rendues côté serveur et passées en props : React sait
 * transporter des éléments déjà rendus jusqu'à un composant client. La bascule
 * ne déclenche donc **aucune requête**, et la page reste entièrement statique —
 * c'est ce qui permet au CDN de continuer à absorber le trafic, ce que la
 * lecture d'un paramètre d'URL aurait fait perdre (elle rend la page dynamique
 * à chaque visite, y compris pour les visiteurs qui ne basculent jamais).
 *
 * Le prix est assumé : la page transporte les deux patchs, donc son poids
 * monte. Mesuré avant/après sur la plus lourde (combos) : 63 → 91 Ko
 * compressés.
 *
 * ─── POURQUOI LE BLOC DE TITRE PASSE PAR ICI ────────────────────────────────
 *
 * `children` est l'en-tête de page (PageHeader). Il traverse ce composant pour
 * une seule raison : le sélecteur doit se poser en haut à DROITE du titre, et
 * il partage son état avec la vue affichée plus bas. Les deux doivent donc
 * vivre dans le même composant client — d'où l'en-tête passé en enfant plutôt
 * qu'un `actions` sur PageHeader, qui aurait obligé à remonter l'état.
 */
export function PatchSwitch({
  context,
  views,
  children,
}: {
  context: PatchContext;
  /** Une vue par patch, déjà rendue côté serveur. */
  views: Record<string, React.ReactNode>;
  /** Le bloc de titre de la page, rendu côté serveur. */
  children?: React.ReactNode;
}) {
  const [selected, setSelected] = useState(context.defaultPatch ?? "");

  // Dernier filet : si la vue demandée manque, on montre la première qu'on a
  // plutôt que rien. Une page qui n'affiche que son titre est indiscernable
  // d'une page cassée, et Next.js la met en cache comme une réussite.
  const shownView = views[selected] ?? Object.values(views)[0] ?? null;

  // Un seul patch connu : pas de bascule à proposer, et surtout pas un
  // sélecteur à une seule option qui donnerait l'illusion d'un choix.
  if (context.options.length < 2) {
    return (
      <>
        {children}
        {shownView}
      </>
    );
  }

  const current = context.current;
  const thinCurrentPatch = current !== null && context.showingPrevious;
  const shown = context.options.find((option) => option.patch === selected);

  return (
    <>
      <HeadlineRow
        aside={
          <HeaderAside label="Patch">
            <div className="inline-flex rounded-lg border border-subtle bg-inset p-1">
              {context.options.map((option) => {
                const active = option.patch === selected;
                return (
                  <button
                    key={option.patch}
                    type="button"
                    onClick={() => setSelected(option.patch)}
                    aria-pressed={active}
                    className={`rounded-md px-3 py-1.5 font-medium tabular-nums transition-[color,transform] duration-75 active:scale-[0.97] ${
                      active ? "bg-raised text-primary" : "text-muted hover:text-secondary"
                    }`}
                  >
                    {option.patch}
                  </button>
                );
              })}
            </div>

          {/* Le nombre de matchs était collé au numéro de patch, dans la
              pastille : on lisait « 16.18 488 » sans savoir ce que comptait le
              488. Sorti du bouton et nommé, il redevient ce qu'il est — la
              taille de l'échantillon derrière la tier list affichée. */}
            {shown && (
              <span className="text-small text-muted">
                <span className="tabular-nums text-secondary">{shown.matches}</span> matches on
                this patch
              </span>
            )}
            {thinCurrentPatch && (
              <span className="text-small text-muted">
                {current.patch} is still too new to rank
              </span>
            )}
          </HeaderAside>
        }
      >
        {children}
      </HeadlineRow>
      {shownView}
    </>
  );
}
