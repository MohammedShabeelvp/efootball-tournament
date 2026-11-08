import { useState } from "react";

export function Spinner({ label = "Loading" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-gold" role="status">
      <span className="spin" />
      <span className="eyebrow">{label}</span>
    </div>
  );
}

export function ErrorBox({ error }) {
  return (
    <div role="alert" className="border border-burgundy bg-burgundy/25 px-4 py-3 text-sm">
      {error?.message || "Something went wrong."}
    </div>
  );
}

export function Notice({ notice }) {
  if (!notice) return null;
  const ok = notice.type === "ok";
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`mb-4 border px-4 py-3 text-sm ${
        ok ? "border-gold/50 bg-gold/10 text-gold" : "border-burgundy bg-burgundy/25 text-smoke"
      }`}
    >
      {notice.text}
    </div>
  );
}

export function Empty({ children }) {
  return (
    <div className="border border-dashed border-smoke/20 px-6 py-10 text-center text-sm text-smoke/60">
      {children}
    </div>
  );
}

/** variant: primary | ghost | danger   size: md | sm */
export function Btn({ variant = "primary", size = "md", loading = false, className = "", children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${className}`}
    >
      {loading && <span className="spin" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

/** Two-step destructive button: click, then confirm. */
export function ConfirmButton({ children, confirmText = "Yes, remove", onConfirm, busy = false }) {
  const [asking, setAsking] = useState(false);

  async function confirm() {
    try {
      await onConfirm();
    } finally {
      setAsking(false);
    }
  }

  if (!asking) {
    return (
      <Btn variant="danger" size="sm" onClick={() => setAsking(true)}>
        {children}
      </Btn>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-smoke/70">Are you sure?</span>
      <Btn size="sm" loading={busy} onClick={confirm}>
        {confirmText}
      </Btn>
      <Btn variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Cancel
      </Btn>
    </span>
  );
}

const CHIP = {
  ongoing: "bg-gold text-ink",
  upcoming: "border border-gold/60 text-gold",
  finished: "border border-smoke/30 text-smoke/70",
  draft: "border border-smoke/30 text-smoke/70",
  setup: "border border-gold/60 text-gold",
};

export function StatusChip({ status }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${CHIP[status] || CHIP.draft}`}>
      {status}
    </span>
  );
}

export function TeamLogo({ team, size = 28 }) {
  const style = { width: size, height: size };
  return team?.logo ? (
    <span
      style={style}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold/40 bg-smoke/5"
    >
      <img src={team.logo} alt="" className="h-full w-full object-cover" />
    </span>
  ) : (
    <span
      style={{ ...style, fontSize: size * 0.45 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-gold/50 font-display font-bold text-gold"
      aria-hidden="true"
    >
      {team?.club_name?.[0] || "?"}
    </span>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="card p-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-display text-3xl font-semibold leading-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-smoke/55">{hint}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }) {
  return (
    <div className="mb-6">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">{title}</h1>
        {children}
      </div>
      <div className="rule mt-4" />
    </div>
  );
}