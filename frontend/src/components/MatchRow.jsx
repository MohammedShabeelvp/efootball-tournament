import { Link } from "react-router-dom";
import { TeamLogo } from "./ui.jsx";

function TeamName({ team, tid, align, highlight }) {
  const body = (
    <span className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <TeamLogo team={team} size={26} />
      <span className="min-w-0">
        <span className={`block truncate font-medium ${highlight ? "text-gold" : ""}`}>{team.club_name}</span>
        <span className="block truncate text-xs text-smoke/50">{team.player_name}</span>
      </span>
    </span>
  );
  return tid ? (
    <Link to={`/t/${tid}/teams/${team.id}`} className="min-w-0 hover:text-gold">
      {body}
    </Link>
  ) : (
    body
  );
}

const RESULT = {
  W: { box: "border-gold bg-gold/10 text-gold", label: "Win" },
  D: { box: "border-smoke/40 text-smoke", label: "Draw" },
  L: { box: "border-burgundy bg-burgundy/40 text-smoke", label: "Loss" },
};

/**
 * One league fixture / result.
 * highlightTeamId: marks that team (gold name) and colours the score box as its win/draw/loss.
 * showRound: set false when the parent already prints the round.
 * label: text shown instead of "Round N" (e.g. "Semi-final · Leg 2").
 */
export default function MatchRow({ match, tid, highlightTeamId, showRound = true, label }) {
  const played = match.status === "played";
  const when = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : null;

  const isHome = highlightTeamId != null && match.home.id === highlightTeamId;
  const isAway = highlightTeamId != null && match.away.id === highlightTeamId;

  let outcome = null;
  if (played && (isHome || isAway)) {
    const mine = isHome ? match.home_goals : match.away_goals;
    const theirs = isHome ? match.away_goals : match.home_goals;
    outcome = mine > theirs ? "W" : mine === theirs ? "D" : "L";
  }

  const roundText = label ?? (showRound ? `Round ${match.round}` : "");

  const box = outcome
    ? RESULT[outcome].box
    : played
      ? "border-gold/60 text-gold"
      : "border-smoke/15 text-smoke/40";

  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <TeamName team={match.home} tid={tid} align="right" highlight={isHome} />
        <div
          className={`min-w-18 border px-3 py-1 text-center font-display text-2xl font-semibold ${box}`}
          aria-label={played ? `${match.home_goals} to ${match.away_goals}` : "Not played yet"}
        >
          {played ? `${match.home_goals} – ${match.away_goals}` : "v"}
          {outcome && <span className="sr-only"> ({RESULT[outcome].label})</span>}
        </div>
        <TeamName team={match.away} tid={tid} highlight={isAway} />
      </div>
      {(roundText || when) && (
        <div className="mt-1 text-center text-[11px] uppercase tracking-[0.16em] text-smoke/40">
          {roundText}
          {roundText && when ? " · " : ""}
          {when}
        </div>
      )}
    </div>
  );
}