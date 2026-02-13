import React from "react";

interface PaginationProps {
    total: number;
    page: number;
    onChange: (page: number) => void;
    showControls?: boolean;
    siblings?: number;
    boundaries?: number;
    isDisabled?: boolean;
    className?: string;
    classNames?: {
        wrapper?: string;
        item?: string;
        cursor?: string;
        prev?: string;
        next?: string;
    };
}

function range(start: number, end: number): number[] {
    const length = end - start + 1;
    return Array.from({ length }, (_, i) => start + i);
}

function usePagination({
    total,
    page,
    siblings = 1,
    boundaries = 1
}: {
    total: number;
    page: number;
    siblings?: number;
    boundaries?: number;
}): (number | "dots")[] {
    const totalPageNumbers = siblings * 2 + 3 + boundaries * 2;

    if (totalPageNumbers >= total) {
        return range(1, total);
    }

    const leftSiblingIndex = Math.max(page - siblings, boundaries);
    const rightSiblingIndex = Math.min(page + siblings, total - boundaries);

    const shouldShowLeftDots = leftSiblingIndex > boundaries + 2;
    const shouldShowRightDots = rightSiblingIndex < total - (boundaries + 1);

    if (!shouldShowLeftDots && shouldShowRightDots) {
        const leftItemCount = siblings * 2 + boundaries + 2;
        return [...range(1, leftItemCount), "dots", ...range(total - boundaries + 1, total)];
    }

    if (shouldShowLeftDots && !shouldShowRightDots) {
        const rightItemCount = siblings * 2 + boundaries + 2;
        return [...range(1, boundaries), "dots", ...range(total - rightItemCount + 1, total)];
    }

    return [
        ...range(1, boundaries),
        "dots",
        ...range(leftSiblingIndex, rightSiblingIndex),
        "dots",
        ...range(total - boundaries + 1, total)
    ];
}

export function Pagination({
    total,
    page,
    onChange,
    showControls = false,
    siblings = 1,
    boundaries = 1,
    isDisabled = false,
    className = "",
    classNames = {}
}: PaginationProps) {
    const pages = usePagination({ total, page, siblings, boundaries });

    const handlePrev = () => {
        if (page > 1 && !isDisabled) {
            onChange(page - 1);
        }
    };

    const handleNext = () => {
        if (page < total && !isDisabled) {
            onChange(page + 1);
        }
    };

    const handlePageClick = (p: number) => {
        if (!isDisabled && p !== page) {
            onChange(p);
        }
    };

    return (
        <nav
            className={`ui-pagination ${isDisabled ? "ui-pagination--disabled" : ""} ${classNames.wrapper || ""} ${className}`}
            aria-label="Pagination"
        >
            {showControls && (
                <button
                    type="button"
                    className={`ui-pagination__btn ui-pagination__btn--prev ${classNames.prev || ""}`}
                    onClick={handlePrev}
                    disabled={page === 1 || isDisabled}
                    aria-label="Previous page"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>
            )}

            <div className="ui-pagination__pages">
                {pages.map((p, index) => {
                    if (p === "dots") {
                        return (
                            <span key={`dots-${index}`} className="ui-pagination__dots">
                                ...
                            </span>
                        );
                    }

                    const isActive = p === page;

                    return (
                        <button
                            key={p}
                            type="button"
                            className={`ui-pagination__page ${isActive ? `ui-pagination__page--active ${classNames.cursor || ""}` : ""} ${classNames.item || ""}`}
                            onClick={() => handlePageClick(p)}
                            disabled={isDisabled}
                            aria-current={isActive ? "page" : undefined}
                        >
                            {p}
                        </button>
                    );
                })}
            </div>

            {showControls && (
                <button
                    type="button"
                    className={`ui-pagination__btn ui-pagination__btn--next ${classNames.next || ""}`}
                    onClick={handleNext}
                    disabled={page === total || isDisabled}
                    aria-label="Next page"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6" />
                    </svg>
                </button>
            )}
        </nav>
    );
}

export type { PaginationProps };
