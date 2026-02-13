import * as React from "react";

// ============================================
// TYPES
// ============================================

type ButtonVariant = "solid" | "flat" | "light" | "ghost" | "bordered";
type ButtonColor = "default" | "primary" | "secondary" | "success" | "warning" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color" | "variant"> {
    children?: React.ReactNode;
    variant?: ButtonVariant;
    color?: ButtonColor;
    size?: ButtonSize;
    isIconOnly?: boolean;
    isLoading?: boolean;
    isDisabled?: boolean;
    startContent?: React.ReactNode;
    endContent?: React.ReactNode;
    onPress?: () => void;
}

// ============================================
// COMPONENT
// ============================================

export function Button({
    children,
    variant = "solid",
    color = "default",
    size = "md",
    isIconOnly = false,
    isLoading = false,
    isDisabled = false,
    startContent,
    endContent,
    onPress,
    onClick,
    className = "",
    type = "button",
    ...props
}: ButtonProps) {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (isLoading || isDisabled) return;
        onPress?.();
        onClick?.(e);
    };

    const variantClass = `ui-btn--${variant}`;
    const colorClass = `ui-btn--${color}`;
    const sizeClass = `ui-btn--${size}`;

    return (
        <button
            type={type}
            className={`ui-btn ${variantClass} ${colorClass} ${sizeClass} ${isIconOnly ? "ui-btn--icon-only" : ""} ${isLoading ? "ui-btn--loading" : ""} ${isDisabled ? "ui-btn--disabled" : ""} ${className}`}
            onClick={handleClick}
            disabled={isDisabled || isLoading}
            {...props}
        >
            {isLoading && (
                <span className="ui-btn__spinner">
                    <svg className="ui-btn__spinner-icon" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="32">
                            <animate attributeName="stroke-dashoffset" values="32;0" dur="0.8s" repeatCount="indefinite" />
                            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                        </circle>
                    </svg>
                </span>
            )}
            {!isLoading && startContent && (
                <span className="ui-btn__start">{startContent}</span>
            )}
            {children && <span className="ui-btn__content">{children}</span>}
            {!isLoading && endContent && (
                <span className="ui-btn__end">{endContent}</span>
            )}
        </button>
    );
}

// ============================================
// EXPORTS
// ============================================

export type { ButtonProps, ButtonVariant, ButtonColor, ButtonSize };
