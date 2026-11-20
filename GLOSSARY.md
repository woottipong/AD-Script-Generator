# AD Script Generator

Automated Thai Audio Description authoring workspace that detects non-speech gaps in video, generates Thai narration scripts, and lets authors review and adjust spot timing before exporting SRT.

## Language

**Speech Segment**:
A contiguous time interval in the video where human speech is detected.
_Avoid_: Voice block, dialogue track

**Non-Speech Gap**:
A contiguous interval without detected speech that bounds where an AD Spot may legally sit without overlapping dialogue.
_Avoid_: Silence, empty space, gap window

**Candidate Spot**:
A Non-Speech Gap at least as long as the VAD minimum AD gap (3,000 ms by default) that is offered for narration. Each one becomes an AD Spot when the Job is created.
_Avoid_: Slot, opening

**AD Spot**:
A single narration placement inside a Non-Speech Gap with a start time, end time, narration decision (`generate`, `skip`, or `pending`), and Thai script text.
_Avoid_: Subtitle, caption block, clip

**Waveform Envelope**:
A visual amplitude representation of the video's audio track aligned with the timeline so authors can judge real loudness against detected Speech Segments.
_Avoid_: Audio graph, sound bar, equalizer

**Trim**:
Adjusting an AD Spot's start or end edge independently to shorten or lengthen its duration within its Non-Speech Gap.
_Avoid_: Resize, stretch, crop

**Move**:
Shifting an entire AD Spot earlier or later along the timeline while preserving its duration, bounded by its Non-Speech Gap.
_Avoid_: Drag, slide, pan

**Job**:
One video's persisted authoring work: video metadata, VAD output, Analysis Batches, and AD Spots, stored under `.data/jobs/<job_id>/`. One Job is active at a time.
_Avoid_: Project, session, task

**Analysis Batch**:
A 240-second slice of the timeline whose Candidate Spots Gemini analyses in one request, read with 20 seconds of context before and 10 seconds after.
_Avoid_: Chunk, window
