// Search any Roblox game, with suggestions as you type.
//
// Keyboard:  "/" anywhere jumps here · ↑ ↓ move · Enter opens · Esc closes.
// Empty box: shows the games you opened recently.
// Built as an accessible "combobox", so screen readers announce the suggestions.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { useSearch } from "../lib/api.js";
import { formatCompact } from "../lib/format.js";
import { useDebounced, useRecentGames } from "../lib/hooks.js";
import GameIcon from "./GameIcon.jsx";

export default function SearchBox() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // which suggestion is highlighted
  const [recent] = useRecentGames();

  // Wait until typing pauses for 250ms before searching.
  const query = useDebounced(text.trim(), 250);
  const search = useSearch(query);

  const typed = text.trim().length >= 2;
  const items = typed ? (search.data?.results ?? []) : recent;
  const waiting = typed && (query !== text.trim() || search.isFetching);

  // New suggestions: highlight the first one again.
  useEffect(() => setActive(0), [query, typed]);

  // Press "/" anywhere on the page to jump to the search box.
  useEffect(() => {
    function onKeyDown(event) {
      const typingSomewhere = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if (event.key === "/" && !typingSomewhere) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function choose(game) {
    setText("");
    setOpen(false);
    inputRef.current?.blur();
    navigate(`/game/${game.universeId}`);
  }

  function onInputKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && open && items[active]) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  // Close when focus leaves the whole search area (not just the text box).
  function onBlur(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  let message = null;
  if (!typed && recent.length === 0) message = "Type a game's name, e.g. \"Blox Fruits\"";
  else if (typed && search.isError) message = search.error.message;
  else if (typed && !waiting && items.length === 0) message = `No games found for "${text.trim()}"`;
  else if (typed && waiting && items.length === 0) message = "Searching…";

  return (
    <div className="search" onBlur={onBlur}>
      <Search className="search-icon" size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder="Search any Roblox game…"
        value={text}
        onChange={(event) => { setText(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKeyDown}
        role="combobox"
        aria-label="Search Roblox games"
        aria-expanded={open}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `search-option-${active}` : undefined}
        autoComplete="off"
        spellCheck="false"
      />
      <kbd className="search-shortcut" aria-hidden="true">/</kbd>

      {open && (
        <div className="search-panel">
          {!typed && recent.length > 0 && <div className="search-heading">Recently viewed</div>}
          {message && <div className="search-message">{message}</div>}
          <ul id="search-results" role="listbox" aria-label="Games" className={waiting ? "is-updating" : ""}>
            {items.map((game, i) => (
              <li
                key={game.universeId}
                id={`search-option-${i}`}
                role="option"
                aria-selected={i === active}
                className="search-option"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(event) => event.preventDefault()} // keep focus so the click lands
                onClick={() => choose(game)}
              >
                <GameIcon src={game.icon} size={36} />
                <span className="search-option-text">
                  <span className="search-option-name">{game.name}</span>
                  <span className="search-option-meta">
                    {game.creatorName}
                    {game.playing != null && <> · {formatCompact(game.playing)} playing</>}
                  </span>
                </span>
                {game.trackedSince && <span className="badge">Tracked</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
