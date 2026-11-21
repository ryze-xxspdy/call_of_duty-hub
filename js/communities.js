/* ---------- Communities: request -> admin/developer approval -> add friends like a group chat ---------- */
const Communities = (() => {
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;
  const fmt = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  let me = null;
  let host = null;       // element of the view currently shown
  let renderer = null;   // () => reload the current view
  let token = 0;
  let channel = null;
  let chatChannel = null;   // live chat of the community currently open

  function init(user) {
    me = user;
    if (channel) return;
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { if (renderer && host && host.isConnected) renderer(); }, 200); };
    channel = db().channel("communities-live");
    ["communities", "community_members", "community_requests"].forEach((table) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh));
    channel.subscribe();
  }

  const statusPill = (s) =>
    `<span class="status-pill ${s === "approved" ? "ok" : s === "rejected" ? "bad" : ""}">${s === "pending" ? "Waiting for approval" : s[0].toUpperCase() + s.slice(1)}</span>`;

  /* ---------- review (shared by the Communities page and the Admin panel) ---------- */
  function reviewRow(r, p) {
    return `<div class="person-row">
      <div class="person-main" style="cursor:default">
        ${Utils.avatar(p.name, p.avatar)}
        <div><strong>${esc(r.name)}</strong>
          <small>${esc(p.name)} · ${fmt(r.created_at)}${r.description ? " · " + esc(r.description) : ""}</small></div>
      </div>
      <div class="person-actions">
        <button class="btn-sm primary" type="button" data-review="${esc(r.id)}" data-ok="1">Approve</button>
        <button class="btn-sm ghost danger" type="button" data-review="${esc(r.id)}" data-ok="0">Reject</button>
      </div>
    </div>`;
  }

  /** Approve / reject one request. Returns true on success. */
  async function review(id, ok) {
    const { error } = await db().rpc("review_community_request", { req: id, approve: ok });
    if (error) {
      const missing = /could not find the function|schema cache/i.test(error.message);
      Utils.toast(missing ? "Re-run supabase/schema.sql in Supabase, then try again." : "Couldn't review: " + error.message, 5000);
      return false;
    }
    Utils.toast(ok ? "Community approved." : "Request rejected.");
    return true;
  }

  /** Wire the Approve / Reject buttons inside `root`; `done` runs after every attempt. */
  function bindReview(root, done) {
    root.querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", async () => {
      const ok = b.dataset.ok === "1";
      if (!ok && !confirm("Reject this community request?")) return;
      root.querySelectorAll("[data-review]").forEach((x) => (x.disabled = true));
      await review(b.dataset.review, ok);
      done();
    }));
  }

  /* ================= join with a code (dashboard Join button + Communities page) ================= */
  function openJoin() {
    if (document.getElementById("join-modal")) return;
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.id = "join-modal";
    wrap.innerHTML = `
      <div class="modal join-modal" role="dialog" aria-modal="true" aria-labelledby="jm-title">
        <h3 id="jm-title">Join a community</h3>
        <p>Enter the community code. Ask a member or the owner for it.</p>
        <input id="jm-code" class="join-code-input" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. K7M2QX" />
        <div class="join-result" id="jm-result"></div>
        <div class="modal-actions"><button class="btn ghost" type="button" id="jm-close">Close</button></div>
      </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector("#jm-code"), out = wrap.querySelector("#jm-result");
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
    wrap.querySelector("#jm-close").addEventListener("click", close);
    setTimeout(() => input.focus(), 30);

    let seq = 0, timer;
    const lookup = async () => {
      const code = input.value.trim().toUpperCase();
      const mine = ++seq;
      if (code.length < 4) { out.innerHTML = ""; return; }
      out.innerHTML = `<div class="empty">Searching…</div>`;
      const { data, error } = await db().rpc("lookup_community_code", { c: code });
      if (mine !== seq || !out.isConnected) return;
      if (error) {
        const missing = /could not find the function|schema cache/i.test(error.message);
        out.innerHTML = `<div class="empty">${missing ? "Re-run supabase/schema.sql in Supabase to turn on join codes." : "Couldn't search: " + esc(error.message)}</div>`;
        return;
      }
      const c = data && data[0];
      if (!c) { out.innerHTML = `<div class="empty">No community found with that code.</div>`; return; }
      const n = Number(c.members);
      out.innerHTML = `
        <div class="person-row join-found">
          <div class="person-main" style="cursor:default">
            <span class="community-icon" style="margin:0">${esc(c.name.trim()[0].toUpperCase())}</span>
            <div><strong>${esc(c.name)}</strong><small>${n} member${n === 1 ? "" : "s"}${c.description ? " · " + esc(c.description) : ""}</small></div>
          </div>
          <div class="person-actions">${c.is_member
            ? `<a class="btn-sm primary" href="#community-${esc(c.id)}" id="jm-open">Open</a>`
            : `<button class="btn-sm primary" type="button" id="jm-join">Join</button>`}</div>
        </div>`;
      const open = out.querySelector("#jm-open");
      if (open) open.addEventListener("click", close);
      const join = out.querySelector("#jm-join");
      if (join) join.addEventListener("click", async () => {
        join.disabled = true;
        const { data: cid, error: e2 } = await db().rpc("join_community_by_code", { c: code });
        if (e2) { join.disabled = false; Utils.toast("Couldn't join: " + e2.message, 4500); return; }
        Utils.toast("You joined " + c.name + ".");
        close();
        location.hash = "#community-" + cid;
      });
    };
    input.addEventListener("input", () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); clearTimeout(timer); timer = setTimeout(lookup, 250); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const j = out.querySelector("#jm-join,#jm-open"); if (j) j.click(); else lookup(); } });
  }

  /* ================= list page ================= */
  async function mount(el) {
    host = el;
    const my = ++token;
    if (chatChannel) { db().removeChannel(chatChannel); chatChannel = null; }
    renderer = () => draw(el, my);
    el.innerHTML = `<h1 class="view-title">Communities</h1><div class="empty">Loading…</div>`;
    await draw(el, my);
  }

  async function draw(el, my) {
    const staff = Auth.isStaff(me);
    const [mem, reqs] = await Promise.all([
      db().from("community_members").select("community_id").eq("user_id", me.id),
      db().from("community_requests").select("*").order("created_at", { ascending: false }).limit(100)
    ]);
    if (my !== token) return;
    const err = mem.error || reqs.error;
    if (err) {
      el.innerHTML = `<h1 class="view-title">Communities</h1><div class="empty-state">Couldn't load communities: ${esc(err.message)}<br><br>Re-run <code>supabase/schema.sql</code> in Supabase (it adds the communities tables).</div>`;
      return;
    }

    const ids = mem.data.map((m) => m.community_id);
    let communities = [], counts = {};
    if (ids.length) {
      const [c, m] = await Promise.all([
        db().from("communities").select("*").in("id", ids).order("created_at", { ascending: false }),
        db().from("community_members").select("community_id").in("community_id", ids)
      ]);
      if (my !== token) return;
      communities = c.data || [];
      (m.data || []).forEach((r) => { counts[r.community_id] = (counts[r.community_id] || 0) + 1; });
    }

    const all = reqs.data;
    const mine = all.filter((r) => r.requester_id === me.id);
    const pending = staff ? all.filter((r) => r.status === "pending") : [];
    if (pending.length) await Social.fetchProfiles([...new Set(pending.map((r) => r.requester_id))]);
    if (my !== token) return;

    const pendingHTML = staff ? `
      <h2 class="section-title">Requests to review <span class="count-chip">${pending.length}</span></h2>
      ${pending.length ? pending.map((r) => reviewRow(r, Social.person(r.requester_id))).join("")
        : `<div class="empty">No requests waiting.</div>`}` : "";

    const mineHTML = mine.filter((r) => r.status !== "approved" || !r.community_id).length ? `
      <h2 class="section-title">My requests</h2>
      ${mine.filter((r) => r.status !== "approved" || !r.community_id).map((r) => `
        <div class="person-row">
          <div class="person-main" style="cursor:default"><div><strong>${esc(r.name)}</strong><small>${fmt(r.created_at)}${r.description ? " · " + esc(r.description) : ""}</small></div></div>
          <div class="person-actions">${statusPill(r.status)}
            ${r.status === "pending" ? `<button class="btn-sm ghost" data-cancel="${esc(r.id)}">Cancel</button>` : ""}</div>
        </div>`).join("")}` : "";

    el.innerHTML = `
      <div class="page-head" style="margin-bottom:18px">
        <h1 class="view-title" style="margin:0">Communities</h1>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost" id="join-code-btn" type="button">Join with code</button>
          <button class="btn primary" id="new-community" type="button">Request a community</button>
        </div>
      </div>

      <form class="dev-card hidden" id="community-form" novalidate>
        <h3>Request a new community</h3>
        <p class="hint">Communities are created only after an admin or the developer approves your request. You'll get a notification when it's reviewed.</p>
        <label class="field-label" for="cm-name">Community name</label>
        <input class="text-input" id="cm-name" maxlength="40" autocomplete="off" placeholder="e.g. BSIT 2A Study Group" />
        <label class="field-label" for="cm-desc" style="margin-top:12px">What is it for? <span class="dim">(optional)</span></label>
        <textarea class="text-input" id="cm-desc" rows="3" maxlength="300"></textarea>
        <p class="dev-msg" id="cm-msg" role="alert"></p>
        <div class="form-actions" style="display:flex;gap:8px;margin-top:6px">
          <button class="btn primary" type="submit">Send request</button>
          <button class="btn ghost" type="button" id="cm-cancel">Close</button>
        </div>
      </form>

      ${pendingHTML}

      <h2 class="section-title">My communities <span class="count-chip">${communities.length}</span></h2>
      ${communities.length ? `<div class="community-grid">${communities.map((c) => `
        <a class="community-card" href="#community-${esc(c.id)}">
          <span class="community-icon">${esc(c.name.trim()[0].toUpperCase())}</span>
          <strong>${esc(c.name)}</strong>
          <small>${counts[c.id] || 1} member${(counts[c.id] || 1) === 1 ? "" : "s"}${c.owner_id === me.id ? " · You own this" : ""}</small>
        </a>`).join("")}</div>`
        : `<div class="empty">You're not in any community yet. Request one above, or ask a friend to add you.</div>`}

      ${mineHTML}

      <h2 class="section-title">All users <span class="count-chip" id="all-count">…</span></h2>
      <p class="hint" style="margin-top:0">Everyone on ConfessHub. Open a profile to add them as a friend or send a message.</p>
      <input class="text-input search-input" id="all-q" placeholder="Search all users…" maxlength="40" autocomplete="off" />
      <div id="all-users"><div class="empty">Loading people…</div></div>`;

    mountAllUsers(el);

    el.querySelector("#join-code-btn").addEventListener("click", openJoin);
    const form = el.querySelector("#community-form");
    el.querySelector("#new-community").addEventListener("click", () => { form.classList.toggle("hidden"); el.querySelector("#cm-name").focus(); });
    el.querySelector("#cm-cancel").addEventListener("click", () => form.classList.add("hidden"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = el.querySelector("#cm-msg");
      const name = el.querySelector("#cm-name").value.trim();
      const description = el.querySelector("#cm-desc").value.trim();
      msg.textContent = "";
      if (name.length < 3) return (msg.textContent = "Give your community a name (at least 3 characters).");
      const btn = e.submitter; if (btn) btn.disabled = true;
      const { error } = await db().from("community_requests").insert({ requester_id: me.id, name, description });
      if (btn) btn.disabled = false;
      if (error) return (msg.textContent = error.message);
      Utils.toast("Request sent. An admin or the developer will review it.", 3500);
      draw(el, my);
    });

    bindReview(el, () => draw(el, my));
    el.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
      const { error } = await db().from("community_requests").delete().eq("id", b.dataset.cancel);
      if (error) Utils.toast("Couldn't cancel: " + error.message);
      draw(el, my);
    }));
  }

  /* ================= all users directory (every account is visible) ================= */
  function mountAllUsers(el) {
    const box = el.querySelector("#all-users");
    const count = el.querySelector("#all-count");
    const q = el.querySelector("#all-q");
    let timer, seq = 0;
    const search = async () => {
      const mine = ++seq;
      const term = q.value.trim();
      let query = db().from("public_profiles").select("id,name,avatar,bio,role,created_at").limit(200);
      query = term ? query.ilike("name", `%${term}%`).order("name") : query.order("name");
      const { data, error } = await query;
      if (mine !== seq || !box.isConnected) return;
      if (error) { box.innerHTML = `<div class="empty">Couldn't load users: ${esc(error.message)}</div>`; return; }
      count.textContent = data.length;
      box.innerHTML = data.length ? data.map((p) => `
        <div class="person-row">
          <a href="${p.id === me.id ? "#profile" : "#user-" + esc(p.id)}" class="person-main">
            ${Utils.avatar(p.name, p.avatar)}
            <div><strong>${Utils.nameWithBadge(p.name, p.id === me.id ? me.role : p.role)}${p.id === me.id ? ' <span class="dim">(you)</span>' : ""}</strong><small>${p.bio ? esc(p.bio) : "No bio yet"}</small></div>
          </a>
        </div>`).join("") : `<div class="empty">No one found with that name.</div>`;
    };
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    search();
  }

  /* ================= community chat ================= */
  async function mountChat(box, cid, my) {
    let msgs = [];
    let rxs = new Map();     // message id -> [{ message_id, user_id, kind }]
    const paint = (stick = true) => {
      if (!box.isConnected) return;
      const log = box.querySelector("#cchat-log");
      const atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      const prevTop = log ? log.scrollTop : 0;
      const hadFocus = !!box.querySelector("#cchat-input") && document.activeElement === box.querySelector("#cchat-input");
      const html = msgs.length
        ? msgs.map((m) => {
            const mine = m.user_id === me.id;
            const p = Social.person(m.user_id);
            return Messages.bubble(mine, mine ? null : p.name, m.body, m.created_at, p.role, { id: m.id, rx: rxs.get(m.id) || [] });
          }).join("")
        : `<div class="empty">No messages yet. Start the conversation!</div>`;
      const draft = box.querySelector("#cchat-input") ? box.querySelector("#cchat-input").value : "";
      box.innerHTML = `
        <div class="chat-log" id="cchat-log">${html}</div>
        <form class="chat-form" id="cchat-form" autocomplete="off">
          <input class="text-input" id="cchat-input" maxlength="1000" placeholder="Message the community…" enterkeyhint="send" />
          <button class="btn primary" type="submit">Send</button>
        </form>`;
      const l = box.querySelector("#cchat-log");
      l.scrollTop = (stick || atBottom) ? l.scrollHeight : prevTop;
      const input = box.querySelector("#cchat-input");
      input.value = draft;
      if (draft && (stick || hadFocus)) input.focus();
      box.querySelector("#cchat-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        const { data, error } = await db().from("community_messages")
          .insert({ community_id: cid, user_id: me.id, body: text }).select().single();
        if (error) { input.value = text; Utils.toast(/schema cache|relation/i.test(error.message) ? "Re-run supabase/schema.sql in Supabase to turn on community chat." : "Couldn't send: " + error.message, 4500); return; }
        if (data && !msgs.some((m) => m.id === data.id)) msgs.push(data);
        paint(true);
        const again = box.querySelector("#cchat-input"); if (again) again.focus();
      });
    };

    const fetchAll = async () => {
      const { data, error } = await db().from("community_messages").select("*").eq("community_id", cid).order("created_at", { ascending: false }).limit(200);
      if (my !== token || !box.isConnected) return;
      if (error) { box.innerHTML = `<div class="empty">Chat unavailable: ${esc(error.message)}</div>`; return; }
      msgs = data.slice().reverse();
      const rr = await db().from("community_message_reactions").select("message_id,user_id,kind").eq("community_id", cid).limit(5000);
      rxs = new Map();
      if (!rr.error) rr.data.forEach((x) => { if (!rxs.has(x.message_id)) rxs.set(x.message_id, []); rxs.get(x.message_id).push(x); });
      await Social.fetchProfiles([...new Set(msgs.map((m) => m.user_id))]);
      if (my !== token || !box.isConnected) return;
      paint(false);
    };

    // react to a community message (optimistic; rolls back on error)
    box.addEventListener("click", async (e) => {
      const row = e.target.closest(".bubble-row[data-mid]");
      if (!row) return;
      const mid = row.dataset.mid, before = rxs.get(mid) || [];
      const kind = Reactions.intent(e.target, before, me.id);
      if (kind === undefined) return;
      rxs.set(mid, Reactions.apply(before, me.id, "message_id", mid, kind));
      paint(false);
      const { error } = await Reactions.save("community_message_reactions", "message_id", mid, me.id, kind, { community_id: cid });
      if (error) {
        rxs.set(mid, before); paint(false);
        Utils.toast(/schema cache|relation/i.test(error.message) ? "Re-run supabase/schema.sql to turn on message reactions." : "Couldn't react: " + error.message);
      }
    });

    await fetchAll();
    if (my !== token) return;
    paint(true);
    chatChannel = db().channel("community-chat-" + cid)
      .on("postgres_changes", { event: "*", schema: "public", table: "community_messages", filter: `community_id=eq.${cid}` }, fetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "community_message_reactions", filter: `community_id=eq.${cid}` }, fetchAll)
      .subscribe();
  }

  /* ================= add people (any user) ================= */
  function mountAddList(el, cid, memberIds, done, personRow) {
    const results = el.querySelector("#add-results");
    const count = el.querySelector("#add-count");
    const q = el.querySelector("#add-q");
    let timer, seq = 0;

    const search = async () => {
      const mine = ++seq;
      const term = q.value.trim();
      let query = db().from("public_profiles").select("id,name,avatar,bio,role,created_at").limit(40);
      query = term ? query.ilike("name", `%${term}%`).order("name") : query.order("name");
      const { data, error } = await query;
      if (mine !== seq || !results.isConnected) return;
      if (error) { results.innerHTML = `<div class="empty">Couldn't load people: ${esc(error.message)}</div>`; return; }
      count.textContent = data.length;
      results.innerHTML = data.length
        ? data.map((p) => personRow(p, memberIds.has(p.id)
            ? `<span class="status-pill ok">Member</span>`
            : `<button class="btn-sm primary" data-add="${esc(p.id)}">Add</button>`)).join("")
        : `<div class="empty">No one found with that name.</div>`;
      results.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        const { error: e2 } = await db().rpc("add_community_member", { cid, target: b.dataset.add });
        if (e2) { Utils.toast("Couldn't add: " + e2.message, 4500); b.disabled = false; return; }
        Utils.toast("Added to the community.");
        done();
      }));
    };
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    search();
  }

  /* ================= one community ================= */
  async function mountDetail(el, id) {
    host = el;
    const my = ++token;
    renderer = () => drawDetail(el, id, my);
    el.innerHTML = `<div class="empty">Loading community…</div>`;
    await drawDetail(el, id, my);
  }

  async function drawDetail(el, id, my) {
    const back = `<p class="today"><a href="#communities" style="color:var(--accent)">← Communities</a></p>`;
    const [c, m] = await Promise.all([
      db().from("communities").select("*").eq("id", id).maybeSingle(),
      db().from("community_members").select("*").eq("community_id", id).order("created_at")
    ]);
    if (my !== token) return;
    if (c.error || m.error) { el.innerHTML = `${back}<div class="empty-state">Couldn't load this community: ${esc((c.error || m.error).message)}</div>`; return; }
    if (!c.data) { el.innerHTML = `${back}<div class="empty-state">This community doesn't exist, or you're not a member of it.</div>`; return; }

    const com = c.data, members = m.data;
    const isOwner = com.owner_id === me.id;
    const canManage = isOwner || Auth.isStaff(me);
    const isMember = members.some((x) => x.user_id === me.id);
    await Social.fetchProfiles(members.map((x) => x.user_id));
    if (my !== token) return;

    const memberIds = new Set(members.map((x) => x.user_id));

    const personRow = (p, right) => `
      <div class="person-row">
        <a href="${p.id === me.id ? "#profile" : "#user-" + esc(p.id)}" class="person-main">
          ${Utils.avatar(p.name, p.avatar)}
          <div><strong>${Utils.nameWithBadge(p.name, p.id === me.id ? me.role : p.role)}${p.id === me.id ? ' <span class="dim">(you)</span>' : ""}</strong><small>${p.bio ? esc(p.bio) : "No bio yet"}</small></div>
        </a>
        <div class="person-actions">${right}</div>
      </div>`;

    el.innerHTML = `
      ${back}
      <div class="profile-head">
        <span class="community-icon big">${esc(com.name.trim()[0].toUpperCase())}</span>
        <div class="profile-info">
          <h1 class="view-title">${esc(com.name)}</h1>
          <p class="bio">${com.description ? esc(com.description) : '<span class="dim">No description.</span>'}</p>
          <small class="dim">Created ${fmt(com.created_at)} · ${members.length} member${members.length === 1 ? "" : "s"}</small>
        </div>
        <div class="profile-actions">
          ${isMember && !isOwner ? `<button class="btn-sm ghost" id="leave">Leave</button>` : ""}
          ${canManage ? `<button class="btn-sm ghost danger" id="del-community">Delete community</button>` : ""}
        </div>
      </div>

      ${(isMember || Auth.isStaff(me)) && com.code ? `
      <div class="code-card">
        <div><small>Community code</small><strong class="code-value" id="com-code">${esc(com.code)}</strong>
          <small class="dim">Share it: anyone can join from Dashboard → Join.</small></div>
        <div class="code-actions">
          <button class="btn-sm primary" type="button" id="copy-code">Copy</button>
          ${canManage ? `<button class="btn-sm ghost" type="button" id="new-code">New code</button>` : ""}
        </div>
      </div>` : ""}

      ${isMember ? `
      <h2 class="section-title">Chat</h2>
      <div class="dev-card com-chat" id="com-chat"></div>

      <h2 class="section-title">Add people <span class="count-chip" id="add-count">…</span></h2>
      <p class="hint" style="margin-top:0">Everyone with an account can be added. They get a notification and can chat right away.</p>
      <input class="text-input search-input" id="add-q" placeholder="Search by username…" maxlength="40" autocomplete="off" />
      <div id="add-results"><div class="empty">Loading people…</div></div>` : ""}

      <h2 class="section-title">Members <span class="count-chip">${members.length}</span></h2>
      ${members.map((x) => {
        const p = Social.person(x.user_id);
        const tags = x.user_id === com.owner_id ? `<span class="role-tag admin">Owner</span>` : "";
        const rm = canManage && x.user_id !== com.owner_id && x.user_id !== me.id
          ? `<button class="btn-sm ghost" data-remove="${esc(x.user_id)}" data-name="${esc(p.name)}">Remove</button>` : "";
        return personRow(p, tags + rm);
      }).join("")}`;

    if (chatChannel) { db().removeChannel(chatChannel); chatChannel = null; }
    if (isMember) {
      mountChat(el.querySelector("#com-chat"), id, my);
      mountAddList(el, id, memberIds, () => drawDetail(el, id, my), personRow);
    }
    const cc = el.querySelector("#copy-code");
    if (cc) cc.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(com.code); Utils.toast("Code copied: " + com.code); }
      catch { Utils.toast("Your code is " + com.code); }
    });
    const nc = el.querySelector("#new-code");
    if (nc) nc.addEventListener("click", async () => {
      if (!confirm("Make a new code? The old code will stop working.")) return;
      const { error } = await db().rpc("regenerate_community_code", { cid: id });
      if (error) return Utils.toast("Couldn't change the code: " + error.message);
      Utils.toast("New code created.");
      drawDetail(el, id, my);
    });
    el.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Remove ${b.dataset.name} from this community?`)) return;
      const { error } = await db().from("community_members").delete().eq("community_id", id).eq("user_id", b.dataset.remove);
      if (error) return Utils.toast("Couldn't remove: " + error.message);
      Utils.toast("Member removed.");
      drawDetail(el, id, my);
    }));
    const leave = el.querySelector("#leave");
    if (leave) leave.addEventListener("click", async () => {
      if (!confirm(`Leave "${com.name}"?`)) return;
      const { error } = await db().from("community_members").delete().eq("community_id", id).eq("user_id", me.id);
      if (error) return Utils.toast("Couldn't leave: " + error.message);
      Utils.toast("You left the community.");
      location.hash = "#communities";
    });
    const del = el.querySelector("#del-community");
    if (del) del.addEventListener("click", async () => {
      if (!confirm(`Permanently delete "${com.name}" for everyone?`)) return;
      const { error } = await db().from("communities").delete().eq("id", id);
      if (error) return Utils.toast("Couldn't delete: " + error.message);
      Utils.toast("Community deleted.");
      location.hash = "#communities";
    });
  }

  return { init, mount, mountDetail, reviewRow, bindReview, openJoin };
})();
