# Plan : lisibilité, identité, navigation (audit design du 2026-09-28)

## Contexte

L'audit en captures (desktop 1440 + mobile 390) a montré un site propre mais :
- des stats moins lisibles qu'elles pourraient l'être : vert partout, blocs de couleur derrière chaque chiffre, tableau à scroll interne, nombres non formatés, couleurs de rang qui empruntent le vert/rouge des stats ;
- des tics qui font « site généré par IA » (sur-titres en majuscules espacées, tirets longs, section Explore générique, chiffres en police mono, badges NEW) ;
- un menu de 8 liens ;
- rien qui démarque le site des concurrents côté données.

Décisions de Théo :
- **L'ordre des tiers ne change pas.** Un S avec un avg un peu moins bon que la ligne en dessous, c'est normal : le score ne se limite pas à l'avg.
- **On garde le héros + top 3 en grand** sur l'accueil.
- **Menu** : Champions · Tier lists ▾ · Leaderboard.
- **Rangs** : emblèmes officiels.

Règles qui tiennent toujours : Avg Placement en tête, mobile vérifié à chaque étape, textes courts, commit + push dès qu'une phase marche.

Chaque phase est livrable seule, dans cet ordre.

---

## Phase 1 : Tableaux lisibles

Fichiers : `src/lib/statsDisplay.tsx`, `src/components/StatsTable.tsx`, `src/components/StatsGrid.tsx`.

1. **Couleurs rares.** Mesurer d'abord (SQL / snapshot 16.18) la distribution réelle de l'avg, du % Top 3 et du % Top 1 par champion, item et augment. Recaler ensuite les seuils de `avgPlacementColor` / `top3Color` / `top1Color` pour que seuls ~15 % de chaque extrême soient en vert ou en rouge, le reste en `text-primary` neutre. Je montre les chiffres à Théo avant de figer. Ces trois fonctions sont utilisées partout (tableaux, cartes, fiche champion, accueil), donc un seul changement suffit.
2. **Barres.** Supprimer les blocs de fond derrière % Top 3 et % Top 1 (`meterWidth` dans `DataRow`). Sur Avg Placement, remplacer le bloc par une barre fine (2-3 px) sous le chiffre. `placementMeterWidth` est réutilisé tel quel.
3. **Scroll de page.** Retirer le conteneur `max-h-[75vh] overflow-auto` : le tableau suit le scroll de la page et son en-tête reste collé sous la nav (`sticky top-[65px]`). Le tableau n'est affiché qu'à partir de `md`, où ses 640 px tiennent, donc plus besoin d'overflow. Le chargement progressif (`TABLE_PAGE_SIZE`, les 1 000 lignes du leaderboard) passe d'un `onScroll` interne à un `IntersectionObserver` sur une ligne sentinelle.
4. **Nombres formatés.** Ajouter `formatCount(n)` (`toLocaleString("en-US")`) dans `statsDisplay.tsx` et l'appliquer à Games, aux compteurs de l'accueil, à « matches on this patch » (`PatchSwitch`) et au leaderboard. `AnvilOpenerSwitch` le fait déjà en local, on le branche dessus. Au passage, trouver pourquoi l'accueil dit 126 814 et le leaderboard 126 094 (deux compteurs différents ?), puis aligner ou nommer chacun clairement.
5. **Cartes mobiles compactes** (`MobileCard`) : une ligne de ~56 px (rang, portrait, nom, avg en gros, Top 3 en petit), les autres stats en dessous en une ligne discrète. Le label « Avg Placement » n'est plus répété sur chaque carte : il est écrit une fois en tête de liste.
6. **Grilles Augments / Comps** (`StatsGrid`) : même principe, le label « AVG PLACEMENT » répété sur chaque carte disparaît, les libellés sont écrits une fois au-dessus.

## Phase 2 : Retirer les tics IA

1. **Sur-titres** : supprimer `eyebrow` de `PageHeader` (TIER LIST, RANKINGS…) et celui de l'accueil (« LEAGUE OF LEGENDS ARENA · 3V3 THREE BY SIX »). « PATCH » / « SCOPE » au-dessus des sélecteurs deviennent inutiles ou passent en ligne. Les en-têtes de colonnes restent (c'est leur place).
2. **Tirets longs** : grep de `—` dans les textes affichés de `src/app` et `src/components` (pas dans les commentaires), puis réécriture de chaque phrase (point, virgule, parenthèse).
3. **Section Explore** supprimée de l'accueil. Elle sera remplacée en phase 5. Le sous-titre « Highest-scoring champions right now, by tier score. » disparaît ; le titre devient concret (ex. « Top champions · 16.18 »).
4. **Chiffres** : `font-mono` → police normale + `tabular-nums` sur toutes les stats, colonnes toujours alignées.
5. **Typographie** : Bricolage + Geist est devenu un duo par défaut. Je fais 3 captures de l'accueil et d'une tier list avec 3 polices d'affichage gratuites (Google Fonts) qui ont du caractère, et Théo choisit. Le corps de texte peut suivre si la capture le justifie.
6. **Logo** : 2-3 variantes montrées en capture (wordmark seul, monogramme sans carré dégradé), Théo choisit.

## Phase 3 : Navigation, rangs, fiche champion

1. **Menu** (`src/components/Nav.tsx`) : `Champions · Tier lists ▾ · Leaderboard`, avec la recherche à droite.
   - Le déroulant contient Items, Augments, Team Comps, Combos, Anvil Run.
   - Accessible : bouton `aria-expanded`, Échap, clic dehors, navigation au clavier. « Tier lists » est actif quand on est sur une de ses pages.
   - Sur mobile, le menu hamburger montre les mêmes liens groupés sous un intertitre.
   - Badges NEW retirés. Info & Tips passe dans `Footer.tsx`.
2. **Emblèmes de rang** (`src/components/RankBadge.tsx`) : l'icône officielle (CommunityDragon, `ranked-emblem/emblem-<tier>.png`, URL à vérifier pour les 10 paliers) plus le nom en texte neutre. `RANK_STYLES` disparaît. Même chose en taille `lg` sur la page joueur.
3. **Fiche champion** (`src/app/champions/[slug]/championPage.tsx`, `championSections.tsx`) :
   - la rangée de stats occupe toute la largeur ;
   - « Top prismatic items » devient un mini-tableau compact (nom + 5 colonnes serrées) au lieu de cartes étalées sur toute la largeur ;
   - les colonnes Silver/Gold/Prismatic passent au même format compact.

## Phase 4 : Accueil

- Héros et podium conservés. Compteurs formatés (phase 1) sans police mono.
- Mobile : podium un peu moins haut (ratio plus large) pour voir les chiffres plus vite.
- Place libérée par Explore : réservée au bloc « Gagnants / perdants du patch » (phase 5).

## Phase 5 : Nouvelles données (la vraie différence)

**On mesure en SQL avant de construire**, puis je montre les chiffres à Théo.

1. **Distribution des placements (1er → 6e).**
   - Les participations des patchs publiés gardent `placement` (`match_participants_v2`). On ajoute les comptes par place à la fonction SQL d'agrégation champion (même style que les `count(*) filter (where placement = …)` existants), aux types de `src/lib/aggregate.ts` et au snapshot.
   - Nouveau composant `PlacementBars` : 6 barres fines en colonne du tableau desktop, en grand sur la fiche champion.
   - D'abord les champions. Items et augments ensuite si la charge reste correcte (plafonds de lecture : `docs/later.md`).
2. **Évolutions d'un patch à l'autre.**
   - Vérifier si le snapshot du patch précédent existe encore (clés `patchedKey` dans le stockage) ou s'il faut le garder à l'archivage.
   - Ensuite : flèche ↑/↓ + nombre de places dans les tableaux, et le bloc « Gagnants / perdants du patch » sur l'accueil.

---

## Vérification (à chaque phase)

- `npm run lint` et `npm run build` sans erreur.
- Captures avant/après avec `scripts/screenshot.mjs` en local : desktop et `--mobile`, sur `/`, `/champions`, `/champions/ahri`, `/augments`, `/comps`, `/anvil`, `/leaderboard`. Plus une vérif à ~820 px (bande 768-1279 px, la plus fragile).
- Phase 1 : le tableau défile avec la page, l'en-tête reste visible, les 1 000 lignes du leaderboard arrivent en scrollant, et le filtre trouve toujours toutes les lignes.
- Phase 3 : déroulant testé à la souris, au clavier (Tab, Entrée, Échap) et sur mobile.
- Phase 5 : les chiffres SQL recoupent les totaux existants (somme des comptes = games, moyenne recalculée = avg affichée).
- Commit + push à la fin de chaque phase qui marche.

---

## Avancement

- **Phase 1 faite (2026-09-28).** Couleurs relatives à la liste (choix de Théo, mesures ci-dessous), jauge fine sur l'avg seulement, tableau au scroll de la page avec en-tête collé, compteurs formatés, cartes mobiles compactes, « AVG PLACEMENT » retiré des cartes. Écart de compteur accueil/leaderboard : deux snapshots du même compteur pris à des heures différentes ; le leaderboard lit maintenant celui de l'accueil.
  Mesures 16.18 (lignes ≥ 100 parties), % Top 3 en vert avec les anciens seuils fixes : items 113/169, augments 82/233, champions 14/173 (et aucun avg de champion vert).
  Reporté en phase 3 : les mini-listes de la fiche champion gardent les seuils fixes jusqu'à leur refonte.
- À noter pour la phase 5 : seuls les snapshots 16.18 et 16.19 existent en base, il n'y a plus de 16.17. Pour les évolutions d'un patch à l'autre, il faudra conserver le snapshot du patch précédent.
- **Phase 2 faite (2026-09-28).** Sur-titres, pastilles NEW des titres, tirets longs des textes affichés, section Explore et police mono retirés. Typo choisie par Théo sur captures : **Chakra Petch** (titres, gros chiffres) + **IBM Plex Sans** (texte, chiffres des tableaux). Logo : **le dé est gardé** (Théo : il rappelle l'aléatoire de l'Arena, les 3 points les équipes de 3, et il a son animation).
- **Phase 3 faite (2026-09-28).** Menu « Champions · Tier lists ▾ · Leaderboard » (déroulant accessible au clavier, tient dès 768 px), Info & Tips dans le pied de page. Rangs : emblèmes officiels recadrés en WebP de ~5 Ko dans `public/img/rank`, nom en texte neutre. Fiche champion : 5e case Games, couleurs des cases relatives à la tier list champions, cartes remplacées par des mini-tableaux (`MiniStatTable`) dont les couleurs se mesurent sur la liste complète du champion.
