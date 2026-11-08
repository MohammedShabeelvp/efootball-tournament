import { useState } from "react";
import { api } from "../api.js";
import { Btn } from "./ui.jsx";

const val = (v) => (v == null ? "" : String(v));

/** Staff-only. Both scores, or clear both. Remounted by the parent when saved values change. */
export default function ScoreEditor({ match, onSaved }) {
  const [home, setHome] = useState(val(match.home_goals));
  const [away, setAway] = useState(val(match.away_goals));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(clear = false) {
    setError("");
    const h = clear || home === "" ? null : Number(home);
    const a = clear || away === "" ? null : Number(away);

    if ((h === null) !== (a === null)) return setError("Enter both scores, or leave both empty.");
    if ([h, a].some((n) => n !== null && (!Number.isInteger(n) || n < 0 || n > 99))) {
      return setError("Scores must be whole numbers from 0 to 99.");
    }

    setBusy(true);
    try {
      const result = await api.setScore(match.id, h, a);
      onSaved(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const box = "input w-14 !px-1 text-center font-display text-xl font-semibold";

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 border-t border-smoke/5 bg-ink/40 px-4 py-2">
      <input
        type="number" min={0} max={99} inputMode="numeric" className={box}
        aria-label={`${match.home.player_name} goals`} value={home} onChange={(e) => setHome(e.target.value)}
      />
      <span className="text-smoke/40">–</span>
      <input
        type="number" min={0} max={99} inputMode="numeric" className={box}
        aria-label={`${match.away.player_name} goals`} value={away} onChange={(e) => setAway(e.target.value)}
      />
      <Btn size="sm" loading={busy} onClick={() => save(false)}>Save</Btn>
      {match.status === "played" && (
        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => save(true)}>Clear</Btn>
      )}
      {error && <span role="alert" className="w-full text-center text-xs text-burgundy brightness-200">{error}</span>}
    </div>
  );
}