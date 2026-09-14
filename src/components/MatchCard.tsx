"use client";

import { useState } from "react";
import Link from "next/link";
import { resolveChampion, resolveItem, resolveAugment } from "@/lib/gameData";
import { EntityTooltip } from "@/components/EntityTooltip";

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

// 1st = gold (the site's "excellence" signal, same as tier S), 2nd/3rd =
// accent (still a podium finish), 4th-6th = neutral — mirrors the tier ramp's
// own descent so a glance at the rail says as much as the number.
function placementTextColor(placement: number) {
  if (placement === 1) return "text-gold";
  if (placement <= 3) return "text-accent";
  return "text-secondary";
}

function placementRailColor(placement: number) {
  if (placement === 1) return "var(--gold)";
  if (placement <= 3) return "var(--accent)";
  return "var(--border-default)";
}

// Matches the tier-list icon rarity treatment, scaled down for these small icons.
const RARITY_RING: Record<string, string> = {
  silver: "ring-1 ring-[color:var(--rarity-silver)]/60",
  gold: "ring-1 ring-[color:var(--rarity-gold)]/80",
  prismatic: "ring-1 ring-[color:var(--prism-violet)]/80",
};

function PlayerRow({ player, highlight }: { player: MatchPlayer; highlight?: boolean }) {
  const champ = resolveChampion(player.champion);

  return (
    <div
      className={`rounded-lg px-2.5 py-2 ${
        highlight
          ? "border border-[color:var(--accent-border)] bg-[color:var(--accent-muted)]"
          : "border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2.5">
        {champ ? (
          <Link href={`/champions/${player.champion}`} className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={champ.iconUrl}
              alt=""
              className="h-9 w-9 rounded-md border border-subtle object-cover transition-opacity hover:opacity-80"
            />
          </Link>
        ) : (
          <span className="h-9 w-9 shrink-0 rounded-md border border-subtle bg-raised" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            {champ ? (
              <Link
                href={`/champions/${player.champion}`}
                className="truncate text-small font-medium text-primary hover:underline"
              >
                {champ.name}
              </Link>
            ) : (
              <span className="truncate text-small font-medium text-primary">{player.champion}</span>
            )}
            <span className="shrink-0 font-mono text-micro text-secondary">
              {player.kills}/{player.deaths}/{player.assists}
            </span>
          </div>
          <span className="block truncate text-micro text-muted">{player.riotId}</span>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-[46px]">
        {player.items.map((id, i) => {
          const item = resolveItem(id);
          if (!item) return null;
          return (
            <EntityTooltip key={`item-${id}-${i}`} entity={{ type: "item", id }} name={item.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.iconUrl}
                alt=""
                className="h-[22px] w-[22px] rounded border border-subtle object-cover"
              />
            </EntityTooltip>
          );
        })}
        {player.augments.length > 0 && <span className="mx-0.5 h-4 w-px shrink-0 bg-subtle" />}
        {player.augments.map((id, i) => {
          const aug = resolveAugment(id);
          if (!aug) return null;
          return (
            <EntityTooltip key={`aug-${id}-${i}`} entity={{ type: "augment", id }} name={aug.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={aug.iconUrl}
                alt=""
                className={`h-5 w-5 rounded-full object-cover ${RARITY_RING[aug.tier] ?? ""}`}
              />
            </EntityTooltip>
          );
        })}
      </div>
    </div>
  );
}

function TeamBlock({ team }: { team: MatchTeam }) {
  return (
    <div>
      <div className={`mb-1 font-display text-small font-semibold ${placementTextColor(team.placement)}`}>
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
    <div
      className="rounded-xl border border-subtle border-l-2 border-l-[color:var(--rail)] bg-raised/50 p-4"
      style={{ "--rail": placementRailColor(match.placement) } as React.CSSProperties}
    >
      <div className="flex items-center justify-between">
        <span className={`font-display text-xl font-bold ${placementTextColor(match.placement)}`}>
          #{match.placement}
        </span>
        <span className="text-small text-muted">
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
          className="mt-3 w-full rounded-md border border-subtle py-1.5 text-micro font-medium text-muted transition-colors hover:bg-overlay hover:text-secondary"
        >
          {expanded ? "Hide other teams" : `Show full lobby (${match.teams.length} teams)`}
        </button>
      )}

      {expanded && (
        <div className="mt-3 flex flex-col gap-3 border-t border-subtle pt-3">
          {otherTeams.map((t) => (
            <TeamBlock key={t.subteamId} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}
