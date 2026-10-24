"use client";

import { useSyncExternalStore } from "react";

// Kept in sync with the inline script in the root layout, which applies the class before the
// first paint so a collapsed sidebar doesn't flash open.
export const SIDEBAR_STORAGE_KEY = "stockpilot-sidebar";
const SIDEBAR_CHANGE_EVENT = "stockpilot-sidebar-change";
const COLLAPSED_CLASS = "sidebar-collapsed";

function subscribe(onChange: () => void) {
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange);
}

function isCollapsed() {
  return document.documentElement.classList.contains(COLLAPSED_CLASS);
}

// Collapses the sidebar to an icon rail on wide screens; phones always show the rail.
export function SidebarToggle() {
  const collapsed = useSyncExternalStore(subscribe, isCollapsed, () => false);

  function toggle() {
    const next = !collapsed;
    document.documentElement.classList.toggle(COLLAPSED_CLASS, next);
    window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {
      // The sidebar still collapses for this visit if storage is unavailable.
    }
  }

  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button className="sidebar-collapse-button" type="button" onClick={toggle} aria-label={label} title={label} aria-expanded={!collapsed}>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="3.5" width="14" height="13" rx="2" />
        <path d="M8 3.5v13" />
        <path d={collapsed ? "m11.5 8 2 2-2 2" : "m13.5 8-2 2 2 2"} />
      </svg>
      <span>Collapse</span>
    </button>
  );
}
