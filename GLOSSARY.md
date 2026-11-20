# AD Script Generator

Thai Audio Description authoring workspace. Authors either generate a new Thai narration script for a video or review an existing SRT script against its video, then adjust text and timing and export SRT.

## Language

**Generate Mode**:
The workflow that finds Candidate Spots in a video and has Gemini write a new narration script for them.
_Avoid_: Create mode, AI mode

**Review Mode**:
The workflow that opens an existing video and its existing SRT script so the author can check and correct the AD Spots against the audio, with no script generation.
_Avoid_: Edit mode, import mode, SRT mode

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
A single narration placement with a start time, end time, narration decision (`generate`, `skip`, or `pending`), and Thai script text. In Generate Mode it sits inside a Non-Speech Gap; in Review Mode it may overlap a Speech Segment, which is flagged rather than forbidden.
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
