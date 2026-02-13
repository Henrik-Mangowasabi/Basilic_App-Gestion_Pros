import React, { useState, useRef, useEffect } from "react";

type TooltipPlacement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
    children: React.ReactElement;
    content: React.ReactNode;
    placement?: TooltipPlacement;
    delay?: number;
    closeDelay?: number;
    isDisabled?: boolean;
    className?: string;
}

export function Tooltip({
    children,
    content,
    placement = "top",
    delay = 200,
    closeDelay: _closeDelay,
    isDisabled = false,
    className = ""
}: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

    const showTooltip = () => {
        if (isDisabled) return;
        timeoutRef.current = setTimeout(() => {
            setIsVisible(true);
        }, delay);
    };

    const hideTooltip = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        setIsVisible(false);
    };

    useEffect(() => {
        if (!isVisible || !triggerRef.current || !tooltipRef.current) return;

        const trigger = triggerRef.current.getBoundingClientRect();
        const tooltip = tooltipRef.current.getBoundingClientRect();
        const offset = 8;

        let top = 0;
        let left = 0;

        switch (placement) {
            case "top":
                top = trigger.top - tooltip.height - offset;
                left = trigger.left + (trigger.width - tooltip.width) / 2;
                break;
            case "bottom":
                top = trigger.bottom + offset;
                left = trigger.left + (trigger.width - tooltip.width) / 2;
                break;
            case "left":
                top = trigger.top + (trigger.height - tooltip.height) / 2;
                left = trigger.left - tooltip.width - offset;
                break;
            case "right":
                top = trigger.top + (trigger.height - tooltip.height) / 2;
                left = trigger.right + offset;
                break;
        }

        setPosition({ top, left });
    }, [isVisible, placement]);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const child = React.Children.only(children);

    return (
        <>
            {React.cloneElement(child, {
                ref: triggerRef,
                onMouseEnter: showTooltip,
                onMouseLeave: hideTooltip,
                onFocus: showTooltip,
                onBlur: hideTooltip
            })}
            {isVisible && (
                <div
                    ref={tooltipRef}
                    className={`ui-tooltip ui-tooltip--${placement} ${className}`}
                    style={{
                        position: "fixed",
                        top: position.top,
                        left: position.left,
                        zIndex: 9999
                    }}
                    role="tooltip"
                >
                    {content}
                </div>
            )}
        </>
    );
}

export type { TooltipProps, TooltipPlacement };
