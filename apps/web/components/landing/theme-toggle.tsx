"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./icons";

const KEY = "ahadi-lp-theme";

/**
 * Runs before the page paints (inlined into the .lp root) so a saved theme
 * never flashes the wrong colours.
 */
export const themeBootScript = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.currentScript.parentElement.setAttribute("data-theme",t)}catch(e){}`;

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".lp");
}

function effectiveTheme(): "light" | "dark" {
  const el = root();
  const set = el?.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(effectiveTheme());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(effectiveTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    root()?.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice lasts for this page view only */
    }
    setTheme(next);
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-l-muted transition-colors hover:bg-l-bg2 hover:text-l-fg"
    >
      {theme === "dark" ? <IconSun className="size-[18px]" /> : <IconMoon className="size-[18px]" />}
    </button>
  );
}
