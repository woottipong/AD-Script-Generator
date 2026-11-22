---
status: accepted
---

# Keycloak sign-in through the server, with a one-week session cookie and Jobs owned by `sub`

Authors sign in with Keycloak (realm `rtt`, client `envisio-dev`) through the Express server as a public OIDC client protected by PKCE, and the server keeps the result in an encrypted httpOnly cookie instead of the browser holding bearer tokens. The video player loads `/api/jobs/:jobId/video` through `<video src>` and cancel cleanup uses `keepalive` requests, and neither can attach an `Authorization` header, while both send cookies. Each Job records its Job Owner by Keycloak `sub`, which never changes, plus the owner's email for display, because usernames are emails and can change. Members of the `admin` or `supervisor` groups (read from the token's groups claim, which the `rtt` realm's mapper names `group`) get All-Jobs Access; everyone else sees only Jobs they own. This settles the per-user ownership that [ADR-0003](0003-sqlite-job-store-and-url-addressed-jobs.md) deferred to login.

## Considered Options

- **`keycloak-js` in the SPA with bearer tokens**: rejected because `<video src>` and `keepalive` cleanup cannot send the token.
- **Owner by email**: rejected; an email change would detach the Author from their Jobs.
- **Refreshing tokens to re-check Keycloak during a session**: rejected as more than a small internal team needs.

## Consequences

- A session lasts one week from sign-in and is never re-checked with Keycloak, so disabling an Author or changing their groups takes effect at their next sign-in. Rotating `SESSION_SECRET` and restarting signs everyone out at once.
- Jobs created before sign-in have no Job Owner and are visible only with All-Jobs Access. Unfinished Uploads have no owner on disk either: the uploader may delete their own only while the server that took the upload is running.
- There is no sign-in bypass; local development signs in against a Keycloak client too.
