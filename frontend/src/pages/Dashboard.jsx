import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import { useAuth } from "../auth.jsx";
import MatchRow from "../components/MatchRow.jsx";
import { Empty, ErrorBox, Spinner, Stat, StatusChip, TeamLogo } from "../components/ui.jsx";

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const describe = (m) => `${m.home.club_name} ${m.home_goals}–${m.away_goals} ${m.away.club_name}`;

/** Champion, runner-up, third place and final score from one knockout stage. */
function summarizeStage(stage) {
  const tieOf = (type) => stage.rounds?.find((r) => r.round_type === type)?.ties?.[0];
  const final = tieOf("final");
  const third = tieOf("third_place");
  const loser = (tie) =>
    tie?.winner ? (tie.winner.id === tie.home?.id ? tie.away : tie.home) : null;

  let score = null;
  if (final?.home && final?.away && final.aggregate) {
    const level = final.aggregate.home === final.aggregate.away;
    score =
      `${final.home.club_name} ${final.aggregate.home}–${final.aggregate.away} ${final.away.club_name}` +
      (final.winner && level ? " (won on penalties)" : "");
  }

  return {
    champion: stage.champion || null,
    runnerUp: loser(final),
    third: third?.winner || null,
    score,
    done: stage.status === "finished",
  };
}

/** Cumulative numbers across every season of the tournament. */
function compute(seasons, tables, fixtures, stages) {
  // Combined table: sum each team's rows over all seasons
  const teams = new Map();
  tables.forEach((rows, i) =>
    rows.forEach((r) => {
      const t = teams.get(r.team_id) || {
        team_id: r.team_id, player_name: r.player_name, club_name: r.club_name, logo: r.logo,
        seasons: 0, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, titles: 0, cups: 0,
      };
      if (r.played > 0) t.seasons += 1;
      for (const k of ["played", "won", "drawn", "lost", "gf", "ga", "points"]) t[k] += r[k];
      if (seasons[i].status === "finished" && r.position === 1 && r.played > 0) t.titles += 1;
      teams.set(r.team_id, t);
    })
  );

  // Knockout wins ("cups")
  stages.forEach((st) => {
    const champ = st?.champion && teams.get(st.champion.id);
    if (champ) champ.cups += 1;
  });

  const rows = [...teams.values()]
    .map((t) => ({ ...t, gd: t.gf - t.ga }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.club_name.localeCompare(b.club_name));
  rows.forEach((t, i) => (t.position = i + 1));

  // Match-level numbers
  const all = fixtures.flat();
  const played = all.filter((m) => m.status === "played");
  let goals = 0, home = 0, draw = 0, away = 0, highest = null, biggest = null;
  played.forEach((m) => {
    const total = m.home_goals + m.away_goals;
    const diff = Math.abs(m.home_goals - m.away_goals);
    goals += total;
    if (m.home_goals > m.away_goals) home += 1;
    else if (m.home_goals < m.away_goals) away += 1;
    else draw += 1;
    if (!highest || total > highest.total) highest = { m, total };
    if (!biggest || diff > biggest.diff) biggest = { m, diff };
  });

  return { rows, total: all.length, played: played.length, goals, home, draw, away, highest, biggest };
}

export default function Dashboard() {
  const { tid } = useParams();
  const { user } = useAuth();
  const { data: seasons, loading, error } = useApi(() => api.seasons(tid), [tid]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  if (seasons.length === 0) {
    return (
      <Empty>
        No season yet.{" "}
        {user && <Link to={`/t/${tid}/manage`} className="text-gold hover:underline">Create one in Manage</Link>}
      </Empty>
    );
  }
  return <Analysis key={seasons.map((s) => s.id).join("-")} tid={tid} seasons={seasons} user={user} />;
}

function Analysis({ tid, seasons, user }) {
  // One table and one fixture list per season
  const { data, loading, error } = useApi(async () => {
    const [tables, fixtures, stages] = await Promise.all([
      Promise.all(seasons.map((s) => api.standings(s.id))),
      Promise.all(seasons.map((s) => api.fixtures(s.id))),
      // A season without a knockout answers 404; a failed lookup shouldn't break the dashboard
      Promise.all(seasons.map((s) => api.knockout(s.id).catch(() => null))),
    ]);
    return { tables, fixtures, stages };
  }, [seasons]);

  const stats = useMemo(() => (data ? compute(seasons, data.tables, data.fixtures, data.stages) : null), [data, seasons]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  // Current season: running, else the next one, else the latest (seasons come newest first)
  const current =
    seasons.find((s) => s.status === "ongoing") || seasons.find((s) => s.status === "upcoming") || seasons[0];
  const idx = seasons.indexOf(current);
  const currentRows = data.tables[idx];
  const currentMatches = data.fixtures[idx];

  const byRound = new Map();
  currentMatches.forEach((m) => byRound.set(m.round, [...(byRound.get(m.round) || []), m]));
  const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  const [roundNo, roundMatches] = rounds.find(([, ms]) => ms.some((m) => m.status !== "played")) || rounds[rounds.length - 1] || [];

  const knockouts = seasons
    .map((season, i) => ({ season, stage: data.stages[i] }))
    .filter((x) => x.stage)
    .map(({ season, stage }) => ({ season, info: summarizeStage(stage) }));

  const finished = seasons.filter((s) => s.status === "finished").length;
  const leader = stats.rows[0];
  const perMatch = stats.played ? (stats.goals / stats.played).toFixed(2) : "0";
  const started = stats.played > 0;
  const base = `/t/${tid}/seasons/${current.id}`;

  const th = "px-2 py-3 text-right font-medium";
  const hide = "hidden sm:table-cell";

  return (
    <div className="space-y-10">
      {/* ---------- all seasons ---------- */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="font-display text-3xl">All seasons</h2>
          <span className="eyebrow">Cumulative</span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Seasons" value={seasons.length} hint={`${finished} finished`} />
          <Stat label="Matches played" value={`${stats.played} / ${stats.total}`} hint={`${pct(stats.played, stats.total)}% complete`} />
          <Stat label="Goals scored" value={stats.goals} />
          <Stat label="Goals per match" value={perMatch} />
          <Stat
            label="Home · Draw · Away"
            value={started ? `${stats.home} · ${stats.draw} · ${stats.away}` : "–"}
            hint={started ? `${pct(stats.home, stats.played)}% · ${pct(stats.draw, stats.played)}% · ${pct(stats.away, stats.played)}%` : ""}
          />
          <Stat label="Highest scoring" value={stats.highest ? `${stats.highest.total} goals` : "–"} hint={stats.highest ? describe(stats.highest.m) : ""} />
          <Stat label="Biggest win" value={stats.biggest ? `${stats.biggest.diff} goals` : "–"} hint={stats.biggest ? describe(stats.biggest.m) : ""} />
          <Stat label="All-time leader" value={started ? leader.club_name : "–"} hint={started ? `${leader.points} pts · ${leader.player_name}` : "No results yet"} />
        </div>
      </section>

      {/* ---------- combined points table ---------- */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="font-display text-3xl">Combined points table</h2>
          <span className="eyebrow">{seasons.length} season{seasons.length === 1 ? "" : "s"} added together</span>
        </div>
        {stats.rows.length === 0 ? (
          <Empty>No teams yet.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-105 text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-smoke/50">
                <tr>
                  <th className="px-3 py-3">#</th>
                  <th className="py-3 font-medium">Team</th>
                  <th className={`${th} ${hide}`}>Seasons</th>
                  <th className={th}>P</th>
                  <th className={`${th} ${hide}`}>W</th>
                  <th className={`${th} ${hide}`}>D</th>
                  <th className={`${th} ${hide}`}>L</th>
                  <th className={`${th} ${hide}`}>GF</th>
                  <th className={`${th} ${hide}`}>GA</th>
                  <th className={th}>GD</th>
                  <th className={th}>Titles</th>
                  <th className={th}>Cups</th>
                  <th className="px-3 py-3 text-right font-medium">Pts</th>
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((r) => {
                  const top = r.position === 1 && started;
                  return (
                    <tr key={r.team_id} className={`border-t border-smoke/5 transition-colors hover:bg-smoke/5 ${top ? "bg-gold/10" : ""}`}>
                      <td className={`border-l-4 px-3 py-3 font-display text-xl ${top ? "border-gold text-gold" : "border-transparent"}`}>{r.position}</td>
                      <td className="py-3">
                        <Link to={`/t/${tid}/teams/${r.team_id}`} className="flex items-center gap-3 hover:text-gold">
                          <TeamLogo team={{ logo: r.logo, club_name: r.club_name }} size={28} />
                          <span className="min-w-0">
                            <span className={`block truncate font-medium ${top ? "text-gold" : ""}`}>{r.club_name}</span>
                            <span className="block truncate text-xs text-smoke/50">{r.player_name}</span>
                          </span>
                        </Link>
                      </td>
                      <td className={`px-2 py-3 text-right ${hide}`}>{r.seasons}</td>
                      <td className="px-2 py-3 text-right">{r.played}</td>
                      <td className={`px-2 py-3 text-right ${hide}`}>{r.won}</td>
                      <td className={`px-2 py-3 text-right ${hide}`}>{r.drawn}</td>
                      <td className={`px-2 py-3 text-right ${hide}`}>{r.lost}</td>
                      <td className={`px-2 py-3 text-right ${hide}`}>{r.gf}</td>
                      <td className={`px-2 py-3 text-right ${hide}`}>{r.ga}</td>
                      <td className="px-2 py-3 text-right">{signed(r.gd)}</td>
                      <td className="px-2 py-3 text-right">{r.titles || "–"}</td>
                      <td className="px-2 py-3 text-right">{r.cups || "–"}</td>
                      <td className="px-3 py-3 text-right font-display text-xl font-semibold text-gold">{r.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-smoke/50">Titles are finished seasons won by league position. Cups are knockout wins.</p>
      </section>

      {/* ---------- knockout winners ---------- */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="font-display text-3xl">Knockout winners</h2>
          <span className="eyebrow">{knockouts.length} knockout{knockouts.length === 1 ? "" : "s"}</span>
        </div>

        {knockouts.length === 0 ? (
          <Empty>No knockout has been created yet.</Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {knockouts.map(({ season, info }) => (
              <article key={season.id} className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-2xl">Season {season.number}</h3>
                  <StatusChip status={info.done ? "finished" : "ongoing"} />
                </div>

                {info.champion ? (
                  <div className="mt-3 flex items-center gap-3 border-l-4 border-gold bg-gold/10 p-3">
                    <TeamLogo team={info.champion} size={40} />
                    <div className="min-w-0">
                      <div className="eyebrow">Champion</div>
                      <div className="truncate font-display text-3xl leading-none text-gold">{info.champion.club_name}</div>
                      <div className="truncate text-xs text-smoke/55">{info.champion.player_name}</div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 border border-dashed border-smoke/20 p-3 text-sm text-smoke/55">
                    Champion to be decided.
                  </p>
                )}

                <dl className="mt-3 space-y-1 text-sm">
                  {info.score && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-smoke/55">Final</dt>
                      <dd className="text-right">{info.score}</dd>
                    </div>
                  )}
                  {info.runnerUp && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-smoke/55">Runner-up</dt>
                      <dd className="text-right">{info.runnerUp.club_name} <span className="text-smoke/50">· {info.runnerUp.player_name}</span></dd>
                    </div>
                  )}
                  {info.third && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-smoke/55">Third place</dt>
                      <dd className="text-right">{info.third.club_name} <span className="text-smoke/50">· {info.third.player_name}</span></dd>
                    </div>
                  )}
                </dl>

                <Link to={`/t/${tid}/seasons/${season.id}/knockout`} className="eyebrow mt-4 inline-block hover:underline">
                  View bracket →
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ---------- current season ---------- */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-3xl">Season {current.number}</h2>
          <StatusChip status={current.status} />
          <span className="eyebrow">Current season</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-end justify-between">
              <h3 className="font-display text-2xl">Table</h3>
              <Link to={`${base}/standings`} className="eyebrow hover:underline">Full standings →</Link>
            </div>
            {currentRows.length === 0 ? (
              <Empty>No teams in this season.</Empty>
            ) : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-smoke/50">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="py-2">Team</th>
                      <th className="px-2 py-2 text-right">P</th>
                      <th className="px-2 py-2 text-right">GD</th>
                      <th className="px-3 py-2 text-right">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRows.map((r) => {
                      const top = r.position === 1 && currentRows.some((x) => x.played > 0);
                      return (
                        <tr key={r.team_id} className={`border-t border-smoke/5 ${top ? "bg-gold/10" : ""}`}>
                          <td className={`border-l-4 px-3 py-2 font-display text-lg ${top ? "border-gold text-gold" : "border-transparent"}`}>{r.position}</td>
                          <td className="py-2">
                            <Link to={`/t/${tid}/teams/${r.team_id}`} className="flex items-center gap-2 hover:text-gold">
                              <TeamLogo team={{ logo: r.logo, club_name: r.club_name }} size={22} />
                              <span className="min-w-0">
                                <span className="block truncate">{r.club_name}</span>
                                <span className="block truncate text-xs text-smoke/50">{r.player_name}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-right">{r.played}</td>
                          <td className="px-2 py-2 text-right">{signed(r.gd)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gold">{r.points}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-end justify-between">
              <h3 className="font-display text-2xl">{roundNo ? `Round ${roundNo}` : "Fixtures"}</h3>
              <Link to={`${base}/fixtures`} className="eyebrow hover:underline">All fixtures →</Link>
            </div>
            {!roundMatches ? (
              <Empty>
                Fixtures haven’t been generated yet.{" "}
                {user && <Link to={`/t/${tid}/manage`} className="text-gold hover:underline">Open Manage</Link>}
              </Empty>
            ) : (
              <div className="card divide-y divide-smoke/5">
                {roundMatches.map((m) => <MatchRow key={m.id} match={m} tid={tid} />)}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}