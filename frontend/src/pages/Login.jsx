import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { Btn, Notice } from "../components/ui.jsx";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const back = location.state?.from || "/";
  if (user) return <Navigate to={back} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await login(username.trim(), password);
      navigate(back, { replace: true });
    } catch (err) {
      setNotice({ type: "err", text: err.message });
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pt-8">
      <div className="eyebrow">Staff only</div>
      <h1 className="mt-1 font-display text-5xl">Sign in</h1>
      <div className="rule my-5" />
      <Notice notice={notice} />
      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <label htmlFor="username" className="eyebrow mb-1 block">Username</label>
          <input id="username" className="input" autoComplete="username" required
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="eyebrow mb-1 block">Password</label>
          <input id="password" type="password" className="input" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Btn type="submit" loading={busy} className="w-full">Login</Btn>
      </form>
    </div>
  );
}