// Kapo va Ton — one bottom sheet for both buttons: each capo 0–7 with the shapes it
// gives ("Eng oson" marked, never applied on its own), the key a semitone at a time,
// and "Oddiy akkordlar". Below: the down-tuning choice and, for admins, the editor.
import type { CapoOption } from "../../harmony";
import type { NotationKind } from "../../notation";
import { haptic } from "../../telegram";
import { t } from "../../texts";
import { presetById, presetForShift, stringName, type PresetId } from "../../tuning";

const SHAPES_SHOWN = 6;

export function CapoKeySheet({
  notation,
  options,
  easiest,
  songCapo,
  capo,
  onCapo,
  shift,
  onShift,
  keyName,
  simple,
  onSimple,
  shapeName,
  alt,
  useAlt,
  onUseAlt,
  onOpenTuner,
  onEdit,
  onClose,
}: {
  notation: NotationKind;
  options: CapoOption[];
  easiest: number | null;
  songCapo: number; // the song's own (catalog songs are written with one)
  capo: number;
  onCapo: (capo: number) => void;
  shift: number;
  onShift: (shift: number) => void;
  keyName: string | null; // the key as it sounds now, e.g. "C#m"
  simple: boolean;
  onSimple: (on: boolean) => void;
  shapeName: (option: CapoOption, i: number) => string;
  alt: { name: string; shift: number } | null | undefined;
  useAlt: boolean;
  onUseAlt: (on: boolean) => void;
  onOpenTuner?: (preset: PresetId) => void;
  onEdit?: () => void;
  onClose: () => void;
}) {
  const preset = alt ? presetForShift(alt.shift) : null;
  const presetNotes = (id: PresetId) => {
    const p = presetById(id);
    return p.strings.map((s) => stringName(s.pc, notation, p.flat)).join(" ");
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet player-sheet capo-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.player.capoKeyTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <h2 className="capo-sheet-title">{t.player.capoKeyTitle}</h2>

        <div className="sheet-block">
          <span className="card-label">{t.player.capoLabel}</span>
          <div className="capo-list" role="radiogroup" aria-label={t.player.capoLabel}>
            {options.map((o) => (
              <button
                key={o.capo}
                type="button"
                role="radio"
                aria-checked={o.capo === capo}
                className="capo-option"
                onClick={() => {
                  haptic.tap();
                  onCapo(o.capo);
                }}
              >
                <span className="capo-option-head">
                  <span className="capo-option-name">{t.player.capoRow(o.capo)}</span>
                  {o.capo === songCapo && songCapo > 0 && <span className="capo-tag">{t.player.songCapo}</span>}
                  {o.capo === easiest && <span className="capo-tag easy">{t.player.easiest}</span>}
                </span>
                <span className="capo-option-shapes mono">
                  {o.shapes
                    .slice(0, SHAPES_SHOWN)
                    .map((_, i) => shapeName(o, i))
                    .join(" ")}
                  {o.shapes.length > SHAPES_SHOWN ? " …" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="sheet-block">
          <div className="sheet-row">
            <span className="card-label">{t.player.keyLabel}</span>
            <div className="ton key-stepper">
              <button type="button" aria-label={t.player.keyDown} onClick={() => onShift(shift - 1)}>
                ▼
              </button>
              <span className="key-now">
                <span className="mono">{keyName ?? (shift === 0 ? "0" : t.player.keyShift(shift))}</span>
                <span className="key-sub">{shift === 0 ? t.player.originalKey : t.player.keyShift(shift)}</span>
              </span>
              <button type="button" aria-label={t.player.keyUp} onClick={() => onShift(shift + 1)}>
                ▲
              </button>
            </div>
          </div>
          <span className="key-note">{t.player.keyNote}</span>
        </div>

        <label className="sheet-row simple-row">
          <span>
            <span className="card-label">{t.player.simple}</span>
            <span className="muted small simple-sub">{t.player.simpleSub}</span>
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={simple}
            onChange={(e) => {
              haptic.tap();
              onSimple(e.target.checked);
            }}
          />
        </label>

        {alt && (
          <div className="sheet-block">
            <span className="card-label">{t.player.tuningLabel}</span>
            <div className="segmented wide" role="group" aria-label={t.player.tuningLabel}>
              <button type="button" className={useAlt ? "" : "selected"} aria-pressed={!useAlt} onClick={() => onUseAlt(false)}>
                {t.player.standardTuning}
              </button>
              <button type="button" className={useAlt ? "selected" : ""} aria-pressed={useAlt} onClick={() => onUseAlt(true)}>
                {t.player.altTuning(alt.shift)}
              </button>
            </div>
            {useAlt && preset && (
              <div className="tuning-hint">
                <span className="mono">{presetNotes(preset)}</span>
                {onOpenTuner && (
                  <button type="button" className="control small" onClick={() => onOpenTuner(preset)}>
                    {t.player.openTuner}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {onEdit && (
          <button type="button" className="button wide secondary" onClick={onEdit}>
            {t.player.edit}
          </button>
        )}
      </div>
    </div>
  );
}
