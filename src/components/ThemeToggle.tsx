import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "auto";

const NEXT_MODE = {
  auto: "light",
  dark: "auto",
  light: "dark",
} as const satisfies Record<ThemeMode, ThemeMode>;

const MODE_TEXT = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
} as const satisfies Record<ThemeMode, string>;

const getInitialMode = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "auto";
  }

  const stored = window.localStorage.getItem("theme");

  if (stored === "light" || stored === "dark" || stored === "auto") {
    return stored;
  }

  return "auto";
};

const resolveMode = (mode: ThemeMode) => {
  if (mode !== "auto") {
    return mode;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const applyThemeMode = (mode: ThemeMode) => {
  const resolved = resolveMode(mode);

  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);

  if (mode === "auto") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }

  document.documentElement.style.colorScheme = resolved;
};

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("auto");

  useEffect(() => {
    const initialMode = getInitialMode();
    // oxlint-disable-next-line react/set-state-in-effect -- the server renders "auto"; the stored mode is readable only after mount
    setMode(initialMode);
    applyThemeMode(initialMode);
  }, []);

  useEffect(() => {
    if (mode !== "auto") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeMode("auto");

    media.addEventListener("change", onChange);

    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [mode]);

  const toggleMode = () => {
    const nextMode = NEXT_MODE[mode];

    setMode(nextMode);
    applyThemeMode(nextMode);
    window.localStorage.setItem("theme", nextMode);
  };

  const label =
    mode === "auto"
      ? "Theme mode: auto (system). Click to switch to light mode."
      : `Theme mode: ${mode}. Click to switch mode.`;

  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={label}
      title={label}
      className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
    >
      {MODE_TEXT[mode]}
    </button>
  );
}
