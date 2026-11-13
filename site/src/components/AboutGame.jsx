// The game's description and key facts.
import { useState } from "react";
import { formatDate, formatNumber } from "../lib/format.js";
import InfoTip from "./InfoTip.jsx";

const LONG_DESCRIPTION = 280; // characters; longer descriptions start folded

export default function AboutGame({ game }) {
  const [expanded, setExpanded] = useState(false);
  const description = game.description?.trim();
  const isLong = description && (description.length > LONG_DESCRIPTION || description.split("\n").length > 5);

  return (
    <section className="card about" aria-labelledby="about-title">
      <h2 id="about-title">About</h2>
      {description ? (
        <>
          {/* React shows this as plain text, so nothing in a description can run as code. */}
          <p className={`about-description${isLong && !expanded ? " is-folded" : ""}`}>{description}</p>
          {isLong && (
            <button type="button" className="link-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      ) : (
        <p className="muted">No description.</p>
      )}
      <dl className="facts">
        <div><dt>Creator</dt><dd>{game.creatorName ?? "—"}</dd></div>
        <div><dt>Genre</dt><dd>{game.genre ?? "—"}</dd></div>
        <div><dt>Server size</dt><dd>{game.maxPlayers ? `${formatNumber(game.maxPlayers)} players` : "—"}</dd></div>
        <div><dt>Created</dt><dd>{formatDate(game.createdAt)}</dd></div>
        <div>
          <dt>
            Tracked since{" "}
            <InfoTip label="About tracking" text="Recorded hourly from this date. Roblox doesn't provide history from before then." />
          </dt>
          <dd>{game.trackedSince ? formatDate(game.trackedSince) : "Not tracked"}</dd>
        </div>
      </dl>
    </section>
  );
}
