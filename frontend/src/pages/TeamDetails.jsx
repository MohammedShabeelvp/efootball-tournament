import { Link, useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import TeamAnalysis from "../components/TeamAnalysis.jsx";
import { Empty, ErrorBox, Spinner, Stat, StatusChip, TeamLogo } from "../components/ui.jsx";

const FORM = {
  W: "bg-gold text-ink",
  D: "border border-smoke/40 text-smoke",
  L: "bg-burgundy text-smoke",
};

export default function TeamDetails() {
  const { tid, teamId } = useParams();
  const { data: team, loading, error } = useApi(() => api.team(teamId), [teamId]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const s = team.stats ?? {
    played: 0, position: null, points: 0,
    won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0,
  };

  return (
    <div className="space-y-8">
      <Link to={`/t/${tid}/teams`} className="eyebrow hover:underline">← All teams</Link>

      <header className="flex flex-wrap items-center gap-5">
        <TeamLogo team={team} size={80} />
        <div>
          <h2 className="font-display text-5xl leading-none">{team.player_name}</h2>
          <p className="mt-1 text-smoke/60">
            {team.club_name}
            {team.efootball_id ? ` · ID ${team.efootball_id}` : ""}
          </p>
          <div className="mt-2">
            <StatusChip status={team.is_active ? "ongoing" : "finished"} />
            <span className="ml-2 text-xs text-smoke/50">{team.is_active ? "Active" : "Inactive"}</span>
          </div>
        </div>
      </header>

      <section>
        <div className="eyebrow mb-2">Latest season</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Position" value={s.position ? `#${s.position}` : "–"} />
        <Stat label="Points" value={s.points} />
        <Stat label="Played" value={s.played} hint={`of ${team.matches_total} scheduled`} />
        <Stat label="W · D · L" value={`${s.won}·${s.drawn}·${s.lost}`} />
        <Stat label="Goals" value={`${s.gf}–${s.ga}`} hint={`GD ${s.gd > 0 ? "+" : ""}${s.gd}`} />
        <Stat label="Career matches" value={team.career_played} />
        </div>
      </section>

      {team.form?.length > 0 && (
        <section>
          <h3 className="mb-2 font-display text-2xl">Recent form</h3>
          <div className="flex gap-2">
            {team.form.map((r, i) => (
              <span key={i} className={`flex h-9 w-9 items-center justify-center text-sm font-semibold ${FORM[r]}`}>
                {r}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 font-display text-2xl">Lineup</h3>
        {team.lineup_image ? (
          <a href={team.lineup_image} target="_blank" rel="noreferrer">
            <img
              src={team.lineup_image}
              alt={`${team.club_name} lineup`}
              className="max-h-128 w-full border border-smoke/10 bg-ink object-contain"
            />
          </a>
        ) : (
          <Empty>No lineup image uploaded yet.</Empty>
        )}
      </section>

      <TeamAnalysis tid={tid} teamId={team.id} />
    </div>
  );
}