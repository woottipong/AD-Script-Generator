# Issue tracker: Local Markdown

Store issues and specs in `.scratch/`, with one directory per feature or effort.

## Specs and tickets

- Spec: `.scratch/<feature-slug>/spec.md`.
- Implementation tickets: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, one file per ticket, numbered from `01`.
- Record triage state in a `Status:` line near the top of each issue; see `triage-labels.md` for the role strings.
- Append discussion under `## Comments` at the end of the issue.

When a skill says to publish to the tracker, create the appropriate file, including parent directories. To fetch a ticket, read the referenced path; if only a number is supplied, identify the feature before selecting a file.

## Wayfinding

- Map: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far, and Fog.
- Child tickets: `.scratch/<effort>/issues/<NN>-<slug>.md`, with the question in the body and a `Type:` of `research`, `prototype`, `grilling`, or `task`.
- Record dependencies near the top as `Blocked by: NN, NN`. A ticket is unblocked when every listed ticket is resolved.
- Find the frontier by scanning for open, unblocked, unclaimed tickets; select the lowest number.
- Claim a ticket by setting `Status: claimed` and saving it before work.
- Resolve it by appending the answer under `## Answer`, setting `Status: resolved`, and adding a gist and link to the map's Decisions-so-far.
