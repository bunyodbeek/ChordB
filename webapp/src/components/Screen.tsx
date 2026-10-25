// Every screen's frame: the floating AppHeader, then a body that fills the rest. Bodies
// don't scroll as a page; lists scroll inside themselves.
import type { ReactNode } from "react";

import { AppHeader } from "./ui";

interface Props {
  title: ReactNode;
  sub?: ReactNode; // a second line under the title (the player's artist)
  onBack?: () => void; // an ichki sahifa: ← in the header
  lead?: ReactNode; // before the title (Asosiy: the logo)
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  after?: ReactNode; // below the body, e.g. the player bar
}

export function Screen({ title, sub, onBack, lead, right, className = "", bodyClassName = "", children, after }: Props) {
  return (
    <div className={`screen ${className}`}>
      <AppHeader title={title} sub={sub} onBack={onBack} lead={lead} right={right} />
      <div className={`screen-body ${bodyClassName}`}>{children}</div>
      {after}
    </div>
  );
}
