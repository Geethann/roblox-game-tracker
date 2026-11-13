// Shown for addresses that don't exist, or game IDs Roblox doesn't know.
import { Link } from "react-router";

export default function NotFoundPage({ message = "That page doesn't exist." }) {
  return (
    <section className="not-found">
      <title>Not found · Roblox Game Tracker</title>
      <h1>Not found</h1>
      <p className="muted">{message} Try searching for the game by name instead.</p>
      <Link to="/" className="button">Back to home</Link>
    </section>
  );
}
