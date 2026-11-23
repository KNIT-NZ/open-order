"use client";

import { useSyncExternalStore } from "react";
import type { ThemeMode } from "../lib/open-order/types";

const STORAGE_KEY = "open-order-theme";
const THEME_CHANGED_EVENT = "open-order-theme-changed";
let transientTheme: ThemeMode | null = null;

function readTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return transientTheme ?? "light";
  }
}

function subscribeTheme(onChange: () => void) {
  const onStoredThemeChange = () => {
    document.documentElement.dataset.theme = readTheme();
    onChange();
  };
  window.addEventListener("storage", onStoredThemeChange);
  window.addEventListener(THEME_CHANGED_EVENT, onStoredThemeChange);
  return () => {
    window.removeEventListener("storage", onStoredThemeChange);
    window.removeEventListener(THEME_CHANGED_EVENT, onStoredThemeChange);
  };
}

function serverTheme(): ThemeMode {
  return "light";
}

export function useOpenOrderTheme() {
  // React hydrates against the same light snapshot as the server, then
  // subscribes to the saved preference. The head script sets visual theme
  // before paint, so a dark-mode reload has no light-logo flash.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);

  function toggleTheme() {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // Keep toggling functional when browser storage is blocked.
      transientTheme = nextTheme;
    }
    window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
  }

  return { theme, toggleTheme };
}
