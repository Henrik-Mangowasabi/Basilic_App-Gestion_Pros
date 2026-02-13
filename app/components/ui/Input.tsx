import React, { forwardRef } from "react";

type InputSize = "sm" | "md" | "lg";
type InputVariant = "flat" | "bordered" | "faded";

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
    label?: string;
    size?: InputSize;
    variant?: InputVariant;
    startContent?: React.ReactNode;
    endContent?: React.ReactNode;
    isInvalid?: boolean;
    errorMessage?: string;
    isClearable?: boolean;
    onClear?: () => void;
    onValueChange?: (value: string) => void;
    classNames?: {
        base?: string;
        mainWrapper?: string;
        inputWrapper?: string;
        input?: string;
        label?: string;
    };
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
    label,
    size = "md",
    variant = "bordered",
    startContent,
    endContent,
    isInvalid = false,
    errorMessage,
    isClearable = false,
    onClear,
    onValueChange,
    onChange,
    value,
    className = "",
    classNames = {},
    ...props
}, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange?.(e);
        onValueChange?.(e.target.value);
    };

    const handleClear = () => {
        onClear?.();
        onValueChange?.("");
    };

    const sizeClass = `ui-input--${size}`;
    const variantClass = `ui-input--${variant}`;

    return (
        <div className={`ui-input ${sizeClass} ${variantClass} ${isInvalid ? "ui-input--invalid" : ""} ${classNames.base || ""} ${className}`}>
            {label && (
                <label className={`ui-input__label ${classNames.label || ""}`}>
                    {label}
                </label>
            )}
            <div className={`ui-input__wrapper ${classNames.inputWrapper || ""}`}>
                {startContent && (
                    <span className="ui-input__start">{startContent}</span>
                )}
                <input
                    ref={ref}
                    className={`ui-input__field ${classNames.input || ""}`}
                    value={value}
                    onChange={handleChange}
                    {...props}
                />
                {isClearable && value && (
                    <button
                        type="button"
                        className="ui-input__clear"
                        onClick={handleClear}
                        aria-label="Clear input"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                )}
                {endContent && (
                    <span className="ui-input__end">{endContent}</span>
                )}
            </div>
            {isInvalid && errorMessage && (
                <span className="ui-input__error">{errorMessage}</span>
            )}
        </div>
    );
});

Input.displayName = "Input";

export type { InputProps, InputSize, InputVariant };
