"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Keep this much clear space between the bubble and the viewport edge. */
const VIEWPORT_MARGIN = 8;

/** Distance entre la bulle et l'élément survolé. */
const GAP = 6;

type Placement = { top: number; left: number };

/**
 * Bulle de survol instantanée (pas le `title=""` natif).
 *
 * Rendue dans un **portail vers `document.body`**, et non à côté de l'élément
 * survolé. Une bulle en `position: absolute` est découpée par le premier
 * ancêtre qui rogne son contenu, et le site en a trois :
 *
 *  - `overflow-hidden` sur les cartes de tier list (il détoure le dégradé de
 *    tier aux coins arrondis) ;
 *  - `max-h-[75vh] overflow-auto` sur le conteneur scrollable des tableaux ;
 *  - `hover:-translate-y-0.5` sur ces mêmes cartes — et c'est le point
 *    décisif : un `transform` crée un bloc conteneur, si bien que même
 *    `position: fixed` resterait rogné. Seul un nœud sorti de l'arbre y échappe.
 *
 * Les infobulles de description, plus hautes que les anciennes bulles d'un seul
 * nom, rendaient ce découpage visible : sur les tier lists d'items et
 * d'augments, elles n'apparaissaient plus du tout.
 *
 * La position est donc calculée en JavaScript au survol. C'est aussi ce qui
 * permet de placer la bulle sous l'élément quand elle ne tient pas au-dessus.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  // `null` = masquée, donc rien n'est monté : une page joueur porte ~900
  // infobulles, aucune ne doit coûter un nœud tant qu'on ne la survole pas.
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [visible, setVisible] = useState(false);

  const show = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // Position provisoire : la bulle doit exister pour être mesurée. Elle est
    // posée au-dessus, centrée, et corrigée juste après dans le layout effect.
    setPlacement({ top: rect.top, left: rect.left + rect.width / 2 });
  }, []);

  const hide = useCallback(() => {
    setPlacement(null);
    setVisible(false);
  }, []);

  // La bulle étant sortie de l'arbre, elle ne suit plus l'élément : au
  // défilement elle resterait figée à l'écran, détachée de son icône. On la
  // masque plutôt que de la repositionner en continu — le survol la rouvrira.
  useLayoutEffect(() => {
    if (!placement) return;
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("resize", hide, { passive: true });
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [placement, hide]);

  // useLayoutEffect : la correction doit intervenir avant la peinture, sinon la
  // bulle apparaît une image au mauvais endroit puis saute.
  //
  // Un ResizeObserver la rejoue à chaque changement de taille, et c'est
  // indispensable : les descriptions arrivent en asynchrone, si bien que la
  // bulle est d'abord mesurée avec le seul nom (~29 px) puis grandit (~64 px).
  // Comme elle est ancrée par le haut, elle s'étendait alors vers le bas et
  // recouvrait l'icône survolée.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!placement || !trigger || !bubble) return;

    const reposition = () => {
      const anchor = trigger.getBoundingClientRect();
      const { width, height } = bubble.getBoundingClientRect();

      // Horizontal : centrée sur l'élément, ramenée dans la fenêtre si elle
      // déborde — c'est le cas de chaque icône en bout de ligne sur téléphone.
      let left = anchor.left + anchor.width / 2 - width / 2;
      left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN);

      // Vertical : au-dessus par défaut ; en dessous s'il n'y a pas la place et
      // qu'il y en a davantage en bas.
      let top = anchor.top - height - GAP;
      if (top < VIEWPORT_MARGIN) {
        const below = anchor.bottom + GAP;
        if (below + height <= window.innerHeight - VIEWPORT_MARGIN || below > VIEWPORT_MARGIN) {
          top = below;
        } else {
          top = VIEWPORT_MARGIN;
        }
      }

      bubble.style.top = `${Math.round(top)}px`;
      bubble.style.left = `${Math.round(left)}px`;
      setVisible(true);
    };

    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(bubble);
    return () => observer.disconnect();
  }, [placement]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {placement !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            className={`pointer-events-none fixed z-50 w-max max-w-[calc(100vw-2rem)] rounded-md border border-default bg-inset px-2.5 py-1.5 text-micro text-primary shadow-[var(--elev-3)] transition-opacity duration-100 ${
              visible ? "opacity-100" : "opacity-0"
            }`}
            style={{ top: placement.top, left: placement.left }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
