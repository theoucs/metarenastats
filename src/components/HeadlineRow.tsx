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
 * Le bloc de droite : une étiquette en capitales, puis son contenu.
 *
 * L'étiquette fait écho à l'eyebrow du titre, à gauche et à la même hauteur.
 * C'est ce qui rattache le bloc à la page au lieu de le laisser flotter dans
 * le coin.
 */
export function HeaderAside({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex shrink-0 flex-col items-start gap-1.5 sm:mb-0 sm:items-end">
      <span className="text-micro font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
