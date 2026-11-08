import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import { AppShell, SeasonLayout, TournamentLayout } from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Fixtures from "./pages/Fixtures.jsx";
import Home from "./pages/Home.jsx";
import Knockout from "./pages/Knockout.jsx";
import Login from "./pages/Login.jsx";
import Manage from "./pages/Manage.jsx";
import Seasons from "./pages/Seasons.jsx";
import Standings from "./pages/Standings.jsx";
import TeamDetails from "./pages/TeamDetails.jsx";
import Teams from "./pages/Teams.jsx";

function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  return user ? children : <Navigate to="/login" state={{ from: location.pathname }} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />

        <Route path="/t/:tid" element={<TournamentLayout />}>
          <Route index element={<Navigate to="seasons" replace />} />
          <Route path="dashboard" element={<Dashboard />} />

          <Route path="seasons" element={<Seasons />} />
          <Route path="seasons/:sid" element={<SeasonLayout />}>
            <Route index element={<Navigate to="standings" replace />} />
            <Route path="standings" element={<Standings />} />
            <Route path="fixtures" element={<Fixtures />} />
            <Route path="knockout" element={<Knockout />} />
          </Route>

          <Route path="teams" element={<Teams />} />
          <Route path="teams/:teamId" element={<TeamDetails />} />

          <Route path="manage" element={<RequireAuth><Manage /></RequireAuth>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}