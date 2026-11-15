// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ThemeToggle from "../ThemeToggle";

const root = document.documentElement;

// jsdom has no matchMedia.
const setSystemScheme = (prefersDark: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      matches: prefersDark,
      removeEventListener: () => {},
    }),
  });
};

const toggle = () => screen.getByRole("button");

const clickToggle = (times: number) => {
  for (let click = 0; click < times; click += 1) {
    fireEvent.click(toggle());
  }
};

describe(ThemeToggle, () => {
  beforeEach(() => {
    window.localStorage.clear();
    root.className = "";
    delete root.dataset.theme;
    setSystemScheme(false);
  });

  afterEach(cleanup);

  it("starts on auto and follows the system scheme", () => {
    setSystemScheme(true);
    render(<ThemeToggle />);

    expect(toggle().textContent).toBe("Auto");
    expect([...root.classList]).toStrictEqual(["dark"]);
    expect(root.dataset.theme).toBeUndefined();
  });

  it("restores the stored mode on mount", () => {
    window.localStorage.setItem("theme", "dark");
    render(<ThemeToggle />);

    expect(toggle().textContent).toBe("Dark");
    expect([...root.classList]).toStrictEqual(["dark"]);
    expect(root.dataset.theme).toBe("dark");
  });

  it("switches from auto to light and remembers it", () => {
    render(<ThemeToggle />);
    clickToggle(1);

    expect(toggle().textContent).toBe("Light");
    expect([...root.classList]).toStrictEqual(["light"]);
    expect(root.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("theme")).toBe("light");
  });

  it("switches from light to dark", () => {
    render(<ThemeToggle />);
    clickToggle(2);

    expect(toggle().textContent).toBe("Dark");
    expect([...root.classList]).toStrictEqual(["dark"]);
    expect(root.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("returns to auto on the third click and drops the forced theme", () => {
    render(<ThemeToggle />);
    clickToggle(3);

    expect(toggle().textContent).toBe("Auto");
    expect([...root.classList]).toStrictEqual(["light"]);
    expect(root.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem("theme")).toBe("auto");
  });
});
