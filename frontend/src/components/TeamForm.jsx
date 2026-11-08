
import { useRef, useState } from "react";
import { btnGhost, btnPrimary, inputCls, Notice } from "./ui.jsx";

const MAX_MB = 5;

export default function TeamForm({ initial = null, onSubmit, onCancel }) {
    const formRef = useRef(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    async function submit(e) {
        e.preventDefault();

        const form = formRef.current;
        const fd = new FormData();

        for (const key of ["club_name", "player_name", "efootball_id"]) {
            fd.append(key, form.elements[key].value.trim());
        }

        for (const key of ["logo", "lineup_image"]) {
            const file = form.elements[key].files[0];

            if (!file) continue;

            if (file.size > MAX_MB * 1024 * 1024) {
                setError(
                    `${key.replace("_", " ")} must be under ${MAX_MB} MB.`
                );
                return;
            }

            fd.append(key, file);
        }

        setBusy(true);
        setError(null);

        try {
            await onSubmit(fd);

            if (!initial) {
                form.reset();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    const label =
        "mb-2 block text-xs font-semibold uppercase tracking-wider text-[#A9A0A2]";

    const fileInput =
        `${inputCls} file:mr-3 file:border-0 file:bg-[#702B43] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[#F3F0EB]`;

    return (
        <form
            ref={formRef}
            onSubmit={submit}
            className="space-y-5 border border-[#33242A] bg-[#191417] p-5 sm:p-6"
        >
            <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#D5AD59]">
                    Team Management
                </p>

                <h2 className="text-xl font-semibold text-[#F3F0EB]">
                    {initial ? "Edit Team" : "Add New Team"}
                </h2>
            </div>

            <Notice
                notice={error && { type: "err", text: error }}
            />

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className={label}>Team name</label>
                    <input
                        name="club_name"
                        className={inputCls}
                        required
                        maxLength={80}
                        defaultValue={initial?.club_name || ""}
                        placeholder="Enter team name"
                    />
                </div>

                <div>
                    <label className={label}>Player name</label>
                    <input
                        name="player_name"
                        className={inputCls}
                        required
                        maxLength={80}
                        defaultValue={initial?.player_name || ""}
                        placeholder="Enter player name"
                    />
                </div>

                <div>
                    <label className={label}>eFootball ID (optional)</label>
                    <input
                        name="efootball_id"
                        className={inputCls}
                        maxLength={50}
                        defaultValue={initial?.efootball_id || ""}
                        placeholder="Enter eFootball ID"
                    />
                </div>

                <div>
                    <label className={label}>Team logo</label>
                    <input
                        name="logo"
                        type="file"
                        accept="image/*"
                        className={fileInput}
                    />
                    <p className="mt-1 text-xs text-[#777176]">
                        Optional · Maximum {MAX_MB} MB
                    </p>
                </div>
            </div>

            <div>
                <label className={label}>Lineup image</label>

                <input
                    name="lineup_image"
                    type="file"
                    accept="image/*"
                    className={fileInput}
                />

                <p className="mt-1 text-xs text-[#777176]">
                    {initial?.lineup_image
                        ? "Choose a file to replace the current image."
                        : `Optional · Maximum ${MAX_MB} MB`}
                </p>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-[#33242A] pt-5">
                <button
                    type="submit"
                    disabled={busy}
                    className={btnPrimary}
                >
                    {busy
                        ? "Saving..."
                        : initial
                            ? "Save Changes"
                            : "Add Team"}
                </button>

                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        className={btnGhost}
                    >
                        Cancel
                    </button>
                )}
            </div>
        </form>
    );
}
