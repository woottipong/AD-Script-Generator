# AD Script Generator

Automated Thai Audio Description authoring workspace that detects non-speech gaps in video, generates Thai narration scripts, and lets authors review and adjust spot timing before exporting SRT.

## Language

**Speech Segment**:
A contiguous time interval in the video where human speech is detected.
_Avoid_: Voice block, dialogue track

**Non-Speech Gap**:
A contiguous interval without detected speech that bounds where an AD Spot may legally sit without overlapping dialogue.
_Avoid_: Silence, empty space, gap window

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
