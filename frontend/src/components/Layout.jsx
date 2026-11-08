import { Link, NavLink, Outlet, useMatch, useOutletContext, useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import { useAuth } from "../auth.jsx";
import { ErrorBox, Spinner, StatusChip } from "./ui.jsx";

function Tabs({ items }) {
  return (
    <nav className="-mx-4 mb-8 flex overflow-x-auto border-b border-smoke/10 px-4" aria-label="Sections">
      {items.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `shrink-0 border-b-2 px-4 py-3 text-xs font-medium uppercase tracking-[0.16em] transition-colors ${
              isActive ? "border-gold text-gold" : "border-transparent text-smoke/60 hover:text-smoke"
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Every step is a link, except the page you are on: Tournaments › Name › Seasons › Season 2 */
function Crumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium uppercase tracking-[0.16em]">
      {items.map((c, i) => (
        <span key={c.label + i} className="flex items-center gap-2">
          {i > 0 && <span className="text-gold/60" aria-hidden="true">›</span>}
          {c.to ? (
            <Link to={c.to} className="text-gold hover:underline">
              {c.label}
            </Link>
          ) : (
            <span className="text-smoke/70" aria-current="page">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

// ---------- whole site ----------

export function AppShell() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-gold/30 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="font-display text-2xl font-semibold tracking-wide">
            Efootball <span className="text-gold">League</span>
          </Link>
          <div className="flex items-center gap-3">
            {user && <span className="eyebrow hidden sm:inline">Staff · {user.username}</span>}
            {user ? (
              <button className="btn btn-ghost btn-sm" onClick={logout}>
                Logout
              </button>
            ) : (
              <Link to="/login" className="btn btn-ghost btn-sm">
                Staff login
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-smoke/10 py-6 text-center text-xs text-smoke/40">Efootball League</footer>
    </div>
  );
}

// ---------- one tournament: seasons · dashboard · teams · manage ----------

export function TournamentLayout() {
  const { tid } = useParams();
  const { user } = useAuth();
  const inSeason = useMatch("/t/:tid/seasons/:sid/*");
  const { data, loading, error, reload } = useApi(() => api.tournament(tid), [tid]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const context = { tournament: data, reloadTournament: reload };

  // Season pages draw their own, longer breadcrumb trail
  if (inSeason) return <Outlet context={context} />;

  const tabs = [
    { to: "seasons", label: "Seasons" },
    { to: "dashboard", label: "Dashboard" },
    { to: "teams", label: "Teams" },
    ...(user ? [{ to: "manage", label: "Manage" }] : []),
  ];

  return (
    <>
      <Crumbs items={[{ label: "Tournaments", to: "/" }, { label: data.name }]} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">{data.name}</h1>
        <StatusChip status={data.status} />
      </div>
      <Tabs items={tabs} />
      <Outlet context={context} />
    </>
  );
}

// ---------- one season: standings · fixtures · knockout ----------

export function SeasonLayout() {
  const { tid, sid } = useParams();
  const parent = useOutletContext();
  const { data, loading, error } = useApi(() => api.seasons(tid), [tid]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const season = data.find((s) => String(s.id) === sid);
  if (!season) return <ErrorBox error={{ message: "Season not found." }} />;

  return (
    <>
      <Crumbs
        items={[
          { label: "Tournaments", to: "/" },
          { label: parent.tournament.name, to: `/t/${tid}/dashboard` },
          { label: "Seasons", to: `/t/${tid}/seasons` },
          { label: `Season ${season.number}` },
        ]}
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">Season {season.number}</h1>
        <StatusChip status={season.status} />
      </div>
      <Tabs
        items={[
          { to: "standings", label: "Standings" },
          { to: "fixtures", label: "Fixtures" },
          { to: "knockout", label: "Knockout" },
        ]}
      />
      <Outlet context={{ ...parent, season }} />
    </>
  );
}