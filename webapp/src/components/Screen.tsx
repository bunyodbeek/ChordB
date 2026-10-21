// Every screen's frame (the v2 designs): an 80px white app bar with the title, then a
// body that fills the rest. Bodies don't scroll as a page; lists scroll inside themselves.
import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  sub?: ReactNode; // a second line under the title (the player's artist)
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  after?: ReactNode; // below the body, e.g. the player bar
}

export function Screen({ title, sub, right, className = "", bodyClassName = "", children, after }: Props) {
  return (
    <div className={`screen ${className}`}>
      <header className="app-bar">
        <div className="app-bar-title">
          <h1>{title}</h1>
          {sub && <span className="app-bar-sub">{sub}</span>}
        </div>
        {right && <div className="app-bar-side">{right}</div>}
      </header>
      <div className={`screen-body ${bodyClassName}`}>{children}</div>
      {after}
    </div>
  );
}
