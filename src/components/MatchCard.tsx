"use client";

import { useState } from "react";
import Link from "next/link";
import { resolveChampion, resolveItem, resolveAugment } from "@/lib/gameData";

export type MatchPlayer = {
  puuid: string;
  riotId: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  items: number[];
  augments: number[];
  isSearchedPlayer: boolean;
};

export type MatchTeam = {
  subteamId: number;
  placement: number;
  players: MatchPlayer[];
};

export type MatchCardData = {
  matchId: string;
  gameCreation: number;
  placement: number;
  teams: MatchTeam[];
};

function placementColor(placement: number) {
  if (placement === 1) return "text-yellow-400";
  if (placement <= 3) return "text-emerald-400";
  return "text-zinc-400";
}

// Matches the tier-list icon rarity treatment, scaled down for these small icons.
const RARITY_RING: Record<string, string> = {
  silver: "ring-1 ring-slate-300/60",
  gold: "ring-1 ring-amber-400/80",
  prismatic: "ring-1 ring-fuchsia-400/80",
};

/** Small icon with a custom hover bubble showing its name (instant, styled — not the native title="" tooltip). */
function IconTooltip({
  src,
  name,
  className,
}: {
  src: string;
  name: string;
  className: string;
}) {
  return (
    <span className="group/tip relative inline-flex shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className={className} />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs font-medium text-zinc-100 opacity-0 shadow-lg transition-opacity duration-100 group-hover/tip:opacity-100">
        {name}
      </span>
    </span>
  );
}

function PlayerRow({ player, highlight }: { player: MatchPlayer; highlight?: boolean }) {
  const champ = resolveChampion(player.champion);

  return (
    <div
      className={`rounded-lg px-2.5 py-2 ${
        highlight ? "border border-blue-500/40 bg-blue-500/10" : "border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2.5">
        {champ ? (
          <Link href={`/champions/${player.champion}`} className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={champ.iconUrl}
              alt=""
              className="h-9 w-9 rounded-md border border-zinc-800 object-cover transition-opacity hover:opacity-80"
            />
          </Link>
        ) : (
          <span className="h-9 w-9 shrink-0 rounded-md border border-zinc-800 bg-zinc-900" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            {champ ? (
              <Link
                href={`/champions/${player.champion}`}
                className="truncate text-sm font-medium text-zinc-100 hover:underline"
              >
                {champ.name}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium text-zinc-100">{player.champion}</span>
            )}
            <span className="shrink-0 font-mono text-xs text-zinc-400">
              {player.kills}/{player.deaths}/{player.assists}
            </span>
          </div>
          <span className="block truncate text-xs text-zinc-500">{player.riotId}</span>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-[46px]">
        {player.items.map((id, i) => {
          const item = resolveItem(id);
          if (!item) return null;
          return (
            <IconTooltip
              key={`item-${id}-${i}`}
              src={item.iconUrl}
              name={item.name}
              className="h-[22px] w-[22px] rounded border border-zinc-800 object-cover"
            />
          );
        })}
        {player.augments.length > 0 && <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-800" />}
        {player.augments.map((id, i) => {
          const aug = resolveAugment(id);
          if (!aug) return null;
          return (
            <IconTooltip
              key={`aug-${id}-${i}`}
              src={aug.iconUrl}
              name={aug.name}
              className={`h-5 w-5 rounded-full object-cover ${RARITY_RING[aug.tier] ?? ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function TeamBlock({ team }: { team: MatchTeam }) {
  return (
    <div>
      <div className={`mb-1 text-xs font-semibold ${placementColor(team.placement)}`}>
        #{team.placement}
      </div>
      <div className="flex flex-col gap-1">
        {team.players.map((p) => (
          <PlayerRow key={p.puuid} player={p} />
        ))}
      </div>
    </div>
  );
}

export function MatchCard({ match }: { match: MatchCardData }) {
  const [expanded, setExpanded] = useState(false);
  const myTeam = match.teams.find((t) => t.players.some((p) => p.isSearchedPlayer));
  const otherTeams = match.teams.filter((t) => t.subteamId !== myTeam?.subteamId);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <span className={`text-xl font-bold ${placementColor(match.placement)}`}>
          #{match.placement}
        </span>
        <span className="text-sm text-zinc-500">
          {new Date(match.gameCreation).toLocaleString("en-GB")}
        </span>
      </div>

      {myTeam && (
        <div className="mt-3 flex flex-col gap-1">
          {myTeam.players.map((p) => (
            <PlayerRow key={p.puuid} player={p} highlight={p.isSearchedPlayer} />
          ))}
        </div>
      )}

      {otherTeams.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 w-full rounded-md border border-zinc-800 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          {expanded ? "Hide other teams" : `Show full lobby (${match.teams.length} teams)`}
        </button>
      )}

      {expanded && (
        <div className="mt-3 flex flex-col gap-3 border-t border-zinc-800 pt-3">
          {otherTeams.map((t) => (
            <TeamBlock key={t.subteamId} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}
