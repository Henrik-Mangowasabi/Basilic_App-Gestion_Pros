import React, { createContext, useContext, useState } from "react";

export type TabsColor = "default" | "primary" | "secondary" | "success" | "warning" | "danger";
export type TabsSize = "sm" | "md" | "lg";
export type TabsVariant = "solid" | "bordered" | "light" | "underlined";
export type TabsRadius = "none" | "sm" | "md" | "lg" | "full";

interface TabsContextValue {
  selectedKey: string;
  setSelectedKey: (key: string) => void;
  color: TabsColor;
  size: TabsSize;
  variant: TabsVariant;
  radius: TabsRadius;
  isDisabled: boolean;
  disabledKeys: Set<string>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tab components must be used within a Tabs component");
  }
  return context;
}

export interface TabsProps {
  children: React.ReactNode;
  selectedKey?: string;
  defaultSelectedKey?: string;
  onSelectionChange?: (key: string) => void;
  color?: TabsColor;
  size?: TabsSize;
  variant?: TabsVariant;
  radius?: TabsRadius;
  isDisabled?: boolean;
  disabledKeys?: string[];
  fullWidth?: boolean;
  className?: string;
  classNames?: {
    base?: string;
    tabList?: string;
    tab?: string;
    tabContent?: string;
    cursor?: string;
    panel?: string;
  };
  "aria-label"?: string;
}

export function Tabs({
  children,
  selectedKey: controlledSelectedKey,
  defaultSelectedKey,
  onSelectionChange,
  color = "default",
  size = "md",
  variant = "solid",
  radius = "md",
  isDisabled = false,
  disabledKeys = [],
  fullWidth = false,
  className = "",
  classNames = {},
  "aria-label": ariaLabel,
}: TabsProps) {
  const [internalSelectedKey, setInternalSelectedKey] = useState(defaultSelectedKey || "");

  const selectedKey = controlledSelectedKey ?? internalSelectedKey;

  const setSelectedKey = (key: string) => {
    if (controlledSelectedKey === undefined) {
      setInternalSelectedKey(key);
    }
    onSelectionChange?.(key);
  };

  const contextValue: TabsContextValue = {
    selectedKey,
    setSelectedKey,
    color,
    size,
    variant,
    radius,
    isDisabled,
    disabledKeys: new Set(disabledKeys),
  };

  const baseClass = [
    "ui-tabs",
    `ui-tabs--${variant}`,
    `ui-tabs--${size}`,
    fullWidth ? "ui-tabs--full-width" : "",
    classNames.base || "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={baseClass} aria-label={ariaLabel}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  children: React.ReactNode;
  className?: string;
}

export function TabList({ children, className = "" }: TabListProps) {
  const { variant, radius } = useTabsContext();

  const listClass = [
    "ui-tabs__list",
    `ui-tabs__list--${variant}`,
    `ui-tabs__list--radius-${radius}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={listClass} role="tablist">
      {children}
    </div>
  );
}

export interface TabProps {
  children: React.ReactNode;
  key?: string;
  id?: string;
  title?: React.ReactNode;
  isDisabled?: boolean;
  className?: string;
}

export function Tab({ children, id, title, isDisabled: tabIsDisabled, className = "" }: TabProps) {
  const { selectedKey, setSelectedKey, color, size, variant, isDisabled, disabledKeys } = useTabsContext();

  const tabKey = id || "";
  const isSelected = selectedKey === tabKey;
  const isTabDisabled = isDisabled || tabIsDisabled || disabledKeys.has(tabKey);

  const tabClass = [
    "ui-tabs__tab",
    `ui-tabs__tab--${color}`,
    `ui-tabs__tab--${size}`,
    `ui-tabs__tab--${variant}`,
    isSelected ? "ui-tabs__tab--selected" : "",
    isTabDisabled ? "ui-tabs__tab--disabled" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const handleClick = () => {
    if (!isTabDisabled) {
      setSelectedKey(tabKey);
    }
  };

  return (
    <button
      type="button"
      role="tab"
      className={tabClass}
      onClick={handleClick}
      disabled={isTabDisabled}
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
    >
      <span className="ui-tabs__tab-content">{title || children}</span>
    </button>
  );
}

export interface TabPanelProps {
  children: React.ReactNode;
  id?: string;
  className?: string;
}

export function TabPanel({ children, id, className = "" }: TabPanelProps) {
  const { selectedKey } = useTabsContext();

  const panelKey = id || "";
  const isSelected = selectedKey === panelKey;

  if (!isSelected) {
    return null;
  }

  const panelClass = ["ui-tabs__panel", className].filter(Boolean).join(" ");

  return (
    <div role="tabpanel" className={panelClass} tabIndex={0}>
      {children}
    </div>
  );
}
