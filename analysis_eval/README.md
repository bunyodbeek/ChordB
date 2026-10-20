# Chord detection ground truth

One JSON file per song, in the song seed format, plus its audio file next to it.
Audio files are gitignored: copy your own recordings here.

```json
{
  "title": "Song title",
  "audio": "song.mp3",
  "bpm": 92,
  "offset_sec": 1.25,
  "beats_per_bar": 4,
  "sections": [
    {"title": "Kirish", "bars": ["Am", "F", "C", "G"]},
    {"title": "Kuplet", "bars": ["Am", "F", "C G", "N"]}
  ]
}
```

- `offset_sec`: the time of the first beat of the first bar. Find it in Audacity or the admin chord editor.
- A bar is one chord, or several separated by spaces that split the bar evenly. `N` means no chord.
- The song must keep a steady tempo; the ground-truth beats are `offset_sec + i * 60 / bpm`.

Run it from `backend/`:

```bash
uv run python -m app.analysis.synth ../analysis_eval     # synthetic_am.wav for the bundled JSON
uv run python -m app.analysis.evaluate                   # all songs here
uv run python -m app.analysis.evaluate --self-transition 0.9 --key-boost 2
```

Columns:

- `tune`: corrected tuning offset (cents).
- `alt`: detected down-tuning.
- `exact`: accuracy at sounding pitch.
- `best±2`: best accuracy over whole-song shifts of −2..+2, with the shift. When `exact` is low but `best±2` is high, the errors are only a tuning shift.
- `no prior`: exact accuracy without the key prior.

Write ground truth the way the chord sheet has it (as played). For a cover tuned a half step down, `best±2` then shows `(+1)`.
