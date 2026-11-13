"""
Roblox game tracker - collector.

Reads the list of games in games.json, asks Roblox's public API for each
game's current stats, and saves them:

  data/history/<universe_id>.csv   one row added per game, every run
  data/latest.json                 the newest numbers for every game

Run it from the project folder:
    python collector/collect.py
"""

import csv
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---- Settings ---------------------------------------------------------------

HERE = Path(__file__).parent            # the collector/ folder
GAMES_FILE = HERE / "games.json"        # which games to track
DATA_DIR = HERE.parent / "data"         # where results are saved
HISTORY_DIR = DATA_DIR / "history"
LATEST_FILE = DATA_DIR / "latest.json"

# The columns in every history CSV, in this order.
CSV_COLUMNS = [
    "timestamp_utc",     # when WE collected this row
    "name",              # the game's title at that moment (titles change for events)
    "playing",           # players online right now
    "visits",            # total visits ever
    "favorites",         # total favourites
    "likes",
    "dislikes",
    "last_updated_utc",  # when the developer last published an update
]


# ---- Talking to Roblox ------------------------------------------------------

def get_json(url, attempts=3):
    """Download a URL and turn the JSON reply into Python dicts and lists.

    Roblox sometimes says "too many requests" or has a brief outage, so we
    try up to `attempts` times, waiting a little longer after each failure.
    """
    request = urllib.request.Request(url, headers={"User-Agent": "roblox-game-tracker"})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # 429 = "too many requests", 5xx = Roblox having problems: worth a retry.
            # Anything else (e.g. 404 "not found") won't fix itself, so stop now.
            if error.code != 429 and error.code < 500:
                raise
            problem = f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError) as error:
            problem = str(error)  # network trouble: worth a retry
        if attempt < attempts:
            wait = 5 * attempt
            print(f"  {problem}; retrying in {wait}s...")
            time.sleep(wait)
    raise RuntimeError(f"Gave up on {url} after {attempts} attempts ({problem})")


def place_to_universe(place_id):
    """Turn a place ID (the number in a game's web address) into its universe ID.

    People only ever see place IDs, but the stats endpoints want universe IDs.
    Returns None if Roblox doesn't recognise the place.
    """
    reply = get_json(f"https://apis.roblox.com/universes/v1/places/{place_id}/universe")
    return reply["universeId"]


def fetch_stats(universe_ids):
    """Get the current stats for several games at once.

    Uses two requests in total (not two per game): one for the game details
    and one for likes/dislikes. Returns {universe_id: {column: value, ...}}.
    """
    ids = ",".join(str(u) for u in universe_ids)
    details = get_json(f"https://games.roblox.com/v1/games?universeIds={ids}")["data"]
    votes = get_json(f"https://games.roblox.com/v1/games/votes?universeIds={ids}")["data"]
    votes_by_id = {v["id"]: v for v in votes}

    stats = {}
    for game in details:
        vote = votes_by_id.get(game["id"], {})
        stats[game["id"]] = {
            "name": game["name"],
            "playing": game["playing"],
            "visits": game["visits"],
            "favorites": game["favoritedCount"],
            "likes": vote.get("upVotes"),
            "dislikes": vote.get("downVotes"),
            "last_updated_utc": game["updated"],
        }
    return stats


# ---- Saving -----------------------------------------------------------------

def append_history(universe_id, row):
    """Add one row to this game's history CSV.

    The first time we see a game the file doesn't exist yet, so we create it
    and write the header line (the column names) first.
    """
    path = HISTORY_DIR / f"{universe_id}.csv"
    is_new_file = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        if is_new_file:
            writer.writeheader()
        writer.writerow(row)


# ---- Main -------------------------------------------------------------------

def main():
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    games = json.loads(GAMES_FILE.read_text(encoding="utf-8"))
    print(f"Collecting {len(games)} games at {timestamp}")

    # 1. Work out each game's universe ID, skipping any Roblox doesn't know.
    tracked = []
    for game in games:
        universe_id = place_to_universe(game["place_id"])
        if universe_id is None:
            print(f"  WARNING: place {game['place_id']} not found on Roblox - skipped")
            continue
        tracked.append({**game, "universe_id": universe_id})

    if not tracked:
        sys.exit("No valid games to collect - check games.json")

    # 2. Ask Roblox for everyone's numbers in one go.
    stats = fetch_stats([g["universe_id"] for g in tracked])

    # 3. Save one history row per game and build the "latest" summary.
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    latest = []
    for game in tracked:
        game_stats = stats.get(game["universe_id"])
        if game_stats is None:
            print(f"  WARNING: no stats returned for {game['label']} - skipped")
            continue
        append_history(game["universe_id"], {"timestamp_utc": timestamp, **game_stats})
        latest.append({**game, **game_stats})
        print(f"  {game['label']}: {game_stats['playing']:,} playing, "
              f"{game_stats['visits']:,} visits")

    LATEST_FILE.write_text(
        json.dumps({"collected_at_utc": timestamp, "games": latest},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Saved {len(latest)} games to {DATA_DIR}")


if __name__ == "__main__":
    main()
