"use client";

import { useEffect, useState } from "react";
import type { ThemeMode } from "../lib/open-order/types";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const savedTheme = window.localStorage.getItem(
    "open-order-theme",
  ) as ThemeMode | null;

  return savedTheme === "dark" || savedTheme === "light"
    ? savedTheme
    : "light";
}

export function useOpenOrderTheme() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("open-order-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }

  return {
    theme,
    toggleTheme,
  };
}