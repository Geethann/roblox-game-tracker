// Switches between light and dark. Until the visitor chooses, the site
// follows their device's setting.
import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useStoredValue } from "../lib/hooks.js";

export default function ThemeToggle() {
  const [theme, setTheme] = useStoredValue("theme", null); // "light", "dark" or null (= device setting)

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const deviceIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme ? theme === "dark" : deviceIsDark;
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button type="button" className="icon-button" onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={label} title={label}>
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
