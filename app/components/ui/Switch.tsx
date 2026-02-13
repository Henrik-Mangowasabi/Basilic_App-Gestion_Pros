import React from "react";

type SwitchSize = "sm" | "md" | "lg";

interface SwitchProps {
    isSelected?: boolean;
    defaultSelected?: boolean;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onValueChange?: (isSelected: boolean) => void;
    size?: SwitchSize;
    color?: string;
    isDisabled?: boolean;
    name?: string;
    value?: string;
    className?: string;
    classNames?: {
        base?: string;
        wrapper?: string;
        thumb?: string;
    };
}

export function Switch({
    isSelected,
    defaultSelected = false,
    onChange,
    onValueChange,
    size = "md",
    isDisabled = false,
    name,
    value,
    className = "",
    classNames = {}
}: SwitchProps) {
    const [internalChecked, setInternalChecked] = React.useState(defaultSelected);
    const isControlled = isSelected !== undefined;
    const checked = isControlled ? isSelected : internalChecked;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isDisabled) return;

        const newValue = e.target.checked;

        if (!isControlled) {
            setInternalChecked(newValue);
        }

        onChange?.(e);
        onValueChange?.(newValue);
    };

    const sizeClass = `ui-switch--${size}`;

    return (
        <label
            className={`ui-switch ${sizeClass} ${checked ? "ui-switch--checked" : ""} ${isDisabled ? "ui-switch--disabled" : ""} ${classNames.base || ""} ${className}`}
        >
            <input
                type="checkbox"
                className="ui-switch__input"
                checked={checked}
                onChange={handleChange}
                disabled={isDisabled}
                name={name}
                value={value}
            />
            <span className={`ui-switch__track ${classNames.wrapper || ""}`}>
                <span className={`ui-switch__thumb ${classNames.thumb || ""}`} />
            </span>
        </label>
    );
}

export type { SwitchProps, SwitchSize };
