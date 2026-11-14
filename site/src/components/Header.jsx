// The bar across the top of every page: logo, Charts link, search, light/dark switch.
import { Link, NavLink } from "react-router";
import { ChartColumn, GitCompareArrows } from "lucide-react";
import SearchBox from "./SearchBox.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

// The logo files live in site/public; BASE_URL adds "/roblox-game-tracker/" in front.
const LOGOS = import.meta.env.BASE_URL;

export default function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label="Roblox Game Tracker home">
          {/* The theme decides which one shows (see .brand-logo in styles.css). */}
          <img className="brand-logo brand-logo-light" src={`${LOGOS}logo-light-64.png`} alt="" width="32" height="32" />
          <img className="brand-logo brand-logo-dark" src={`${LOGOS}logo-dark-64.png`} alt="" width="32" height="32" />
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
