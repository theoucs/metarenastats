import { riotFetch } from "@/lib/riotClient";
import { apiKey } from "@/lib/riotSearch";
import { itemCategory } from "@/lib/gameData";

/**
 * Ordre d'achat des items, extrait du Match Timeline.
 *
 * `match_participants.items` conserve l'ordre des *slots d'inventaire* de Riot,
 * pas l'ordre d'achat — vérifié sur EUW1_7982040680, où Xayah achète
 * Boots → The Collector → Infinity Edge mais dont l'inventaire final range
 * Boots, Reaper's Toll, Collector, IE. Le commentaire d'`aggregate.ts` qui
 * parlait d'une « approximation de l'ordre d'achat » était donc inexact.
 *
 * ⚠️ Ce que le timeline ne donne pas : **les prismatiques**. Ils ne sont jamais
 * achetés en boutique — mesuré sur 108 participants, 20 apparaissent dans un
 * timeline contre 183 réellement possédés. L'ordre extrait ici ne couvre donc
 * que les achats en boutique (bottes + légendaires) et **complète** l'inventaire
 * final, il ne le remplace pas.
 */

/**
 * Enclumes : ce que le joueur achète est le *droit de choisir*, pas l'item qui
 * en sort. Les laisser polluerait l'ordre avec des entrées qui ne sont pas des
 * items (« Stat Bonus » apparaissait 27 fois d'affilée chez un même joueur).
 *
 * La famille occupe la plage **220000-220007 en continu** : Stat Bonus, les six
 * « Legendary <rôle> Item » (Fighter, Marksman, Assassin, Mage, Tank, Support)
 * et Prismatic Item. Une première version n'en listait que quatre et laissait
 * passer « Legendary Fighter Item » et « Legendary Assassin Item » dans l'ordre
 * d'achat — repéré en relisant les premières lignes écrites en base.
 *
 * 220008-220011 (les « Voucher ») sont déjà marqués `excluded` dans items.json
 * et tombent donc sous le filtre de catégorie ci-dessous.
 */
const ANVIL_ID_MIN = 220000;
const ANVIL_ID_MAX = 220007;

/** Consommables (« juices ») : achetés en cours de partie, jamais un choix de build. */
const CONSUMABLE_ITEM_IDS = new Set([2142, 2143, 2144, 2145]);

type TimelineEvent = {
  type: string;
  timestamp: number;
  participantId?: number;
  itemId?: number;
  beforeId?: number;
  afterId?: number;
};

/** Ordre d'achat par puuid, pour un match. */
export type MatchItemOrder = Map<string, number[]>;

function isBuildItem(itemId: number): boolean {
  if (itemId >= ANVIL_ID_MIN && itemId <= ANVIL_ID_MAX) return false;
  if (CONSUMABLE_ITEM_IDS.has(itemId)) return false;
  // « excluded » couvre les récompenses de quête et les items auto-attribués
  // (Arcane Sweeper, que ~tout le monde possède) — jamais un choix de build.
  return itemCategory(itemId) !== "excluded";
}

/**
 * Rejoue les événements d'un joueur pour obtenir l'ordre des items qu'il a
 * réellement gardés.
 *
 * Une simple liste des `ITEM_PURCHASED` ne suffit pas : un achat annulé
 * (`ITEM_UNDO`, 16 occurrences sur une seule partie observée) compterait comme
 * un achat, et un item revendu apparaîtrait dans un build dont il ne fait plus
 * partie. On simule donc l'inventaire.
 */
function orderForParticipant(events: TimelineEvent[], participantId: number): number[] {
  const acquired: number[] = [];

  const removeLast = (itemId: number) => {
    const index = acquired.lastIndexOf(itemId);
    if (index !== -1) acquired.splice(index, 1);
  };

  for (const event of events) {
    if (event.participantId !== participantId) continue;

    switch (event.type) {
      case "ITEM_PURCHASED":
        if (event.itemId !== undefined && isBuildItem(event.itemId)) acquired.push(event.itemId);
        break;
      case "ITEM_UNDO":
        // `beforeId` est l'item rendu au marchand (0 quand l'undo porte sur une vente).
        if (event.beforeId) removeLast(event.beforeId);
        break;
      case "ITEM_SOLD":
        if (event.itemId !== undefined) removeLast(event.itemId);
        break;
    }
  }

  // Dédupliquer en gardant la première acquisition : un même item racheté plus
  // tard (vu : Essence Reaver acheté trois fois) ne doit apparaître qu'une fois,
  // à la position où il est entré dans le build.
  const seen = new Set<number>();
  return acquired.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

/** Extrait l'ordre d'achat de chaque participant d'un timeline déjà téléchargé. */
export function parseItemOrder(timeline: {
  info: { frames: { events: TimelineEvent[] }[]; participants: { participantId: number; puuid: string }[] };
}): MatchItemOrder {
  const events = timeline.info.frames.flatMap((frame) => frame.events);
  const order: MatchItemOrder = new Map();
  for (const { participantId, puuid } of timeline.info.participants) {
    order.set(puuid, orderForParticipant(events, participantId));
  }
  return order;
}

/**
 * Télécharge et dépouille le timeline d'un match.
 *
 * @param maxWaitMs combien de temps accepter d'attendre un créneau de débit.
 */
export async function fetchItemOrder(
  matchId: string,
  maxWaitMs?: number,
): Promise<MatchItemOrder | null> {
  const res = await riotFetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`,
    apiKey(),
    maxWaitMs === undefined ? undefined : { maxWaitMs },
  );
  if (!res.ok) {
    console.error(`[timeline] ${matchId} ignoré : HTTP ${res.status}`);
    return null;
  }
  try {
    return parseItemOrder(await res.json());
  } catch (error) {
    console.error(`[timeline] ${matchId} illisible :`, error);
    return null;
  }
}
