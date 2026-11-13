// Search any Roblox game, with suggestions as you type.
//
// Keyboard:  "/" anywhere jumps here · ↑ ↓ move · Enter opens · Esc closes.
// Empty box: shows the games you opened recently.
// Built as an accessible "combobox", so screen readers announce the suggestions.
//
// Used in two places:
//   - the header (default): choosing a game opens its page
//   - the compare page: `onSelect` receives the chosen game instead, and
//     `exclude` hides games that are already being compared
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { useSearch } from "../lib/api.js";
import { formatCompact } from "../lib/format.js";
import { useDebounced, useRecentGames } from "../lib/hooks.js";
import GameIcon from "./GameIcon.jsx";

export default function SearchBox({
  onSelect, exclude = [], placeholder = "Search any Roblox game…", label = "Search Roblox games",
  shortcut = true, id = "search",
}) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [recent] = useRecentGames();

  // Wait until typing pauses for 250ms before searching.
  const query = useDebounced(text.trim(), 250);
  const search = useSearch(query);

  const typed = text.trim().length >= 2;
  const items = (typed ? (search.data?.results ?? []) : recent)
    .filter((game) => !exclude.includes(game.universeId));
  const waiting = typed && (query !== text.trim() || search.isFetching);

  // Which suggestion is highlighted. It's remembered together with the list it
  // belongs to, so when new results arrive the highlight starts at the top again.
  const listKey = typed ? `search:${query}` : "recent";
  const [highlight, setHighlight] = useState({ list: listKey, index: 0 });
  const active = highlight.list === listKey ? highlight.index : 0;
  const setActive = (change) => setHighlight({
    list: listKey,
    index: typeof change === "function" ? change(active) : change,
  });

  // Press "/" anywhere on the page to jump to the search box (header only).
  useEffect(() => {
    if (!shortcut) return undefined;
    function onKeyDown(event) {
      const typingSomewhere = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if (event.key === "/" && !typingSomewhere) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);

  function choose(game) {
    setText("");
    setOpen(false);
    inputRef.current?.blur();
    if (onSelect) onSelect(game);
    else navigate(`/game/${game.universeId}`);
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
        placeholder={placeholder}
        value={text}
        onChange={(event) => { setText(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKeyDown}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-results`}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off"
        spellCheck="false"
      />
      {shortcut && <kbd className="search-shortcut" aria-hidden="true">/</kbd>}

      {open && (
        <div className="search-panel">
          {!typed && recent.length > 0 && <div className="search-heading">Recently viewed</div>}
          {message && <div className="search-message">{message}</div>}
          <ul id={`${id}-results`} role="listbox" aria-label="Games" className={waiting ? "is-updating" : ""}>
            {items.map((game, i) => (
              <li
                key={game.universeId}
                id={`${id}-option-${i}`}
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
                    {/* Only the parts we have, with " · " between them. */}
                    {[game.creatorName, game.playing != null && `${formatCompact(game.playing)} playing`]
                      .filter(Boolean).join(" · ")}
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
