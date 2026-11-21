/* ---------- Messages: 1-to-1 chat (live) + unread count ---------- */
const Messages = (() => {
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;

  let me = null;
  let rows = [];                 // recent messages involving me (newest first)
  let reacts = new Map();        // message id -> [{ message_id, user_id, kind }]
  let channel = null;
  const listeners = [];
  let host = null;               // element currently showing the inbox / a thread
  let redraw = null;

  const on = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((fn) => fn());
  const other = (m) => (m.sender_id === me.id ? m.recipient_id : m.sender_id);
  const unreadFrom = (id) => rows.filter((m) => m.recipient_id === me.id && m.sender_id === id && !m.read_at).length;

  const clock = (iso) => {
    const d = new Date(iso);
    const today = Utils.daysBetween(d, new Date()) === 0;
    return today ? Utils.formatTime(d) : `${Utils.formatShortDate(d)}, ${Utils.formatTime(d)}`;
  };

  /* ---------- data ---------- */
  async function load() {
    const { data, error } = await db().from("messages").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) { console.warn("Messages unavailable:", error.message); rows = []; }
    else rows = data;
    // emoji reactions on those messages (RLS only returns ones from my chats); older databases may lack the table
    const rr = await db().from("message_reactions").select("message_id,user_id,kind").limit(5000);
    reacts = new Map();
    if (!rr.error) rr.data.forEach((x) => { if (!reacts.has(x.message_id)) reacts.set(x.message_id, []); reacts.get(x.message_id).push(x); });
    const ids = [...new Set(rows.map(other))];
    if (ids.length) await Social.fetchProfiles(ids);
    emit();
    if (redraw && host && host.isConnected) redraw();
  }

  async function init(user) {
    me = user;
    await load();
    if (channel) return;
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 150); };
    channel = db().channel("my-messages")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, refresh)
      .subscribe();
  }

  async function send(to, body) {
    const text = body.trim();
    if (!text) return;
    const { data, error } = await db().from("messages")
      .insert({ sender_id: me.id, recipient_id: to, body: text }).select().single();
    if (error) {
      const missing = /relation|schema cache|could not find/i.test(error.message);
      throw new Error(/row-level security|violates/i.test(error.message)
        ? "You can only message friends, staff, or people who share a community with you."
        : missing ? "Re-run supabase/schema.sql in Supabase to turn on messages." : error.message);
    }
    // Show it right away; realtime / the next load() will reconcile.
    if (data && !rows.some((m) => m.id === data.id)) rows.unshift(data);
    emit();
    if (redraw && host && host.isConnected) await redraw();
  }

  /** React to a message. kind = a reaction key, or null to remove yours. Optimistic, rolls back on error. */
  async function react(mid, kind) {
    const before = reacts.get(mid) || [];
    reacts.set(mid, Reactions.apply(before, me.id, "message_id", mid, kind));
    if (redraw && host && host.isConnected) await redraw();
    const { error } = await Reactions.save("message_reactions", "message_id", mid, me.id, kind);
    if (error) {
      reacts.set(mid, before);
      if (redraw && host && host.isConnected) await redraw();
      Utils.toast(/schema cache|relation/i.test(error.message) ? "Re-run supabase/schema.sql to turn on message reactions." : "Couldn't react: " + error.message);
    }
  }

  async function markRead(from) {
    const ids = rows.filter((m) => m.recipient_id === me.id && m.sender_id === from && !m.read_at).map((m) => m.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    rows.forEach((m) => { if (ids.includes(m.id)) m.read_at = now; });
    emit();
    await db().from("messages").update({ read_at: now }).in("id", ids);
  }

  /* ---------- views ---------- */
  /** Inbox (no id) or a conversation (with id), side by side like a chat app. */
  async function mount(el, otherId) {
    host = el;
    redraw = () => draw(el, otherId);
    await draw(el, otherId);
  }

  function conversations() {
    const seen = new Map();
    rows.forEach((m) => { const id = other(m); if (!seen.has(id)) seen.set(id, m); });
    return [...seen.entries()];    // [otherId, lastMessage] newest first
  }

  async function draw(el, otherId) {
    let list = conversations();
    // Opening a chat with someone new: show them at the top of the list.
    if (otherId && !list.some(([id]) => id === otherId)) {
      await Social.fetchProfiles([otherId]);
      list = [[otherId, null], ...list];
    }

    const convoHTML = list.length ? list.map(([id, last]) => {
      const p = Social.person(id);
      const n = unreadFrom(id);
      return `<a class="convo ${id === otherId ? "active" : ""}" href="#messages-${esc(id)}">
        <span class="av-wrap">${Utils.avatar(p.name, p.avatar, "sm")}${Social.isOnline(id) ? '<i class="dot"></i>' : ""}</span>
        <span class="convo-text"><strong>${Utils.nameWithBadge(p.name, p.role)}</strong>
          <small>${last ? (last.sender_id === me.id ? "You: " : "") + esc(last.body) : "Say hello 👋"}</small></span>
        ${n ? `<span class="nav-badge">${n}</span>` : ""}
      </a>`;
    }).join("") : `<div class="empty">No conversations yet.<br>Open a friend's profile and press <strong>Message</strong>.</div>`;

    let threadHTML;
    if (!otherId) {
      threadHTML = `<div class="chat-empty">Select a conversation to start chatting.</div>`;
    } else {
      const p = Social.person(otherId);
      const msgs = rows.filter((m) => other(m) === otherId).slice().reverse();
      threadHTML = `
        <div class="chat-head">
          <a class="chat-back" href="#messages" aria-label="Back to conversations">←</a>
          <a class="person-main" href="#user-${esc(otherId)}">${Utils.avatar(p.name, p.avatar, "sm")}
            <div><strong>${Utils.nameWithBadge(p.name, p.role)}</strong><small>${Social.isOnline(otherId) ? '<span class="online-text">● Online</span>' : "Offline"}</small></div></a>
        </div>
        <div class="chat-log" id="chat-log">
          ${msgs.length ? msgs.map((m) => bubble(m.sender_id === me.id, null, m.body, m.created_at, null, { id: m.id, rx: reacts.get(m.id) || [] })).join("") : `<div class="empty">No messages yet. Say hi to ${esc(p.name)}!</div>`}
        </div>
        <form class="chat-form" id="chat-form" autocomplete="off">
          <input class="text-input" id="chat-input" maxlength="1000" placeholder="Write a message…" enterkeyhint="send" />
          <button class="btn primary" id="chat-send" type="submit">Send</button>
        </form>`;
    }

    const keep = el.querySelector("#chat-input");
    const draft = keep ? keep.value : "";
    // re-drawing for the same chat (new message, a reaction): keep the scroll spot and focus
    const prev = el.querySelector("#chat-log");
    const same = !!prev && el._thread === otherId;
    const stuck = !same || prev.scrollHeight - prev.scrollTop - prev.clientHeight < 80;
    const prevTop = same ? prev.scrollTop : 0;
    const hadFocus = !!keep && document.activeElement === keep;
    el._thread = otherId;
    el.innerHTML = `
      <h1 class="view-title ${otherId ? "in-thread" : ""}">Messages</h1>
      <div class="chat-layout ${otherId ? "has-thread" : ""}">
        <aside class="convo-list">${convoHTML}</aside>
        <section class="chat-pane">${threadHTML}</section>
      </div>`;

    if (!otherId) return;
    const log = el.querySelector("#chat-log");
    log.scrollTop = stuck ? log.scrollHeight : prevTop;
    const input = el.querySelector("#chat-input");
    input.value = draft;
    if (!same || hadFocus) input.focus();
    if (!el._rxBound) {
      el._rxBound = true;
      el.addEventListener("click", (e) => {
        const row = e.target.closest(".bubble-row[data-mid]");
        if (!row) return;
        const kind = Reactions.intent(e.target, reacts.get(row.dataset.mid) || [], me.id);
        if (kind !== undefined) react(row.dataset.mid, kind);
      });
    }
    el.querySelector("#chat-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value;
      if (!text.trim()) return;
      const btn = el.querySelector("#chat-send");
      btn.disabled = true; input.value = "";
      try { await send(otherId, text); }
      catch (ex) {
        const again = el.querySelector("#chat-input");
        if (again) { again.value = text; again.focus(); }
        Utils.toast(ex.message, 4500);
      } finally {
        const b = el.querySelector("#chat-send"); if (b) b.disabled = false;
      }
    });
    markRead(otherId);
  }

  /** One chat bubble. `who` (name) is shown only for other people in group chats.
   *  opts = { id, rx } adds the reaction button + chips (rx = this message's reaction rows). */
  function bubble(mine, who, body, at, role, opts) {
    const rx = opts && opts.rx || [];
    const chips = opts && opts.id ? Reactions.chips(rx, me.id) : "";
    const btn = opts && opts.id ? Reactions.picker(rx, me.id) : "";
    return `<div class="bubble-row ${mine ? "mine" : ""}"${opts && opts.id ? ` data-mid="${esc(opts.id)}"` : ""}>
      ${mine ? btn : ""}
      <div class="bubble-col">
        <div class="bubble">${who ? `<strong>${Utils.nameWithBadge(who, role)}</strong>` : ""}<p>${esc(body)}</p><small>${clock(at)}</small></div>
        ${chips ? `<div class="rx-chips msg-chips">${chips}</div>` : ""}
      </div>
      ${mine ? "" : btn}
    </div>`;
  }

  return { init, on, mount, send, bubble, clock, get unreadCount() { return rows.filter((m) => m.recipient_id === me.id && !m.read_at).length; } };
})();
