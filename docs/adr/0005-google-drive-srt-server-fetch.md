---
status: accepted
---

# Fetch public Google Drive SRT files through the Express server instead of the browser

Authors in Review Mode can paste a public Google Drive link to an `.srt` file in addition to selecting or dropping a local file. The browser cannot read Google Drive share links directly because `drive.google.com` and `drive.usercontent.google.com` do not send permissive CORS headers, and Drive's download responses return the original file name (often UTF-8 Thai via RFC 5987 `filename*`) in `Content-Disposition` and signal private/unshared files via redirects to `accounts.google.com` or `text/html` interstitial pages. Fetching through `POST /api/review/fetch-srt` behind the session auth gate lets the server extract the file ID, request `drive.usercontent.google.com/download?id=…&export=download` with manual redirects, enforce a strict host allowlist, and classify permission, missing-file, size, and SRT syntax errors into actionable Thai messages before returning UTF-8 text and cue counts to Review Intake.

## Considered Options

- **Direct browser `fetch` to Google Drive URLs**: rejected; blocked by CORS and cannot inspect redirect targets (`accounts.google.com`) or `Content-Disposition` cross-origin.
- **Generic open URL proxy (`POST /api/review/fetch-srt` accepting any `http(s)` URL)**: rejected; turns the authenticated server into an arbitrary SSRF vector against internal/metadata networks.
- **Google Drive Picker / OAuth per Author**: rejected; adds Google Cloud OAuth consent, token storage, and client configuration beyond the team's public-link workflow.

## Consequences

- Only `http(s)` links on `drive.google.com` and `drive.usercontent.google.com` with valid file IDs (`/file/d/<id>`, `/open?id=`, `/uc?id=`, `/download?id=`) are accepted, and redirects are followed manually (at most 2 hops) strictly to `https:` hosts in `{drive.google.com, drive.usercontent.google.com, *.googleusercontent.com}`.
- Downloads are capped at 5 MiB (`GOOGLE_DRIVE_SRT_MAX_BYTES`), timed out at 15 seconds, decoded with UTF-8/Windows-874 fallback, and validated with `parseSrt` before the response returns to the browser.
- The `.srt` file must be shared as "Anyone with the link" ("ทุกคนที่มีลิงก์") on Google Drive; private Drive files are rejected cleanly with guidance instead of prompting for Google login.
- Review Mode's no-video-upload boundary ([ADR-0002](0002-job-mode-and-video-source.md)) stays intact: only the small `.srt` text file is fetched server-side, while the video continues to play and scan locally or from its direct CORS `.mp4` URL.
