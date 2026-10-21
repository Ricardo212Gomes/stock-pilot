"use client";

import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "stockpilot-theme";
const THEME_CHANGE_EVENT = "stockpilot-theme-change";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    let savedTheme: string | null = null;

    try {
      savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      savedTheme = null;
    }

    const useDarkTheme = savedTheme
      ? savedTheme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;

    document.documentElement.classList.toggle("dark", useDarkTheme);
    setIsDark(useDarkTheme);
  }, []);

  useEffect(() => {
    function syncTheme() {
      setIsDark(document.documentElement.classList.contains("dark"));
    }

    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
  }, []);

  function toggleTheme() {
    const nextIsDark = !isDark;
    document.documentElement.classList.toggle("dark", nextIsDark);
    setIsDark(nextIsDark);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextIsDark ? "dark" : "light");
    } catch {
      // The theme still changes for this visit if storage is unavailable.
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        {isDark ? (
          <circle cx="10" cy="10" r="3.5" />
        ) : (
          <path d="M15.4 12.1A6.4 6.4 0 0 1 7.9 4.6 6.4 6.4 0 1 0 15.4 12.1Z" />
        )}
      </svg>
      <span>{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}
