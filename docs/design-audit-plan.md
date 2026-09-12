# MetArenaStats — Plan d'exécution de l'audit design/UX (2026-09-12)

Suite de `design-refresh-plan.md`. Ce document part d'un audit fait **sur captures
réelles** (11 pages, aux largeurs 1440 / 1279 / 820 / 390px) et liste les
correctifs à appliquer, dans un ordre où chaque phase est livrable seule.

> **✅ Plan entièrement exécuté le 2026-09-12.** Les 7 phases sont livrées et
> poussées sur `main` (un commit par phase). Ce document reste la référence du
> *pourquoi* de chaque choix — il décrit désormais l'état du code, pas un
> chantier à venir. Les écarts constatés à l'exécution sont notés en ligne,
> préfixés « À l'exécution ».

## Contraintes

- **Ne toucher ni aux données, ni aux calculs de stats, ni aux fetchs.**
  `lib/aggregate.ts`, `lib/tiers.ts` (sauf les 2 valeurs hex du §1.1),
  `lib/gameData.ts`, `lib/riotSearch.ts`, `app/api/**` : hors périmètre.
- Les choix actés dans `design-refresh-plan.md` §2 (rôles couleur : cyan =
  interactif, or = excellence, prismatique = marque, vert/rouge = qualité d'une
  stat) restent la loi. Rien ici ne les remet en cause.
- Tailwind v4 : pas de `tailwind.config.js`, tout se configure dans
  `src/app/globals.css`.

## Décision actée par Théo le 2026-09-12

> **Dès qu'il faut désigner une métrique comme plus importante qu'une autre,
> c'est Avg Placement.** Partout, sans exception.

C'est cohérent avec `lib/tiers.ts` qui pondère l'avg placement à 60% du score de
tier contre 20/20 pour %Top1/%Top3 : mettre autre chose en avant contredirait le
propre scoring du site.

La règle s'applique aux pilules de stats (§3.1) **et** à tous les endroits où un
seul chiffre est mis en vedette : cartes de grille, cartes mobiles, cartes du
podium de l'accueil, ordre des colonnes du tableau (§3.6).

**Seule exception, et elle n'est pas visuelle :** le tri par défaut du
Leaderboard (`StatsTable.tsx:464`, `variant === "ranked"` → `top3Rate`). Ce
tri *est* le classement lui-même — le changer change qui est n°1, ce qui relève
des données, hors périmètre de ce plan, et contredirait la copie de la page
(« Ranked by % Top 3 ») et `/info`. À traiter séparément si Théo veut revoir la
méthodologie du classement.

---

## Phase 1 — Tokens et fondations

Aucune page ne change de structure. Effet immédiat et global.

### 1.1 Contrastes sous le minimum AA

Mesuré (ratio WCAG contre `--bg-base #0A0B0F` / `--bg-raised #111318`) :

| Token | Valeur actuelle | Ratio | Verdict |
|---|---|---|---|
| `--text-muted` | `#646C7E` | **3.74 / 3.53** | échec (min 4.5 sous 18.66px) |
| tier D | `#5A6172` | **3.17** | échec, sur un badge 14px bold |

`--text-muted` porte les en-têtes de colonnes, les labels `MiniStat`, **les liens
de nav inactifs**, la ligne « Sample size », le footer, le `#1 · 127 games` —
souvent à 11px (`text-micro`).

- `globals.css:16` : `--text-muted: #646C7E` → **`#7A8294`** (5.10 / 4.82).
  Reste nettement sous `--text-secondary` (#9BA3B4, 7.77) : la hiérarchie à 3
  niveaux est préservée.
- `lib/tiers.ts` `TIER_STYLES.D` : `#5A6172` → **`#70798C`** (4.50) dans `text`,
  `bg`, `border` et `hex`. La descente or → cyan → indigo → gris reste intacte.

### 1.2 Échelle de rayons

Relevé sur `src/` : `rounded-lg` ×31, `rounded-md` ×18, `rounded-full` ×14,
`rounded-xl` ×10, plus `rounded-[10px]`, `rounded-[3px]`, `rounded-[4px]`.
Aucune règle.

Dans `@theme inline` de `globals.css`, après le bloc type scale :

```css
--radius-chip: 6px;     /* badges, pills de tri, petites icônes */
--radius-control: 8px;  /* inputs, boutons, groupes d'onglets */
--radius-card: 12px;    /* cartes, panneaux, tableaux */
```

Puis : `statsDisplay.tsx:50` `rounded-[10px]` → `rounded-xl`. Les `rounded-[3px]`
(barres de meter) et `rounded-[4px]` (icône prismatique) restent, ce sont des
détails sub-pixel assumés.

### 1.3 Focus visible

**Zéro `:focus-visible` dans tout le projet.** Pire : `HomeSearch.tsx:65` et
`NavSearch.tsx:93` font `outline-none` + `focus:border-accent`, donc au clavier on
perd l'anneau natif pour un changement de bordure de 1px.

Dans `globals.css`, après la règle `::selection` :

```css
:where(a, button, input, [role="tab"], [tabindex]):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Et retirer `outline-none` de `HomeSearch.tsx:65` et `NavSearch.tsx:93` (garder
`focus:border-accent`, les deux se cumulent bien).

### 1.4 Ancres sous le header sticky

Il y a des `id={entity-${row.key}}` (`StatsTable.tsx:274`, `StatsGrid.tsx:48`) et
un header sticky de 65px sans compensation : une ancre atterrit sous le header.

```css
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
[id^="entity-"] { scroll-margin-top: 80px; }
```

---

## Phase 2 — Cohérence structurelle

Le problème n°1 du site : à 1440px le bord gauche du contenu est à **x=296** sur
`/champions`, **x=232** sur `/combos`, **x=360** sur `/info`, pendant que le logo
du nav ne bouge pas. Le contenu saute latéralement à chaque navigation.

### 2.1 Une seule largeur de conteneur

Actuellement cinq :

| Largeur | Pages |
|---|---|
| `max-w-3xl` | `info`, `privacy`, l'état 404 de `players/[riotId]` |
| `max-w-4xl` | `champions`, `leaderboard`, `anvil` |
| `max-w-5xl` | `items`, `combos`, `comps`, `augments`, `champions/[slug]`, accueil |
| `max-w-6xl` | `Nav`, `players/[riotId]` |

→ **`mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12` partout**, aligné sur le nav.
Fichiers : `app/{champions,items,combos,comps,augments,anvil,leaderboard,info,privacy}/page.tsx`,
`app/page.tsx` (les deux `<section>`), `app/champions/[slug]/page.tsx` (banner
ligne 320 + contenu ligne 348), `app/players/[riotId]/page.tsx:41`.

Exception assumée : les pages de **texte** (`info`, `privacy`) gardent le
conteneur à `max-w-6xl` mais leurs paragraphes restent bornés par `max-w-2xl`
pour la longueur de ligne. Le bord gauche, lui, doit s'aligner.

Si le tableau Champions paraît trop aéré à 1152px, c'est la table qu'on élargit
(colonnes `% Top 3` / `% Top 1` plus larges), **pas** le conteneur qu'on rétrécit.

### 2.2 `/info` et `/privacy` passent par `PageHeader`

`info/page.tsx:4` et `privacy/page.tsx:9` ont un `<h1>` en `text-h1` (24px) sans
eyebrow, là où les 8 autres pages sont en `text-display` (32px) avec eyebrow.
Le titre est visiblement plus petit que partout ailleurs.

→ `<PageHeader eyebrow="Help" title="Info & Tips" />` et
`<PageHeader eyebrow="Legal" title="Privacy Policy & Terms of Service" />`.

### 2.3 Onglets et tri à la même taille

Ils sont empilés à 12px d'écart sur `/items`, `/augments`, `/comps`, `/combos` et
n'ont pas la même métrique :

- `TieredStatsTabs.tsx:81` (et :70 pour le variant « Soon ») : `px-4 py-1.5 text-sm`
- `StatsTable.tsx:199` (`SortControl`) : `px-3 py-1 text-small`

→ Aligner les deux sur **`px-3 py-1.5 text-small`**.

---

## Phase 3 — Hiérarchie

### 3.1 Pilules de stats : une métrique principale (Avg Placement)

`statsDisplay.tsx:44` (`StatPill`) rend 5 pilules strictement identiques :
`Avg Placement 3.01` et `% Played 0.7%` ont le même poids typographique
(`text-display`, 32px). Cinq chiffres au même poids = aucun chiffre.

**Ajouter une prop `emphasis` à `StatPill`** (pas un nouveau composant) :

```tsx
export function StatPill({ label, value, colorClass, emphasis = false }) {
  return (
    <div className={`rounded-xl border bg-raised px-4 py-2.5 text-center shadow-[var(--elev-1)] ${
      emphasis
        ? "border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] shadow-[var(--elev-2)]"
        : "border-subtle"
    }`}>
      <div className="text-micro uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-display font-semibold ${
        emphasis ? "text-display-lg" : "text-h1"
      } ${colorClass ?? "text-primary"}`}>
        {value}
      </div>
    </div>
  );
}
```

Soit : principale à **48px** (`text-display-lg`) sur fond cyan très dilué,
secondaires descendues de 32px à **24px** (`text-h1`).

- `champions/[slug]/page.tsx:367` : `<StatPill label="Avg Placement" … emphasis />`
- `players/[riotId]/page.tsx:130` : idem sur la pilule `Avg Placement`.

Grille, pour que la principale porte visuellement :

- Page champion (`:366`) : `grid grid-cols-2 gap-3 sm:grid-cols-5` →
  `grid grid-cols-2 gap-3 sm:grid-cols-4 [&>*:first-child]:col-span-2 [&>*:first-child]:sm:row-span-2 [&>*:first-child]:sm:col-span-1`
  — ou plus simple et suffisant : garder `sm:grid-cols-5` et ne changer que la
  typo + le fond. Tester les deux, garder le plus lisible.
- **Mobile** : en `grid-cols-2` avec 5 pilules, la 5e est orpheline sur sa ligne.
  Avec `emphasis` sur la 1ʳᵉ, mettre `[&>*:first-child]:col-span-2` : la
  principale prend toute la largeur en haut, les 4 autres font 2×2. Le compte
  tombe juste et la hiérarchie est portée par le layout.
- Page joueur (`:129`) : `sm:grid-cols-4` + `[&>*:first-child]:col-span-2` sur
  mobile, même logique avec 4 pilules.

### 3.2 La colonne TIER répète le badge sous sa propre bande

`StatsTable.tsx:286` : sur `/champions`, le badge `S` est affiché 24 fois
d'affilée juste sous la bande « S TIER ». 56px de largeur pour zéro information,
et ça dilue le signal doré.

→ Rendre la colonne conditionnelle à `!showBands` (donc elle réapparaît dès qu'on
trie par autre chose que Tier, où elle est vraiment utile) :
- `<th>` ligne 581 et `<td>` ligne 286 : `{variant === "tiers" && !showBands && …}`
- `colCount` ligne 514 : `variant === "tiers" ? (showBands ? 7 : 8) : 5`
- `showBands` est calculé ligne 515, **après** son premier usage utile — le
  remonter avant le `return`.

Même logique sur `StatsGrid.tsx:96` (`<TierBadge>` dans la carte) : le masquer
quand `showBands` est vrai.

### 3.3 Page champion : trois traitements pour un même niveau de section

`champions/[slug]/page.tsx` — `Best Augments` (:383) est un `h2` nu,
`Item Build` (:395) un `h2` **dans** une carte, `Top Combos` (:436) un `h2` nu.
Les trois sont pairs logiquement mais ne se lisent pas comme tels.

→ Sortir `Item Build` et `Anvil Run` de leurs `rounded-lg border bg-raised/40`
(`:394` et `AnvilRunPanel` ligne 140) : les titres remontent au niveau des deux
autres, et le contenu reste dans des cartes internes. Séparer les 3 sections par
`border-t border-subtle pt-8` au lieu du `mt-10` actuel.

### 3.4 Labels `MiniStat` : 75 répétitions → 5

`statsDisplay.tsx:59`. Sur la page champion, chaque carte d'augment/item affiche
`AVG · TOP 1 · TOP 3 · GAMES · PLAYED` en 11px. × ~15 cartes = les mêmes 5 mots
écrits 75 fois, pendant que les valeurs sont coincées à 12px (`text-xs`).

→ Écrire les labels **une seule fois** en en-tête de `AugmentColumn`
(`champions/[slug]/page.tsx:70`) dans une ligne `grid grid-cols-5 gap-1
text-center text-micro uppercase text-muted`, et ne garder que les valeurs dans
les cartes. Ça libère la place pour passer les valeurs de `text-xs` à
`text-small` (13px). Même traitement pour `PrismaticItemCard` (:109) et
`AnvilRunPanel` (:148).

### 3.5 Accueil : une seule section

`app/page.tsx:186` — un hero + le top 8 champions, puis le footer. Aucun point
d'entrée vers Items / Augments / Combos / Comps, soit la moitié du nav.

→ Ajouter une 3ᵉ section « Explore » : 4 cartes de lien (icône + titre + une
ligne de contexte type « 312 augments classés »), `grid-cols-2 lg:grid-cols-4`,
même matériau que `ChampionChip` (`rounded-lg border-subtle bg-raised/40`).
Pas de nouveau fetch : réutiliser les compteurs déjà chargés par `getSiteStats()`.

### 3.6 Appliquer la règle « AVG prime » partout

Aujourd'hui c'est `% Top 3` qui est en vedette dans **quatre** composants, en
`font-display text-h1` avec une barre de meter sous lui. Il faut inverser :
Avg Placement devient le grand chiffre, % Top 3 redescend dans la ligne de
stats secondaires, à la place qu'occupe l'avg aujourd'hui.

| Fichier | Ligne | Chiffre en vedette actuel |
|---|---|---|
| `StatsGrid.tsx` (`GridCard`) | 100 | `top3Rate` en `text-h1` + meter :108 |
| `StatsTable.tsx` (`MobileCard`) | 413 | `top3Rate` en `text-h1` + meter :421 |
| `app/page.tsx` (`ChampionSpotlight`) | 62 | `top3Rate` coloré, avg en gris derrière |
| `app/page.tsx` (`ChampionChip`) | 89 | `top3Rate` seul, avg absent |

Deux helpers manquent pour que ce soit faisable proprement — les deux sont du
**rendu**, pas du calcul, et vont dans `lib/statsDisplay.tsx` à côté de
`top3Color` / `top1Color` :

**a) Une couleur de qualité pour l'avg placement.** Le mode est à 6 équipes,
donc la moyenne attendue est **3.5**. Par analogie avec `top3Color` (±5pp autour
de son baseline de 50% pour le vert, −10pp pour le rouge) :

```ts
// Avg placement over 6 teams — baseline 3.5, and lower is better, so the
// comparisons are inverted relative to top3Color/top1Color.
export function avgPlacementColor(avg: number) {
  if (avg <= 3.2) return "text-stat-good";
  if (avg <= 3.7) return "text-secondary";
  return "text-stat-bad";
}
```

Les seuils sont un point de départ dérivé du baseline, **à valider à l'œil sur
`/champions`** : si trop de lignes ressortent en rouge ou en vert, resserrer,
et documenter le raisonnement en commentaire comme le fait déjà `top1Color`.
Vert/rouge sur ce chiffre reste conforme à `design-refresh-plan.md` §2 (vert et
rouge = qualité d'une stat, et l'avg placement en est une).

**b) Une largeur de meter pour une métrique où le petit est bon.**
`meterWidth(value, max)` (`StatsTable.tsx:245`) suppose « plus grand = mieux » ;
l'appliquer tel quel à l'avg donnerait une barre pleine pour le pire champion.

```ts
// Sibling of meterWidth for metrics where lower is better. Normalized against
// the batch's own best/worst rather than the theoretical 1..6, so the bars
// actually spread out instead of all sitting near the middle.
export function placementMeterWidth(avg: number, best: number, worst: number) {
  if (worst - best < 1e-9) return 50;
  return Math.max(3, Math.min(92, ((worst - avg) / (worst - best)) * 92));
}
```

`best` / `worst` se calculent comme `maxTop3` l'est déjà (`StatsTable.tsx:474`,
`StatsGrid.tsx:164`) : un `useMemo` sur les `rows`, min et max de `avgPlacement`.

**Contenu de la ligne secondaire après inversion**, dans les deux cartes
(`GridCard` :112 et `MobileCard` :425) : `Top 3` · `Top 1` · `Games` ·
`% Played`, avec `top3Color` / `top1Color` conservés sur leurs valeurs. On ne
perd aucun chiffre, ils changent juste de rang.

**Ordre des colonnes du tableau desktop** (`StatsTable.tsx:301-326` pour les
`<td>`, `:583-589` pour les `<th>`) : aujourd'hui
`Games · % Top 3 · % Top 1 · Avg Placement · % Played`, l'avg est en 4ᵉ.
→ `Avg Placement · % Top 3 · % Top 1 · Games · % Played`. La colonne la plus
importante arrive en premier après le nom, et c'est elle qui porte la barre de
heat map (les deux autres la gardent aussi, cf. §5.1).

Après ce changement, `maxTop3` reste nécessaire pour la barre de `% Top 3` —
ne pas le supprimer.

---

## Phase 4 — Responsive et navigation

Le 390px est **propre** : vérifié par mesure (aucun élément dont `right >
innerWidth` sur `/`, `/champions`, `/items`, `/combos`), le tableau bascule en
cartes sous `md`, le burger marche, `SlidingHighlight` gère le wrap. Ne rien
casser ici.

### 4.1 La bande 768–1279px est le trou noir du site — priorité absolue

`Nav.tsx:86` (liens en `xl:flex`), `:152` (NavSearch en `hidden xl:block`),
`:162` et `:175` (`xl:hidden`).

À **1279px** — MacBook Air en plein écran, iPad Pro paysage, une fenêtre non
maximisée sur un 1440 — le header ne contient qu'**un logo et un burger**. Ni
navigation, ni recherche, sur un écran de 1280px de large, sur un site de stats.
Capture de référence : `w1279-champions.png`.

→ Deux correctifs, à faire ensemble :

1. **Descendre les liens de `xl:` à `lg:`** (1024px) et compresser :
   `NavLink` (`Nav.tsx:54`) `px-2.5` → `px-2`, et la `<ul>` (`:86`)
   `gap-0.5` → `gap-0`. Budget à 1024 : logo ~180 + 8 liens × ~75 = 600 +
   recherche 220 ≈ 1000. Si ça ne passe pas au test, sortir `Info & Tips` du
   `LINKS` principal derrière un bouton `···`, ou raccourcir
   `Leaderboard` → `Ranks`.
2. **Rendre la `NavSearch` visible dès `md`**, indépendamment des liens :
   `:152` `hidden xl:block` → `hidden md:block`, avec `ml-auto` pour qu'elle se
   pousse à droite quand les liens sont encore masqués. C'est l'action à plus
   fort impact du plan : entre 768 et 1024 on garde le burger, mais la recherche
   — la fonction n°1 du site — redevient atteignable en un clic.

### 4.2 La table déborde de sa colonne sur la page joueur

`players/[riotId]/page.tsx:144` (`grid lg:grid-cols-[1fr_minmax(0,380px)]`) +
`StatsTable.tsx:575` (`min-w-[640px]`). « Top Champions » est une table à
`min-w-[640px]` dans une colonne de 380px : la colonne `% Top 3` est **coupée en
plein milieu des cellules**, avec un scroll horizontal sans aucune affordance.
Visible sur `d-player2.png`.

→ Ajouter une prop `compact?: boolean` à `StatsTable` qui :
- retire `min-w-[640px]` de la `<table>` (`:575`),
- masque les colonnes `Games` et `% Played` (`<th>` et `<td>`),
- réduit le padding des cellules à `px-2`.

Puis `<StatsTable rows={championRows} linkPrefix="/champions/" compact />` ligne 166.

### 4.3 Placeholder tronqué sur mobile

`HomeSearch.tsx:64` : `"Search a player (Name#TAG), champion, item or augment..."`
s'affiche `"…champion, iter"` à 390px.

→ Reprendre celui du `NavSearch` (`NavSearch.tsx:92`) :
`"Search player, champion, item…"`.

### 4.4 Podium trop haut sur mobile

`app/page.tsx:37` : `aspect-[3/2]` à 390px = ~500px par carte, donc 1,5 carte par
écran — trois swipes pour voir le top 3, sur un site fait pour checker entre deux
games.

→ `aspect-[16/9] sm:aspect-[3/4]`. Le commentaire existant ligne 32 explique déjà
pourquoi le paysage est le bon choix sur mobile ; il s'agit juste d'aller au bout.

---

## Phase 5 — Lisibilité des listes

### 5.1 Les barres de heat map se détachent des chiffres

`StatsTable.tsx:305` et `:314`. Le span est `absolute inset-y-[7px] left-0` avec
une largeur en % de la cellule, alors que le nombre est aligné **à droite**. Dès
que la valeur est basse, le rectangle teinté s'arrête avant le chiffre : on lit
un bloc vide flottant et un nombre orphelin. Très visible sur `/anvil` (colonne
% Top 1, ex. Aurelion Sol 28.6%) et sur `/champions` (Graves 19.8%).

→ Option retenue : **ancrer la barre à droite** — `left-0` → `right-0` sur les
deux spans. La barre grandit alors *sous* le nombre, le chiffre reste toujours
dans la zone teintée.

> **À l'exécution :** l'option retenue a suffi, le repli n'a pas été nécessaire.

Si le rendu manque de lisibilité en comparaison ligne à ligne, repli : vraie
piste — un fond `absolute inset-y-[7px] inset-x-0 rounded-[3px] bg-inset` + un
remplissage `absolute right-0` par-dessus, chiffre en `relative` au-dessus des deux.

**Ordre avec le §3.6 :** faire ce §5.1 d'abord (2 spans à corriger), puis §3.6,
qui ajoute une **3ᵉ** barre sur la colonne Avg Placement devenue première — elle
utilise `placementMeterWidth` et non `meterWidth`, mais copie le même markup
déjà corrigé ici. Dans l'autre sens on corrigerait trois spans au lieu de deux.

### 5.2 Densité du tableau

`StatsTable.tsx:274-326` : 57px/ligne (icône `h-9 w-9` + `py-2.5`) dans un
`max-h-[75vh]` → sur un 1440×900 on voit **11 champions sur 173** avant de
scroller, dans un scroll imbriqué. Référence u.gg : ~44px.

→ `py-2.5` → `py-1.5` sur les `<td>`, `sizeClass="h-9 w-9"` → `h-8 w-8`
(`NameCellContent`, :216, :220 et :228), `inset-y-[7px]` → `inset-y-[5px]` sur les
barres pour suivre. Résultat ~46px : 4 lignes gagnées par écran.

Vérifier au passage que `/leaderboard` (42px, sans icône) et `/champions` se
retrouvent au même rythme.

### 5.3 Bandes de tier sous-dimensionnées

`StatsTable.tsx:148` (`TierBandHeading`) : `text-micro` (11px) + un filet à 25%
d'opacité. C'est le seul repère structurel d'une liste de 173 lignes, et c'est
plus petit que le texte des cellules.

→ `font-display text-h2 font-semibold` (18px), et un fond sur toute la largeur :

```tsx
<div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 font-display text-h2 font-semibold"
     style={{
       color: style.hex,
       backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${style.hex} 14%, transparent), transparent 55%)`,
     }}>
```

Le composant est partagé par la table, les cartes mobiles et `StatsGrid` : un
seul changement couvre les 7 pages de listes.

---

## Phase 6 — Micro-interactions

L'existant est de bonne facture (`SlidingHighlight` 250ms ease-out +
`ResizeObserver` + `motion-reduce`, `scale-[1.04]` du podium, `Tooltip` clampé au
viewport, shimmer prismatique, bordure du nav au scroll). C'est le socle qui manque.

### 6.1 Aucun retour au clic

**Zéro `active:` dans tout le projet.** Sur mobile, taper un onglet de tri ne
renvoie rien pendant les 250ms d'animation du highlight.

→ `active:scale-[0.97] transition-transform duration-75` sur :
`StatsTable.tsx:199` (SortControl), `:93` (ShowMoreButton),
`TieredStatsTabs.tsx:81`, `ShowMoreNote.tsx:14`, `Nav.tsx:162` (burger).

### 6.2 Le hover de ligne détruit l'info de tier

`StatsTable.tsx:278` : `group-hover:border-l-[color:var(--accent)]` remplace le
rail coloré du tier par du cyan. La seule info couleur de la ligne disparaît
précisément au moment où on la regarde.

→ Garder `var(--rail)` et l'épaissir :
`border-l-2` → `group-hover:border-l-4 group-hover:-ml-0.5`, en retirant
l'override cyan. Le hover reste porté par `hover:bg-overlay` (:275).

### 6.3 Cartes de grille statiques

`StatsGrid.tsx:49` : seulement `hover:border-default hover:bg-overlay`.

→ `transition-[transform,border-color,background-color,box-shadow] duration-150
hover:-translate-y-0.5 hover:shadow-[var(--elev-2)]`
(+ `motion-reduce:hover:translate-y-0`).

### 6.4 Changement d'onglet sec

`TieredStatsTabs.tsx:96` : le contenu est remplacé d'un coup.

→ `@keyframes fade-in { from { opacity: 0; transform: translateY(4px) } }` dans
`globals.css`, puis envelopper le rendu dans
`<div key={active} className="motion-safe:animate-[fade-in_150ms_ease-out]">`.

### 6.5 Menu mobile sans animation

`Nav.tsx:174` : `{open && <div>}`, apparition instantanée.

→ Toujours monter le div, et animer par la grille :
`grid transition-[grid-template-rows] duration-200 ease-out` +
`grid-rows-[0fr]` / `grid-rows-[1fr]` selon `open`, enfant direct en
`overflow-hidden`. Garder `aria-expanded` et ajouter `inert` quand fermé.

---

## Phase 7 — Finition « waow »

### 7.1 Le hero de la page champion gâche son meilleur asset

`champions/[slug]/page.tsx:289-320`. 324px de splash, et le bloc nom est en
`pb-16`, c'est-à-dire dans la zone où le scrim vertical (`from-35%`, ligne 314)
est **100% opaque**. Visuellement : une image, puis une barre noire, puis le nom.
L'art et l'identité ne se touchent jamais.

→ Trois changements liés (les commentaires du fichier expliquent pourquoi les
valeurs actuelles sont ce qu'elles sont — les mettre à jour en même temps) :
1. `:320` `pb-16` → `pb-8`.
2. `:314` scrim vertical `from-35%` → `from-15%`.
3. `:358` remplacer le `-mt-8` (qui *exige* une zone opaque en bas du banner) par
   des pilules qui flottent par-dessus le splash :
   `bg-[var(--bg-base)]/70 backdrop-blur-md` sur `StatPill` quand elles
   chevauchent, et `-mt-12` pour un chevauchement franc et assumé.

> **À l'exécution :** `pb-8` était trop court — les pilules recouvraient
> « Rank #1 of 173 champions ». Il faut `pb-20` : le padding doit couvrir les
> 48px de chevauchement *plus* un vrai écart (80 − 48 = 32px d'air sous le nom).

### 7.2 Le skeleton de chargement est invisible

`players/[riotId]/loading.tsx` : `bg-raised` (#111318) sur `bg-base` (#0A0B0F)
= **1.06:1** de contraste. Sur la page joueur, qui attend plusieurs secondes
l'API Riot, l'écran a l'air vide ou cassé — confirmé sur capture (`d-player.png`
est une page quasi noire).

→ `bg-raised` → `bg-[color:var(--bg-overlay)]` (#171A21) sur tous les blocs, et
remplacer `animate-pulse` par un vrai shimmer :

```css
@keyframes shimmer { to { background-position: -200% 0; } }
```
```
bg-[linear-gradient(90deg,var(--bg-overlay),rgba(255,255,255,0.05),var(--bg-overlay))]
bg-[length:200%_100%] motion-safe:animate-[shimmer_1.4s_linear_infinite]
```

Aligner aussi la structure du skeleton sur le vrai layout de la page (4 pilules,
pas 4 blocs de 64px) pour supprimer le saut au chargement.

### 7.3 Halo de tier sur les cartes de grille

`StatsGrid.tsx:48` (`GridCard`) : icône 44px sur `bg-raised/40`, identique partout
sur `/items` et `/augments`. Correctif peu cher, effet immédiat :

```
before:pointer-events-none before:absolute before:inset-0 before:rounded-xl
before:bg-[radial-gradient(140px_70px_at_10%_0%,color-mix(in_srgb,var(--tier-hex)_18%,transparent),transparent)]
```

avec `--tier-hex` posé en style inline depuis `TIER_STYLES[tier].hex`, comme le
rail ligne 55 le fait déjà.

### 7.4 États vides

`StatsTable.tsx:234` (`EmptyState`), plus les 4 « No data yet. » de la page
champion : une boîte grise, sans icône ni action.
→ Icône en `text-muted` + une ligne d'explication + un lien vers la recherche.
Faible priorité, à faire en dernier.

---

## Trouvé pendant la vérification (corrigé)

Non prévu par le plan, détecté en repassant les 11 pages à 8 largeurs :

- **Tables à paires coupées entre 768 et 1024px.** Les lignes de `/combos`
  portent deux blocs icône+nom dans une seule cellule, donc la table réclame
  ~785px là où le reste du site tient en ~640px. À partir de `md` elle
  s'affichait quand même et les deux dernières colonnes étaient coupées dans le
  scrollport sans affordance — le défaut que le §4.2 corrige sur la page
  joueur. Ces lignes (`rows.some(r => r.secondaryName)`) gardent les cartes
  jusqu'à `lg`.
- **Bande de 25px sous le header, menu mobile fermé.** Le grid item du §6.5 ne
  doit porter ni padding ni bordure : ils survivent à la piste `0fr`. Trois
  niveaux de `div`, le padding tout à l'intérieur.
- **En-tête de colonnes désaligné** sur « Top Prismatic Items » de la page
  champion : le §3.4 écrit les 5 labels une fois au-dessus de la liste, ce qui
  suppose une liste en **une** colonne. Le bloc était en `sm:grid-cols-2`, donc
  l'en-tête couvrait les deux colonnes et les valeurs une seule. Passé en une
  colonne, comme le panneau Anvil Run voisin.

## Hors périmètre / reporté

Identifié pendant l'audit, volontairement **pas** dans ce plan :

- **Bandeau de fraîcheur des données** (`Patch 26.18 · mis à jour il y a 12 min`
  en tête des tier lists, comme u.gg / op.gg). Reporté par Théo le 2026-09-12 —
  pas pour tout de suite. Nécessiterait de toute façon une donnée de patch et un
  timestamp côté `lib/aggregate.ts`, donc ce n'est pas un chantier purement
  visuel.
- **Tri par défaut du Leaderboard** — cf. la décision actée en tête de document :
  c'est la méthodologie du classement, pas du rendu.
- **3 erreurs ESLint préexistantes** (`setState` synchrone dans un `useEffect`,
  dans `HomeSearch`, `Nav` et `NavSearch`) : antérieures à ce plan, vérifiées
  identiques avant et après. C'est du comportement, pas du rendu.

## Ordre de bataille

Si on ne fait que trois choses, ce sont celles-ci — les trois se voient sur
toutes les pages :

1. **§4.1** — nav et recherche invisibles entre 768 et 1279px.
2. **§2.1** — largeur de conteneur unique.
3. **§5.1** — barres de heat map ancrées à droite.

Ensuite, par ratio impact/coût : Phase 1 (tokens, tout est mécanique) → Phase 2 →
Phase 5 → Phase 3 → Phase 6 → Phase 7.

**§3.6 est la plus grosse pièce du plan** (4 composants, 2 helpers, l'ordre des
colonnes) et la plus visible : c'est elle qui change ce que l'œil lit en premier
sur les 7 pages de listes. La faire d'un bloc, après le §5.1, et vérifier
`/champions`, `/items`, `/comps` et l'accueil dans la foulée — pas en fin de
session.

## Comment vérifier

`npm run dev`, puis captures. **Piège** : Chrome headless impose une largeur de
fenêtre minimale de **500px** — un `--window-size=390,844` rend en réalité à 500
et recadre l'image à 390, ce qui fabrique un faux débordement horizontal. Pour
tester le mobile il faut passer par CDP (`Emulation.setDeviceMetricsOverride`)
avec `--remote-debugging-port`.

Largeurs à repasser après chaque phase : **1440, 1279, 1024, 820, 390**.
La 1279 et la 1024 sont celles qui cassent, ne pas les sauter.

Détection de débordement, à exécuter dans la page :

```js
[...document.querySelectorAll('*')].filter(el => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.right > innerWidth + 1;
});
```

(`html { overflow-x: hidden }` de `globals.css:166` masque le symptôme :
`document.scrollWidth` ne révèle **jamais** un débordement, il faut mesurer les
éléments un par un.)
