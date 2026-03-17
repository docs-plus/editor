"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export interface TabContentProps {
  isActive: boolean;
  title: string;
  onSwitch: () => void;
  tabClassName?: string;
  onAuxClick?: (e: MouseEvent<HTMLDivElement>) => void;
  leadingSlot?: ReactNode;
  icon: ReactNode;
  trailingSlot?: ReactNode;
}

export function TabContent({
  isActive,
  title,
  onSwitch,
  tabClassName = "",
  onAuxClick,
  leadingSlot,
  icon,
  trailingSlot,
}: TabContentProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSwitch();
    }
  };

  return (
    <div
      role="tab"
      tabIndex={isActive ? 0 : -1}
      aria-selected={isActive}
      className={`tab-bar-tab ${isActive ? "tab-bar-tab--active" : ""} ${tabClassName}`.trim()}
      onClick={onSwitch}
      onKeyDown={handleKeyDown}
      onAuxClick={onAuxClick}
    >
      {leadingSlot}
      <span className="tab-bar-tab-icon">{icon}</span>
      <span className="tab-bar-tab-title">{title}</span>
      {trailingSlot}
    </div>
  );
}
