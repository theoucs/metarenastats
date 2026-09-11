# MetArenaStats — Plan de refonte visuelle

Objectif : passer de « dashboard générique » à un produit avec une identité propre,
**sans toucher aux données ni aux calculs de stats**, et sans sacrifier la lisibilité.

Ce document est écrit pour être exécuté par un agent. Chaque phase est livrable
indépendamment (le site reste cohérent entre deux phases).

---

## 1. Diagnostic — pourquoi ça fait « vibecodé »

Constaté sur captures à 1440px (accueil, champions, leaderboard) :

1. **La police est Geist** — la police maison de Vercel, livrée par défaut par
   `create-next-app`. Utilisée seule, sans police d'affichage, c'est le marqueur
   n°1 d'un template Next.js.
2. **Palette zinc-950 + dégradé blue-500→violet-500** — la combinaison par défaut
   de tout site généré par IA. Elle est utilisée pour le logo, le wordmark, les
   badges « New » et l'onglet actif. Aucun lien avec League of Legends / Arena.
3. **Le blob flou en fond de hero** — dégradé radial blurré derrière un logo
   centré. Cliché absolu. Et ~60 % de l'accueil sous la ligne de flottaison est
   vide.
4. **Un seul matériau pour tout** : `bg-zinc-900/40` + `border-zinc-800` sur
   chaque carte, panneau, tableau et badge. Aucune hiérarchie par l'élévation :
   une stat héro et une note de bas de page ont le même poids visuel.
5. **Les couleurs de tier sont sémantiquement fausses** : S=ambre, A=violet,
   B=bleu, **C=emerald (vert)**, D=zinc. Or le vert signifie « bonne stat »
   partout ailleurs (colonnes % Top 3 / % Top 1). Un tier C vert se lit comme
   « bon ». **C'est un vrai bug d'ergonomie, pas juste esthétique.**
6. **Les tableaux sont des murs de lignes identiques.** Sur une *tier list*, les
   tiers sont quasi invisibles (badge de 24px) et rien ne regroupe visuellement
   les bandes S / A / B / C / D.
7. **Les icônes de champions font 28px** — l'asset le plus riche disponible est
   utilisé en timbre-poste pendant que l'espace est gaspillé ailleurs.
8. **Rythme typographique et spatial ad-hoc** : `mt-1/2/4/6/10` au cas par cas,
   pas d'échelle définie, mélange `rounded-md/lg/xl/2xl` sans règle.
9. **Zéro micro-interaction** au-delà d'un changement de fond au survol.

---

## 2. Direction — « la rigueur de Linear, l'âme d'Arena »

On garde la **discipline** de l'inspiration existante (GitHub / Vercel / Linear /
Apple : typo nette, espace maîtrisé, zéro clutter, rapide) mais on lui donne une
**identité couleur et matière ancrée dans Arena**.

Le levier : **le système de rareté des augments (silver / gold / prismatic)
existe déjà dans nos données et partiellement dans l'UI.** On en fait la
signature visuelle du site plutôt qu'un dégradé bleu-violet inventé.

Trois rôles couleur, strictement séparés :

| Rôle | Couleur | Usage |
|---|---|---|
| **Primaire** (interactif) | Cyan hextech | Liens, onglet actif, focus, sélection |
| **Signal** (excellence) | Or | Tier S, 1ʳᵉ place, best-in-class |
| **Prismatique** (signature) | Opale du jeu (cf. §3.1.1) | **Logo, wordmark**, rareté prismatique |
| *Réservé* | Vert / rouge | **Uniquement** qualité d'une stat. Jamais de branding. |

> **✅ Direction validée par Théo le 2026-09-11.** Ne pas re-débattre ces choix
> sans qu'il le demande explicitement. Points actés :
> - Logo et wordmark en **prismatique** (forme inchangée, cf. §4.0) — il aime.
>   ⚠️ **Corrigé le 2026-09-11** : la teinte validée initialement était le
>   fuchsia→cyan existant. Théo a signalé qu'il ne reflétait pas le jeu ;
>   vérification faite sur l'asset officiel, il avait raison. Les valeurs
>   retenues sont désormais celles du §3.1.1 (opale violet/périwinkle avec
>   reflet jaune-vert), pas le fuchsia→cyan.
> - Cyan **en petites touches d'interface uniquement** (onglet actif, liens, focus),
>   jamais en aplat.
> - Or **réservé** au tier S et à la 1ʳᵉ place.
> - Vert/rouge **réservés** à la qualité d'une stat.
> - Fond : `#09090B` → `#0A0B0F` (changement volontairement quasi imperceptible).
>
> Replis discutés si un ajustement est demandé plus tard : cyan tiré vers le
> turquoise ou vers un indigo profond ; logo monochrome blanc (sobre, mais perd
> le lien avec le jeu).

---

## 3. Design tokens

À définir dans `src/app/globals.css`. **Le projet est en Tailwind v4** — pas de
`tailwind.config.js`, la configuration se fait dans le CSS.

Deux mécanismes à ne pas confondre :
- Les valeurs déclarées dans `@theme { --color-*: … }` génèrent des classes
  utilitaires (`--color-bg-raised` → `bg-bg-raised`). C'est ce qu'il faut pour
  tout ce qui est utilisé comme classe Tailwind.
- Les variables déclarées dans `:root` restent de simples variables CSS,
  utilisables en `var(…)` ou en valeur arbitraire (`bg-[var(--prism-frame)]`).
  Les dégradés et les ombres composées (`--prism-frame`, `--elev-*`) vont là.

Le `@theme inline` déjà présent dans `globals.css` (qui mappe `--color-background`
et les polices) doit être **étendu, pas remplacé** : `--font-sans` / `--font-mono`
y sont déjà câblés sur les variables de `next/font`.

### 3.1 Couleurs

```css
:root {
  /* Base — charcoal légèrement bleuté, pas du zinc par défaut */
  --bg-base:      #0A0B0F;   /* page */
  --bg-raised:    #111318;   /* cartes, tableaux */
  --bg-overlay:   #171A21;   /* popovers, survol de ligne */
  --bg-inset:     #08090C;   /* zones en creux (inputs) */

  --border-subtle:  #1E222B;
  --border-default: #272C37;
  --border-strong:  #39414F;

  --text-primary:   #F2F4F8;
  --text-secondary: #9BA3B4;
  --text-muted:     #646C7E;

  /* Primaire — cyan hextech */
  --accent:        #35D0E8;
  --accent-hover:  #5BDDF0;
  --accent-muted:  rgba(53, 208, 232, 0.12);
  --accent-border: rgba(53, 208, 232, 0.32);

  /* Signal — or */
  --gold:        #F2B640;
  --gold-muted:  rgba(242, 182, 64, 0.12);
  --gold-border: rgba(242, 182, 64, 0.35);

  /* Signature — prismatique. Valeurs échantillonnées sur l'asset officiel
     game/assets/ux/cherry/augments/augmentselection/augmentcard_frame_prismatic.png */
  --prism-shimmer: #E1E4C6;  /* reflet jaune-vert — la signature "réfraction" */
  --prism-pale:    #D0D4E4;  /* lavande pâle */
  --prism-blue:    #849AD3;  /* périwinkle */
  --prism-violet:  #8362DC;  /* violet */

  /* Cadre de rareté prismatique — reproduit le jeu à l'identique */
  --prism-frame: linear-gradient(160deg,
    var(--prism-shimmer), var(--prism-pale) 35%,
    var(--prism-blue) 70%, var(--prism-violet));

  /* Logo / wordmark — mêmes teintes, resaturées (cf. §3.1.1) */
  --prism-brand: linear-gradient(120deg, #B8C77E, #9AA7DD 32%, #6E7FD4 68%, #7A4FD8);

  /* Qualité de stat — réservé, ne jamais réutiliser ailleurs */
  --stat-good: #3FCF8E;
  --stat-bad:  #F2555A;
}
```

#### 3.1.1 Pourquoi deux variantes de prismatique

**Le dégradé actuel du site est faux.** `EntityIcon` utilise
`from-fuchsia-400 via-purple-400 to-cyan-300` (`#E879F9 → #C084FC → #67E8F9`) :
un rose magenta saturé vers un cyan vif. L'asset officiel du jeu, échantillonné
pixel par pixel, donne tout autre chose :

| Position sur le cadre | Couleur réelle |
|---|---|
| Haut | `#D0D4E4` lavande pâle |
| Haut-gauche / haut-droite | `#E1E4C6` **jaune-vert pâle** |
| Milieu des montants | `#849AD3` périwinkle |
| Bas des montants | `#8362DC` violet |
| Bas | `#9F73C2` violet grisé |

Trois écarts : notre version est **beaucoup trop saturée**, elle est
**dominée par le rose magenta** (absent du jeu, qui est dominé par le violet), et
elle **rate complètement le reflet jaune-vert** — or c'est précisément lui qui
donne l'effet « opale / réfraction » caractéristique du prismatique.

**Deux usages, deux variantes :**

- **`--prism-frame`** (cadres d'augments et d'items prismatiques) : reproduit le
  jeu littéralement. Vérifié visuellement contre l'asset de référence, ça colle.
- **`--prism-brand`** (logo, wordmark) : mêmes teintes, resaturées d'environ 25 %.
  **Nécessaire** : testé, les points blancs du logo deviennent invisibles sur le
  pastel littéral, et un wordmark en `bg-clip-text` pastel est illisible sur fond
  sombre. La version resaturée conserve le reflet jaune-vert et reste lisible
  jusqu'à 16 px (favicon). Variante écartée : points sombres (`#241645`) sur
  l'opale littérale — très joli aussi, mais change le caractère du logo.

#### 3.1.2 Argent et or — même écart, moindre priorité

Les cadres `silver` et `gold` du jeu sont **métalliques** (reflet clair en haut,
sombre en bas), là où le site utilise des bordures plates et vives :

| | Reflet haut | Corps | Bas |
|---|---|---|---|
| Silver (jeu) | `#ECEDEC` | `#898989` | `#474747` |
| Gold (jeu) | `#F7EDCE` | `#947152` | `#624536` |
| *Site actuel* | *silver = `slate-300`, gold = `amber-400` — plats et plus vifs* |

À 28 px sur fond sombre, **reproduire le métal littéralement rendrait les bordures
quasi invisibles** : ne pas copier tel quel. La bonne correction est un simple
ajustement de teinte — or moins citron (vers `#E8B563`), argent moins bleuté
(vers `#C9CCD4`) — en gardant assez de luminosité pour rester lisible.
**Valeurs à valider à l'œil pendant la phase 1**, contrairement au prismatique
qui est déjà vérifié.

**Contraintes à vérifier** : `--gold` et `--accent` sur `--bg-raised` doivent
passer AA (4.5:1) pour du texte. Si le badge S en or sur fond ambré échoue,
éclaircir le texte du badge, pas le fond.

### 3.2 Échelle de tiers (remplace `TIER_STYLES` dans `src/lib/tiers.ts`)

Doit se lire comme une **descente** claire, et **ne jamais contenir de vert**.

| Tier | Texte | Fond | Bordure | Extra |
|---|---|---|---|---|
| **S** | `#F2B640` (or) | `rgba(242,182,64,.14)` | `rgba(242,182,64,.40)` | glow `0 0 16px -4px rgba(242,182,64,.45)` |
| **A** | `#35D0E8` (cyan) | `rgba(53,208,232,.12)` | `rgba(53,208,232,.32)` | — |
| **B** | `#7C8CF8` (indigo) | `rgba(124,140,248,.10)` | `rgba(124,140,248,.26)` | — |
| **C** | `#8792A8` (slate) | `rgba(135,146,168,.08)` | `rgba(135,146,168,.20)` | — |
| **D** | `#5A6172` (gris) | `rgba(90,97,114,.06)` | `rgba(90,97,114,.16)` | — |

Or → cyan → indigo → slate → gris : descente en « préciosité » lisible même en
niveaux de gris.

> **Note sur le cyan du tier A.** Il est identique à `--accent` (la couleur
> interactive), ce qui contredit en apparence la règle « trois rôles strictement
> séparés » du §2. C'est **assumé** : la rampe de tiers est une échelle fermée,
> toujours affichée dans un badge de 28 px en colonne fixe — un contexte où
> aucune confusion avec un lien n'est possible. Ne pas « corriger » en inventant
> une 4ᵉ teinte, ça casserait la lisibilité de la descente.

### 3.3 Typographie

Le problème n'est pas Geist en soi, c'est **Geist tout seul**. Ajouter une police
d'affichage suffit à casser l'effet template.

- **Display** (h1/h2, gros chiffres, wordmark) : **Bricolage Grotesque**
  (Google Fonts, variable, gratuite). Alternatives si le rendu ne plaît pas :
  Space Grotesk, Sora, Outfit.
- **UI / corps** : garder **Geist Sans** (bonne police, changement inutile).
- **Chiffres de tableau** : garder **Geist Mono**, avec
  `font-variant-numeric: tabular-nums` explicite partout où des nombres
  s'alignent en colonne.

Chargement via `next/font/google` (`display: "swap"`, `subsets: ["latin"]`),
exposé en `--font-display`.

Échelle (remplace les tailles ad-hoc) :

| Token | Taille / interligne | Letter-spacing | Police |
|---|---|---|---|
| `display-lg` | 3rem / 1.05 | -0.03em | display |
| `display` | 2rem / 1.1 | -0.02em | display |
| `h1` | 1.5rem / 1.2 | -0.02em | display |
| `h2` | 1.125rem / 1.3 | -0.01em | display |
| `body` | 0.875rem / 1.5 | 0 | sans |
| `small` | 0.8125rem / 1.45 | 0 | sans |
| `micro` | 0.6875rem / 1.4 | 0.04em (uppercase) | sans |

### 3.4 Élévation

Le détail qui fait « soigné » : le **liseré interne clair en haut** des surfaces.

```css
--elev-1: inset 0 1px 0 rgba(255,255,255,0.03);
--elev-2: inset 0 1px 0 rgba(255,255,255,0.04),
          0 1px 2px rgba(0,0,0,.4),
          0 8px 24px -8px rgba(0,0,0,.5);
--elev-3: inset 0 1px 0 rgba(255,255,255,0.05),
          0 4px 8px rgba(0,0,0,.5),
          0 16px 48px -12px rgba(0,0,0,.7);
```

- e1 : cartes, panneaux, tableaux
- e2 : survol de carte, éléments actifs
- e3 : popovers, dropdown de recherche, tooltips

### 3.5 Rayons et rythme

- Rayons : `6px` (badges, inputs) / `10px` (cartes, boutons) / `14px` (panneaux) / `full` (pills).
  **Une valeur par rôle, pas de mélange au cas par cas.**
- Espacement : base 4pt. Gap de section `40px` desktop / `28px` mobile.
  Padding carte `16px`. Cellule de tableau `12px 16px`.

---

## 4. Composants

### 4.0 Identité — logo, wordmark, favicon ✅ validé

**La forme du logo ne change pas** (carré arrondi `rx=9`, 3 points blancs).
Seul le dégradé de remplissage change — il passe de 2 stops à 4.

| Fichier | Changement |
|---|---|
| `src/components/Logo.tsx` | Les 2 stops `#3b82f6 → #8b5cf6` deviennent les 4 stops de `--prism-brand` (`#B8C77E → #9AA7DD → #6E7FD4 → #7A4FD8`). Points blancs conservés. |
| `src/components/Wordmark.tsx` | Le `A` et `rena` passent de `from-blue-400 to-violet-400` à `--prism-brand`. `Met` et `Stats` restent en `--text-primary`. Structure inchangée. |
| `src/app/icon.svg` | Même dégradé que `Logo.tsx` — les deux doivent rester strictement identiques. |
| `src/app/favicon.ico` | **À régénérer depuis le nouvel `icon.svg`.** Sinon Safari continuera d'afficher l'ancien logo bleu-violet. Commande utilisée précédemment : `magick -background none -density 384 icon.svg -resize {16,32,48,64} …` puis assemblage en `.ico`. |
| `src/lib/statsDisplay.tsx` | `EntityIcon` : remplacer `from-fuchsia-400 via-purple-400 to-cyan-300` par `--prism-frame` (cf. §3.1.1 — le dégradé actuel ne correspond pas au jeu). |

⚠️ **Ne pas utiliser `--prism-brand` pour les cadres d'augments, ni `--prism-frame`
pour le logo.** Les deux se ressemblent mais ont des contraintes opposées :
le cadre doit coller au jeu, le logo doit rester lisible à 16 px.

Le badge « New » de la nav (§4.6) **ne doit pas** reprendre le dégradé prismatique :
le prismatique reste réservé à l'identité et à la rareté prismatique du jeu.

### 4.1 `StatsTable` — pièce maîtresse (plus gros gain)

1. **Bandes de tier.** Quand le tri est sur `tier`, insérer une ligne de
   séparation par bande (`S`, `A`, `B`…) avec un rail coloré à gauche des lignes
   du groupe. Rend enfin la *tier list* lisible comme une tier list.
   Quand le tri est sur une autre colonne, pas de bandes (comportement actuel).
2. **Barres inline.** Derrière les valeurs `% Top 3` et `% Top 1`, un remplissage
   horizontal discret (`--accent-muted`, largeur = valeur normalisée sur la
   colonne). Transforme le scan visuel et supprime l'effet « mur de chiffres ».
   Purement décoratif : la valeur numérique reste affichée.
3. **Icônes à 32–36px** (au lieu de 28), nom du champion en `font-medium`.
4. **En-tête collant** (`sticky top-0`) dans le conteneur scrollable.
5. **Survol de ligne** : `--bg-overlay` + rail d'accent à gauche (2px), transition 150ms.
6. **`tabular-nums`** sur toutes les cellules numériques.
7. Conserver : `overflow-x-auto` + `min-w-[640px]` (responsive, cf. §7).

### 4.2 `TierBadge`
28px (au lieu de 24), nouvelle rampe §3.2, S reçoit le glow. Police display,
`font-bold`.

### 4.3 `StatPill` → carte de stat
Valeur en police display `display`/`2rem`, label en `micro` uppercase
`--text-muted`, fond `--bg-raised` + `--elev-1`.

### 4.4 `SampleSizeBadge`
Actuellement une longue pill qui passe à la ligne. La transformer en **ligne de
méta discrète** (pas de pill) : `--text-muted`, `small`, avec le nombre en
`--text-secondary`.

### 4.5 Onglets (`TieredStatsTabs`) et `SortControl`
Indicateur actif animé (translation 250ms `ease-out`) au lieu d'un simple
changement de fond. Fond du conteneur `--bg-inset`, pill active `--bg-overlay` +
`--elev-2`, texte actif `--text-primary`.

### 4.6 `Nav`
- Indicateur d'onglet actif animé, cohérent avec §4.5.
- Badge « New » : remplacer le dégradé bleu-violet générique par
  `--accent-muted` + texte `--accent` + bordure `--accent-border`. Plus sobre,
  plus premium, et cohérent avec le système.
- Champ de recherche : fond `--bg-inset`, icône loupe à gauche, raccourci `⌘K`
  affiché à droite en `micro`.
  **Le raccourci doit réellement fonctionner** : `⌘K` (macOS) / `Ctrl+K` met le
  focus sur l'input de `NavSearch` (`preventDefault` pour ne pas déclencher la
  recherche du navigateur), `Échap` retire le focus et vide les suggestions.
  Afficher `⌘K` uniquement si la plateforme est Apple, sinon `Ctrl K`.
  Ne pas afficher le raccourci sur mobile (l'input est dans le menu déroulant).
- Bordure basse du header qui s'intensifie au scroll (`--border-subtle` →
  `--border-default`).

### 4.7 `MatchCard`
Rail coloré à gauche selon le placement (1 = or, 2-3 = accent, 4-6 = neutre),
placement en police display. Rend l'historique scannable d'un coup d'œil.

### 4.8 `Footer`
Le disclaimer Riot est un mur de texte au même poids que le reste. Le passer en
`micro` / `--text-muted`, et séparer visuellement le lien Privacy.
**Ne pas modifier le texte du disclaimer** (obligation Riot, cf. §7).

---

## 5. Pages

### 5.1 Accueil — supprimer le vide
- **Supprimer le blob flou.** Le remplacer par un motif de fond très discret
  (grille hexagonale ou anneaux concentriques, opacité ≤ 4 %) qui évoque l'arène,
  en SVG inline, non répété agressivement.
- Hero resserré : wordmark + une ligne + **la recherche comme élément principal**.
- **Remplir la zone morte** avec un « Meta Snapshot » construit sur les données
  déjà disponibles : top 5 champions du moment + les chiffres clés.
  → Réutiliser `getChampionStats()`, **aucun nouveau calcul.**

  ⚠️ **Ne pas appeler `getComboStats()` sur l'accueil.** Mesuré : ~2,4 s de calcul
  côté serveur (il génère toutes les paires de tous les participants). L'accueil
  n'appelle aujourd'hui que `getSiteStats()` et répond instantanément — y ajouter
  les combos rendrait la page d'entrée du site lente, ce qui annulerait le
  bénéfice. Si un top combos sur l'accueil est vraiment souhaité plus tard, il
  faudra d'abord mettre en cache le résultat (`unstable_cache` / ISR), ce qui
  sort du périmètre de cette refonte.

### 5.2 Page champion — le plus gros « woaw »
- **Bandeau splash art.** Vérifié disponible :
  `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/{id}_0.jpg`
  (~47 Ko, préférable au `splash/` à ~176 Ko).
  Hauteur ~220px, `object-position: top`, scrim dégradé vers `--bg-base` en bas,
  nom du champion et stats posés dessus.
  → Transforme la page d'un dashboard générique en vrai site de jeu.
- Les cartes de stats chevauchent légèrement le bas du bandeau (`-mt-8`).
- Sections existantes (Best Augments / Item Build / Anvil Run / Top Combos)
  conservées, re-stylées avec les tokens.

### 5.3 Page joueur
Même traitement d'en-tête, avec l'art du champion principal en fond très
assombri (opacité ~15 %) + scrim. Garde la cohérence avec la page champion.

### 5.4 Tier lists (champions / items / augments / combos / anvil)
Bénéficient automatiquement de §4.1. Aucune refonte de structure nécessaire.

### 5.5 Pages et états secondaires — à ne pas oublier
Faciles à zapper, et ils trahiraient l'ancienne palette s'ils restent en l'état :

- `src/app/players/[riotId]/loading.tsx` — le squelette de chargement utilise
  `bg-zinc-900` en dur. À passer sur `--bg-raised`, sinon il clignote dans
  l'ancienne teinte à chaque recherche de joueur.
- `src/app/info/page.tsx` et `src/app/privacy/page.tsx` — pages de texte, à
  repasser sur les tokens de typo et de surface (pas de refonte de structure).
- L'état vide de `StatsTable` (`EmptyState`) et le bandeau d'avertissement
  « données en cache » de la page joueur (actuellement en `amber-*` en dur).

---

## 6. Motion

- Durées : 150ms (survol), 250ms (indicateur d'onglet), `ease-out`.
- **`prefers-reduced-motion: reduce` respecté** : désactiver translations et
  glows animés.
- **Interdit** : animations d'entrée au scroll, parallax, compteurs animés,
  glassmorphism généralisé. Sur un site de stats c'est du bruit, ça nuit à la
  perf et ça fait *plus* « template », pas moins.

---

## 7. Garde-fous (ne pas casser)

1. **Aucune modification de `src/lib/aggregate.ts`, `tiers.ts` (logique de
   `computeTiers`), ni des données.** Seul `TIER_STYLES` change dans `tiers.ts`.
   Les chiffres affichés doivent être identiques avant/après.
2. **Responsive obligatoire** : vérifier 320 / 375 / 390 / 430 / 768 / 1024 /
   1280 sur chaque page touchée, aucun débordement horizontal.
   La nav bascule en hamburger sous `xl` (1280px) — ne pas baisser ce seuil sans
   revérifier, 8 liens + badges + recherche ne tiennent pas en dessous.
3. **Copy sobre** : ne pas réintroduire de phrases explicatives sur le
   fonctionnement du tri/tier. Ne rien ajouter qui soit déjà visible à l'écran.
4. **Disclaimer Riot inchangé** (texte exact exigé par leur politique), et
   `/privacy` reste accessible depuis le footer.
5. **Images distantes** : si passage à `next/image` pour les splash arts, ajouter
   `ddragon.leagueoflegends.com` à `images.remotePatterns` dans `next.config.ts`.
   Sinon garder `<img>` + `loading="lazy"` + dimensions explicites (éviter le CLS).
6. **Perf** : 2 polices max. `next/font` avec `display: "swap"`. Le bandeau splash
   ne doit pas bloquer le rendu.

---

## 8. Phasage

Ordonné par **impact / effort décroissant**. Chaque phase est shippable seule.

| Phase | Contenu | Fichiers principaux | Impact |
|---|---|---|---|
| **1 — Fondations** | Tokens couleur, polices, échelle typo, élévations, nouvelle rampe de tiers, **logo + wordmark + favicon prismatiques**, + les états secondaires du §5.5 | `globals.css`, `layout.tsx`, `tiers.ts`, `statsDisplay.tsx`, `Logo.tsx`, `Wordmark.tsx`, `icon.svg`, `favicon.ico`, `loading.tsx`, `info/`, `privacy/` | ⭐⭐⭐⭐⭐ |
| **2 — Tableaux** | Bandes de tier, barres inline, en-tête collant, survol, icônes | `StatsTable.tsx` | ⭐⭐⭐⭐⭐ |
| **3 — En-têtes riches** | Splash art champion + joueur | `champions/[slug]/page.tsx`, `players/[riotId]/page.tsx` | ⭐⭐⭐⭐ |
| **4 — Accueil** | Suppression du blob, motif de fond, Meta Snapshot | `app/page.tsx`, `HomeSearch.tsx` | ⭐⭐⭐⭐ |
| **5 — Chrome & polish** | Nav, onglets, MatchCard, footer, motion, ⌘K | `Nav.tsx`, `TieredStatsTabs.tsx`, `MatchCard.tsx`, `Footer.tsx` | ⭐⭐⭐ |

La phase 1 seule change déjà radicalement la perception (couleur + typo =
l'essentiel du signal « template »). Ne pas sauter directement à la 3 ou la 4.

---

## 9. Vérification (à faire à chaque phase)

1. `npx tsc --noEmit` → 0 erreur.
2. Captures Playwright à **390px et 1280px** sur : accueil, champions,
   champion detail, combos, joueur, leaderboard.
3. Contrôle de débordement horizontal (`scrollWidth > clientWidth`) sur les
   7 largeurs du §7.2.
4. **Contrôle anti-régression des données** : comparer les valeurs affichées
   (games / % / avg) avant et après sur une page témoin. Elles doivent être
   strictement identiques.
5. Contraste : texte des badges de tier et `--text-secondary` sur `--bg-raised`
   ≥ 4.5:1.
6. Vérifier le rendu avec `prefers-reduced-motion: reduce` activé.
7. **Phase 1 uniquement** — après régénération du favicon : décoder le `.ico`
   servi (`sips -s format png`) et confirmer visuellement que c'est bien le
   nouveau logo prismatique. Prévenir que Safari met le favicon en cache très
   agressivement : il faut fermer l'onglet (voire quitter Safari) pour le voir
   changer, un simple rechargement ne suffit pas.
