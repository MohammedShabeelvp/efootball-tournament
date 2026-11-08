import { Link, useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import { Empty, ErrorBox, Spinner, TeamLogo } from "../components/ui.jsx";

export default function Teams() {
  const { tid } = useParams();
  const { data, loading, error } = useApi(() => api.teams(tid), [tid]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (data.length === 0) return <Empty>No teams registered yet.</Empty>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((t) => (
        <Link key={t.id} to={`/t/${tid}/teams/${t.id}`} className="card card-hover flex items-center gap-4 p-4">
          <TeamLogo team={t} size={52} />
          <div className="min-w-0">
            <div className="truncate font-display text-2xl leading-tight">{t.player_name}</div>
            <div className="truncate text-sm text-smoke/60">{t.club_name}</div>
            {!t.is_active && <div className="eyebrow mt-1 text-smoke/50!">Inactive</div>}
          </div>
        </Link>
      ))}
    </div>
  );
}