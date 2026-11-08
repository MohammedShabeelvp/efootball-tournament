import { Link, useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import { Empty, ErrorBox, Spinner, TeamLogo } from "../components/ui.jsx";

const signed = (n) => (n > 0 ? `+${n}` : String(n));

export default function Standings() {
  const { tid, sid } = useParams();
  const standings = useApi(() => api.standings(sid), [sid]);
  // Qualifier positions come from the knockout setup; 404 means none yet
  const knockout = useApi(
    () => api.knockout(sid).catch((e) => (e.status === 404 ? null : Promise.reject(e))),
    [sid]
  );

  if (standings.loading || knockout.loading) return <Spinner />;
  if (standings.error) return <ErrorBox error={standings.error} />;

  const rows = standings.data;
  if (rows.length === 0) return <Empty>No teams in this season.</Empty>;

  const qualifiers = knockout.data?.qualifying_teams ?? 0;
  const started = rows.some((r) => r.played > 0);

  const kind = (r) =>
    r.position === 1 && started ? "leader" : r.position <= qualifiers ? "qualifier" : "none";

  const ROW = { leader: "bg-gold/10", qualifier: "bg-burgundy/25", none: "" };
  const EDGE = { leader: "border-gold text-gold", qualifier: "border-burgundy", none: "border-transparent" };

  const th = "px-2 py-3 text-right font-medium";
  const hide = "hidden sm:table-cell";

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-90 text-sm">
          <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-smoke/50">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="py-3 font-medium">Team</th>
              <th className={th}>P</th>
              <th className={`${th} ${hide}`}>W</th>
              <th className={`${th} ${hide}`}>D</th>
              <th className={`${th} ${hide}`}>L</th>
              <th className={`${th} ${hide}`}>GF</th>
              <th className={`${th} ${hide}`}>GA</th>
              <th className={th}>GD</th>
              <th className="px-3 py-3 text-right font-medium">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = kind(r);
              const cutLine = qualifiers > 0 && r.position === qualifiers && qualifiers < rows.length;
              return (
                <tr
                  key={r.team_id}
                  className={`border-t ${cutLine ? "border-b-2 border-b-gold/50" : ""} border-smoke/5 transition-colors hover:bg-smoke/5 ${ROW[k]}`}
                >
                  <td className={`border-l-4 px-3 py-3 font-display text-xl ${EDGE[k]}`}>{r.position}</td>
                  <td className="py-3">
                    <Link to={`/t/${tid}/teams/${r.team_id}`} className="flex items-center gap-3 hover:text-gold">
                      <TeamLogo team={{ logo: r.logo, club_name: r.club_name }} size={28} />
                      <span className="min-w-0">
                        <span className={`block truncate font-medium ${k === "leader" ? "text-gold" : ""}`}>
                          {r.club_name}
                        </span>
                        <span className="block truncate text-xs text-smoke/50">{r.player_name}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-3 text-right">{r.played}</td>
                  <td className={`px-2 py-3 text-right ${hide}`}>{r.won}</td>
                  <td className={`px-2 py-3 text-right ${hide}`}>{r.drawn}</td>
                  <td className={`px-2 py-3 text-right ${hide}`}>{r.lost}</td>
                  <td className={`px-2 py-3 text-right ${hide}`}>{r.gf}</td>
                  <td className={`px-2 py-3 text-right ${hide}`}>{r.ga}</td>
                  <td className="px-2 py-3 text-right">{signed(r.gd)}</td>
                  <td className="px-3 py-3 text-right font-display text-xl font-semibold text-gold">{r.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-smoke/60">
        <li className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 border-l-4 border-gold bg-gold/20" /> League leader
        </li>
        {qualifiers > 0 ? (
          <li className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 border-l-4 border-burgundy bg-burgundy/40" /> Knockout qualifier (top {qualifiers})
          </li>
        ) : (
          <li>Knockout places appear here once the knockout is created.</li>
        )}
      </ul>
    </>
  );
}