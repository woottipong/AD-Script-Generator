---
status: accepted
---

# Jobs record their mode and video source; only Generate Mode keeps a server video copy

A Job now carries `mode` (`generate` or `review`), a `video_source` discriminated by `kind` (`server_copy`, `url`, `local_file`), and a `schema_version`, because Jobs will later move into a database and be bound to logged-in users, and both Review Mode and Generate Mode Jobs must map onto the same tables. Generate Mode still uploads a server copy of the video because Gemini analysis and re-upload need it; Review Mode never sends the video to the server (it streams from the URL or reads the author's local file in the browser), so its Job stores only where the video came from.

## Considered Options

- **Server copy for every Job**: rejected because Review Mode needs no Gemini access and the copy would cost server disk for every reviewed video.
- **Infer the mode from the presence of batches or a local file path**: rejected because a database migration needs an explicit column, and the inference breaks as soon as Generate Mode accepts URLs.
- **Reserve an `owner_id` now**: deferred; the identity provider and ID format are unknown, and every existing Job needs an owner assigned during the database migration either way. `schema_version` marks which Jobs that migration must convert.

## Consequences

- Jobs without `schema_version` are read as version 1 Generate Mode Jobs with a `server_copy` source and are rewritten in the new shape on their next save.
- Reopening a Review Mode Job whose source is `local_file` requires the author to pick the same file again (matched by name and size).
