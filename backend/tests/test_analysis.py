import shutil

import numpy as np
import pytest
import soundfile as sf

from app.analysis import audio
from app.analysis.audio import SAMPLE_RATE, AnalysisError, load_audio
from app.analysis.decode import (
    KK_MAJOR,
    KK_MINOR,
    N_STATE,
    DecodeConfig,
    Key,
    Segment,
    chord_state,
    decode,
    diatonic_states,
    emissions,
    estimate_key,
    merge_segments,
    similarities,
    state_chord,
    templates,
    viterbi,
)
from app.analysis.engine import decode_features, extract_features, fill_gaps
from app.analysis.evaluate import accuracy, ground_truth_beats, reduce_symbol
from app.analysis.synth import DEMO, render
from chordb_common.models import Quality

MAJ, MIN = Quality.MAJOR, Quality.MINOR


def chroma_of(*pcs: int) -> np.ndarray:
    c = np.zeros(12)
    c[[p % 12 for p in pcs]] = 1
    return c


def triad(root: int, quality: Quality) -> np.ndarray:
    return chroma_of(root, root + (4 if quality == MAJ else 3), root + 7)


# --- templates -------------------------------------------------------------------


def test_templates_are_unit_vectors_with_flat_n():
    t = templates()
    assert t.shape == (25, 12)
    np.testing.assert_allclose(np.linalg.norm(t, axis=1), 1)
    np.testing.assert_allclose(t[N_STATE], np.full(12, 1 / np.sqrt(12)))


@pytest.mark.parametrize("root", range(12))
@pytest.mark.parametrize("quality", [MAJ, MIN])
def test_each_triad_matches_its_own_template(root, quality):
    sim = similarities(triad(root, quality)[:, None], n_weight=0.85)[:, 0]
    assert int(np.argmax(sim)) == chord_state(root, quality)
    assert sim[chord_state(root, quality)] == pytest.approx(1.0)
    assert state_chord(chord_state(root, quality)) == (root, quality)


def test_flat_chroma_is_no_chord():
    sim = similarities(np.ones((12, 1)), n_weight=0.85)[:, 0]
    assert int(np.argmax(sim)) == N_STATE
    assert state_chord(N_STATE) is None


# --- key estimation ----------------------------------------------------------------


@pytest.mark.parametrize("root", range(12))
def test_key_profiles_rotate(root):
    major = estimate_key(np.roll(KK_MAJOR, root))
    minor = estimate_key(np.roll(KK_MINOR, root))
    assert (major.root, major.quality) == (root, MAJ)
    assert (minor.root, minor.quality) == (root, MIN)


def test_key_from_chord_progressions():
    g = 7  # G - C - D - G
    prog = triad(g, MAJ) * 2 + triad(g + 5, MAJ) + triad(g + 7, MAJ) + chroma_of(g + 4, g + 11)
    key = estimate_key(prog)
    assert (key.root, key.quality) == (g, MAJ)

    e = 4  # Em - Am - B - Em
    prog = triad(e, MIN) * 2 + triad(e + 5, MIN) + triad(e + 7, MAJ) + chroma_of(e, e + 7)
    key = estimate_key(prog)
    assert (key.root, key.quality) == (e, MIN)


def test_diatonic_chords():
    c_major = diatonic_states(Key(0, MAJ, 1))
    assert c_major == {chord_state(r, q) for r, q in
                       [(0, MAJ), (2, MIN), (4, MIN), (5, MAJ), (7, MAJ), (9, MIN)]}
    a_minor = diatonic_states(Key(9, MIN, 1))
    assert chord_state(4, MAJ) in a_minor  # harmonic-minor V: E in Am
    assert chord_state(4, MIN) in a_minor
    assert {chord_state(0, MAJ), chord_state(5, MAJ), chord_state(7, MAJ)} <= a_minor
    assert chord_state(2, MAJ) not in a_minor


# --- key prior ---------------------------------------------------------------------


def test_key_prior_breaks_ties_toward_the_key():
    # C E G B: exactly as close to C as to Em.
    chroma = chroma_of(0, 4, 7, 11)[:, None]
    sim = similarities(chroma, n_weight=0.85)
    quiet = np.zeros(1, dtype=bool)
    cfg = DecodeConfig()
    c, em = chord_state(0, MAJ), chord_state(4, MIN)

    in_f = emissions(sim, quiet, Key(5, MAJ, 1), cfg)[:, 0]  # F major: C is V, Em is outside
    in_d = emissions(sim, quiet, Key(2, MAJ, 1), cfg)[:, 0]  # D major: Em is ii, C is outside
    assert np.argmax(in_f) == c
    assert np.argmax(in_d) == em
    assert in_f[c] / in_f[em] == pytest.approx(cfg.key_boost / cfg.non_diatonic)

    flat = emissions(sim, quiet, None, cfg)[:, 0]
    assert flat[c] == pytest.approx(flat[em])
    np.testing.assert_allclose(emissions(sim, quiet, Key(5, MAJ, 1), cfg).sum(axis=0), 1)


def test_quiet_beats_are_no_chord():
    chroma = np.stack([triad(9, MIN)] * 3, axis=1)
    quiet = np.array([False, True, False])
    p = emissions(similarities(chroma, 0.85), quiet, None, DecodeConfig())
    assert np.argmax(p[:, 1]) == N_STATE
    assert np.argmax(p[:, 0]) == chord_state(9, MIN)


# --- smoothing and merging ----------------------------------------------------------


def test_viterbi_smooths_a_one_beat_glitch():
    # One ambiguous beat (C E G plus a strong A) leans to C inside a run of Am.
    am, glitch = triad(9, MIN), triad(0, MAJ) + 0.8 * chroma_of(9)
    chroma = np.stack([am] * 4 + [glitch] + [am] * 4, axis=1)
    cfg = DecodeConfig()
    prob = emissions(similarities(chroma, cfg.n_weight), np.zeros(9, bool), None, cfg)
    assert np.argmax(prob[:, 4]) == chord_state(0, MAJ)
    assert set(viterbi(prob, cfg.self_transition)) == {chord_state(9, MIN)}
    # With no stickiness the glitch survives.
    assert chord_state(0, MAJ) in set(viterbi(prob, 1 / 25))


def seg(a, b, state, conf=1.0):
    return Segment(a, b, state, conf)


def test_merge_joins_equal_neighbours():
    am, f = chord_state(9, MIN), chord_state(5, MAJ)
    out = merge_segments([seg(0, 1, am, 1.0), seg(1, 2, am, 0.5), seg(2, 3, f)], 0.9)
    assert [(s.start_sec, s.end_sec, s.state) for s in out] == [(0, 2, am), (2, 3, f)]
    assert out[0].confidence == pytest.approx(0.75)


def test_merge_drops_short_segments():
    am, g, c = chord_state(9, MIN), chord_state(7, MAJ), chord_state(0, MAJ)
    # A short G between two Am becomes one Am.
    out = merge_segments([seg(0, 2, am), seg(2, 2.3, g), seg(2.3, 4, am)], 0.5)
    assert [(s.start_sec, s.end_sec, s.state) for s in out] == [(0, 4, am)]
    # A short first segment goes to the next one; a short one elsewhere to the previous.
    out = merge_segments([seg(0, 0.2, g), seg(0.2, 2, c), seg(2, 2.1, am), seg(2.1, 4, g)], 0.5)
    assert [(s.start_sec, s.end_sec, s.state) for s in out] == [(0, 2.1, c), (2.1, 4, g)]
    # Long segments are never touched.
    segs = [seg(0, 1, am), seg(1, 2, g)]
    assert [(s.start_sec, s.end_sec) for s in merge_segments(segs, 1.0)] == [(0, 1), (1, 2)]


def test_decode_empty():
    assert decode(np.zeros((12, 0)), np.zeros(0, bool), np.zeros(1), None, DecodeConfig(), 0.5) == []


def test_fill_gaps_pads_intro_breaks_and_outro():
    beats = np.array([40, 50, 60, 70, 100, 110])
    out = fill_gaps(beats, 140)
    assert list(out) == [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130]


# --- whole engine on a synthetic song ---------------------------------------------------


@pytest.fixture(scope="module")
def demo_features():
    return extract_features(render(DEMO), SAMPLE_RATE)


def test_engine_on_synthetic_song(demo_features):
    result = decode_features(demo_features)
    assert (result.key.root, result.key.quality) == (9, MIN)
    assert result.bpm == pytest.approx(DEMO["bpm"], abs=3)
    assert accuracy(result.segments, ground_truth_beats(DEMO)) >= 0.9
    assert accuracy(decode_features(demo_features, DecodeConfig().without_key_prior()).segments,
                    ground_truth_beats(DEMO)) >= 0.9

    data = result.to_json()
    assert data["key"]["quality"] == "min"
    events = data["events"]
    assert events[0]["start_sec"] == 0 and events[-1]["end_sec"] == data["duration_sec"]
    assert all(a["end_sec"] == b["start_sec"] for a, b in zip(events, events[1:]))
    assert all(a["chord"] != b["chord"] for a, b in zip(events, events[1:]))
    assert events[-1]["chord"] is None  # the final "N" bar
    assert {"root": 9, "quality": "min"} in [e["chord"] for e in events]
    assert all(0 <= e["confidence"] <= 1 for e in events)


def test_silence_is_rejected_or_no_chord():
    result = decode_features(extract_features(np.zeros(SAMPLE_RATE * 3, np.float32)))
    assert result.key is None
    assert all(s.state == N_STATE for s in result.segments)


def test_too_short():
    with pytest.raises(AnalysisError) as e:
        extract_features(np.zeros(100, np.float32))
    assert e.value.code == "too_short"


# --- evaluation helpers ------------------------------------------------------------------


def test_reduce_symbol():
    assert reduce_symbol("G7") == chord_state(7, MAJ)
    assert reduce_symbol("Bm7") == chord_state(11, MIN)
    assert reduce_symbol("Bbmaj7") == chord_state(10, MAJ)
    assert reduce_symbol("N") == N_STATE
    assert reduce_symbol("Csus4") is None


def test_ground_truth_beats_and_accuracy():
    spec = {"bpm": 120, "offset_sec": 1.0, "sections": [{"bars": ["Am", "C G"]}]}
    beats = ground_truth_beats(spec)
    assert len(beats) == 8
    assert beats[0].start_sec == 1.0 and beats[1].start_sec == 1.5
    assert [b.state for b in beats[4:]] == [chord_state(0, MAJ)] * 2 + [chord_state(7, MAJ)] * 2

    am, c, g = chord_state(9, MIN), chord_state(0, MAJ), chord_state(7, MAJ)
    perfect = [seg(0, 3, am), seg(3, 4, c), seg(4, 5, g)]
    assert accuracy(perfect, beats) == 1.0
    assert accuracy([seg(0, 5, am)], beats) == 0.5


# --- audio decoding ---------------------------------------------------------------------


def test_load_audio_errors(tmp_path, monkeypatch):
    with pytest.raises(AnalysisError) as e:
        load_audio(tmp_path / "missing.mp3")
    assert e.value.code == "not_found"

    f = tmp_path / "long.mp3"
    f.write_bytes(b"x")
    monkeypatch.setattr(audio, "probe_duration", lambda _p: 601.0)
    with pytest.raises(AnalysisError) as e:
        load_audio(f)
    assert e.value.code == "too_long"

    monkeypatch.setattr(audio, "probe_duration", lambda _p: None)
    monkeypatch.setattr(audio.shutil, "which", lambda _name: None)
    with pytest.raises(AnalysisError) as e:
        load_audio(f)
    assert e.value.code == "ffmpeg_missing"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_load_audio_with_ffmpeg(tmp_path):
    src = tmp_path / "in.wav"
    sf.write(src, np.zeros((44100 * 2, 2), np.float32), 44100)  # 2 s stereo 44.1 kHz
    y = load_audio(src)
    assert y.ndim == 1
    assert abs(len(y) - 2 * SAMPLE_RATE) < SAMPLE_RATE * 0.05

    with pytest.raises(AnalysisError) as e:
        load_audio(src, max_duration=1)
    assert e.value.code == "too_long"

    bad = tmp_path / "bad.mp3"
    bad.write_bytes(b"not audio at all")
    with pytest.raises(AnalysisError) as e:
        load_audio(bad)
    assert e.value.code == "decode_failed"
