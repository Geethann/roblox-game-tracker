// The bar across the top of every page: logo, Charts link, search, light/dark switch.
import { Link, NavLink } from "react-router";
import { Activity, ChartColumn, GitCompareArrows } from "lucide-react";
import SearchBox from "./SearchBox.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

export default function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label="Roblox Game Tracker home">
          <span className="brand-mark"><Activity size={18} strokeWidth={2.5} /></span>
          <span className="brand-name">Roblox Game Tracker</span>
        </Link>
        {/* NavLink knows when its page is open, and marks itself with aria-current. */}
        <NavLink to="/charts" className="nav-link" aria-label="Charts">
          <ChartColumn size={18} aria-hidden="true" />
          <span className="nav-link-text">Charts</span>
        </NavLink>
        <NavLink to="/compare" className="nav-link" aria-label="Compare">
          <GitCompareArrows size={18} aria-hidden="true" />
          <span className="nav-link-text">Compare</span>
        </NavLink>
        <SearchBox />
        <ThemeToggle />
      </div>
    </header>
  );
}
