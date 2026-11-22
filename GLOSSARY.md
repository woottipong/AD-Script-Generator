# TCC Envisio

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
Adjusting an AD Spot's start or end edge independently to shorten or lengthen its duration. In Generate Mode it is bounded by its Non-Speech Gap; in Review Mode it is bounded by video duration and neighboring spots, and any speech overlap is flagged.
_Avoid_: Resize, stretch, crop

**Move**:
Shifting an entire AD Spot earlier or later along the timeline while preserving its duration. In Generate Mode it is bounded by its Non-Speech Gap; in Review Mode it is bounded by video duration and neighboring spots, and any speech overlap is flagged.
_Avoid_: Drag, slide, pan

**Extended AD**:
Narration that runs longer than its AD Spot because playback pauses while it is read. Estimated speech longer than the spot is therefore informational, never an error.
_Avoid_: Overrun, overflow

**Author**:
A person signed in to Envisio who creates, edits, and exports Jobs.
_Avoid_: User, editor, member

**Job Owner**:
The Author who created a Job. Ownership never changes hands; a Job made before sign-in existed has no Job Owner.
_Avoid_: Creator, assignee

**All-Jobs Access**:
What an Author in the admin or supervisor group has: they see every Job, including ones with no Job Owner, and may do anything a Job Owner may do with it. Admin and supervisor do not differ.
_Avoid_: Admin rights, superuser

**Job**:
One video's persisted authoring work: its Job Title, Job Owner, video metadata, VAD output, Analysis Batches, and AD Spots. An Author reopens their own Jobs (or any Job, with All-Jobs Access) from the Job List; several Jobs can be open at once in different browser tabs.
_Avoid_: Project, session, task

**Job List**:
The landing view listing the Author's own Jobs, or every Job, Job Owner, and Unfinished Upload with All-Jobs Access (sorted most recently changed first by default, with search, mode filtering, and column sorting), from which an Author reopens or deletes one or starts a new Job.
_Avoid_: Dashboard, storage manager, history

**Unfinished Upload**:
A Generate Mode video copy whose upload never became a Job. It has no Job Owner, so it appears only in the Job List of Authors with All-Jobs Access, and only so it can be deleted.
_Avoid_: Orphan, partial job

**Job Title**:
The name authors know a Job by. It defaults to the video's file name without its extension (up to 120 characters) when the Job is created.
_Avoid_: Job name, label

**Analysis Batch**:
A 240-second slice of the timeline whose Candidate Spots Gemini analyses in one request, read with 20 seconds of context before and 10 seconds after.
_Avoid_: Chunk, window
