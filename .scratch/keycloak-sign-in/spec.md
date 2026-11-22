# Login ด้วย Keycloak และเห็นเฉพาะงานของตัวเอง

Status: ready-for-agent

ใช้คำตาม [GLOSSARY.md](../../GLOSSARY.md) (Author, Job Owner, All-Jobs Access, Job, Job List, Unfinished Upload, Job Title, Generate Mode, Review Mode, AD Spot, Analysis Batch) และการตัดสินใจใน [ADR-0004](../../docs/adr/0004-keycloak-sign-in-with-server-session-cookie.md) ซึ่งต่อจากเรื่องที่ [ADR-0003](../../docs/adr/0003-sqlite-job-store-and-url-addressed-jobs.md) พักไว้

## Problem Statement

ตอนนี้ใครเปิดเว็บ Envisio ได้ก็เห็นทุก Job ใน Job List เปิดงานของคนอื่นได้ แก้บท เปลี่ยนชื่อ สั่งวิเคราะห์ และลบงานของคนอื่นได้ด้วย ไม่มีทางรู้ว่างานไหนเป็นของใคร Author ในทีมทำงานพร้อมกันหลายคน จึงเสี่ยงแก้ทับหรือลบงานของเพื่อนโดยไม่ตั้งใจ ส่วนหัวหน้าทีมก็ไม่รู้ว่าใครถืองานไหนอยู่

## Solution

Author ต้อง login ผ่าน Keycloak ขององค์กร (realm `rtt`, client `envisio-dev`, username เป็น email) ก่อนใช้ Envisio หลัง login แล้ว Job List แสดงเฉพาะงานที่ตัวเองเป็น Job Owner และเปิดหรือแก้ได้เฉพาะงานของตัวเอง Author ที่อยู่ในกลุ่ม `admin` หรือ `supervisor` ได้ All-Jobs Access คือเห็นทุกงาน รวมถึงงานที่ไม่มีเจ้าของและ Unfinished Upload และทำกับงานเหล่านั้นได้ทุกอย่างเหมือนเป็นเจ้าของ Job List ของคนกลุ่มนี้มีตัวกรองเจ้าของ (`ทุกคน` / `งานของฉัน`) และคอลัมน์ "เจ้าของ" แสดง email ของ Job Owner login อยู่ได้ 1 สัปดาห์ และ header มีเมนูบัญชีผู้ใช้ (`Avatar` `AccountMenu` dropdown) แสดงชื่อ email สิทธิ์การเข้าถึง และปุ่มออกจากระบบ

## User Stories

1. As an Author, I want Envisio to send me to the Keycloak sign-in page when I open any page without being signed in, so that nobody can use it anonymously.
2. As an Author, I want to sign in with my existing organisation account (my email as username), so that I don't need a separate Envisio password.
3. As an Author, I want to land back on the page I originally opened (for example `/jobs/:jobId`) after signing in, so that a shared link or bookmark still works.
4. As an Author, I want to stay signed in for a week, so that I'm not asked to sign in again every day.
5. As an Author, I want the Job List to show only the Jobs I own, so that it stays short and I can't touch a teammate's work by mistake.
6. As an Author, I want every new Job I create in Generate Mode or Review Mode to be recorded as mine, so that it shows in my Job List from then on.
7. As an Author, I want a link to someone else's Job to say "ไม่พบงานนี้" just like a deleted Job, so that it doesn't reveal that the Job exists.
8. As an Author, I want renaming, saving AD Spots, starting or resuming analysis, streaming the video, and deleting to work on my Jobs and be refused on anyone else's, so that ownership is enforced everywhere, not just in the list.
9. As an Author, I want cancelling an upload or a Job I just started creating to still clean up the video copy on the server, so that cancelling leaves nothing behind just as it does today.
10. As an Author, I want the header to show the email I'm signed in with, so that I know which account I'm using.
11. As an Author, I want a sign-out button that also signs me out of Keycloak, so that the next person on a shared computer can't continue as me.
12. As an Author, I want to be sent to sign in and then back to the same page when my session runs out mid-work, so that I can carry on without hunting for my Job again.
13. As an Author, I want the Job List search, mode filter, sort, and paging to keep working on my own Jobs, so that nothing I use today goes away.
14. As an Author with All-Jobs Access, I want to see every Job of every Author in the Job List, so that I can follow the team's work.
15. As an Author with All-Jobs Access, I want an "เจ้าของ" column showing each Job Owner's email, so that I know whose Job each row is.
16. As an Author with All-Jobs Access, I want to search the Job List by a Job Owner's email, so that I can find one Author's Jobs quickly.
17. As an Author with All-Jobs Access, I want to open, edit, rename, analyse, export, and delete any Job, so that I can take over or tidy up work when someone is away or has left.
18. As an Author with All-Jobs Access, I want Jobs made before sign-in existed to show as "ไม่มีเจ้าของ", so that they stay reachable and can be cleaned up.
19. As an Author with All-Jobs Access, I want to see and delete Unfinished Uploads, so that the server's disk can be tidied after a restart.
20. As an Author with All-Jobs Access, I want admin and supervisor to work the same, so that nobody has to remember which group can do what.
21. As an Author, I want my email shown as the Job Owner to stay current if the organisation changes my email, so that teammates still recognise my Jobs.
22. As an Author whose email changes in Keycloak, I want to keep all my Jobs, so that an account change doesn't orphan my work.
23. As an operator, I want to set the Keycloak issuer, client ID, session secret, app URL, and the All-Jobs Access group names through environment variables, so that the same build runs in development and production.
24. As an operator, I want the server to refuse to start when a required sign-in setting is missing, so that a misconfiguration never runs without sign-in.
25. As an operator, I want to sign everyone out at once by changing the session secret and restarting, so that I can revoke access immediately when someone leaves.
26. As an operator, I want the production healthcheck to keep working without a session, so that the container isn't marked unhealthy.
27. As an operator, I want the server to start even when Keycloak is briefly unreachable, so that a Keycloak outage only affects new sign-ins.
28. As a developer, I want local development to sign in against the `envisio-dev` client with a `localhost` redirect URI, so that development runs the same code path as production.
29. As a developer, I want the browser tests to keep mocking every API route, now including the signed-in Author, so that they run without Keycloak.

## Implementation Decisions

**Sign-in flow (server, public client with PKCE)**
- Add the `openid-client` dependency (approved). The Express server runs an authorization code flow with PKCE (`S256`) and `state` against the issuer in `KEYCLOAK_ISSUER_URL` (`https://accounts.rtt.in.th/auth/realms/rtt`), client `envisio-dev` as a public client (no client secret; PKCE protects the code exchange).
- Discover the provider lazily on the first sign-in and keep the result, so the server starts and serves its healthcheck even when Keycloak is unreachable.
- Routes:
  - `GET /auth/login?returnTo=<path>` starts the flow. It keeps `state`, the PKCE verifier, and `returnTo` in a short-lived encrypted cookie (10 minutes).
  - `GET /auth/callback` finishes the flow, creates the session, and redirects to `returnTo`.
  - `GET /auth/logout` clears the session and redirects to Keycloak's `end_session_endpoint` with `id_token_hint`, `client_id`, and the post-logout redirect. It sends the redirect as both `post_logout_redirect_uri` and `redirect_uri` because this Keycloak serves under `/auth` and may be an older release.
- `returnTo` must be a same-origin path beginning with a single `/`; anything else falls back to `/` (no open redirect).
- The redirect URI is `<APP_URL>/auth/callback`; `APP_URL` is the public origin of the app.

**Session cookie**
- One cookie (`envisio_session`): httpOnly, `SameSite=Lax`, `Secure` when `APP_URL` is https, `Path=/`, lasting 7 days from sign-in, never extended, never re-checked with Keycloak.
- Its value is sealed with AES-256-GCM from `node:crypto` using a key derived from `SESSION_SECRET`; no session library and no server-side session store. A cookie that fails to unseal or has expired counts as signed out.
- It holds `sub`, `email`, optional `name`, the computed `allJobs` flag, optional `accessGroups` (the matching groups from `AUTH_ALL_JOBS_GROUPS` when `allJobs` is true), the `id_token` (for logout), and the expiry. Group changes take effect at the next sign-in.
- `email` comes from the `email` claim, falling back to `preferred_username`.
- `allJobs` is true when any entry of the token's `groups` claim, with a leading `/` stripped, matches a name in `AUTH_ALL_JOBS_GROUPS` (default `admin,supervisor`).

**Configuration**
- The server requires `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_CLIENT_ID`, `SESSION_SECRET`, and `APP_URL`. If any is missing, or `SESSION_SECRET` is shorter than 32 characters, it exits at startup with a clear message.
- There is no sign-in bypass or development switch.

**Route protection**
- Public without a session: `GET /api/config` (used by the production healthcheck), `/auth/*`, and static files (built `/assets`, `/ort`, `/models`, and Vite's own module requests in development).
- Every other `/api/*` route answers HTTP 401 `{ error, code: 'UNAUTHENTICATED' }` without a valid session.
- A browser page navigation (a GET for a non-API path that accepts `text/html`) without a session is redirected to `/auth/login?returnTo=<path and query>` before `index.html` is served, so the SPA has no sign-in page of its own.
- New `GET /api/me` returns `{ email, name?, allJobs, accessGroups? }` (`name` when present in the token, `accessGroups` when `allJobs` is true).

**Ownership in the Job store (schema change)**
- Append a migration to the store's `MIGRATIONS` list that adds nullable `owner_sub` and `owner_email` columns to `jobs`. Existing Jobs get no Job Owner (null).
- `PersistedJobState` gains optional `owner_sub` and `owner_email`. `JOB_SCHEMA_VERSION` stays 3 because the shape only gains optional fields.
- Saving a Job keeps the owner it already has. Only the two Job-creation routes set the owner, from the session.
- The store offers a way to list Jobs visible to a viewer (all Jobs, or only those whose `owner_sub` matches), keeping filtering in the store as ADR-0003 planned, and exposes each Job's owner so routes can check access.
- At sign-in, the callback updates `owner_email` on every Job whose `owner_sub` is the Author's `sub`, so the displayed email follows an email change.
- List summaries include `owner_email` (null when there is no Job Owner).

**Access rule**
- A viewer may act on a Job when `allJobs` is true or the Job's `owner_sub` equals the viewer's `sub`. A Job with no Job Owner is reachable only with All-Jobs Access.
- Every route that takes a `:jobId` applies this rule before doing anything: read, video stream, rename, save spots, start, analyse batch, and delete. A Job the viewer may not act on answers HTTP 404 with the same body as a missing Job, never 403.
- Gemini analysis stays one Job at a time across the server. The existing 409 message names no other Job or Author.

**Unfinished Uploads**
- `activeUploads` becomes a map from `uploadId` to the uploader's `sub`, set by upload init.
- The chunk, abandon, and Job-creation routes for an `uploadId` act only when the uploader's `sub` matches, or the viewer has All-Jobs Access; otherwise they answer 404.
- The uploader can delete their own Unfinished Upload (the client's cancel cleanup) while `activeUploads` still knows it, including right after `abandon`: abandoning marks the upload finished but keeps its uploader until it is deleted or becomes a Job.
- After a server restart an Unfinished Upload has no known uploader, and only Authors with All-Jobs Access see it in the Job List or can delete it.

**Client**
- At startup the client loads `/api/me` once.
- The header shows the `Avatar` `AccountMenu` dropdown on the right (hidden below `sm` in the editor, where sign-out stays reachable from the Job List), displaying the Author's name, email, access badge (`เห็นงานของทุกคน` + `กลุ่ม …` or `เห็นเฉพาะงานของตัวเอง`), and an `ออกจากระบบ` item that confirms unsaved edits before navigating to `/auth/logout`.
- One place in the client intercepts every `/api` response with status 401 and navigates the page to `/auth/login?returnTo=<current path and query>`. All existing callers (Job List, editor, save queue, polling, uploads) are covered without changing each one.
- When `allJobs` is true, the Job List adds an owner filter (`ทุกคน` / `งานของฉัน`), shows the "เจ้าของ" column on wide viewports (and stacks the owner email cleanly inside the title cell whenever the column hides), and includes the owner's email in search; when narrowed to `งานของฉัน`, the "เจ้าของ" column hides. Its other behaviour is unchanged.
- The "ไม่พบงานนี้" state for `/jobs/:jobId` also covers Jobs the Author may not open.

**Docs to update**
- API documentation: auth routes, `/api/me`, the 401 contract, and `owner_email` in the list response.
- System constraints: route protection, the access rule, and the session.
- README: setup, environment variables, Keycloak client settings, `.env.example`.
- AGENTS verification note: deleting now affects another Author's Job only with All-Jobs Access.

## Testing Decisions

- A good test exercises behaviour through a public boundary: an HTTP request with or without a session, or a page in the browser with mocked API routes. It asserts what the Author would see (status codes, which Jobs come back, what the page shows), not internal helpers.
- **Seam 1, the server's HTTP boundary (main seam).** Extend the existing integration tests that spawn the real server against a temporary data directory (prior art: the job storage and HTTP boundary integration tests). The tests start the server with test values for every required sign-in setting. They create signed-in requests by sealing a session with the server's own session-sealing function and the same test `SESSION_SECRET`, so no Keycloak is needed. Cover:
  - 401 without a session on protected routes, and `/api/config` still public
  - `/api/me` for an Author and for one with All-Jobs Access
  - the list filtered to own Jobs versus all Jobs, with `owner_email`
  - 404 on every `:jobId` route for another Author's Job and for a Job with no Job Owner
  - All-Jobs Access acting on any Job
  - new Jobs recording their Job Owner from the session
  - Unfinished Upload visibility and deletion by the uploader versus others
  - a tampered or expired cookie counting as signed out
  - startup refusing to run without the required settings
  - the page-navigation redirect to `/auth/login` with `returnTo`
- **Seam 2, the Job store.** Extend the existing store tests for the new migration: a database at the previous version upgrades and keeps its Jobs with no owner, a save keeps the owner, the owner email updates for a `sub`, and owner filtering works.
- **Seam 3, browser tests with mocked API.** Extend the existing scripts under the browser tests to mock `/api/me`. Add cases for:
  - the owner column, owner filter (`ทุกคน` / `งานของฉัน`), and owner-email search appearing only with `allJobs`
  - a 401 from any API sending the page to `/auth/login?returnTo=…`
  - the `AccountMenu` showing name, email, access badge/groups, and sign-out (including unsaved-edits confirmation)
- The real Keycloak round trip (sign-in, callback, sign-out) is checked by hand against `envisio-dev`, not automated.

## Out of Scope

- Roles beyond All-Jobs Access, any difference between admin and supervisor, and read-only access.
- Transferring Job ownership, or sharing a Job with specific Authors.
- Assigning existing Jobs to an owner (they stay without a Job Owner).
- Refresh tokens, re-checking Keycloak during a session, or revoking one Author's session before it expires (rotate `SESSION_SECRET` instead).
- A sign-in page inside the SPA, or a sign-in bypass for development or tests.
- Keeping an Unfinished Upload's uploader across server restarts.
- Preventing two people from editing the same Job at once (still last write wins, per ADR-0003).

## Further Notes

- On `envisio-dev`, register the redirect URI `http://localhost:3003/auth/callback` and the post-logout redirect URI `http://localhost:3003/` for local development, plus the production equivalents. Keep client authentication off (public client) and keep the Group Membership mapper that puts `groups` in the token.
- `SESSION_SECRET` goes only in `.env`. Never commit them, never put them in examples or logs.
- The discovery document does not list `groups` in `claims_supported`, which is normal for a mapper claim. Confirm on the first real sign-in that `groups` arrives in the token.
