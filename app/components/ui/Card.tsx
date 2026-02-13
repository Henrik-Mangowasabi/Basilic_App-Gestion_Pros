import React from "react";

interface CardProps {
    children: React.ReactNode;
    className?: string;
    isPressable?: boolean;
    isHoverable?: boolean;
    onPress?: () => void;
}

interface CardHeaderProps {
    children: React.ReactNode;
    className?: string;
}

interface CardBodyProps {
    children: React.ReactNode;
    className?: string;
}

interface CardFooterProps {
    children: React.ReactNode;
    className?: string;
}

export function Card({
    children,
    className = "",
    isPressable = false,
    isHoverable = false,
    onPress
}: CardProps) {
    const handleClick = () => {
        if (isPressable) {
            onPress?.();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (isPressable && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onPress?.();
        }
    };

    return (
        <div
            className={`ui-card ${isPressable ? "ui-card--pressable" : ""} ${isHoverable ? "ui-card--hoverable" : ""} ${className}`}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            role={isPressable ? "button" : undefined}
            tabIndex={isPressable ? 0 : undefined}
        >
            {children}
        </div>
    );
}

export function CardHeader({ children, className = "" }: CardHeaderProps) {
    return (
        <div className={`ui-card__header ${className}`}>
            {children}
        </div>
    );
}

export function CardBody({ children, className = "" }: CardBodyProps) {
    return (
        <div className={`ui-card__body ${className}`}>
            {children}
        </div>
    );
}

export function CardFooter({ children, className = "" }: CardFooterProps) {
    return (
        <div className={`ui-card__footer ${className}`}>
            {children}
        </div>
    );
}

export type { CardProps, CardHeaderProps, CardBodyProps, CardFooterProps };
