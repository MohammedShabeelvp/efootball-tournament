import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { api, useApi } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Btn, ConfirmButton, Empty, ErrorBox, Notice, Spinner, TeamLogo } from "../components/ui.jsx";

/** Season tab. Anyone can view the bracket; staff set it up, score it and reset it. */

const MAX_TEAMS = 64;

const ROUND_LABELS = {
  round_of_64: "Round of 64", round_of_32: "Round of 32", round_of_16: "Round of 16",
  quarter_final: "Quarter-finals", semi_final: "Semi-finals", final: "Final", third_place: "Third place",
};
const SINGULAR = {
  quarter_final: "Quarter-final", semi_final: "Semi-final", final: "Final", third_place: "Third-place match",
};
const roundLabel = (t) => ROUND_LABELS[t] || t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const tieTitle = (tie) => {
  const base = SINGULAR[tie.round_type] || roundLabel(tie.round_type);
  return tie.round_type === "final" || tie.round_type === "third_place" ? base : `${base} ${tie.tie_number}`;
};

// ---------- bracket maths (mirrors the backend) ----------

const bracketSize = (n) => { let s = 1; while (s < n) s *= 2; return s; };
const roundTypeFor = (size) => ({ 2: "final", 4: "semi_final", 8: "quarter_final" }[size] || `round_of_${size}`);

function requiredRounds(teams, third) {
  const types = [];
  for (let s = bracketSize(teams); s >= 2; s /= 2) types.push(roundTypeFor(s));
  if (third) types.push("third_place");
  return types;
}

function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((s) => [s, next + 1 - s]);
  }
  return order;
}

function firstRoundPairs(teams) {
  const size = bracketSize(teams);
  const order = seedOrder(size);
  const pairs = [];
  for (let i = 0; i < size; i += 2) {
    pairs.push({ home: order[i] <= teams ? order[i] : null, away: order[i + 1] <= teams ? order[i + 1] : null });
  }
  return pairs;
}

const val = (v) => (v == null ? "" : String(v));
const scoreBox = "input !px-1 text-center font-display text-2xl font-semibold";

// ---------- pieces ----------

function Segmented({ value, onChange, label }) {
  return (
    <div className="inline-flex" role="group" aria-label={label}>
      {[1, 2].map((n) => (
        <button
          key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)}
          className={`border px-3 py-1 text-xs uppercase tracking-[0.12em] transition-colors ${
            value === n ? "border-gold bg-burgundy text-smoke" : "border-smoke/20 text-smoke/60 hover:border-gold"
          }`}
        >
          {n === 1 ? "1 leg" : "2 legs"}
        </button>
      ))}
    </div>
  );
}

function TeamLine({ team, empty }) {
  if (!team) return <span className="text-sm text-smoke/40">{empty}</span>;
  return (
    <span className="flex items-center gap-2">
      <TeamLogo team={team} size={22} />
      <span className="font-medium">{team.player_name}</span>
      <span className="text-xs text-smoke/50">{team.club_name}</span>
    </span>
  );
}

// ---------- rules (before the league ends) and setup (after) ----------

function SetupForm({ standings, busy, onSubmit, finished, initial, onCancel }) {
  const available = Math.min(MAX_TEAMS, standings.length);
  const [qualifying, setQualifying] = useState(initial?.qualifying_teams ?? (Math.min(4, available) || 4));
  const [legs, setLegs] = useState(initial?.round_legs ?? {});
  const [third, setThird] = useState(initial?.third_place_match ?? false);

  const count = Number(qualifying);
  const valid = Number.isInteger(count) && count >= 2 && count <= available;
  const thirdAllowed = valid && count >= 4;
  const thirdOn = thirdAllowed && third;

  const rounds = useMemo(() => (valid ? requiredRounds(count, thirdOn) : []), [count, valid, thirdOn]);
  const pairs = useMemo(() => (valid ? firstRoundPairs(count) : []), [count, valid]);
  const nameOf = (seed) => {
    const r = standings[seed - 1];
    return r ? `${r.player_name} (${r.club_name})` : `Seed ${seed}`;
  };
  const chips = [2, 4, 8, 16, 32].filter((n) => n <= available);

  if (available < 2) return <Empty>This season needs at least 2 teams first.</Empty>;

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      qualifying_teams: count,
      third_place_match: thirdOn,
      round_legs: Object.fromEntries(rounds.map((r) => [r, legs[r] ?? 1])),
    });
  }

  const label = finished ? "Create knockout" : initial ? "Save changes" : "Save knockout rules";

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-[minmax(260px,360px)_1fr]">
      <div className="card p-5">
        <h3 className="font-display text-2xl">{finished ? "Knockout settings" : "Knockout rules"}</h3>

        <label htmlFor="ko-q" className="eyebrow mb-1 mt-4 block">Teams that qualify</label>
        <input id="ko-q" type="number" min={2} max={available} className="input" value={qualifying}
          onChange={(e) => setQualifying(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((n) => (
            <button key={n} type="button" onClick={() => setQualifying(n)}
              className={`border px-2.5 py-1 text-xs uppercase tracking-[0.1em] transition-colors ${
                count === n ? "border-gold bg-burgundy" : "border-smoke/20 text-smoke/60 hover:border-gold"
              }`}>
              Top {n}
            </button>
          ))}
        </div>
        <p className={`mt-1 text-xs ${valid ? "text-smoke/50" : "text-burgundy brightness-200"}`}>
          {valid ? `${available} teams are in this season.` : `Enter a whole number from 2 to ${available}.`}
        </p>

        <div className="eyebrow mb-1 mt-5">Legs per round</div>
        <div className="divide-y divide-smoke/10">
          {rounds.map((r) => (
            <div key={r} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">{roundLabel(r)}</span>
              <Segmented label={`${roundLabel(r)} legs`} value={legs[r] ?? 1}
                onChange={(n) => setLegs((p) => ({ ...p, [r]: n }))} />
            </div>
          ))}
        </div>

        <label className={`my-4 flex items-start gap-2 text-sm ${thirdAllowed ? "" : "text-smoke/40"}`}>
          <input type="checkbox" className="mt-1 accent-[var(--color-gold)]" checked={thirdOn}
            disabled={!thirdAllowed} onChange={(e) => setThird(e.target.checked)} />
          <span>Play a third-place match{!thirdAllowed && " (needs at least 4 teams)"}</span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Btn type="submit" loading={busy} disabled={!valid}>{label}</Btn>
          {onCancel && <Btn variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Btn>}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-display text-2xl">{finished ? "First round" : "First round (projected)"}</h3>
        {valid ? (
          <>
            <p className="mt-1 text-xs text-smoke/50">
              {rounds.filter((r) => r !== "third_place").length} rounds in total. Top seeds skip round one when the
              field isn’t a power of two.
              {!finished && " Pairings use the current table; the final seeds are fixed when the league ends."}
            </p>
            <ol className="mt-3 grid gap-2">
              {pairs.map((p, i) => (
                <li key={i}
                  className="grid grid-cols-[24px_1fr_30px_24px_1fr] items-center gap-2 border border-smoke/10 px-3 py-2 text-sm">
                  <span className="text-center font-display text-lg text-gold">{p.home}</span>
                  <span className="break-words">{nameOf(p.home)}</span>
                  <span className="text-center text-xs text-smoke/40">{p.away ? "v" : "bye"}</span>
                  <span className="text-center font-display text-lg text-gold">{p.away ?? ""}</span>
                  <span className="break-words">{p.away ? nameOf(p.away) : ""}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="mt-1 text-sm text-smoke/50">Choose a valid number of teams to see the pairings.</p>
        )}
      </div>
    </form>
  );
}

function Setup({ seasonId, ...rest }) {
  const { data, loading, error } = useApi(() => api.standings(seasonId), [seasonId]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return <SetupForm standings={data} {...rest} />;
}

/** Rules are saved; waiting for the league to end. */
function PlannedPanel({ stage, seasonId, seasonFinished, canEdit, busy, onEdit, onRemove, onBuild }) {
  const fixtures = useApi(() => api.fixtures(seasonId), [seasonId]);
  const table = useApi(() => api.standings(seasonId), [seasonId]);

  const rounds = requiredRounds(stage.qualifying_teams, stage.third_place_match);
  const matches = fixtures.data || [];
  const played = matches.filter((m) => m.status === "played").length;
  const pct = matches.length ? Math.round((100 * played) / matches.length) : 0;
  const rows = table.data || [];
  const started = rows.some((r) => r.played > 0);
  const top = rows.slice(0, stage.qualifying_teams);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="eyebrow">Rules saved</div>
          <h3 className="font-display text-2xl">Knockout planned</h3>
          <dl className="mt-3 divide-y divide-smoke/10 text-sm">
            <div className="flex justify-between py-2">
              <dt className="text-smoke/60">Teams that qualify</dt>
              <dd className="font-semibold">Top {stage.qualifying_teams}</dd>
            </div>
            {rounds.map((r) => (
              <div key={r} className="flex justify-between py-2">
                <dt className="text-smoke/60">{roundLabel(r)}</dt>
                <dd>{stage.round_legs[r] === 2 ? "2 legs" : "1 leg"}</dd>
              </div>
            ))}
            {!stage.third_place_match && (
              <div className="flex justify-between py-2">
                <dt className="text-smoke/60">Third-place match</dt>
                <dd>No</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="card p-5">
          <div className="eyebrow">League progress</div>
          {fixtures.loading ? (
            <Spinner />
          ) : matches.length === 0 ? (
            <p className="mt-2 text-sm text-smoke/60">League fixtures haven’t been generated yet.</p>
          ) : (
            <>
              <div className="mt-1 font-display text-4xl">
                {played} <span className="text-lg text-smoke/50">of {matches.length} matches played</span>
              </div>
              <div className="mt-2 h-2 bg-smoke/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-2 bg-gold" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
          <p className="mt-4 text-sm text-smoke/60">
            The knockout fixtures are created automatically when the league ends: as soon as the last league match is
            scored{canEdit ? ", or when you end the season" : ""}.
          </p>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="font-display text-2xl">{started ? "Qualifying right now" : "Teams in this season"}</h3>
          <span className="eyebrow">Provisional until the league ends</span>
        </div>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {top.map((r) => (
            <li key={r.team_id} className="flex items-center gap-3 border border-smoke/10 px-3 py-2 text-sm">
              <span className="w-6 text-center font-display text-lg text-gold">{r.position}</span>
              <TeamLogo team={{ logo: r.logo, club_name: r.club_name }} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.club_name}</span>
                <span className="block truncate text-xs text-smoke/50">{r.player_name}</span>
              </span>
              <span className="text-xs text-smoke/60">{r.points} pts</span>
            </li>
          ))}
        </ol>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          {seasonFinished && (
            <Btn loading={busy} onClick={onBuild}>Create knockout fixtures now</Btn>
          )}
          <Btn variant="ghost" disabled={busy} onClick={onEdit}>Edit rules</Btn>
          <ConfirmButton confirmText="Yes, remove plan" busy={busy} onConfirm={onRemove}>Remove plan</ConfirmButton>
        </div>
      )}
    </div>
  );
}

// ---------- scoring ----------

function LegRow({ match, tie, canEdit, onSave }) {
  const [f, setF] = useState({
    hg: val(match.home_goals), ag: val(match.away_goals), hp: val(match.home_pens), ap: val(match.away_pens),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const isLast = match.leg_number === tie.legs;
  const levelSingleLeg = tie.legs === 1 && f.hg !== "" && Number(f.hg) === Number(f.ag);
  const showPens = isLast && (tie.needs_penalties || f.hp !== "" || f.ap !== "" || levelSingleLeg);
  const num = (s) => (s === "" ? null : Number(s));

  async function submit(clear) {
    setError("");
    const payload = clear
      ? { home_goals: null, away_goals: null, home_pens: null, away_pens: null }
      : {
          home_goals: num(f.hg), away_goals: num(f.ag),
          home_pens: showPens ? num(f.hp) : null, away_pens: showPens ? num(f.ap) : null,
        };
    const nums = Object.values(payload).filter((v) => v !== null);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 99)) return setError("Scores must be whole numbers from 0 to 99.");
    if ((payload.home_goals === null) !== (payload.away_goals === null)) return setError("Enter both scores, or leave both empty.");
    if ((payload.home_pens === null) !== (payload.away_pens === null)) return setError("Enter both penalty scores, or neither.");

    setSaving(true);
    try {
      await onSave(match.id, payload);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const np = { type: "number", min: 0, max: 99, inputMode: "numeric", disabled: !canEdit };

  return (
    <div className="border-t border-smoke/10 py-2 first:border-t-0 first:pt-0">
      {tie.legs === 2 && <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-smoke/45">Leg {match.leg_number}</div>}
      <div className="grid grid-cols-[1fr_48px_12px_48px_1fr] items-center gap-1.5">
        <span className="break-words text-right font-medium">{match.home.player_name}</span>
        <input {...np} className={scoreBox} aria-label={`${match.home.player_name} goals`} value={f.hg} onChange={set("hg")} />
        <span className="text-center text-smoke/40">–</span>
        <input {...np} className={scoreBox} aria-label={`${match.away.player_name} goals`} value={f.ag} onChange={set("ag")} />
        <span className="break-words font-medium">{match.away.player_name}</span>
      </div>

      {showPens && (
        <div className="mt-1.5 grid grid-cols-[1fr_48px_12px_48px_1fr] items-center gap-1.5">
          <span className="text-right text-xs text-smoke/50">Penalties</span>
          <input {...np} className={`${scoreBox} !text-lg`} aria-label={`${match.home.player_name} penalties`} value={f.hp} onChange={set("hp")} />
          <span className="text-center text-smoke/40">–</span>
          <input {...np} className={`${scoreBox} !text-lg`} aria-label={`${match.away.player_name} penalties`} value={f.ap} onChange={set("ap")} />
          <span />
        </div>
      )}

      {canEdit && (
        <div className="mt-2 flex justify-end gap-2">
          <Btn size="sm" loading={saving} onClick={() => submit(false)}>Save score</Btn>
          {match.status === "played" && <Btn size="sm" variant="ghost" disabled={saving} onClick={() => submit(true)}>Clear</Btn>}
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-burgundy brightness-200">{error}</p>}
    </div>
  );
}

function TieCard({ tie, canEdit, onSave }) {
  const matches = tie.matches || [];
  const winnerId = tie.winner?.id;
  const side = (team) =>
    `flex items-center justify-between gap-2 border-l-4 px-2 py-1.5 ${
      winnerId && winnerId === team?.id ? "border-gold bg-gold/10" : "border-transparent"
    }`;

  return (
    <article className="card p-3">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="font-display text-xl">{tieTitle(tie)}</h4>
        {tie.legs === 2 && tie.aggregate && matches.some((m) => m.status === "played") && (
          <span className="text-xs text-smoke/55">Aggregate {tie.aggregate.home}–{tie.aggregate.away}</span>
        )}
      </header>

      {tie.is_bye ? (
        <div className={side(tie.winner)}>
          <TeamLine team={tie.winner} />
          <span className="eyebrow">Bye</span>
        </div>
      ) : matches.length === 0 ? (
        <>
          <div className={side(tie.home)}><TeamLine team={tie.home} empty="Waiting for a result" /></div>
          <div className={side(tie.away)}><TeamLine team={tie.away} empty="Waiting for a result" /></div>
        </>
      ) : (
        matches.map((m) => (
          <LegRow key={`${m.id}:${m.home_goals}:${m.away_goals}:${m.home_pens}:${m.away_pens}`}
            match={m} tie={tie} canEdit={canEdit} onSave={onSave} />
        ))
      )}

      {winnerId && !tie.is_bye && (
        <footer className="mt-3 flex items-center gap-2 border-t border-smoke/10 pt-2 text-sm">
          <span className="h-4 w-1 bg-gold" /> Winner: <strong className="font-semibold">{tie.winner.player_name}</strong>
        </footer>
      )}
    </article>
  );
}

function Bracket({ stage, canEdit, onSave, onReset, resetting }) {
  const [confirming, setConfirming] = useState(false);
  const third = stage.rounds.find((r) => r.round_type === "third_place");
  const columns = stage.rounds.filter((r) => r.round_type !== "third_place");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">Top {stage.qualifying_teams} qualified · {stage.status}</p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {confirming ? (
              <>
                <span className="text-xs text-smoke/70">Delete this bracket and start over?</span>
                <Btn size="sm" loading={resetting} onClick={onReset}>Yes, reset</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep it</Btn>
              </>
            ) : (
              <Btn size="sm" variant="danger" onClick={() => setConfirming(true)}>Reset knockout</Btn>
            )}
          </div>
        )}
      </div>

      {stage.champion && (
        <div className="mb-5 flex items-center gap-4 border border-gold bg-gold/10 p-4">
          <TeamLogo team={stage.champion} size={44} />
          <div>
            <div className="eyebrow">Champion</div>
            <div className="font-display text-4xl leading-none">{stage.champion.player_name}</div>
            <div className="text-xs text-smoke/55">{stage.champion.club_name}</div>
          </div>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-3">
        {columns.map((round) => (
          <section key={round.round_type} className="flex w-80 shrink-0 flex-col gap-3">
            <h3 className="font-display text-2xl">{roundLabel(round.round_type)}</h3>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {round.ties.map((tie) => <TieCard key={tie.id} tie={tie} canEdit={canEdit} onSave={onSave} />)}
              {round.round_type === "final" && third && (
                <>
                  <h3 className="mt-2 font-display text-2xl">{roundLabel("third_place")}</h3>
                  {third.ties.map((tie) => <TieCard key={tie.id} tie={tie} canEdit={canEdit} onSave={onSave} />)}
                </>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

// ---------- tab ----------

export default function Knockout() {
  const { sid } = useParams();
  const { season } = useOutletContext();
  const { user } = useAuth();
  const canEdit = Boolean(user);
  const finished = season.status === "finished";

  const [stage, setStage] = useState(undefined); // undefined = loading, null = nothing set yet
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStage(await api.knockout(sid));
    } catch (e) {
      setStage(null);
      if (e.status !== 404) setNotice({ type: "err", text: e.message });
    }
  }, [sid]);

  useEffect(() => { load(); }, [load]);

  async function run(action, success) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ type: "ok", text: success });
    } catch (e) {
      setNotice({ type: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  // Before the league ends the server saves the rules; afterwards it builds the bracket
  const save = (body) =>
    run(
      async () => {
        setStage(await api.createKnockout(sid, body));
        setEditing(false);
      },
      finished
        ? "Knockout created. Round-one matches are ready for scores."
        : "Knockout rules saved. The fixtures are created automatically when the league ends."
    );
  const build = () => run(async () => setStage(await api.buildKnockout(sid)), "Knockout fixtures created.");
  const reset = (text) =>
    run(async () => {
      await api.resetKnockout(sid);
      setStage(null);
      setEditing(false);
    }, text);

  // Throws so the leg row can show the error beside its inputs
  async function saveScore(matchId, payload) {
    await api.setKnockoutScore(matchId, payload);
    await load(); // winners may have moved into later rounds
    setNotice({ type: "ok", text: "Score saved." });
  }

  let body;
  if (stage === undefined) {
    body = <Spinner />;
  } else if (stage && stage.status === "planned") {
    body =
      editing && canEdit ? (
        <Setup seasonId={sid} busy={busy} finished={finished} initial={stage} onSubmit={save} onCancel={() => setEditing(false)} />
      ) : (
        <PlannedPanel
          stage={stage} seasonId={sid} seasonFinished={finished} canEdit={canEdit} busy={busy}
          onEdit={() => setEditing(true)} onBuild={build} onRemove={() => reset("Knockout plan removed.")}
        />
      );
  } else if (stage) {
    body = (
      <Bracket stage={stage} canEdit={canEdit} onSave={saveScore} onReset={() => reset("Knockout reset. Choose new settings.")} resetting={busy} />
    );
  } else if (!canEdit) {
    body = <Empty>No knockout rules have been set yet.</Empty>;
  } else {
    body = (
      <>
        <p className="mb-4 max-w-2xl text-sm text-smoke/60">
          {finished
            ? "Pick the settings, check the pairings, then create the matches."
            : "Set the knockout rules now, even while the league is still being played. The bracket and its fixtures are created automatically when the league ends: as soon as the last league match is scored, or when you end the season."}
        </p>
        <Setup seasonId={sid} busy={busy} finished={finished} onSubmit={save} />
      </>
    );
  }

  return (
    <>
      <Notice notice={notice} />
      {body}
    </>
  );
}