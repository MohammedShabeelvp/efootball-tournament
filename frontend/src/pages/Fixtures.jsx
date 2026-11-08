import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import MatchRow from "../components/MatchRow.jsx";
import ScoreEditor from "../components/ScoreEditor.jsx";
import { useAuth } from "../auth.jsx";
import { Empty, ErrorBox, Spinner } from "../components/ui.jsx";

const LABEL = "eyebrow mb-2 block";

export default function Fixtures() {
  const { tid, sid } = useParams();
  const { user } = useAuth();

  const { data, loading, error, reload } = useApi(() => api.fixtures(sid), [sid]);

  const [selectedRound, setSelectedRound] = useState(null); // null = default, "all" = every round
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTeam, setSelectedTeam] = useState("all");
  const [venueFilter, setVenueFilter] = useState("all");

  // Matches grouped by round
  const rounds = useMemo(() => {
    const map = new Map();
    (data || []).forEach((match) => {
      if (!map.has(match.round)) map.set(match.round, []);
      map.get(match.round).push(match);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [data]);

  // Played count per round, shared by the mobile and desktop selectors
  const roundItems = useMemo(
    () =>
      rounds.map(([round, matches]) => ({
        round,
        total: matches.length,
        played: matches.filter((m) => m.status === "played").length,
      })),
    [rounds]
  );

  // Unique teams in the fixtures
  const teams = useMemo(() => {
    const map = new Map();
    (data || []).forEach((m) => {
      if (m.home?.id) map.set(m.home.id, m.home);
      if (m.away?.id) map.set(m.away.id, m.away);
    });
    return [...map.values()].sort((a, b) => a.player_name.localeCompare(b.player_name));
  }, [data]);

  // First round with unfinished matches, else the last round
  const defaultRound = useMemo(() => {
    const firstOpen = rounds.find(([, ms]) => ms.some((m) => m.status !== "played"));
    return firstOpen ? firstOpen[0] : rounds.length ? rounds[rounds.length - 1][0] : null;
  }, [rounds]);

  const showAll = selectedRound === "all";
  const currentRound = showAll ? null : selectedRound ?? defaultRound;

  const filteredMatches = useMemo(() => {
    const pool = showAll ? data || [] : rounds.find(([r]) => r === currentRound)?.[1] || [];

    return pool.filter((m) => {
      if (statusFilter === "finished" && m.status !== "played") return false;
      if (statusFilter === "unfinished" && m.status === "played") return false;

      if (selectedTeam !== "all") {
        const id = Number(selectedTeam);
        if (venueFilter === "home") return m.home?.id === id;
        if (venueFilter === "away") return m.away?.id === id;
        return m.home?.id === id || m.away?.id === id;
      }
      return true;
    });
  }, [data, rounds, currentRound, showAll, statusFilter, selectedTeam, venueFilter]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (rounds.length === 0) return <Empty>No fixtures yet. Staff need to generate them.</Empty>;

  const playedMatches = filteredMatches.filter((m) => m.status === "played").length;

  const resetFilters = () => {
    setStatusFilter("all");
    setSelectedTeam("all");
    setVenueFilter("all");
    setSelectedRound(null);
  };

  const chipClass = (active) =>
    `shrink-0 border px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] transition-colors ${
      active ? "border-gold bg-gold text-ink" : "border-smoke/20 text-smoke/70 hover:border-gold"
    }`;
  const listClass = (active) =>
    `flex w-full items-center justify-between border px-3 py-3 text-left transition-colors ${
      active ? "border-gold bg-gold/10 text-gold" : "border-smoke/10 text-smoke/70 hover:border-gold/50"
    }`;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="card grid gap-4 p-4 md:grid-cols-3">
        <div>
          <label htmlFor="f-status" className={LABEL}>Match status</label>
          <select id="f-status" className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All matches</option>
            <option value="finished">Finished matches</option>
            <option value="unfinished">Unfinished matches</option>
          </select>
        </div>

        <div>
          <label htmlFor="f-team" className={LABEL}>Select team</label>
          <select id="f-team" className="input" value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)}>
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.player_name} ({t.club_name})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="f-venue" className={LABEL}>Team position</label>
          <select
            id="f-venue"
            className="input"
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
            disabled={selectedTeam === "all"}
          >
            <option value="all">All (Home & Away)</option>
            <option value="home">Home matches</option>
            <option value="away">Away matches</option>
          </select>
        </div>
      </div>

      {/* Round list + matches */}
      <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="card min-w-0 p-3">
          <h2 className="eyebrow mb-3 hidden md:block">Rounds</h2>

          {/* Mobile: horizontal chips */}
          <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
            <button onClick={() => setSelectedRound("all")} className={chipClass(showAll)}>
              All
            </button>
            {roundItems.map(({ round, played, total }) => (
              <button key={round} onClick={() => setSelectedRound(round)} className={chipClass(!showAll && round === currentRound)}>
                R{round} <span className="opacity-70">{played}/{total}</span>
              </button>
            ))}
          </div>

          {/* Desktop: vertical list */}
          <div className="hidden max-h-130 space-y-2 overflow-y-auto pr-1 md:block">
            <button onClick={() => setSelectedRound("all")} className={listClass(showAll)}>
              <span className="text-sm font-medium">All rounds</span>
            </button>
            {roundItems.map(({ round, played, total }) => (
              <button key={round} onClick={() => setSelectedRound(round)} className={listClass(!showAll && round === currentRound)}>
                <span className="text-sm font-medium">Round {round}</span>
                <span className={`text-xs ${played === total ? "text-gold" : "text-smoke/50"}`}>
                  {played}/{total}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-3xl">{showAll ? "All rounds" : `Round ${currentRound}`}</h2>
              <p className="text-xs text-smoke/50">
                {filteredMatches.length} matches · {playedMatches} finished
              </p>
            </div>
            <button onClick={resetFilters} className="btn btn-ghost btn-sm">
              Reset filters
            </button>
          </div>

          {filteredMatches.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="font-medium">No matches found</p>
              <p className="mt-1 text-sm text-smoke/50">Try changing your filters.</p>
            </div>
          ) : (
            <div className="card divide-y divide-smoke/5">
              {filteredMatches.map((match) => (
                <div key={match.id}>
                  <MatchRow match={match} tid={tid} />
                  {user && (
                    <ScoreEditor
                      key={`${match.id}-${match.home_goals}-${match.away_goals}`}
                      match={match}
                      onSaved={reload}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}