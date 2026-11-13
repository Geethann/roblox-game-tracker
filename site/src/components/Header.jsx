// The bar across the top of every page: logo, search, light/dark switch.
import { Link } from "react-router";
import { Activity } from "lucide-react";
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
        <SearchBox />
        <ThemeToggle />
      </div>
    </header>
  );
}
