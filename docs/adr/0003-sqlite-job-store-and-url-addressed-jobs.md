---
status: accepted
---

# Jobs live in SQLite with VAD output as a file, and the URL picks the open Job

Job metadata, Analysis Batches, and AD Spots move from `job.json` files into one SQLite database (`.data/envisio.db`, opened with the built-in `node:sqlite`). Each Job's VAD output stays in its own write-once file, `.data/jobs/<job_id>/vad_output.json`, next to the Generate Mode video copy. The server no longer keeps an active Job: the Job List is the landing view and the editor opens the Job named in its URL (`/jobs/:jobId`), so several authors or tabs can work on different Jobs at once before login exists.

## Considered Options

- **VAD output as a database column**: rejected. VAD output is written once and is the largest part of a Job, while spots and status are rewritten on every save; keeping it out of the rows keeps saves and Job List queries small. The cost is a second write outside the transaction, so `load` treats a missing or corrupt VAD file as a missing Job.
- **Keep one server-wide active Job**: rejected because a second browser would take over the first author's Job.
- **Per-user active Job (`user_id` plus `user_active_jobs`)**: deferred to the login feature. Identity is not designed yet, and with Jobs addressed by URL nothing needs an active pointer now.
- **Migrate existing `job.json` Jobs**: rejected while the app is in development; `.data` is wiped instead.

## Consequences

- `GET /api/jobs/current` and the pointer-clearing role of `DELETE /api/jobs/:jobId` go away; deleting a Job is refused only while it is analysing or uploading.
- Saving spots is last-write-wins: two tabs editing one Job overwrite each other, and so does an edit saved while Gemini writes a later Analysis Batch. This is accepted until login scopes Jobs to their owner.
- Gemini analysis stays one Job at a time across the server; other authors get HTTP 409 until it finishes.
- When login arrives, reading Jobs goes through `store.list()` and `store.load()`, so ownership filtering is added there.
