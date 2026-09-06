// Script de validation Phase 0 : vérifie qu'on peut bien récupérer des données de match Arena.
// Usage : node --env-file=.env test-riot-api.mjs "Pseudo#TAG"

const apiKey = process.env.RIOT_API_KEY;
const riotId = process.argv[2];

if (!apiKey) {
  console.error("Erreur : RIOT_API_KEY manquante. Vérifie ton fichier .env");
  process.exit(1);
}
if (!riotId || !riotId.includes("#")) {
  console.error('Usage : node --env-file=.env test-riot-api.mjs "Pseudo#TAG"');
  process.exit(1);
}

const [gameName, tagLine] = riotId.split("#");
const headers = { "X-Riot-Token": apiKey };

async function riotFetch(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} sur ${url}\n${await res.text()}`);
  }
  return res.json();
}

// 1. Riot ID -> PUUID (routing "regional", ici europe pour EUW)
const account = await riotFetch(
  `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
);
console.log("Compte trouvé :", account);

// 2. Liste des derniers match IDs en Arena (queue 1750 = Arena "Three by Six" actuel, depuis patch 26.10 / mai 2026)
// Note : 1700 est l'ANCIEN format Arena 2v2 (8 équipes de 2), obsolète depuis mai 2026.
const matchIds = await riotFetch(
  `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=1750&start=0&count=5`
);
console.log(`\n${matchIds.length} match(s) Arena trouvé(s) :`, matchIds);

if (matchIds.length === 0) {
  console.log("\nAucun match Arena récent sur ce compte. Réessaie avec un pseudo qui joue souvent en Arena.");
  process.exit(0);
}

// 3. Détail du match le plus récent
const match = await riotFetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${matchIds[0]}`);
console.log("\nqueueId:", match.info.queueId, "| gameMode:", match.info.gameMode);

const me = match.info.participants.find((p) => p.puuid === account.puuid);
console.log("\nDonnées du joueur dans ce match :");
console.log(JSON.stringify(me, null, 2));
