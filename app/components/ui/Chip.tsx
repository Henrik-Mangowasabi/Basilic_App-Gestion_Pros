import React from "react";

export type ChipColor = "default" | "primary" | "secondary" | "success" | "warning" | "danger";
export type ChipSize = "sm" | "md" | "lg";
export type ChipVariant = "solid" | "bordered" | "light" | "flat" | "faded" | "shadow" | "dot";

export interface ChipProps {
  children?: React.ReactNode;
  color?: ChipColor;
  size?: ChipSize;
  variant?: ChipVariant;
  radius?: "none" | "sm" | "md" | "lg" | "full";
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
  avatar?: React.ReactNode;
  isDisabled?: boolean;
  onClose?: () => void;
  className?: string;
  classNames?: {
    base?: string;
    content?: string;
    dot?: string;
    avatar?: string;
    closeButton?: string;
  };
}

export function Chip({
  children,
  color = "default",
  size = "md",
  variant = "solid",
  radius = "full",
  startContent,
  endContent,
  avatar,
  isDisabled = false,
  onClose,
  className = "",
  classNames = {},
}: ChipProps) {
  const baseClass = [
    "ui-chip",
    `ui-chip--${color}`,
    `ui-chip--${size}`,
    `ui-chip--${variant}`,
    `ui-chip--radius-${radius}`,
    isDisabled ? "ui-chip--disabled" : "",
    classNames.base || "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={baseClass}>
      {variant === "dot" && (
        <span className={`ui-chip__dot ui-chip__dot--${color} ${classNames.dot || ""}`} />
      )}
      {avatar && (
        <span className={`ui-chip__avatar ${classNames.avatar || ""}`}>{avatar}</span>
      )}
      {startContent && <span className="ui-chip__start">{startContent}</span>}
      <span className={`ui-chip__content ${classNames.content || ""}`}>{children}</span>
      {endContent && <span className="ui-chip__end">{endContent}</span>}
      {onClose && (
        <button
          type="button"
          className={`ui-chip__close ${classNames.closeButton || ""}`}
          onClick={onClose}
          disabled={isDisabled}
          aria-label="Remove"
        >
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            height="1em"
            role="presentation"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            viewBox="0 0 24 24"
            width="1em"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
