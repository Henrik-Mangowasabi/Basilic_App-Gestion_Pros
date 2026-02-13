import React, { useState, useRef, useEffect, createContext, useContext } from "react";
import { createPortal } from "react-dom";

interface DropdownContextValue {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    onAction?: (key: React.Key) => void;
    triggerRef: React.RefObject<HTMLDivElement>;
}

interface DropdownProps {
    children: React.ReactNode;
    className?: string;
    classNames?: { content?: string; };
    placement?: string;
    portalContainer?: HTMLElement;
}

interface DropdownTriggerProps {
    children: React.ReactElement;
}

interface DropdownMenuProps {
    children: React.ReactNode;
    ariaLabel?: string;
    onAction?: (key: React.Key) => void;
    className?: string;
}

interface DropdownItemProps {
    children: React.ReactNode;
    itemKey?: string;
    startContent?: React.ReactNode;
    endContent?: React.ReactNode;
    color?: "default" | "danger";
    className?: string;
    onPress?: () => void;
    key?: string;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

const useDropdownContext = () => {
    const context = useContext(DropdownContext);
    if (!context) {
        throw new Error("Dropdown components must be used within a Dropdown");
    }
    return context;
};

export function Dropdown({
    children,
    className = "",
    classNames = {},
    placement: _placement,
    portalContainer: _portalContainer,
}: DropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const isInsideTrigger = dropdownRef.current && dropdownRef.current.contains(target);
            const isInsideMenu = target.closest(".ui-dropdown__menu--portal");

            if (!isInsideTrigger && !isInsideMenu) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("keydown", handleEscape);
        }

        return () => {
            document.removeEventListener("keydown", handleEscape);
        };
    }, [isOpen]);

    return (
        <DropdownContext.Provider value={{ isOpen, setIsOpen, triggerRef }}>
            <div
                ref={dropdownRef}
                className={`ui-dropdown ${isOpen ? "ui-dropdown--open" : ""} ${className}`}
                data-content-class={classNames.content}
            >
                {children}
            </div>
        </DropdownContext.Provider>
    );
}

export function DropdownTrigger({ children }: DropdownTriggerProps) {
    const { isOpen, setIsOpen, triggerRef } = useDropdownContext();

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
    };

    return (
        <div ref={triggerRef} style={{ display: "inline-block" }}>
            {React.cloneElement(children, {
                onClick: handleClick,
                "aria-expanded": isOpen,
                "aria-haspopup": "menu"
            })}
        </div>
    );
}

export function DropdownMenu({
    children,
    ariaLabel,
    onAction,
    className = ""
}: DropdownMenuProps) {
    const { isOpen, setIsOpen, triggerRef } = useDropdownContext();
    const [position, setPosition] = useState({ top: 0, right: 0 });
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const top = rect.bottom + 4;
            const right = window.innerWidth - rect.right;

            setPosition({ top, right });
        }
    }, [isOpen, triggerRef]);

    if (!isOpen) return null;

    const handleAction = (key: React.Key) => {
        onAction?.(key);
        setIsOpen(false);
    };

    const menuContent = (
        <div
            ref={menuRef}
            className={`ui-dropdown__menu ui-dropdown__menu--portal ${className}`}
            role="menu"
            aria-label={ariaLabel}
            style={{
                position: "fixed",
                top: position.top,
                right: position.right,
            }}
        >
            {React.Children.map(children, (child, index) => {
                if (React.isValidElement<DropdownItemProps>(child)) {
                    const itemKey = child.props.itemKey || child.key || `item-${index}`;
                    return React.cloneElement(child, {
                        onPress: () => {
                            child.props.onPress?.();
                            handleAction(itemKey);
                        }
                    });
                }
                return child;
            })}
        </div>
    );

    if (typeof document !== "undefined") {
        return createPortal(menuContent, document.body);
    }

    return menuContent;
}

export function DropdownItem({
    children,
    itemKey,
    startContent,
    endContent,
    color = "default",
    className = "",
    onPress
}: DropdownItemProps) {
    const handleClick = () => {
        onPress?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPress?.();
        }
    };

    return (
        <div
            className={`ui-dropdown__item ${color === "danger" ? "ui-dropdown__item--danger" : ""} ${className}`}
            role="menuitem"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            data-key={itemKey}
        >
            {startContent && (
                <span className="ui-dropdown__item-start">{startContent}</span>
            )}
            <span className="ui-dropdown__item-content">{children}</span>
            {endContent && (
                <span className="ui-dropdown__item-end">{endContent}</span>
            )}
        </div>
    );
}

export type {
    DropdownProps,
    DropdownTriggerProps,
    DropdownMenuProps,
    DropdownItemProps
};
