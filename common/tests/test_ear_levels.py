import random
from itertools import pairwise

import pytest

from chordb_common import ear
from chordb_common.models import Quality


@pytest.mark.parametrize("number", range(1, ear.LEVEL_COUNT + 1))
def test_generator_over_a_thousand_runs(number):
    lv = ear.level(number)
    pool = {ear.item_id(item) for item in lv.pool}
    rand = random.Random(number)
    for _ in range(1000):
        qs = ear.make_questions(number, rand)
        assert len(qs) == ear.QUESTIONS
        played = [ear.item_id(ear.parse_id(",".join(f"{r}:{q}" for r, q in x["chords"]))) for x in qs]
        assert all(a != b for a, b in pairwise(played)), played  # no repeat in a row
        assert set(played) == pool  # every chord of the pool comes up
        for q, p in zip(qs, played, strict=True):
            assert q["answer"] in q["options"]
            assert len(set(q["options"])) == len(q["options"])
            if lv.kind == "quality":
                assert sorted(q["options"]) == ["maj", "min"]
            else:
                assert q["answer"] == p
                assert len(q["options"]) == min(ear.OPTIONS, len(lv.pool) if lv.kind == "chord" else 4)
            if lv.kind == "chord":
                assert set(q["options"]) <= pool  # wrong options come from the level's pool


def test_options_are_shuffled():
    rand = random.Random(1)
    positions = {q["options"].index(q["answer"]) for _ in range(50) for q in ear.make_questions(4, rand)}
    assert positions == {0, 1, 2, 3}


def test_look_alikes_are_offered():
    rand = random.Random(2)
    am = ear.item_id((ear.chord("Am"),))
    c = ear.item_id((ear.chord("C"),))
    with_am = [q for _ in range(100) for q in ear.make_questions(4, rand) if q["answer"] == am]
    assert sum(c in q["options"] for q in with_am) > len(with_am) / 3


def test_barre_voicings():
    # Barre fret = the lowest fret held across the strings.
    frets = {n: min(f for f in ear.VOICINGS[ear.chord(n)] if f > 0) for n in
             ("F", "Bm", "F#m", "B", "Bb", "C#m", "Gm")}
    assert frets == {"F": 1, "Bm": 2, "F#m": 2, "B": 2, "Bb": 1, "C#m": 4, "Gm": 3}


def test_ids_round_trip():
    item = ear.level(8).pool[0]
    assert ear.parse_id(ear.item_id(item)) == item
    assert ear.parse_id("maj") == ()
    assert ear.contrast("maj", ((9, Quality.MINOR),)) == ((9, Quality.MAJOR),)
