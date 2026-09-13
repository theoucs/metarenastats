# MetArenaStats — Plan données & infrastructure (2026-09-13)

Feuille de route de tout ce qui reste à faire côté **données** : API Riot, crawler,
agrégation, hébergement, coûts. Les plans `design-*.md` couvrent l'UI et ne sont
pas concernés.

Chaque phase est livrable seule. Les phases 0 et 1 ne demandent **aucune clé de
production** — c'est du travail utile dès maintenant.

## État des lieux (mesuré le 2026-09-13, pas estimé)

| Mesure | Valeur | Source |
|---|---|---|
| Base actuelle | 905 matchs / 13 377 participants | `count` Supabase |
| Poids d'une ligne participant | 277 o sur le fil, ~471 o en base avec index | mesuré via PostgREST |
| Poids d'un match en base | **~8,5 Ko** (18 joueurs) | déduit |
| Poids d'un chargement de page | **3,7 Mo** | `PARTICIPANT_COLUMNS` × 13 377 |
| `GET /matches/{id}` | 138 Ko | réponse réelle |
| `GET /matches/{id}/timeline` | **1,48 Mo** (10,7×) | réponse réelle |

### Les deux plafonds actuels, tous les deux proches

1. **`aggregate.ts` : `MAX_PAGES = 30`** → 30 000 lignes → **~1 660 matchs**. Au-delà,
   les stats deviennent silencieusement fausses (troncature muette, pas d'erreur).
2. **Egress Supabase gratuit : 5 Go/mois** → **~1 350 pages vues/mois** à la taille
   actuelle, et ça se dégrade linéairement avec la base.

Cause commune : toutes les pages sont en `export const dynamic = "force-dynamic"`
et `fetchAllParticipants` charge **toute la base en mémoire JS** à chaque requête
pour agréger en JavaScript. Le commentaire à `aggregate.ts:45` l'anticipait déjà.

## Rate limits Riot — comment on les connaît

Riot les renvoie dans les headers de **chaque** réponse. C'est la source de vérité,
toujours à jour, y compris le jour où la clé de prod arrive :

```
x-app-rate-limit:       100:120,20:1   ← la clé  : 100 req/2min ET 20 req/s
x-app-rate-limit-count: 3:120,1:1      ← où on en est
x-method-rate-limit:    2000:10        ← cette méthode seulement
```

Deux compteurs s'empilent, la plus stricte gagne. Les *method limits* du portail
sont si larges (2000/10s sur match-v5) qu'on ne les atteindra jamais : **le seul
plafond réel est le 100/2min de la clé**.

> **Vérifié : le compteur app est par host régional.** `europe.api.riotgames.com`
> était à `3:120` pendant que `euw1.api.riotgames.com` était à `2:120`.
> On a donc **100/2min sur `europe`** (account, match-v5) **+ 100/2min sur `euw1`**
> (summoner, spectator, status). Tout ce qui vit sur `euw1` ne coûte rien au
> budget matchs.

## Décisions actées par Théo le 2026-09-13

> **Les rangs soloq : hors périmètre, définitivement.** Un rang soloq ne dit rien
> du niveau Arena. C'est précisément ce vide que le classement du site viendra
> combler quand il y aura assez de données.

> **L'ordre d'achat des items est prioritaire** (phase 1), avant le crawler.

> **Icône d'invocateur** à la place du champion le plus joué sur la page joueur.

---

## Phase 0 — Débloquer l'architecture (URGENT, gratuit, sans clé)

Rien ne sert de crawler des millions de matchs dans une architecture qui meurt à
1 660. **Tout le reste dépend de cette phase.**

### 0.1 — Agrégation en SQL + tables `stats_*`

Remplacer le « charger toute la base et agréger en JS » par des tables
pré-calculées, rafraîchies par un job, jamais par une requête utilisateur :

- `stats_champion`, `stats_augment`, `stats_item`, `stats_combo`, `stats_build_slot`
- Petites par nature : `stats_champion` = ~60 lignes **quelle que soit la taille de
  la base derrière**. C'est ce qui rend le nombre de matchs indépendant de la
  vitesse du site.
- Les pages lisent **uniquement** ces tables. Jamais `match_participants`.
- Exception assumée : les pages joueur lisent le brut, mais filtré par `puuid`
  (index déjà en place) et le trafic y est faible.

### 0.2 — ISR à la place de `force-dynamic`

Les 10 pages en `force-dynamic` passent en cache avec revalidation (30–60 min).
Les stats sur des centaines de milliers de parties ne bougent pas à la minute.
Le CDN sert alors ~99 % des visites, l'egress Supabase tombe à ~zéro.

⚠️ Next 16 : lire `node_modules/next/dist/docs/` avant d'écrire (Cache Components,
`use cache`, `cacheLife`) — les APIs ont changé.

### 0.3 — Rate limiter côté recherche joueur

Aujourd'hui `BATCH_SIZE = 5` / `BATCH_DELAY_MS = 300` ne couvre que le 20/s, **pas
le 100/2min**. Une recherche = ~32 appels → la 4ᵉ recherche enchaînée prend un 429.
Aucun retry, aucune lecture du `Retry-After`.

### 0.4 — Icône d'invocateur

`GET euw1/lol/summoner/v4/summoners/by-puuid/{puuid}` → `profileIconId` +
`summonerLevel`. Image : `ddragon/cdn/{version}/img/profileicon/{id}.png`.
Un appel, sur le host `euw1` donc hors budget matchs.

---

## Phase 1 — Ordre d'achat réel des items

### Pourquoi c'est un vrai gain

`item0..item6` est l'ordre des **slots d'inventaire**, pas l'ordre d'achat. Le
commentaire à `aggregate.ts:38` dit que ça « approxime l'ordre d'achat » — c'est
inexact, aujourd'hui `stats_build_slot` mélange du signal et du bruit.

Le timeline donne l'ordre vrai. Vérifié sur `EUW1_7982040680` :

```
Xayah  timeline (ordre d'achat) : Boots → The Collector → Infinity Edge
       item0..6 (ordre de slot) : Boots, Reaper's Toll, Collector, IE, Sweeper
```

### ⚠️ Ce que le timeline ne donne PAS : les prismatiques

Découverte à l'analyse. Les items prismatiques **n'apparaissent jamais** en
`ITEM_PURCHASED` : ils sortent d'une enclume, ils ne sont pas achetés en boutique.
Ce qui est enregistré, c'est l'achat de l'**enclume**, pas ce qui en sort :

| ID | Nom | Nature |
|---|---|---|
| 220000 | Stat Bonus | enclume |
| 220002 | Legendary Marksman Item | enclume |
| 220004 | Legendary Mage Item | enclume |
| 220007 | **Prismatic Item** | enclume |

Exemple : Taliyah finit avec 4 prismatiques en inventaire, **zéro** dans le
timeline. Trois joueurs sur 18 ont un ordre timeline entièrement vide alors
qu'ils ont des prismatiques.

> **Conséquence : le timeline complète l'inventaire final, il ne le remplace pas.**
> Ordre d'achat = légendaires + bottes (boutique). Prismatiques = inventaire final
> uniquement. Il faut garder les deux sources.

### Filtrage à appliquer

- retirer les enclumes `220000 / 220002 / 220004 / 220007`
- retirer les consommables `2142–2145` (juices) et `3348` (Arcane Sweeper,
  auto-attribué à tout le monde)
- traiter `ITEM_UNDO` (16 occurrences sur une seule partie) — sans ça on compte
  des achats annulés
- dédupliquer les rachats du même ID (vu : Gangplank achète `223508` trois fois)

### Le coût réel — Théo a raison sur le stockage

| | Impact |
|---|---|
| Stockage | ~5,6 items/joueur → ~100 int par match → **+~700 o, soit +8 %** de la base. Négligeable. |
| Bande passante | 1,48 Mo/match téléchargés — **mais dans le crawler (GitHub Actions), où c'est gratuit et non compté.** Ne touche ni l'egress Supabase ni Vercel. |
| **Appels API** | **+1 par match. C'est le seul vrai coût : ça divise le débit de crawl par 2.** |

L'API n'a pas de sélection de champs : on télécharge les 1,48 Mo quoi qu'il
arrive. Mais comme ça n'atterrit que sur un runner gratuit, seul le budget
d'appels compte.

### Conséquence de design : passe séparée, pas inline

Ne **pas** récupérer le timeline en même temps que le match. Sinon la couverture
en matchs est divisée par deux en permanence.

- `matches.timeline_fetched boolean default false`
- un **second job**, prioritaire au plus récent, qui rattrape le retard avec le
  budget d'appels restant
- auto-régulé : quand le crawl principal ralentit, le rattrapage accélère

C'est mieux qu'un échantillonnage à 5 % — la couverture monte à 100 % si le
budget le permet, sans jamais brider la collecte principale.

### Le reste du timeline, pour plus tard

Non prioritaire mais présent dans la même réponse, donc gratuit à ajouter ensuite :

- `SKILL_LEVEL_UP` (321/partie) — l'ordre de skill, que personne ne sort en Arena
- `CHAMPION_KILL` (151) — dégâts subis détaillés **sort par sort**
- `participantFrames` — instantané des 18 joueurs **toutes les 60 s** : gold, xp,
  level, position, 26 stats de champion, 12 compteurs de dégâts.
  → la **courbe de puissance round par round** : « cet augment scale à partir de
  quel round ? ». Aucun concurrent ne le fait.

---

## Phase 2 — Le crawler (écriture maintenant, mise à l'échelle plus tard)

### Principe

```
1. seed : liste de PUUID connus
2. GET /matches/by-puuid/{puuid}/ids?queue=1750   → 100 IDs
3. diff avec la base → ne garder que les nouveaux      ← étape clé
4. GET /matches/{id} → 18 joueurs
5. stocker, + ajouter les 17 autres PUUID à la file
6. retour en 2
```

Chaque partie rapporte **17 nouveaux joueurs**. Boule de neige : jamais de pénurie
de seeds. L'étape 3 est ce qui rend l'ensemble efficace — la découverte est quasi
gratuite, on ne dépense des appels que sur du nouveau.

Seed initial si besoin : `euw1/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5`
→ **300 PUUID en un appel** (vérifié), sur le host `euw1` donc hors budget matchs.

### Deux modes de crawl — à prévoir dès le schéma

| Mode | But | Couverture |
|---|---|---|
| **découverte** | stats de méta (champions, augments, items) | large, peu profonde |
| **suivi** | re-crawl de joueurs actifs connus | profonde, pour le **classement** |

Le boule de neige seul donne des centaines de milliers de joueurs à 2–3 parties
chacun : parfait pour la méta, **inutilisable pour un ladder**. D'où
`crawl_queue.priority`. Pénible à rajouter après coup.

### Où il tourne : GitHub Actions, pas Vercel

Vérifié dans la doc Vercel : **le plan Hobby limite les crons à une fois par jour**.
GitHub Actions : gratuit et illimité en minutes sur repo public (2 000 min/mois en
privé), intervalle minimum 5 min, 6 h max par job.

⚠️ Sur repo public, les workflows planifiés sont **désactivés après 60 jours sans
activité** sur le repo.

### Débit

| | Budget | Matchs/jour | Automatisable |
|---|---|---|---|
| Dev key | 100/2min sur `europe` | ~65 000 théoriques | ❌ expire à 24 h |
| Prod key | ~500/10s | bien au-delà du besoin | ✅ |

La clé de dev n'est pas trop lente — 65k/jour serait déjà énorme. Ce qui la
disqualifie est **uniquement** l'expiration à 24 h. (Et faire tourner un site
public sur une clé de dev sort du cadre d'usage Riot, ce qui joue contre la
demande de prod key en cours.)

---

## Phase 3 — Mise à l'échelle (à l'arrivée de la clé de prod)

### Architecture cible

```
GitHub Actions (cron */15)
   crawler → Riot API
      ↓
   Supabase : lignes brutes, FENÊTRE GLISSANTE (patch courant, 14–30 j)
      ↓
   job d'agrégation SQL → tables stats_* (petites, immuables en taille)
      ↓
   archive JSONL.gz → Cloudflare R2 (~1 Go par million de matchs)

Next.js / Vercel
   lit UNIQUEMENT stats_*  →  quelques Ko
   ISR revalidate 30–60 min  →  le CDN absorbe ~99 % des visites
```

### La fenêtre glissante est le levier économique principal

Le brut ne sert qu'à deux choses : les pages joueur, et recalculer les agrégats le
jour où on ajoute une dimension. L'archive compressée couvre le second cas.

> Avec fenêtre glissante + archive, on peut cumuler **des millions de parties en
> restant sur Supabase Pro à 25 $** — la base active ne contient jamais que le
> patch courant.

---

## Phase 4 — Plus tard

- Timelines : le reste des événements (skill order, courbes de puissance)
- **Classement Arena** — quand la profondeur par joueur le permet (mode « suivi »)
- Badge « en game » : `spectator-v5` (host `euw1`, gratuit)
- Bannière de maintenance : `lol-status-v4`

**Hors périmètre définitif :** TFT, LOR, Valorant, Clash, Tournament, Challenges,
rangs soloq. Soit ~45 des 59 méthodes de la clé.

---

## Coûts — ce qui est gratuit, et quand ça ne l'est plus

| Service | Gratuit jusqu'à | Déclencheur de facturation | Prix |
|---|---|---|---|
| GitHub Actions | illimité (repo public) | jamais à cette échelle | — |
| Vercel Hobby | le trafic actuel | **usage commercial** (pubs) | 20 $/mois |
| Supabase | 500 Mo DB, 5 Go egress | ~59 000 matchs en brut | 25 $/mois → 8 Go |
| Supabase compute | Micro (1 Go RAM), inclus | agrégats sur millions de lignes | +15 à 60 $/mois |
| Cloudflare R2 | 10 Go, egress gratuit | archive au-delà | ~0,015 $/Go |

Volumes en brut (à 8,5 Ko/match) : 100k = 0,85 Go · 1M = 8,5 Go · 5M = 42 Go.

**En résumé :**

- **0 €** jusqu'à ~50 000 matchs — et c'est déjà un vrai site de stats
- **25 €/mois** pour tenir 500k à 1M
- **40 à 85 €/mois** pour du multi-million confortable

> Le piège : ce n'est pas le stockage qui coûte (0,125 $/Go, dérisoire), c'est le
> **compute**. Une base de 40 Go sur l'instance Micro incluse sera inutilisable
> pour les agrégations. C'est là que part l'argent.

Note aussi : un projet Supabase gratuit est **mis en pause après 1 semaine
d'inactivité** — un crawler qui tourne tous les quarts d'heure l'évite.

## Ordre d'exécution recommandé

```
0.1  agrégation SQL + tables stats_*     ← bloquant pour tout le reste
0.2  ISR
0.3  rate limiter
0.4  icône d'invocateur
1    ordre d'achat des items (passe séparée)
2    crawler + schéma à deux modes
3    ─ clé de prod ─ mise à l'échelle, Supabase Pro quand la base le réclame
4    timelines complets, classement Arena
```

Les phases 0 et 1 sont aussi ce qui aide à **obtenir** la clé de prod : Riot veut
voir un site qui tourne et qui tient debout. Ce n'est pas du remplissage
d'attente, c'est le dossier.
