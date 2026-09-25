/**
 * Test de la comparaison de publications.
 *
 * Il ne teste pas « est-ce que ça marche » mais les quatre propriétés dont
 * l'absence m'a fait valider une réécriture fausse le 2026-09-25 :
 *
 *   1. une comparaison qui ne compare RIEN doit le dire, pas répondre « égal » ;
 *   2. une différence dans une liste empaquetée — un tableau de nombres sans
 *      noms de champs — doit être vue ; c'est exactement ce qu'une requête qui
 *      nomme `games` et `tierStat` rate en silence ;
 *   3. le bruit d'arrondi doit être classé comme tel, sinon chaque réécriture
 *      ressemble à une régression ;
 *   4. un champ présent d'un seul côté est une différence, pas un oubli.
 *
 *   node scripts/verify-publication.test.mjs
 */
import { compareAll } from "./verify-publication.mjs";

let echecs = 0;
const t = (nom, condition) => {
  console.log(`${condition ? "✓" : "✗ ÉCHEC —"} ${nom}`);
  if (!condition) echecs += 1;
};

// 1. Le piège d'origine. Deux documents sans feuille commune ne prouvent rien ;
//    `compared` doit valoir 0 pour que l'appelant refuse de conclure.
t("zéro document → zéro feuille comparée", compareAll({}, {}).compared === 0);

// 2. Une liste empaquetée dont un élément bouge. La forme réelle d'`allItems` :
//    [itemId, games, top1, top3, placementSum, avgPlacement, …], sans aucun nom.
const empaqueteA = { "champion:ahri": { allItems: [[447108, 746, 147, 426, 2426, 3.2079]] } };
const empaqueteB = { "champion:ahri": { allItems: [[447108, 746, 147, 426, 2426, 3.2081]] } };
const surEmpaquete = compareAll(empaqueteA, empaqueteB);
t("différence dans un tableau empaqueté détectée", surEmpaquete.differences.length === 1);
t("chemin exact rapporté", surEmpaquete.differences[0]?.path === "champion:ahri.allItems.0.5");

// 3. Une somme réordonnée dérive vers la quinzième décimale. C'est attendu de
//    toute réécriture d'agrégation et ça ne doit pas faire échouer la
//    vérification — sans quoi plus aucune réécriture ne serait validable.
const arrondi = compareAll({ k: { x: 0.6537151791587511 } }, { k: { x: 0.6537151791587509 } });
t("arrondi à 1e-16 classé en arrondi", arrondi.differences.length === 0 && arrondi.rounding === 1);

// 4. Un champ qui apparaît ou disparaît est un changement de contrat.
t(
  "champ présent d'un seul côté signalé",
  compareAll({ k: { x: 1 } }, { k: { x: 1, y: 2 } }).differences.length === 1,
);

// 5. Un snapshot entier qui apparaît ou disparaît aussi.
t(
  "snapshot présent d'un seul côté signalé",
  compareAll({ a: { x: 1 } }, { a: { x: 1 }, b: { x: 1 } }).differences.length === 1,
);

console.log(echecs === 0 ? "\nTous les tests passent." : `\n${echecs} test(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
