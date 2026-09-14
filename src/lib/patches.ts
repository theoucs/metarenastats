import { supabaseAdmin } from "@/lib/supabase";

/**
 * Quel patch le site montre, et lequel il propose en second.
 *
 * Les tier lists d'un patch périmé ne servent à rien : un augment nerfé de 20 %
 * garde ses anciens chiffres. On ne publie donc que deux patchs, le courant et
 * le précédent — au-delà, les données ne servent plus qu'à l'historique d'un
 * joueur et au classement, qui eux restent sur tout ce qu'on connaît.
 */

/**
 * Matchs requis pour qu'un patch devienne celui affiché par défaut.
 *
 * Le jour où un patch sort, il n'a aucune donnée : basculer dessus
 * immédiatement afficherait des tier lists construites sur trente parties. En
 * dessous de ce seuil, le site reste sur le patch précédent en le disant, et
 * bascule tout seul une fois le seuil franchi.
 *
 * 300 est un point de départ assumé : à 173 champions ça fait moins de deux
 * parties par champion, donc c'est un plancher, pas un gage de fiabilité. Le
 * sélecteur permet de toute façon de revenir au patch précédent.
 */
export const PATCH_MIN_MATCHES = 300;

/**
 * Plancher pour qu'un patch soit seulement *reconnu comme existant*.
 *
 * Sépare « ce patch existe » de « ce patch est affichable ». Sans lui, un seul
 * match mal étiqueté — une partie jouée pendant un déploiement, un match dont
 * la version est illisible — ferait apparaître un patch fantôme et décalerait
 * tout le reste d'un cran.
 */
const PATCH_MIN_TO_EXIST = 5;

export type PatchOption = {
  patch: string;
  matches: number;
  participants: number;
};

export type PatchContext = {
  /** Le courant d'abord, le précédent ensuite. Vide si la base est neuve. */
  options: PatchOption[];
  current: PatchOption | null;
  previous: PatchOption | null;
  /** Celui que le site affiche sans qu'on lui demande rien. */
  defaultPatch: string | null;
  /** true quand le patch courant est trop maigre et qu'on montre le précédent. */
  showingPrevious: boolean;
};

const EMPTY: PatchContext = {
  options: [],
  current: null,
  previous: null,
  defaultPatch: null,
  showingPrevious: false,
};

/**
 * Les patchs disponibles, lus dans les données.
 *
 * Volontairement pas depuis une liste externe (Data Dragon, notes de patch) :
 * ce qui compte est le patch sous lequel les parties ont RÉELLEMENT été jouées.
 * Riot déploie par région et en décalé ; nos matchs, eux, portent la version
 * que le serveur avait au moment de la partie.
 */
export async function getPatchContext(): Promise<PatchContext> {
  if (!supabaseAdmin) return EMPTY;

  const { data, error } = await supabaseAdmin.rpc("patch_options", {
    min_matches: PATCH_MIN_TO_EXIST,
  });
  if (error) {
    console.error("[patch] liste des patchs indisponible :", error.message);
    return EMPTY;
  }

  const options: PatchOption[] = (data ?? [])
    .slice(0, 2)
    .map((row: { patch: string; matches: number; participants: number }) => ({
      patch: row.patch,
      matches: Number(row.matches),
      participants: Number(row.participants),
    }));

  const [current = null, previous = null] = options;
  if (!current) return EMPTY;

  // Le patch courant ne prend la main que s'il tient debout — et seulement s'il
  // existe un précédent où se replier. Sur une base neuve, mieux vaut un patch
  // maigre que rien du tout.
  const showingPrevious = current.matches < PATCH_MIN_MATCHES && previous !== null;

  return {
    options,
    current,
    previous,
    defaultPatch: showingPrevious ? previous.patch : current.patch,
    showingPrevious,
  };
}

/**
 * Clé de snapshot pour un patch donné : « champions@16.18 ».
 *
 * Le séparateur est `@` et non `:`, déjà utilisé par les pages de champion
 * (« champion:ahri »). Une clé reste donc lisible et découpable sans ambiguïté.
 */
export function patchedKey(base: string, patch: string): string {
  return `${base}@${patch}`;
}
