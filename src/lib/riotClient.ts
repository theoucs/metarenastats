/**
 * Client HTTP pour l'API Riot : respecte les limites de débit et réessaie
 * proprement sur un 429.
 *
 * Ce qu'il corrige. L'ancien code espaçait les appels par lots (5 en parallèle,
 * 300 ms de pause), ce qui ne couvrait que la limite « 20 requêtes/seconde » et
 * ignorait complètement la seconde : **100 requêtes / 2 minutes**. Une recherche
 * de joueur coûte ~32 appels, donc la 4ᵉ recherche enchaînée prenait un 429, sans
 * aucun réessai ni lecture de `Retry-After` — l'utilisateur voyait juste un
 * message d'échec.
 *
 * Deux limites s'empilent côté Riot et la plus stricte gagne :
 *  - la limite « application », attachée à la clé — sur une clé de dev,
 *    `100:120,20:1` (100 par 120 s ET 20 par seconde) ;
 *  - la limite « méthode », propre à chaque endpoint, si large sur nos endpoints
 *    (2000/10 s sur match-v5) qu'elle n'est jamais le facteur limitant.
 *
 * Détail vérifié qui compte : **le compteur applicatif est par host régional**.
 * `europe.api.riotgames.com` et `euw1.api.riotgames.com` ont chacun le leur, d'où
 * un limiteur distinct par host plutôt qu'un compteur global — sinon les appels
 * `euw1` (icône d'invocateur…) consommeraient à tort le budget des matchs.
 */

/** Fenêtres de la limite applicative d'une clé de développement. */
const APP_RATE_LIMITS: ReadonlyArray<{ limit: number; windowMs: number }> = [
  { limit: 20, windowMs: 1_000 },
  { limit: 100, windowMs: 120_000 },
];

const MAX_RETRIES = 2;
/** Garde-fou si Riot renvoie un 429 sans `Retry-After` exploitable. */
const FALLBACK_RETRY_AFTER_MS = 2_000;
/** Un `Retry-After` déraisonnable ne doit pas bloquer un rendu de page. */
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * Attente maximale acceptée avant d'abandonner, pour un appel servant un rendu
 * de page.
 *
 * Mesuré : trois recherches enchaînées (~96 appels) saturent la fenêtre
 * 100/2 min, et la troisième a mis **117 s** — le limiteur faisait exactement
 * son travail, mais un visiteur devant une page blanche pendant deux minutes
 * est un pire résultat qu'une erreur honnête. Au-delà de ce seuil on renvoie
 * donc un 429 synthétique, que `riotErrorResult` traduit déjà en « trop de
 * recherches, réessayez dans un instant ».
 *
 * Le crawler (phase 1) voudra l'inverse : attendre patiemment. D'où le
 * paramètre `maxWaitMs` plutôt qu'une constante en dur.
 */
const INTERACTIVE_MAX_WAIT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Limiteur à fenêtre glissante pour un host.
 *
 * Limite volontairement en mémoire du processus. Sur Vercel, plusieurs instances
 * peuvent tourner en parallèle et ne partagent pas ce compteur : ce limiteur
 * empêche donc une *instance* de dépasser son quota, pas la flotte entière. Un
 * limiteur réellement distribué demanderait Redis, ce qui n'est pas justifié
 * tant que le trafic est ce qu'il est — et le réessai sur 429 ci-dessous couvre
 * le cas résiduel. À revoir quand le crawler tournera en continu.
 */
class HostRateLimiter {
  private timestamps: number[] = [];
  /** Sérialise les réservations : sans ça, deux appels concurrents peuvent
   * réserver le même créneau et dépasser la limite ensemble. */
  private queue: Promise<void> = Promise.resolve();

  /** @returns false si le créneau demanderait d'attendre plus que `maxWaitMs`. */
  async acquire(maxWaitMs: number): Promise<boolean> {
    const run = this.queue.then(() => this.reserve(maxWaitMs));
    // On avale l'erreur sur la chaîne pour qu'un échec ne bloque pas la file.
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  private async reserve(maxWaitMs: number): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    // Boucle : après une attente, une autre fenêtre peut être devenue limitante.
    for (;;) {
      const now = Date.now();
      const longestWindow = Math.max(...APP_RATE_LIMITS.map((l) => l.windowMs));
      this.timestamps = this.timestamps.filter((t) => now - t < longestWindow);

      let waitMs = 0;
      for (const { limit, windowMs } of APP_RATE_LIMITS) {
        const inWindow = this.timestamps.filter((t) => now - t < windowMs);
        if (inWindow.length >= limit) {
          // Attendre que la plus ancienne requête de la fenêtre en sorte.
          waitMs = Math.max(waitMs, windowMs - (now - inWindow[0]) + 1);
        }
      }

      if (waitMs === 0) {
        this.timestamps.push(now);
        return true;
      }
      if (now + waitMs > deadline) return false;
      await sleep(waitMs);
    }
  }

  /** Recale le compteur sur ce que Riot dit réellement. */
  syncFromHeaders(header: string | null): void {
    // Format : "3:120,1:1" — compte:fenêtre_en_secondes, une paire par fenêtre.
    if (!header) return;
    const now = Date.now();
    for (const pair of header.split(",")) {
      const [countRaw, windowRaw] = pair.split(":");
      const count = Number(countRaw);
      const windowMs = Number(windowRaw) * 1000;
      if (!Number.isFinite(count) || !Number.isFinite(windowMs)) continue;

      const known = this.timestamps.filter((t) => now - t < windowMs).length;
      // Riot compte plus d'appels que nous (autre instance, autre onglet) :
      // on comble l'écart avec des marqueurs datés pour ne pas sous-estimer.
      for (let i = known; i < count; i++) this.timestamps.push(now);
    }
  }
}

const limiters = new Map<string, HostRateLimiter>();

function limiterFor(url: string): HostRateLimiter {
  const host = new URL(url).host;
  let limiter = limiters.get(host);
  if (!limiter) {
    limiter = new HostRateLimiter();
    limiters.set(host, limiter);
  }
  return limiter;
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return FALLBACK_RETRY_AFTER_MS;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * `fetch` vers l'API Riot, cadencé et avec réessai sur 429.
 *
 * Ne réessaie que sur 429 : un 404 (joueur inconnu) ou un 401 (clé expirée) ne
 * s'arrangeront pas en insistant, et l'appelant a un message dédié pour chacun.
 */
export async function riotFetch(
  url: string,
  apiKey: string,
  { maxWaitMs = INTERACTIVE_MAX_WAIT_MS }: { maxWaitMs?: number } = {},
): Promise<Response> {
  const limiter = limiterFor(url);

  for (let attempt = 0; ; attempt++) {
    if (!(await limiter.acquire(maxWaitMs))) {
      console.warn(`[riot] budget de débit saturé sur ${new URL(url).pathname} — abandon plutôt que faire attendre.`);
      // 429 synthétique : l'appelant a déjà le bon message pour ce cas.
      return new Response(null, { status: 429, statusText: "Local rate limit" });
    }
    const response = await fetch(url, {
      headers: { "X-Riot-Token": apiKey },
      cache: "no-store",
    });

    limiter.syncFromHeaders(response.headers.get("x-app-rate-limit-count"));

    if (response.status !== 429 || attempt >= MAX_RETRIES) return response;

    const waitMs = retryAfterMs(response);
    console.warn(
      `[riot] 429 sur ${new URL(url).pathname} — nouvelle tentative dans ${waitMs} ms ` +
        `(${attempt + 1}/${MAX_RETRIES})`,
    );
    await sleep(waitMs);
  }
}
