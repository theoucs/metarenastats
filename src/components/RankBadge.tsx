import type { Tier } from "@/lib/rating";

/**
 * Le rang Arena d'un joueur (Iron → Challenger).
 *
 * Aux couleurs des paliers de la ranked, parce que c'est la seule échelle que
 * le joueur connaît déjà : personne n'a besoin qu'on lui explique ce que vaut
 * un Emerald. Volontairement distinct des pastilles S/A/B des tier lists, qui
 * notent un champion, pas une personne (voir lib/tiers.ts).
 */
const RANK_STYLES: Record<Tier, { text: string; bg: string; border: string }> = {
  Challenger: { text: "text-[#4BE0E8]", bg: "bg-[#4BE0E8]/[0.14]", border: "border-[#4BE0E8]/40" },
  Grandmaster: { text: "text-[#E8555A]", bg: "bg-[#E8555A]/[0.13]", border: "border-[#E8555A]/35" },
  Master: { text: "text-[#B478F0]", bg: "bg-[#B478F0]/[0.13]", border: "border-[#B478F0]/35" },
  Diamond: { text: "text-[#7CA9F5]", bg: "bg-[#7CA9F5]/[0.12]", border: "border-[#7CA9F5]/30" },
  Emerald: { text: "text-[#3FCF8E]", bg: "bg-[#3FCF8E]/[0.12]", border: "border-[#3FCF8E]/30" },
  Platinum: { text: "text-[#4FC4C0]", bg: "bg-[#4FC4C0]/[0.11]", border: "border-[#4FC4C0]/28" },
  Gold: { text: "text-[#F2B640]", bg: "bg-[#F2B640]/[0.12]", border: "border-[#F2B640]/32" },
  Silver: { text: "text-[#A6B2C4]", bg: "bg-[#A6B2C4]/[0.09]", border: "border-[#A6B2C4]/22" },
  Bronze: { text: "text-[#C08552]", bg: "bg-[#C08552]/[0.10]", border: "border-[#C08552]/25" },
  Iron: { text: "text-[#7E8494]", bg: "bg-[#7E8494]/[0.07]", border: "border-[#7E8494]/[0.18]" },
};

export function RankBadge({ tier, size = "sm" }: { tier: Tier; size?: "sm" | "lg" }) {
  const style = RANK_STYLES[tier];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border font-display font-bold uppercase tracking-wide ${
        size === "lg" ? "px-2.5 py-1 text-small" : "px-2 py-0.5 text-micro"
      } ${style.bg} ${style.text} ${style.border}`}
    >
      {tier}
    </span>
  );
}
