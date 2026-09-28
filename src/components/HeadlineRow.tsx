import type { ReactNode } from "react";

/**
 * La rangée d'ouverture d'une page de stats : le titre à gauche, la portée des
 * données à droite.
 *
 * Existe pour que les sept pages aient le même rythme. Le sélecteur de patch
 * (tier lists) et la mention « toutes patches » (classement) vivent dans des
 * composants différents pour des raisons d'état, mais ils doivent tomber au
 * même endroit, à la même hauteur — d'où cette mise en page unique plutôt que
 * deux `flex` recopiés qui divergeront au premier ajustement.
 */
export function HeadlineRow({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 flex-1">{children}</div>
      {aside}
    </div>
  );
}

/**
 * Le bloc de droite, aligné sur le haut du titre.
 *
 * Il portait une étiquette en capitales espacées (« PATCH », « SCOPE ») qui
 * répondait au sur-titre de gauche. Les deux sont partis ensemble le
 * 2026-09-28 : c'est le tic le plus reconnaissable des sites générés, et le
 * contenu se nomme lui-même (le sélecteur dit « Patch »).
 */
export function HeaderAside({ children }: { children: ReactNode }) {
  return (
    // `sm:mb-7` et non `sm:mb-0` : sur une page sans description, cette colonne
    // est PLUS HAUTE que le titre, c'est donc elle qui fixe la hauteur de la
    // rangée. Sans marge basse, le contrôle suivant se collait à elle et la
    // pile — étiquette, sélecteur, compteur, filtre — se lisait comme un seul
    // amas dans le coin. La marge reprend celle de PageHeader, donc la
    // séparation est la même quelle que soit la colonne la plus haute.
    <div className="mb-6 flex shrink-0 flex-col items-start gap-1.5 sm:mb-7 sm:items-end">
      {children}
    </div>
  );
}
