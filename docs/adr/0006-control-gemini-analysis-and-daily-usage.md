---
status: accepted
---

# Control Gemini analysis and daily usage

Envisio asks Authors to confirm potential costs and video transfer to Gemini each time they choose to start or resume analysis. Only members of the Keycloak `admin` and `supervisor` groups may do so for Jobs they can access. This permission is independent of All-Jobs Access. The daily limit starts at three distinct Jobs per Author per Thailand calendar day and is configurable by deployment. A reservation is charged when the server admits analysis and is kept through retries, stops, restarts, and deletion of the Job. Starting or resuming the same Job with the same account on the same day uses the same reservation.

An authorized Author can stop analysis for a Job they can access, regardless of who started it. Stop is recorded with the requesting Author. An in-flight Gemini request may finish and incur charges. Envisio keeps a successful result from that request, skips further batches and retries, and attempts to delete the Gemini file. The Envisio copy remains available. Authors can edit completed batches and export partial SRT with a warning. Resuming requires renewed confirmation and processes only unfinished batches.
