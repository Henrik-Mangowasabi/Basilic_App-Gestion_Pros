import React, { useEffect, useRef, createContext, useContext } from "react";
import { createPortal } from "react-dom";

// ============================================
// TYPES
// ============================================

type ModalSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "full";
type ModalBackdrop = "transparent" | "opaque" | "blur";

interface ModalContextValue {
    onClose: () => void;
}

interface ModalProps {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    size?: ModalSize;
    backdrop?: ModalBackdrop;
    isDismissable?: boolean;
    hideCloseButton?: boolean;
    className?: string;
    scrollBehavior?: "inside" | "outside" | "normal";
    classNames?: {
        base?: string;
        header?: string;
        body?: string;
        footer?: string;
        backdrop?: string;
        wrapper?: string;
        closeButton?: string;
    };
}

interface ModalContentProps {
    children: React.ReactNode | (() => React.ReactNode) | ((onClose: () => void) => React.ReactNode);
    className?: string;
}

interface ModalHeaderProps {
    children: React.ReactNode;
    className?: string;
}

interface ModalBodyProps {
    children: React.ReactNode;
    className?: string;
}

interface ModalFooterProps {
    children: React.ReactNode;
    className?: string;
}

// ============================================
// CONTEXT
// ============================================

const ModalContext = createContext<ModalContextValue | null>(null);

const useModalContext = () => {
    const context = useContext(ModalContext);
    if (!context) {
        throw new Error("Modal components must be used within a Modal");
    }
    return context;
};

// ============================================
// COMPONENTS
// ============================================

export function Modal({
    children,
    isOpen,
    onClose,
    size = "md",
    backdrop = "blur",
    isDismissable = true,
    className = "",
    scrollBehavior: _scrollBehavior,
    classNames = {},
}: ModalProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isDismissable) {
                onClose();
            }
        };

        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [isOpen, isDismissable, onClose]);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [isOpen]);

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === overlayRef.current && isDismissable) {
            onClose();
        }
    };

    if (!isOpen) return null;

    const sizeClass = `ui-modal--${size}`;
    const backdropClass = `ui-modal__backdrop--${backdrop}`;

    const modalContent = (
        <div
            ref={overlayRef}
            className={`ui-modal__overlay ${backdropClass}`}
            onClick={handleBackdropClick}
        >
            <div
                className={`ui-modal ${sizeClass} ${className}`}
                role="dialog"
                aria-modal="true"
            >
                <ModalContext.Provider value={{ onClose }}>
                    {children}
                </ModalContext.Provider>
            </div>
        </div>
    );

    if (typeof document !== "undefined") {
        return createPortal(modalContent, document.body);
    }

    return modalContent;
}

export function ModalContent({ children, className = "" }: ModalContentProps) {
    const { onClose } = useModalContext();

    let content: React.ReactNode;
    if (typeof children === "function") {
        try {
            content = (children as (onClose: () => void) => React.ReactNode)(onClose);
        } catch {
            content = (children as () => React.ReactNode)();
        }
    } else {
        content = children;
    }

    return (
        <div className={`ui-modal__content ${className}`}>
            {content}
        </div>
    );
}

export function ModalHeader({ children, className = "" }: ModalHeaderProps) {
    const { onClose } = useModalContext();

    return (
        <div className={`ui-modal__header ${className}`}>
            <div className="ui-modal__title">{children}</div>
            <button
                type="button"
                className="ui-modal__close"
                onClick={onClose}
                aria-label="Close modal"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}

export function ModalBody({ children, className = "" }: ModalBodyProps) {
    return (
        <div className={`ui-modal__body ${className}`}>
            {children}
        </div>
    );
}

export function ModalFooter({ children, className = "" }: ModalFooterProps) {
    return (
        <div className={`ui-modal__footer ${className}`}>
            {children}
        </div>
    );
}

// ============================================
// EXPORTS
// ============================================

export type {
    ModalProps,
    ModalContentProps,
    ModalHeaderProps,
    ModalBodyProps,
    ModalFooterProps,
    ModalSize,
    ModalBackdrop
};
