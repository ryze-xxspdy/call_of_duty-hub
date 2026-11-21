/* ---------- Shared emoji reactions (comments, chat messages) ---------- */
const Reactions = (() => {
  const esc = Utils.escapeHTML;
  const EMOJI = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", fire: "🔥"};
  const LABEL = { like: "Like", love: "Love", haha: "Haha", wow: "Wow", sad: "Sad", fire: "Fire" };

  /** Chips under a comment / bubble: one per kind with its count; yours is highlighted. */
  function chips(rows = [], meId) {
    const tally = {};
    rows.forEach((x) => { tally[x.kind] = (tally[x.kind] || 0) + 1; });
    const mine = rows.find((x) => x.user_id === meId);
    return Object.keys(EMOJI).filter((k) => tally[k]).sort((a, b) => tally[b] - tally[a]).map((k) =>
      `<button type="button" class="rx-chip ${mine && mine.kind === k ? "on" : ""}" data-rx="${k}" title="${LABEL[k]}" aria-label="${LABEL[k]}: ${tally[k]}">${EMOJI[k]} ${tally[k]}</button>`).join("");
  }

  /** Small smiley button + hover / tap picker. */
  function picker(rows = [], meId) {
    const mine = rows.find((x) => x.user_id === meId);
    return `<span class="react-wrap rx-wrap">
      <button type="button" class="rx-add ${mine ? "on" : ""}" data-rx-main aria-haspopup="true" aria-label="React" title="React">${mine ? EMOJI[mine.kind] : "☺"}</button>
      <span class="react-picker" role="menu">${Object.keys(EMOJI).map((k) =>
        `<button type="button" role="menuitem" class="${mine && mine.kind === k ? "on" : ""}" data-rx="${k}" title="${LABEL[k]}" aria-label="${LABEL[k]}">${EMOJI[k]}</button>`).join("")}</span>
    </span>`;
  }

  /** Touch screens: the first tap on the smiley only opens the picker. Returns true if it did. */
  function openedPicker(btn) {
    const wrap = btn.closest(".react-wrap");
    if (window.matchMedia("(hover: none)").matches && !wrap.classList.contains("open")) {
      document.querySelectorAll(".react-wrap.open").forEach((w) => w.classList.remove("open"));
      wrap.classList.add("open");
      return true;
    }
    wrap.classList.remove("open");
    return false;
  }

  /** What a click on `[data-rx-main]` / `[data-rx]` means: a kind to set, null to clear, undefined = nothing to do. */
  function intent(target, rows, meId) {
    const mine = rows.find((x) => x.user_id === meId);
    const main = target.closest("[data-rx-main]");
    const pick = target.closest("[data-rx]");
    if (main) return openedPicker(main) ? undefined : (mine ? null : "like");
    if (pick) {
      const w = pick.closest(".react-wrap"); if (w) w.classList.remove("open");
      return mine && mine.kind === pick.dataset.rx ? null : pick.dataset.rx;
    }
    return undefined;
  }

  /** Write it: kind = key to set, null to remove. `table` has user_id + `keyCol`; `extra` = more columns on insert. */
  async function save(table, keyCol, key, meId, kind, extra = {}) {
    const q = Auth.client.from(table);
    return kind
      ? q.upsert({ [keyCol]: key, user_id: meId, kind, ...extra }, { onConflict: `${keyCol},user_id` })
      : q.delete().eq(keyCol, key).eq("user_id", meId);
  }

  /** Apply a change to a local list of rows (optimistic update). */
  function apply(rows, meId, keyCol, key, kind) {
    const next = rows.filter((x) => x.user_id !== meId);
    if (kind) next.push({ [keyCol]: key, user_id: meId, kind });
    return next;
  }

  // tapping elsewhere closes an open picker
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".react-wrap.open").forEach((w) => { if (!w.contains(e.target)) w.classList.remove("open"); });
  });

  return { EMOJI, LABEL, chips, picker, intent, save, apply };
})();
