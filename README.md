# StudyHub / ConfessHub

Login + dashboard with a posts feed (text, photo, video), an admin panel, and a Supabase database.
Plain HTML, CSS and JavaScript, no build step.

## 1. Set up Supabase (5 minutes)
1. Create a free project at https://supabase.com.
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, press **Run**.
   - Before running, set your **developer email** in the `insert into public.admin_settings` line
     (default `shopeehack40@gmail.com`). The account that signs up with that email becomes the **developer**.
     Sign up with it right away. Already have an account with that email? Re-running the SQL promotes it.
   - Re-running on an existing project is safe; the old admin code is removed.
3. **Project Settings → API**: copy the *Project URL* and the *anon public* key into `js/config.js`.
4. (Easiest for testing) **Authentication → Providers → Email**: turn off *Confirm email*.
   If you leave it on, new users must click the link in their email before they can log in.

## 2. Run it
    cd studyhub
    python3 -m http.server 8000
Open http://localhost:8000

## How it works
- **Roles**: `student` (everyone who signs up) < `admin` < `developer`.
  The sign-up form has no role choice, so every public sign-up is a student.
  Roles can't be edited from the browser except through the developer-only database functions.
- **Developer** (sidebar, developer only): create **admin accounts** (name, email, password), switch anyone
  between Student and Admin, and delete accounts. The developer also gets the full Admin panel and can delete any post.
  Admins can only moderate posts and view users / logins; they cannot create or change accounts.
- **Dashboard**: **Posts** on the left (text, photo or video up to 50 MB; delete your own, admins/developer can delete any)
  and an **Active now** list on the right showing who is online (live, via Supabase Realtime presence). Click anyone to open their profile.
- **Edit profile** (sidebar or avatar menu): change your profile picture, username and bio.
  Other users only ever see your photo, username and bio (through the `public_profiles` view); never your email.
- **Friends**: find people under **Search Here → User**, open their profile and press **Add friend**.
  Incoming requests show up under **Friend Request** (and the bell) with **Accept** / **Reject**.
  Once accepted, they appear in the **Friends** list and you can open their profile to see all their posts.
  Re-run `supabase/schema.sql` once to add the new tables, view and storage bucket.
- **Admin panel** (sidebar, admins + developer): totals, **New logins** (every login with time, NEW badge for the last hour),
  **Users** (name, email, role, joined, last login) and **Posts** moderation. Admins also get a pop-up
  toast the moment someone logs in.

- **Communities**: anyone can **Request a community** (name + description). Admins and the developer see it under
  **Communities → Requests to review** (and get a notification) and press **Approve** / **Reject**. Once approved the
  requester owns the community and any member can **add their own friends** to it, like a group chat.
  Owners (and staff) can remove members or delete it; members can leave.
- **Notifications** (bell): friend requests with **Add friend / Decline** buttons, plus notices from the admin / developer side:
  *"You are now an Admin"* (shown as a pop-up the moment the developer promotes you, no refresh needed),
  community requests to review, community approved / declined, and "added to a community".
  **Re-run `supabase/schema.sql`** to add the notification + community tables and the profile repair.

- **Reviewing communities**: admins / developer can also approve or reject from **Admin panel → Communities**
  (with a badge for pending requests). Staff can review any pending request, including their own.
- **Reactions & comments**: every post has a reaction picker (👍 ❤️ 😂 😮 😢 🔥, one per person, click again to remove)
  and a comment thread. Authors, the commenter and staff can delete comments; post authors get a notification.
  **Re-run `supabase/schema.sql`** to add `post_reactions` / `post_comments` and the updated review function.

- **Announcements**: admins and the developer post them under **Announcements → New announcement**.
  Every user gets a **pop-up** (instantly if online, or at their next login). It shows **once per person**:
  after pressing *Got it* it never pops up again, and after **24 hours** it stops popping up either way
  (it stays on the Announcements page as history). "Seen" is stored in the database (`announcement_seen`).
- **Staff-login alerts**: when an admin or the developer logs in, every student gets a bell notification + toast
  (at most once per hour per staff member).
- **Bell number**: now only counts real things: friend requests, unread notifications and new announcements. It hides at 0.
  **Re-run `supabase/schema.sql`** (section 14) to add the announcement tables and the login-alert trigger.

- **Messages**: the chat icon (top bar) and **Messages** in the sidebar open your inbox. Chat 1-to-1 live with friends or
  anyone you share a community with (press **Message** on their profile). Unread messages show a red number.
- **Community chat**: every member of an approved community gets a live group chat on the community page.
- **Add anyone to a community**: members of an approved community can search **all users** and add anyone (not just friends).
  **Re-run `supabase/schema.sql`** (section 15) to add `messages`, `community_messages` and the updated add-member function.
- **Forgot password / Google / Facebook** on the login page now use real Supabase auth (turn the providers on in
  Supabase > Authentication > Providers).

- **Role badges**: developer and admin accounts show a **Developer** (orange) or **Admin** (blue) badge next to their name
  everywhere: their profile (plus a "verified staff account" line), posts, comments, chats, Active now, friend lists and search.
  Students never get a badge. **Re-run `supabase/schema.sql`** (section 17) so the public profile view includes `role`.
- **Look**: dark navy sidebar layout (brand + menu on the left, greeting + My Classes + posts in the middle, Active now on the right).
  Theme toggle (sun icon) still switches light / dark.

- **Profile banner**: **Edit profile** now has a wide banner picture (JPG / PNG / GIF / WEBP, max 5 MB) shown at the top of your
  profile for everyone who opens it. No banner = a soft gradient.
- **Contact staff** (sidebar, Account): lists the developer and every admin with a quick message box. Messages arrive in their
  normal **Messages** inbox. Anyone can message staff, and staff can reply to anyone.
- **Announcements to chosen people**: when posting, admins / developer choose **Everyone** or **Specific people** (search a
  username, add as many as needed). Only the chosen people get the pop-up and can read it; the author and the developer can always see it.
- Removed: the "SY 2026 - 2027 · 1 Semester" label and the **My Classes** cards (and `data/classes.json`).
  **Re-run `supabase/schema.sql`** (section 18) to add the banner column, staff messaging and announcement recipients.

## Files
    index.html / dashboard.html
    js/config.js    Supabase URL + key (you fill this in)
    js/auth.js      Supabase login, sign-up, session
    js/feed.js      posts feed + composer + uploads
    js/social.js    profiles, friends, requests, user search, active users
    js/admin.js     admin panel
    js/developer.js developer panel (create admins, manage accounts)
    js/notify.js    notification pop-ups + panel data
    js/announce.js  announcements: one-time pop-up, 24h window
    js/messages.js  1-to-1 chat + unread count
    js/communities.js  community requests, approval, members, community chat
    js/contact.js   Contact staff page (message the developer / admins)
    js/dashboard.js dashboard, routing
    supabase/schema.sql   tables, security rules, storage bucket, realtime
#   c a l l _ o f _ d u t y - h u b  
 #   c a l l _ o f _ d u t y - h u b  
 #   c a l l _ o f _ d u t y - h u b  
 