import React, { createContext, useContext, useState, useCallback } from "react";

// ============================================
// TYPES
// ============================================

type SelectionMode = "none" | "single" | "multiple";
type SelectionKeys = Set<string> | "all";

interface TableContextValue {
    selectionMode: SelectionMode;
    selectedKeys: SelectionKeys;
    onSelectionChange: (keys: SelectionKeys) => void;
    allRowKeys: string[];
    registerRowKey: (key: string) => void;
    unregisterRowKey: (key: string) => void;
}

interface TableProps {
    children: React.ReactNode;
    ariaLabel?: string;
    selectionMode?: SelectionMode;
    selectedKeys?: SelectionKeys;
    onSelectionChange?: (keys: SelectionKeys) => void;
    className?: string;
    classNames?: {
        table?: string;
        thead?: string;
        tbody?: string;
        tr?: string;
        th?: string;
        td?: string;
        wrapper?: string;
    };
    removeWrapper?: boolean;
    selectionBehavior?: any;
    onRowAction?: () => void;
    "aria-label"?: string;
}

interface TableHeaderProps<T> {
    children: React.ReactNode | ((column: T) => React.ReactNode);
    columns?: T[];
}

interface TableColumnProps {
    children: React.ReactNode;
    key?: string;
    align?: "start" | "center" | "end";
    className?: string;
}

interface TableBodyProps<T> {
    children: React.ReactNode | ((item: T) => React.ReactNode);
    items?: T[];
    emptyContent?: React.ReactNode;
}

interface TableRowProps {
    children: React.ReactNode | ((columnKey: React.Key) => React.ReactNode);
    rowKey?: string;
    className?: string;
    onClick?: () => void;
}

interface TableCellProps {
    children: React.ReactNode;
    className?: string;
    colSpan?: number;
}

// ============================================
// CONTEXT
// ============================================

const TableContext = createContext<TableContextValue | null>(null);

const useTableContext = () => {
    const context = useContext(TableContext);
    if (!context) {
        throw new Error("Table components must be used within a Table");
    }
    return context;
};

// ============================================
// COMPONENTS
// ============================================

export function Table({
    children,
    ariaLabel,
    "aria-label": ariaLabelAlt,
    selectionMode = "none",
    selectedKeys = new Set(),
    onSelectionChange,
    className = "",
    classNames = {},
    removeWrapper: _removeWrapper,
    selectionBehavior: _selectionBehavior,
    onRowAction: _onRowAction,
}: TableProps) {
    const label = ariaLabel || ariaLabelAlt;
    const [allRowKeys, setAllRowKeys] = useState<string[]>([]);

    const registerRowKey = useCallback((key: string) => {
        setAllRowKeys(prev => prev.includes(key) ? prev : [...prev, key]);
    }, []);

    const unregisterRowKey = useCallback((key: string) => {
        setAllRowKeys(prev => prev.filter(k => k !== key));
    }, []);

    const handleSelectionChange = useCallback((keys: SelectionKeys) => {
        onSelectionChange?.(keys);
    }, [onSelectionChange]);

    const contextValue: TableContextValue = {
        selectionMode,
        selectedKeys,
        onSelectionChange: handleSelectionChange,
        allRowKeys,
        registerRowKey,
        unregisterRowKey
    };

    return (
        <TableContext.Provider value={contextValue}>
            <table
                aria-label={label}
                className={`ui-table ${classNames.table || ""} ${className}`}
            >
                {children}
            </table>
        </TableContext.Provider>
    );
}

export function TableHeader<T extends { key: string }>({
    children,
    columns
}: TableHeaderProps<T>) {
    const { selectionMode, selectedKeys, onSelectionChange, allRowKeys } = useTableContext();

    const isAllSelected = selectedKeys === "all" ||
        (selectedKeys instanceof Set && allRowKeys.length > 0 && allRowKeys.every(k => selectedKeys.has(k)));

    const handleSelectAll = () => {
        if (isAllSelected) {
            onSelectionChange(new Set());
        } else {
            onSelectionChange(new Set(allRowKeys));
        }
    };

    const renderContent = (): React.ReactNode => {
        if (columns && typeof children === "function") {
            return columns.map(column => (children as (column: T) => React.ReactNode)(column));
        }
        return children as React.ReactNode;
    };

    return (
        <thead className="ui-table__thead">
            <tr className="ui-table__header-row">
                {selectionMode === "multiple" && (
                    <th className="ui-table__th ui-table__th--checkbox">
                        <label className="ui-checkbox">
                            <input
                                type="checkbox"
                                checked={isAllSelected}
                                onChange={handleSelectAll}
                                className="ui-checkbox__input"
                            />
                            <span className="ui-checkbox__box"></span>
                        </label>
                    </th>
                )}
                {renderContent()}
            </tr>
        </thead>
    );
}

export function TableColumn({
    children,
    align = "start",
    className = ""
}: TableColumnProps) {
    const alignClass = {
        start: "ui-table__th--start",
        center: "ui-table__th--center",
        end: "ui-table__th--end"
    };

    return (
        <th className={`ui-table__th ${alignClass[align]} ${className}`}>
            {children}
        </th>
    );
}

export function TableBody<T extends { id?: string; key?: string }>({
    children,
    items,
    emptyContent = "Aucune donnée."
}: TableBodyProps<T>) {
    const renderContent = (): React.ReactNode => {
        if (items && typeof children === "function") {
            if (items.length === 0) {
                return (
                    <tr className="ui-table__row ui-table__row--empty">
                        <td colSpan={100} className="ui-table__td ui-table__td--empty">
                            {emptyContent}
                        </td>
                    </tr>
                );
            }
            return items.map(item => (children as (item: T) => React.ReactNode)(item));
        }
        return children as React.ReactNode;
    };

    return (
        <tbody className="ui-table__tbody">
            {renderContent()}
        </tbody>
    );
}

export function TableRow({
    children,
    rowKey,
    className = "",
    onClick
}: TableRowProps) {
    const { selectionMode, selectedKeys, onSelectionChange, registerRowKey, unregisterRowKey } = useTableContext();

    React.useEffect(() => {
        if (rowKey) {
            registerRowKey(rowKey);
            return () => unregisterRowKey(rowKey);
        }
    }, [rowKey, registerRowKey, unregisterRowKey]);

    const isSelected = rowKey && (
        selectedKeys === "all" ||
        (selectedKeys instanceof Set && selectedKeys.has(rowKey))
    );

    const handleSelect = () => {
        if (!rowKey || selectionMode === "none") return;

        if (selectionMode === "single") {
            onSelectionChange(new Set([rowKey]));
        } else {
            const newKeys = new Set(selectedKeys === "all" ? [] : selectedKeys);
            if (isSelected) {
                newKeys.delete(rowKey);
            } else {
                newKeys.add(rowKey);
            }
            onSelectionChange(newKeys);
        }
    };

    const renderContent = (): React.ReactNode => {
        return children as React.ReactNode;
    };

    return (
        <tr
            className={`ui-table__row ${isSelected ? "ui-table__row--selected" : ""} ${className}`}
            data-selected={isSelected}
            onClick={onClick}
        >
            {selectionMode === "multiple" && (
                <td className="ui-table__td ui-table__td--checkbox">
                    <label className="ui-checkbox">
                        <input
                            type="checkbox"
                            checked={!!isSelected}
                            onChange={handleSelect}
                            className="ui-checkbox__input"
                        />
                        <span className="ui-checkbox__box"></span>
                    </label>
                </td>
            )}
            {renderContent()}
        </tr>
    );
}

export function TableCell({ children, className = "", colSpan }: TableCellProps) {
    return (
        <td className={`ui-table__td ${className}`} colSpan={colSpan}>
            {children}
        </td>
    );
}

// ============================================
// EXPORTS
// ============================================

export type {
    TableProps,
    TableHeaderProps,
    TableColumnProps,
    TableBodyProps,
    TableRowProps,
    TableCellProps,
    SelectionMode,
    SelectionKeys
};
