import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useApi } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Btn, ConfirmButton, Empty, ErrorBox, Notice, PageHeader, Spinner, StatusChip } from "../components/ui.jsx";

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(api.tournaments, []);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const t = await api.createTournament(name.trim());
      navigate(`/t/${t.id}/manage`);
    } catch (err) {
      setNotice({ type: "err", text: err.message });
      setBusy(false);
    }
  }

  async function remove(id) {
    setRemoving(id);
    setNotice(null);
    try {
      await api.deleteTournament(id);
      setNotice({ type: "ok", text: "Tournament deleted." });
      reload();
    } catch (err) {
      setNotice({ type: "err", text: err.message });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Competitions" title="Tournaments" />
      <p className="-mt-2 mb-8 max-w-xl text-smoke/60">
        Follow the table, fixtures and knockout of every competition.
      </p>

      <Notice notice={notice} />

      {user && (
        <form onSubmit={create} className="card mb-8 p-5">
          <h2 className="font-display text-2xl">Create a tournament</h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              className="input"
              placeholder="Tournament name"
              required
              maxLength={120}
              aria-label="Tournament name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Btn type="submit" loading={busy} className="sm:w-48">
              Create
            </Btn>
          </div>
        </form>
      )}

      {data.length === 0 ? (
        <Empty>No tournaments yet.{user ? "" : " Staff can log in to create one."}</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => (
            <div key={t.id} className="card card-hover flex flex-col">
              <Link to={`/t/${t.id}/seasons`} className="block flex-1 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-3xl leading-tight">{t.name}</h2>
                  <StatusChip status={t.status} />
                </div>
                <p className="mt-3 text-sm text-smoke/60">
                  {t.team_count} teams · {t.match_count} matches
                </p>
                {t.season_running && (
                  <p className="eyebrow mt-3 flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 bg-gold" /> Season in progress
                  </p>
                )}
              </Link>
              {user?.role === "admin" && (
                <div className="border-t border-smoke/10 px-5 py-3">
                  <ConfirmButton busy={removing === t.id} onConfirm={() => remove(t.id)}>
                    Delete
                  </ConfirmButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}