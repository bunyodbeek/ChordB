// Mashq tab. Stage 1: a placeholder until the practice games land.
import { t } from "../texts";
import { Screen } from "./Screen";

export function Practice() {
  return (
    <Screen title={t.tabs.practice} bodyClassName="center-body">
      <p className="soon">{t.soon}</p>
    </Screen>
  );
}
