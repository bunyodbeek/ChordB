// What the player remembers on this device: the strumming card toggle and, per song,
// the voicing picked for each chord. Storage can be missing or throw (private mode, a
// WebView with site data off): then nothing is remembered and the defaults hold.

const RHYTHM_KEY = "chordb.player.rhythm";
const VOICING_KEY = (song: string) => `chordb.voicing.${song}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered
  }
}

export const loadRhythm = (): boolean => read(RHYTHM_KEY) !== "off"; // on by default
export const storeRhythm = (on: boolean): void => write(RHYTHM_KEY, on ? "on" : "off");

/** "9:min" → the variant's index, for one song ("song:12", "analysis:5"). */
export type VoicingChoices = Record<string, number>;

export function loadVoicings(song: string): VoicingChoices {
  try {
    const v = JSON.parse(read(VOICING_KEY(song)) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as VoicingChoices) : {};
  } catch {
    return {};
  }
}

export const storeVoicings = (song: string, choices: VoicingChoices): void =>
  write(VOICING_KEY(song), JSON.stringify(choices));
