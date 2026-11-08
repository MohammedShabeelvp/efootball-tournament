import { Link, useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Empty, ErrorBox, Spinner, StatusChip } from "../components/ui.jsx";

export default function Seasons() {
  const { tid } = useParams();
  const { user } = useAuth();
  const { data, loading, error } = useApi(() => api.seasons(tid), [tid]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  if (data.length === 0) {
    return (
      <Empty>
        No seasons yet.{" "}
        {user && (
          <Link to={`/t/${tid}/manage`} className="text-gold hover:underline">
            Create the first one in Manage
          </Link>
        )}
      </Empty>
    );
  }

  const current =
    data.find((x) => x.status === "ongoing") || data.find((x) => x.status === "upcoming") || data[0];

  const link = "eyebrow border border-smoke/15 px-3 py-2 text-center transition-colors hover:border-gold hover:bg-gold hover:text-ink";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((s) => (
        <article key={s.id} className={`card card-hover p-5 ${s.id === current.id ? "border-gold/70!" : ""}`}>
          {s.id === current.id && <div className="eyebrow mb-2">Current season</div>}
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-4xl">Season {s.number}</h2>
            <StatusChip status={s.status} />
          </div>
          <p className="mt-2 text-sm text-smoke/60">
            {s.team_count} teams · {s.match_count} matches
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Link className={link} to={`/t/${tid}/seasons/${s.id}/standings`}>Table</Link>
            <Link className={link} to={`/t/${tid}/seasons/${s.id}/fixtures`}>Fixtures</Link>
            <Link className={link} to={`/t/${tid}/seasons/${s.id}/knockout`}>Knockout</Link>
          </div>
        </article>
      ))}
    </div>
  );
}