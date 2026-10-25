"""Automatic chord detection (DSP only): see engine.py.

This module stays import-light (no librosa) so the API can read ENGINE_VERSION.
"""

# Bump whenever results would change: cached analyses are keyed on it.
# 1.1: explicit tuning, alt_tuning, suggested_capo
# 1.2: half-beat steps, bass chroma, beats moved back by the onset lag
ENGINE_VERSION = "1.2"


class AnalysisError(Exception):
    """A failure with a stable code the API returns (analyses.error_code) and logs.

    Codes: not_found, ffmpeg_missing, decode_failed, too_long, too_short,
    timeout, crashed, interrupted, unknown (plus the YouTube ones from stage 3).
    """

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code
