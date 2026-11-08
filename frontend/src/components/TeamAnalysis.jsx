import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../api.js";
import MatchRow from "./MatchRow.jsx";
import { Empty, ErrorBox, Spinner, Stat, StatusChip, TeamLogo } from "./ui.jsx";

/**
 * Complete record of one team across every season: league and knockout matches.
 * Fetches each season's fixtures, table and knockout once, then works everything out here.
 */

const KO_NAMES = { quarter_final: "Quarter-final", semi_final: "Semi-final", final: "Final", third_place: "Third-place match" };
const koName = (type) => KO_NAMES[type] || type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const per = (n, d) => (d ? (n / d).toFixed(2) : "0.00");
const signed = (n) => (n > 0 ? `+${n}` : String(n));

// ---------- data ----------

async function loadHistory(tid) {
  const seasons = await api.seasons(tid);
  return Promise.all(
    seasons.map(async (season) => {
      const [fixtures, standings, stage] = await Promise.all([
        api.fixtures(season.id),
        api.standings(season.id),
        api.knockout(season.id).catch(() => null), // 404 = no knockout that season
      ]);
      return { season, fixtures, standings, stage };
    })
  );
}

/** Every match this team is in, oldest first, seen from the team's side. */
function buildEntries(history, teamId) {
  const entries = [];

  history.forEach(({ season, fixtures, stage }) => {
    fixtures.forEach((m) => {
      if (m.home.id !== teamId && m.away.id !== teamId) return;
      entries.push({
        key: `L${m.id}`, comp: "league", seasonId: season.id, seasonNumber: season.number,
        order: m.round, label: `Round ${m.round}`, match: m,
      });
    });

    stage?.rounds?.forEach((round) =>
      round.ties.forEach((tie) =>
        (tie.matches || []).forEach((km) => {
          if (km.home.id !== teamId && km.away.id !== teamId) return;
          const pens = km.home_pens != null && km.away_pens != null ? ` · pens ${km.home_pens}–${km.away_pens}` : "";
          entries.push({
            key: `K${km.id}`, comp: "knockout", seasonId: season.id, seasonNumber: season.number,
            order: 1000 + tie.round_number * 10 + km.leg_number,
            label: `${koName(tie.round_type)}${tie.legs === 2 ? ` · Leg ${km.leg_number}` : ""}${pens}`,
            match: { ...km, round: 0 },
          });
        })
      )
    );
  });

  entries.sort((a, b) => a.seasonNumber - b.seasonNumber || a.order - b.order);

  return entries.map((e) => {
    const m = e.match;
    const home = m.home.id === teamId;
    const played = m.status === "played";
    const gf = played ? (home ? m.home_goals : m.away_goals) : null;
    const ga = played ? (home ? m.away_goals : m.home_goals) : null;
    return {
      ...e, played, home, gf, ga,
      opp: home ? m.away : m.home,
      result: played ? (gf > ga ? "W" : gf === ga ? "D" : "L") : null,
    };
  });
}

const split = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });

/** Numbers for a list of PLAYED entries, oldest first. Points count league matches only. */
function analyse(list) {
  const s = {
    played: list.length, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, clean: 0, failed: 0, points: 0,
    home: split(), away: split(), biggestWin: null, heaviestLoss: null, highest: null, winStreak: 0, unbeaten: 0,
  };
  let win = 0;
  let unbeaten = 0;

  list.forEach((e) => {
    const side = e.home ? s.home : s.away;
    s.gf += e.gf; s.ga += e.ga;
    side.p += 1; side.gf += e.gf; side.ga += e.ga;
    if (e.ga === 0) s.clean += 1;
    if (e.gf === 0) s.failed += 1;

    if (e.result === "W") {
      s.won += 1; side.w += 1; win += 1; unbeaten += 1;
      if (e.comp === "league") s.points += 3;
    } else if (e.result === "D") {
      s.drawn += 1; side.d += 1; win = 0; unbeaten += 1;
      if (e.comp === "league") s.points += 1;
    } else {
      s.lost += 1; side.l += 1; win = 0; unbeaten = 0;
    }
    s.winStreak = Math.max(s.winStreak, win);
    s.unbeaten = Math.max(s.unbeaten, unbeaten);

    const diff = e.gf - e.ga;
    if (diff > 0 && (!s.biggestWin || diff > s.biggestWin.diff)) s.biggestWin = { diff, e };
    if (diff < 0 && (!s.heaviestLoss || -diff > s.heaviestLoss.diff)) s.heaviestLoss = { diff: -diff, e };
    const total = e.gf + e.ga;
    if (!s.highest || total > s.highest.total) s.highest = { total, e };
  });

  return s;
}

// ---------- small pieces ----------

function Choice({ value, onChange, options, label }) {
  return (
    <div className="inline-flex" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={`border px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] transition-colors ${
            value === v ? "border-gold bg-gold text-ink" : "border-smoke/20 text-smoke/70 hover:border-gold"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function RecordCard({ title, item, text }) {
  return (
    <div className="card p-4">
      <div className="eyebrow">{title}</div>
      {item ? (
        <>
          <div className="mt-1 font-display text-3xl leading-tight">{text(item)}</div>
          <div className="mt-0.5 text-xs text-smoke/55">
            vs {item.e.opp.club_name} · Season {item.e.seasonNumber} · {item.e.label}
          </div>
        </>
      ) : (
        <div className="mt-1 text-smoke/40">–</div>
      )}
    </div>
  );
}

const TH = "px-2 py-3 text-right font-medium";
const HIDE = "hidden sm:table-cell";
const HEAD = "text-left text-[11px] uppercase tracking-[0.14em] text-smoke/50";

// ---------- component ----------

export default function TeamAnalysis({ tid, teamId }) {
  const { data: history, loading, error } = useApi(() => loadHistory(tid), [tid]);
  const [scope, setScope] = useState("all"); // all | league | knockout
  const [seasonId, setSeasonId] = useState("all");
  const [historySeason, setHistorySeason] = useState(null); // null = current season

  const entries = useMemo(() => (history ? buildEntries(history, teamId) : []), [history, teamId]);
  const inScope = useMemo(() => entries.filter((e) => scope === "all" || e.comp === scope), [entries, scope]);
  const filtered = useMemo(
    () => inScope.filter((e) => seasonId === "all" || String(e.seasonId) === seasonId),
    [inScope, seasonId]
  );
  const overall = useMemo(() => analyse(filtered.filter((e) => e.played)), [filtered]);

  // One row per season the team took part in (honours the league/knockout choice)
  const seasonRows = useMemo(() => {
    if (!history) return [];
    return history
      .map(({ season, standings, stage }) => {
        const row = standings.find((r) => r.team_id === teamId);
        const list = inScope.filter((e) => e.seasonId === season.id && e.played);
        return {
          season,
          pos: row && row.played > 0 ? row.position : null,
          stats: analyse(list),
          inSeason: Boolean(row) || list.length > 0,
          leagueChamp: season.status === "finished" && row?.position === 1 && row.played > 0,
          cupWinner: stage?.champion?.id === teamId,
        };
      })
      .filter((r) => r.inSeason);
  }, [history, inScope, teamId]);

  const headToHead = useMemo(() => {
    const map = new Map();
    filtered.filter((e) => e.played).forEach((e) => {
      const r = map.get(e.opp.id) || { opp: e.opp, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
      r.p += 1; r.gf += e.gf; r.ga += e.ga;
      if (e.result === "W") r.w += 1; else if (e.result === "D") r.d += 1; else r.l += 1;
      map.set(e.opp.id, r);
    });
    return [...map.values()].sort((a, b) => b.p - a.p || a.opp.club_name.localeCompare(b.opp.club_name));
  }, [filtered]);

  // Current season = running, else upcoming, else the latest one this team played
  const currentSeasonId = useMemo(() => {
    if (!history) return null;
    const mine = history.filter((h) => entries.some((e) => e.seasonId === h.season.id));
    const current =
      mine.find((h) => h.season.status === "ongoing") ||
      mine.find((h) => h.season.status === "upcoming") ||
      mine[0]; // seasons come newest first
    return current ? String(current.season.id) : null;
  }, [history, entries]);

  const historyChoice = historySeason ?? currentSeasonId ?? "all";

  const historyList = useMemo(
    () => inScope.filter((e) => historyChoice === "all" || String(e.seasonId) === historyChoice),
    [inScope, historyChoice]
  );

  const bySeason = useMemo(() => {
    const map = new Map();
    historyList.forEach((e) => map.set(e.seasonNumber, [...(map.get(e.seasonNumber) || []), e]));
    return [...map.entries()].sort((a, b) => b[0] - a[0]); // newest season first
  }, [historyList]);

  if (loading) return <Spinner label="Loading match history" />;
  if (error) return <ErrorBox error={error} />;
  if (entries.length === 0) return <Empty>This team has no matches yet.</Empty>;

  const seasonOptions = history.filter((h) => entries.some((e) => e.seasonId === h.season.id));
  const o = overall;
  const noPoints = scope === "knockout";

  return (
    <div className="space-y-10">
      {/* ---------- filters ---------- */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-3xl">Match analysis</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Choice
              label="Competition" value={scope} onChange={setScope}
              options={[["all", "All"], ["league", "League"], ["knockout", "Knockout"]]}
            />
            <select
              className="input !w-auto" aria-label="Season" value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
            >
              <option value="all">All seasons</option>
              {seasonOptions.map(({ season }) => (
                <option key={season.id} value={season.id}>Season {season.number}</option>
              ))}
            </select>
          </div>
        </div>

        {o.played === 0 ? (
          <Empty>No played matches for this selection.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Played" value={o.played} />
            <Stat label="Wins" value={o.won} hint={`${pct(o.won, o.played)}% win rate`} />
            <Stat label="Draws" value={o.drawn} hint={`${pct(o.drawn, o.played)}%`} />
            <Stat label="Losses" value={o.lost} hint={`${pct(o.lost, o.played)}%`} />
            <Stat label="Win ratio" value={`${pct(o.won, o.played)}%`} hint={`${o.won} of ${o.played}`} />
            <Stat label="Points" value={noPoints ? "–" : o.points} hint={noPoints ? "League matches only" : "Win 3 · draw 1"} />
            <Stat label="Goals scored" value={o.gf} hint={`${per(o.gf, o.played)} per match`} />
            <Stat label="Goals conceded" value={o.ga} hint={`${per(o.ga, o.played)} per match`} />
            <Stat label="Goal difference" value={signed(o.gf - o.ga)} />
            <Stat label="Clean sheets" value={o.clean} hint={`${pct(o.clean, o.played)}% of matches`} />
            <Stat label="Failed to score" value={o.failed} hint={`${pct(o.failed, o.played)}% of matches`} />
            <Stat label="Best run" value={`${o.winStreak} wins`} hint={`${o.unbeaten} unbeaten`} />
          </div>
        )}
      </section>

      {o.played > 0 && (
        <>
          {/* ---------- records ---------- */}
          <section className="grid gap-3 sm:grid-cols-3">
            <RecordCard title="Biggest win" item={o.biggestWin} text={(i) => `${i.e.gf}–${i.e.ga}`} />
            <RecordCard title="Heaviest defeat" item={o.heaviestLoss} text={(i) => `${i.e.gf}–${i.e.ga}`} />
            <RecordCard title="Highest scoring" item={o.highest} text={(i) => `${i.total} goals (${i.e.gf}–${i.e.ga})`} />
          </section>

          {/* ---------- home / away ---------- */}
          <section>
            <h3 className="mb-3 font-display text-2xl">Home and away</h3>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[360px] text-sm">
                <thead className={HEAD}>
                  <tr>
                    <th className="px-3 py-3 font-medium">Venue</th>
                    {["P", "W", "D", "L", "GF", "GA"].map((h) => <th key={h} className={TH}>{h}</th>)}
                    <th className="px-3 py-3 text-right font-medium">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {[["Home", o.home], ["Away", o.away]].map(([name, r]) => (
                    <tr key={name} className="border-t border-smoke/5">
                      <td className="px-3 py-3 font-medium">{name}</td>
                      {[r.p, r.w, r.d, r.l, r.gf, r.ga].map((v, i) => <td key={i} className="px-2 py-3 text-right">{v}</td>)}
                      <td className="px-3 py-3 text-right font-semibold text-gold">{pct(r.w, r.p)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ---------- by season ---------- */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h3 className="font-display text-2xl">Season by season</h3>
          <span className="eyebrow">{scope === "all" ? "League + knockout" : scope}</span>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className={HEAD}>
              <tr>
                <th className="px-3 py-3 font-medium">Season</th>
                <th className={TH}>Pos</th>
                <th className={TH}>P</th>
                <th className={`${TH} ${HIDE}`}>W</th>
                <th className={`${TH} ${HIDE}`}>D</th>
                <th className={`${TH} ${HIDE}`}>L</th>
                <th className={`${TH} ${HIDE}`}>GF</th>
                <th className={`${TH} ${HIDE}`}>GA</th>
                <th className={TH}>GD</th>
                <th className={`${TH} ${HIDE}`}>CS</th>
                <th className={TH}>Win %</th>
                <th className="px-3 py-3 text-right font-medium">Pts</th>
              </tr>
            </thead>
            <tbody>
              {seasonRows.map(({ season, pos, stats: s, leagueChamp, cupWinner }) => (
                <tr key={season.id} className="border-t border-smoke/5">
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-xl">Season {season.number}</span>
                      <StatusChip status={season.status} />
                    </div>
                    {(leagueChamp || cupWinner) && (
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                        {leagueChamp && <span className="bg-gold px-1.5 py-0.5 text-ink">League champion</span>}
                        {cupWinner && <span className="border border-gold px-1.5 py-0.5 text-gold">Cup winner</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right">{pos ? `#${pos}` : "–"}</td>
                  <td className="px-2 py-3 text-right">{s.played}</td>
                  <td className={`px-2 py-3 text-right ${HIDE}`}>{s.won}</td>
                  <td className={`px-2 py-3 text-right ${HIDE}`}>{s.drawn}</td>
                  <td className={`px-2 py-3 text-right ${HIDE}`}>{s.lost}</td>
                  <td className={`px-2 py-3 text-right ${HIDE}`}>{s.gf}</td>
                  <td className={`px-2 py-3 text-right ${HIDE}`}>{s.ga}</td>
                  <td className="px-2 py-3 text-right">{signed(s.gf - s.ga)}</td>
                  <td className={`px-2 py-3 text-right ${HIDE}`}>{s.clean}</td>
                  <td className="px-2 py-3 text-right">{s.played ? `${pct(s.won, s.played)}%` : "–"}</td>
                  <td className="px-3 py-3 text-right font-display text-xl font-semibold text-gold">
                    {noPoints ? "–" : s.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-smoke/50">CS = clean sheets. Points count league matches only.</p>
      </section>

      {/* ---------- head to head ---------- */}
      {headToHead.length > 0 && (
        <section>
          <h3 className="mb-3 font-display text-2xl">Head to head</h3>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead className={HEAD}>
                <tr>
                  <th className="px-3 py-3 font-medium">Opponent</th>
                  {["P", "W", "D", "L", "GF", "GA"].map((h) => <th key={h} className={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {headToHead.map((r) => (
                  <tr key={r.opp.id} className="border-t border-smoke/5">
                    <td className="px-3 py-3">
                      <Link to={`/t/${tid}/teams/${r.opp.id}`} className="flex items-center gap-3 hover:text-gold">
                        <TeamLogo team={r.opp} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.opp.club_name}</span>
                          <span className="block truncate text-xs text-smoke/50">{r.opp.player_name}</span>
                        </span>
                      </Link>
                    </td>
                    {[r.p, r.w, r.d, r.l, r.gf, r.ga].map((v, i) => <td key={i} className="px-2 py-3 text-right">{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------- full match history ---------- */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl">Match history</h3>
            <span className="eyebrow">{historyList.length} matches</span>
          </div>
          <select
            className="input !w-auto"
            aria-label="Season for match history"
            value={historyChoice}
            onChange={(e) => setHistorySeason(e.target.value)}
          >
            <option value="all">All seasons</option>
            {seasonOptions.map(({ season }) => (
              <option key={season.id} value={season.id}>
                Season {season.number}
                {String(season.id) === currentSeasonId ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
        {bySeason.length === 0 ? (
          <Empty>No matches for this selection.</Empty>
        ) : (
          <div className="space-y-6">
            {bySeason.map(([number, list]) => (
              <div key={number}>
                <h4 className="mb-2 font-display text-xl text-gold">Season {number}</h4>
                <div className="card divide-y divide-smoke/5">
                  {list.map((e) => (
                    <MatchRow key={e.key} match={e.match} tid={tid} highlightTeamId={teamId} label={e.label} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}