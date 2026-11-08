import { useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Btn, ConfirmButton, Empty, ErrorBox, Notice, Spinner, StatusChip, TeamLogo } from "../components/ui.jsx";

const MAX_IMAGE_MB = 5;
const LABEL = "eyebrow mb-1 block";

function Section({ title, hint, children }) {
  return (
    <section className="card p-5">
      <h2 className="font-display text-3xl">{title}</h2>
      {hint && <p className="mt-1 text-sm text-smoke/55">{hint}</p>}
      <div className="rule my-4" />
      {children}
    </section>
  );
}

// ---------- teams ----------

/** Drops empty file inputs and checks sizes. Returns an error message, or null when fine. */
function cleanFiles(fd) {
  for (const key of ["logo", "lineup_image"]) {
    const file = fd.get(key);
    if (!file || !file.size) fd.delete(key);
    else if (file.size > MAX_IMAGE_MB * 1024 * 1024) return `Images must be smaller than ${MAX_IMAGE_MB} MB.`;
  }
  return null;
}

/** The same inputs for adding and editing; `team` pre-fills them when editing. */
function TeamFields({ prefix, team }) {
  const id = (name) => `${prefix}-${name}`;
  return (
    <>
      <div>
        <label htmlFor={id("player_name")} className={LABEL}>Player name *</label>
        <input id={id("player_name")} name="player_name" className="input" required maxLength={80}
          defaultValue={team?.player_name ?? ""} />
      </div>
      <div>
        <label htmlFor={id("club_name")} className={LABEL}>Club *</label>
        <input id={id("club_name")} name="club_name" className="input" required maxLength={80}
          defaultValue={team?.club_name ?? ""} />
      </div>
      <div>
        <label htmlFor={id("efootball_id")} className={LABEL}>eFootball ID</label>
        <input id={id("efootball_id")} name="efootball_id" className="input" maxLength={50}
          defaultValue={team?.efootball_id ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={id("logo")} className={LABEL}>Logo</label>
          <input id={id("logo")} name="logo" type="file" accept="image/*" className="input px-2! py-1.5! text-xs" />
        </div>
        <div>
          <label htmlFor={id("lineup_image")} className={LABEL}>Lineup</label>
          <input id={id("lineup_image")} name="lineup_image" type="file" accept="image/*" className="input px-2! py-1.5! text-xs" />
        </div>
      </div>
    </>
  );
}

function TeamsPanel({ tid, seasonRunning }) {
  const { data, loading, error, reload } = useApi(() => api.teams(tid), [tid]);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(false);
  const [formKey, setFormKey] = useState(0); // remounts the add form to clear file inputs
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  async function add(e) {
    e.preventDefault();
    setNotice(null);
    const fd = new FormData(e.currentTarget);
    const bad = cleanFiles(fd);
    if (bad) return setNotice({ type: "err", text: bad });

    setAdding(true);
    try {
      await api.createTeam(tid, fd);
      setNotice({ type: "ok", text: "Team added." });
      setFormKey((k) => k + 1);
      reload();
    } catch (err) {
      setNotice({ type: "err", text: err.message });
    } finally {
      setAdding(false);
    }
  }

  async function save(e, team) {
    e.preventDefault();
    setNotice(null);
    const fd = new FormData(e.currentTarget);
    const bad = cleanFiles(fd); // empty file inputs are dropped, so current images are kept
    if (bad) return setNotice({ type: "err", text: bad });

    setBusyId(team.id);
    try {
      await api.updateTeam(team.id, fd);
      setNotice({ type: "ok", text: `${fd.get("club_name")} updated.` });
      setEditingId(null);
      reload();
    } catch (err) {
      setNotice({ type: "err", text: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function act(id, fn, success) {
    setBusyId(id);
    setNotice(null);
    try {
      await fn();
      setNotice({ type: "ok", text: success });
      reload();
    } catch (err) {
      setNotice({ type: "err", text: err.message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Section
      title="Teams"
      hint={
        seasonRunning
          ? "A season is running: new teams join as inactive and take part from the next season."
          : "Active teams are locked into a season when it is created."
      }
    >
      <Notice notice={notice} />

      <form key={formKey} onSubmit={add} className="mb-6 grid gap-3 sm:grid-cols-2">
        <TeamFields prefix="add" />
        <Btn type="submit" loading={adding} className="sm:col-span-2 sm:w-48">Add team</Btn>
      </form>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data.length === 0 ? (
        <Empty>No teams yet.</Empty>
      ) : (
        <ul className="divide-y divide-smoke/10 border border-smoke/10">
          {data.map((t) => (
            <li key={t.id} className="px-3 py-3">
              {editingId === t.id ? (
                <form onSubmit={(e) => save(e, t)} className="grid gap-3 sm:grid-cols-2">
                  <TeamFields prefix={`edit-${t.id}`} team={t} />
                  <p className="text-xs text-smoke/50 sm:col-span-2">
                    Leave an image empty to keep the current one.
                  </p>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <Btn type="submit" size="sm" loading={busyId === t.id}>Save changes</Btn>
                    <Btn size="sm" variant="ghost" disabled={busyId === t.id} onClick={() => setEditingId(null)}>
                      Cancel
                    </Btn>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link to={`/t/${tid}/teams/${t.id}`} className="flex min-w-0 items-center gap-3 hover:text-gold">
                    <TeamLogo team={t} size={34} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.player_name}</span>
                      <span className="block truncate text-xs text-smoke/50">
                        {t.club_name}{t.is_active ? "" : " · inactive"}
                      </span>
                    </span>
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <Btn size="sm" variant="ghost" onClick={() => { setNotice(null); setEditingId(t.id); }}>
                      Edit
                    </Btn>
                    <Btn
                      size="sm" variant="ghost" loading={busyId === t.id}
                      onClick={() =>
                        act(t.id, () => api.setTeamActive(t.id, !t.is_active), t.is_active ? "Team set inactive." : "Team set active.")
                      }
                    >
                      {t.is_active ? "Deactivate" : "Activate"}
                    </Btn>
                    <ConfirmButton busy={busyId === t.id} onConfirm={() => act(t.id, () => api.deleteTeam(t.id), "Team removed.")}>
                      Remove
                    </ConfirmButton>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------- seasons ----------

/** Rounds and matches a round-robin produces (mirrors the backend's circle method). */
function fixturePlan(teams, double) {
  const single = teams + (teams % 2) - 1; // odd counts get a rest slot, so one extra round
  const perRound = Math.floor(teams / 2);
  const rounds = double ? single * 2 : single;
  return { rounds, perRound, matches: rounds * perRound };
}

function FixtureOptions({ season, double, setDouble, busy, onGenerate }) {
  const teams = season.team_count;

  if (teams < 2) {
    return (
      <div className="w-full border border-burgundy bg-burgundy/25 p-3 text-sm" role="alert">
        This season has {teams} team{teams === 1 ? "" : "s"}. At least 2 are needed to generate fixtures.
      </div>
    );
  }

  const options = [
    { value: false, title: "Single round-robin", text: "Every team plays each other once." },
    { value: true, title: "Home & away", text: "Every team plays each other twice, once at home and once away." },
  ];

  return (
    <div className="w-full border border-gold/30 p-4">
      <div className="eyebrow mb-3">Fixture format · {teams} teams</div>

      <div role="radiogroup" aria-label="Fixture format" className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => {
          const plan = fixturePlan(teams, o.value);
          const on = double === o.value;
          return (
            <button
              key={o.title}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setDouble(o.value)}
              className={`border p-3 text-left transition-colors ${
                on ? "border-gold bg-gold/10" : "border-smoke/15 hover:border-gold/60"
              }`}
            >
              <span className="block font-display text-xl">{o.title}</span>
              <span className="block text-xs text-smoke/60">{o.text}</span>
              <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span><strong className="text-gold">{plan.rounds}</strong> rounds</span>
                <span><strong className="text-gold">{plan.matches}</strong> matches</span>
                <span className="text-smoke/60">{plan.perRound} per round</span>
              </span>
            </button>
          );
        })}
      </div>

      {teams % 2 === 1 && (
        <p className="mt-2 text-xs text-smoke/55">With an odd number of teams, one team rests each round.</p>
      )}

      <Btn className="mt-4" loading={busy} onClick={onGenerate}>
        Generate {double ? "home & away" : "single"} fixtures
      </Btn>
    </div>
  );
}

function SeasonRow({ tid, season, onChanged, setNotice }) {
  const { user } = useAuth();
  const [ask, setAsk] = useState(null); // server message when results would be lost
  const [double, setDouble] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(fn, success) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await fn();
      setNotice({ type: "ok", text: typeof success === "function" ? success(result) : success });
      onChanged();
    } catch (err) {
      setNotice({ type: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function scrap(force = false) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.scrapSeason(season.id, force);
      setAsk(null);
      setNotice({
        type: "ok",
        text: `Season ${r.season} scrapped: ${r.league_matches} league matches and ${r.knockout_ties} knockout ties removed.`,
      });
      onChanged();
    } catch (err) {
      if (err.status === 409) setAsk(err.message); // has results: ask before deleting them
      else setNotice({ type: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const link = "eyebrow border border-smoke/15 px-3 py-1.5 transition-colors hover:border-gold hover:bg-gold hover:text-ink";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-4">
      <div>
        <div className="flex items-center gap-3">
          <span className="font-display text-2xl">Season {season.number}</span>
          <StatusChip status={season.status} />
        </div>
        <p className="text-xs text-smoke/50">{season.team_count} teams · {season.match_count} matches</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {season.status === "ongoing" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-gold" checked={force} onChange={(e) => setForce(e.target.checked)} />
              Even if matches are unplayed
            </label>
            <ConfirmButton confirmText="Yes, end season" busy={busy}
              onConfirm={() => act(() => api.endSeason(season.id, force), "Season ended.")}>
              End season
            </ConfirmButton>
          </>
        )}

        <Link className={link} to={`/t/${tid}/seasons/${season.id}/standings`}>Table</Link>
        <Link className={link} to={`/t/${tid}/seasons/${season.id}/fixtures`}>Fixtures</Link>
        <Link className={link} to={`/t/${tid}/seasons/${season.id}/knockout`}>Knockout</Link>
        {!ask && (
          <ConfirmButton confirmText="Yes, scrap it" busy={busy} onConfirm={() => scrap(false)}>
            Scrap season
          </ConfirmButton>
        )}
      </div>

      {season.status === "upcoming" && (
        <FixtureOptions
          season={season}
          double={double}
          setDouble={setDouble}
          busy={busy}
          onGenerate={() =>
            act(
              () => api.generateFixtures(season.id, double),
              (r) => `${r.created} fixtures created. The season is now running.`
            )
          }
        />
      )}

      {ask && (
        <div className="w-full border border-burgundy bg-burgundy/25 p-4" role="alert">
          <p className="text-sm">{ask}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {user?.role === "admin" ? (
              <Btn size="sm" variant="danger" loading={busy} onClick={() => scrap(true)}>
                Scrap anyway
              </Btn>
            ) : (
              <span className="text-xs text-smoke/70">Only an admin can delete results.</span>
            )}
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setAsk(null)}>
              Keep the season
            </Btn>
          </div>
        </div>
      )}
    </li>
  );
}

function SeasonsPanel({ tid, reloadTournament }) {
  const { data, loading, error, reload } = useApi(() => api.seasons(tid), [tid]);
  const [notice, setNotice] = useState(null);
  const [creating, setCreating] = useState(false);

  const changed = () => {
    reload();
    reloadTournament();
  };

  async function create() {
    setCreating(true);
    setNotice(null);
    try {
      const s = await api.createSeason(tid);
      setNotice({ type: "ok", text: `Season ${s.number} created with the currently active teams.` });
      changed();
    } catch (err) {
      setNotice({ type: "err", text: err.message });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Section title="Seasons" hint="Create a season, generate its fixtures, then end it when every match is played.">
      <Notice notice={notice} />
      <Btn loading={creating} onClick={create} className="mb-5">Create next season</Btn>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data.length === 0 ? (
        <Empty>No seasons yet.</Empty>
      ) : (
        <ul className="divide-y divide-smoke/10 border border-smoke/10">
          {data.map((s) => (
            <SeasonRow key={s.id} tid={tid} season={s} onChanged={changed} setNotice={setNotice} />
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------- tournament ----------

function TournamentPanel({ tournament, reloadTournament }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(tournament.name);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  async function rename(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api.updateTournament(tournament.id, { name: name.trim() });
      setNotice({ type: "ok", text: "Tournament renamed." });
      reloadTournament();
    } catch (err) {
      setNotice({ type: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteTournament(tournament.id);
      navigate("/");
    } catch (err) {
      setNotice({ type: "err", text: err.message });
      setBusy(false);
    }
  }

  return (
    <Section title="Tournament">
      <Notice notice={notice} />
      <form onSubmit={rename} className="flex flex-col gap-3 sm:flex-row">
        <input className="input" required maxLength={120} aria-label="Tournament name" value={name} onChange={(e) => setName(e.target.value)} />
        <Btn type="submit" loading={busy} className="sm:w-48">Rename</Btn>
      </form>

      {user?.role === "admin" && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-smoke/10 pt-4">
          <span className="text-sm text-smoke/60">Deleting removes every team, season and match.</span>
          <ConfirmButton busy={busy} confirmText="Yes, delete everything" onConfirm={remove}>
            Delete tournament
          </ConfirmButton>
        </div>
      )}
    </Section>
  );
}

// ---------- page ----------

export default function Manage() {
  const { tid } = useParams();
  const { tournament, reloadTournament } = useOutletContext();

  return (
    <div className="space-y-6">
      <TeamsPanel tid={tid} seasonRunning={tournament.season_running} />
      <SeasonsPanel tid={tid} reloadTournament={reloadTournament} />
      <TournamentPanel tournament={tournament} reloadTournament={reloadTournament} />
    </div>
  );
}