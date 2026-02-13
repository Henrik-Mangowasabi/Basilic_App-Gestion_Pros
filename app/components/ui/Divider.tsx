import React from "react";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function Divider({ orientation = "horizontal", className = "" }: DividerProps) {
  const dividerClass = [
    "ui-divider",
    `ui-divider--${orientation}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <hr
      className={dividerClass}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
