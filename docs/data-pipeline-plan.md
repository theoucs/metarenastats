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

Au 2026-09-14 le crawler a porté la base à **1 531 matchs / 27 558 participants**
(17 551 joueurs en file). Les poids unitaires ci-dessus ne bougent pas ; le volume, si.

### Correction du 2026-09-14 : l'egress se compte compressé

Les 277 o/ligne mesurés le 13 étaient la taille **non compressée**. Supabase gzipe
ses réponses quand on les demande, et le `fetch` de Node envoie `accept-encoding`
tout seul — donc c'est déjà le cas en production, sans rien changer. Vérifié sur
les colonnes exactes de l'agrégateur, `item_order` compris :

| | Par ligne | Lecture complète (27 558 lignes) |
|---|---|---|
| Non compressé | 294 o | 7,7 Mo |
| **Sur le fil (gzip)** | **110 o** | **3,0 Mo** |

Le plafond gratuit de 5 Go/mois est donc **2,7× plus loin** qu'écrit plus haut.
Ce qui le consomme n'est plus l'affichage des pages (elles lisent un snapshot de
quelques Ko depuis la phase 0) mais **le rafraîchissement lui-même**, qui relit
toute la table à chaque passage :

> À rythme strictement horaire, 5 Go/mois autorisent ~7 Mo par rafraîchissement,
> soit **~64 000 lignes ≈ 3 600 matchs**. En pratique les crons GitHub ne partent
> que 4 à 6 fois par jour, ce qui repousse le seuil autour de **14 000 matchs** —
> quelques semaines au rythme actuel, pas quelques mois.

C'est le déclencheur réel de la phase 3, et il ne dépend pas de la clé de prod :
tant que l'agrégation lit les lignes brutes, elle paie l'egress. La sortie n'est
pas d'optimiser le transfert (il l'est déjà) mais de **grouper en SQL** pour que
les 27 000 lignes ne sortent plus de la base.

### Les deux plafonds — corrigés le 2026-09-13 (phase 0)

1. **`aggregate.ts` : `MAX_PAGES = 30`** → 30 000 lignes → **~1 660 matchs**. Au-delà,
   les stats deviennent silencieusement fausses (troncature muette, pas d'erreur).
2. **Egress Supabase gratuit : 5 Go/mois** → **~1 350 pages vues/mois** à la taille
   actuelle, et ça se dégrade linéairement avec la base.

Cause commune : toutes les pages étaient en `export const dynamic = "force-dynamic"`
et `fetchAllParticipants` chargeait **toute la base en mémoire JS** à chaque
requête pour agréger en JavaScript. Le commentaire à `aggregate.ts:45`
l'anticipait déjà. Les deux sont levés depuis la phase 0 ci-dessous.

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

> **L'ordre d'achat des items passe après le crawler.** Décidé le 2026-09-13 :
> sans volume de parties, une stat d'ordre d'achat n'aurait presque aucune
> donnée derrière elle. Le crawler d'abord, l'ordre d'achat ensuite.

> **Icône d'invocateur** à la place du champion le plus joué sur la page joueur.

---

## Phase 0 — Débloquer l'architecture (URGENT, gratuit, sans clé)

Rien ne sert de crawler des millions de matchs dans une architecture qui meurt à
1 660. **Tout le reste dépend de cette phase.**

### 0.1 — ✅ Snapshots pré-calculés (fait le 2026-09-13)

Le plan initial disait « agrégation SQL + tables `stats_*` ». À l'exécution, un
autre découpage s'est imposé, plus sûr et nettement moins coûteux : **la logique
d'agrégation n'a pas été réécrite du tout**, elle a seulement changé de moment
d'exécution.

Porter les 12 agrégateurs en SQL demandait de répliquer en base les catégories
d'items, les raretés d'augments et les rôles de champions, qui vivent
aujourd'hui dans des JSON côté app (`src/lib/data/`) — beaucoup de travail, et
surtout un vrai risque de changer les chiffres publiés au passage.

Ce qui a été fait à la place :

- table `stats_snapshots (key, payload jsonb, computed_at, source_matches,
  source_participants, truncated)` ;
- `src/lib/statsSnapshot.ts` : `refreshSnapshots()` exécute chaque agrégateur
  une fois et écrit son résultat ; `readSnapshot()` le relit ;
- `POST /api/cron/refresh-stats`, protégé par `CRON_SECRET`, déclenché par
  `.github/workflows/refresh-stats.yml` toutes les heures ;
- les 9 pages de stats + les 4 routes API lisent un snapshot ; une page de
  champion a le sien (`champion:<id>`, 173 entrées).

**Repli assumé** : si un snapshot manque (base fraîche, cron jamais passé), la
page recalcule en direct. Le comportement est alors exactement l'ancien — jamais
pire, et seulement jusqu'au premier passage du job.

Deux choses mesurées à l'exécution, qui ne se devinaient pas :

- **Le `cache()` de React ne déduplique pas dans un route handler.** Un premier
  rafraîchissement complet a déclenché **184 lectures intégrales** de
  `match_participants` — une par agrégateur et par champion. La mémoïsation de
  React est liée au rendu d'un composant serveur. Corrigé avec un
  `AsyncLocalStorage` (`withParticipantSet`) : **1 lecture**. Ne pas revenir en
  arrière là-dessus.
- **Le coût réel du calcul est dérisoire** : 155 ms pour les 9 agrégateurs
  partagés, 410 ms pour les 173 pages de champion, ~600 ms au total à 900
  matchs. Les 40 s observées au premier essai étaient la compilation du serveur
  de dev, pas le travail.

`MAX_PAGES` passe de 30 à 500 (≈ 28 000 matchs) et, surtout, **une troncature
n'est plus muette** : elle est journalisée, stockée dans `stats_snapshots.truncated`
et fait échouer le job GitHub Actions. C'est ce qui rendait le plafond dangereux.

`getPlayerProfile` ne charge plus toute la base pour un seul joueur : requête
ciblée sur `puuid`, plus une seconde requête (recouvrement de tableaux Postgres)
qui ne remonte que les équipes AFK à exclure.

**Ce que ça ne règle pas** : l'agrégation reste en mémoire JS. Le vrai argument
pour passer en SQL n'est d'ailleurs pas le CPU mais **l'egress** — tant que le
calcul lit les lignes brutes depuis Supabase, chaque rafraîchissement les fait
sortir de la base. À l'échelle du crawler (phase 1), il faudra que le calcul
descende *dans* Postgres, où plus rien ne sort. C'est la phase 3.

### 0.2 — ✅ ISR à la place de `force-dynamic` (fait le 2026-09-13)

Les 9 pages de stats passent de `dynamic = "force-dynamic"` à
`revalidate = 1800`. Vérifié au build : elles sortent en `○ (Static)`, les pages
joueur restent en `ƒ (Dynamic)` — elles déclenchent un appel Riot en direct et
doivent le rester.

Choix de l'API : `export const revalidate` (modèle « précédent ») plutôt que
Cache Components. La doc embarquée (`03-file-conventions/02-route-segment-config`)
indique que `dynamic`/`revalidate` sont **supprimés lorsque `cacheComponents` est
activé** — l'activer aurait été une migration de toute l'app pour le même
résultat. À reconsidérer plus tard, pas en même temps qu'un changement d'archi.
Piège noté : la valeur doit être un littéral analysable statiquement
(`1800` ✅, `30 * 60` ❌).

### 0.3 — ✅ Rate limiter côté recherche joueur (fait le 2026-09-13)

`src/lib/riotClient.ts` : `riotFetch()` remplace les `fetch` directs. Fenêtre
glissante sur les deux limites (20/s **et** 100/2 min), **un limiteur par host**
puisque les compteurs d'`europe` et d'`euw1` sont distincts, réessai sur 429 en
lisant `Retry-After`, et recalage sur l'en-tête `x-app-rate-limit-count` que Riot
renvoie à chaque réponse.

Mesuré avant/après sur trois recherches enchaînées (~96 appels) :

| | Avant | Après |
|---|---|---|
| 429 rencontrés | non réessayés | 2, **tous deux réessayés** |
| matchs perdus | silencieusement abandonnés | **0** |

Le test a révélé un défaut que le plan n'avait pas prévu : la 3ᵉ recherche a mis
**117 s**. Le limiteur faisait son travail, mais une page blanche pendant deux
minutes est pire qu'une erreur franche. D'où `INTERACTIVE_MAX_WAIT_MS` (15 s) :
au-delà, on renvoie un 429 synthétique traduit en « trop de recherches,
réessayez dans un instant » — vérifié à **0,18 s** en saturant le limiteur.
Le paramètre `maxWaitMs` existe pour que le crawler, lui, puisse attendre.

Limite connue et assumée : le limiteur vit en mémoire du processus. Sur Vercel,
plusieurs instances ne le partagent pas — il protège une instance, pas la
flotte. Le réessai sur 429 couvre le reste. À revoir (Redis) quand le crawler
tournera en continu.

### 0.4 — ✅ Icône d'invocateur (fait le 2026-09-13)

`GET euw1/lol/summoner/v4/summoners/by-puuid/{puuid}` → `profileIconId` +
`summonerLevel`, sur le host `euw1` donc hors budget matchs. L'avatar de la page
joueur est désormais l'icône choisie par le joueur, avec son niveau en
sous-titre ; repli sur le champion le plus joué si Riot est injoignable.

La version Data Dragon nécessaire à l'URL est **relue depuis les URLs déjà
présentes dans `champions.json`** (`profileIconUrl` dans `gameData.ts`) plutôt
que redéclarée : une constante en double serait oubliée au prochain patch.

---

## Phase 1 — ✅ Le crawler (fait le 2026-09-13)

Livré et vérifié en production. `src/lib/crawler.ts` + `/api/cron/crawl` +
`.github/workflows/crawl.yml`.

### Résultats de la première mise en service

| | Avant | Après 2 passes |
|---|---|---|
| Matchs exploitables | 752 | **889** |
| Lignes participants | 13 521 | 16 002 |
| Matchs incomplets | 162 | 42 (en cours de résorption) |
| Joueurs en file | 0 | **9 652** |

Une passe de 244 s : 100 matchs réparés, 16 ingérés, **1 064 joueurs
découverts**, 126 appels Riot. Le débit est borné par la clé (100 appels /
2 min), pas par le code — le limiteur cadence exactement comme prévu.

### La cause des matchs vides, corrigée

161 matchs sur 913 étaient enregistrés sans aucun participant. La clé étrangère
impose d'écrire la ligne `matches` avant les participants ; un échec entre les
deux laissait un match vide, et `persistMatches(...).catch(console.error)`
avalait l'erreur. L'ancienne version « fire-and-forget » explique le volume :
la promesse était tuée à l'envoi de la réponse HTTP.

`ingested_at` n'est désormais posé qu'**après** l'écriture des participants. Un
match à NULL est incomplet par définition, et la passe de réparation le reprend
en priorité — c'est le meilleur rapport qualité/prix du budget d'appels : un
appel comble un trou déjà identifié.

### Arbitrage à connaître : le crawler et les visiteurs partagent la clé

Même budget de débit (100 appels / 2 min, attaché à la clé). Pendant une passe
le budget est saturé et une recherche de visiteur échoue — d'où l'espacement des
passes, qui rend la fenêtre au site.

### Deux corrections issues de la première nuit d'exploitation

**1. Une clé expirée brûlait le budget en silence.** La clé de dev meurt toutes
les 24 h ; chaque passe tentait alors 57 appels en 401 avant de s'arrêter, et
recommençait à chaque cron. Le garde-fou du workflow ne voyait rien : il testait
`riotCalls:0`, or `riotCalls` compte les appels *tentés*. Désormais la passe
commence par un contrôle de la clé sur `euw1` (compteur distinct, donc gratuit)
et abandonne en `apiUnavailable` ; le rapport distingue `riotOk` de `riotCalls`.

**2. Les crons GitHub sautent massivement.** Réglé sur `:43`, les lancements
réels observés : 15:03, 18:20, 21:07, 23:31, 01:40, 07:07 — **6 passes en 16 h
au lieu de 16**, avec 20 à 60 min de retard. Ils sont « best-effort », pas
garantis. L'estimation initiale de ~1 400 matchs/jour supposait un cron ponctuel
et était donc fausse (~360/jour en réalité).

Correction : **un job enchaîne plusieurs passes espacées** plutôt que de compter
sur la fréquence du cron. Un job GitHub peut durer 6 h et les minutes sont
illimitées sur un repo public — c'est le levier gratuit. À 3 passes par job et
~6 jobs/jour, on retrouve l'ordre de grandeur visé.

### Dette assumée

Le crawler tourne dans une route Next pour partager `fetchMatchDetail` et
`persistMatches` avec la recherche joueur — une seule logique d'ingestion. Sans
conséquence aujourd'hui (le débit de la clé de dev borne bien avant les 300 s
d'une fonction serverless), mais à migrer vers un worker autonome avec la clé de
production.

### Conception d'origine (conservée pour référence)

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

## Phase 2 — ✅ Ordre d'achat réel des items (fait le 2026-09-14)

Livré et vérifié en production. `src/lib/timeline.ts` + `/api/cron/timelines` +
`.github/workflows/timelines.yml`, colonne `match_participants.item_order` et
marqueur `matches.timeline_fetched_at`.

### Ce que ça corrigeait, mesuré

Le pari du plan était que `items[0]` n'est pas le premier achat. Sur les 4 363
participants qui ont maintenant les deux, **le premier slot d'inventaire n'est le
premier achat que dans 37,5 % des cas** : près de deux tiers de l'ancienne stat
« premier item » était du bruit.

Le nouvel ordre, lui, est immédiatement plausible — six des huit premiers achats
les plus fréquents sont des bottes (Ionian 719, Berserker's 465, Sorcerer's 385,
Mercury's 335), les deux autres étant Heartsteel et Infinity Edge. L'ancien
classement ne ressemblait à rien de tel.

### Débit constaté

| | Valeur |
|---|---|
| Une passe | 80 matchs en 127 s, 81 appels, **81 aboutis** |
| Un job (3 passes) | 240 matchs, 4 320 participants, 9 min 35 |
| Couverture au 14/09 | 284 / 1 531 matchs (18,5 %), 1 247 en attente |

Le rattrapage est borné par la clé, pas par le code — comme le crawl. À ce
rythme (~240 matchs/job) le retard se comble en 5 à 6 jobs, mais chaque appel
dépensé ici est un appel que le crawl principal n'a pas : c'est l'arbitrage
prévu, et c'est pour ça que la passe est séparée et prioritaire au plus récent.

### Deux choses que l'exécution a apprises

**La famille d'enclumes est continue de 220000 à 220007**, pas les quatre IDs
listés au plan. Une première version laissait passer « Legendary Fighter Item »
et « Legendary Assassin Item » dans l'ordre d'achat — repéré en relisant les
premières lignes écrites en base, pas en relecture de code.

**14,6 % des participants ont un ordre vide** (749 sur 5 112) et c'est normal :
ce sont ceux dont tout le build sort d'enclumes. Confirme la conclusion du plan —
`item_order` complète `items`, il ne le remplace pas. `aggregate.ts` retombe
d'ailleurs sur `items` quand l'ordre est vide.

### Conception d'origine (conservée pour référence)

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

## Phase 3 — Mise à l'échelle

> **Le déclencheur n'est pas la clé de prod, c'est l'egress** (voir la correction
> du 2026-09-14 en tête de document). Le rafraîchissement relit toute la table à
> chaque passage : ~14 000 matchs au rythme de cron actuel, et la facture Supabase
> démarre. À faire avant d'avoir la clé, pas après.


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
0.1  ✅ snapshots pré-calculés (fait 2026-09-13)
0.2  ✅ ISR sur les pages de stats (fait 2026-09-13)
0.3  ✅ rate limiter côté recherche joueur (fait 2026-09-13)
0.4  ✅ icône d'invocateur (fait 2026-09-13)
1    ✅ crawler + schéma à deux modes (fait 2026-09-13)
2    ✅ ordre d'achat des items (passe séparée) (fait 2026-09-14)
3    ─ clé de prod ─ mise à l'échelle, Supabase Pro quand la base le réclame
4    timelines complets, classement Arena
```

Les phases 0 et 1 sont aussi ce qui aide à **obtenir** la clé de prod : Riot veut
voir un site qui tourne et qui tient debout. Ce n'est pas du remplissage
d'attente, c'est le dossier.
