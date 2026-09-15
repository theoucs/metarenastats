"use client";

import { useState, type ReactNode } from "react";

/**
 * Replie une note de méthode sous le titre, pour que le visiteur de passage ne
 * la prenne pas en pleine figure.
 *
 * `label` n'est pas décoratif : « Show more » tout seul ne dit pas ce qu'il y a
 * de plus, donc personne ne clique — ou alors sans savoir sur quoi. Nommer la
 * note lui donne sa seule chance d'être lue par qui la cherche.
 */
export function ShowMoreNote({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // Volontairement discret : c'est une note de méthode, pas le sujet de
        // la page. En accent sous un titre sans description, elle se lisait
        // comme un sous-titre et criait plus fort que le titre lui-même.
        className="text-small text-muted underline decoration-dotted underline-offset-4 transition-colors duration-75 hover:text-secondary"
      >
        {open ? `${label} \u2191` : `${label} \u2193`}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
