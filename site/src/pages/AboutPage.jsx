// "How it works": where the numbers come from, what they mean, and their limits.
// Being upfront about how data is collected is what makes a stats site trustworthy.
import { Link } from "react-router";

const SOURCE_CODE = "https://github.com/Geethann/roblox-game-tracker";
const HAS_ANALYTICS = Boolean(import.meta.env.VITE_CF_ANALYTICS_TOKEN);

export default function AboutPage() {
  return (
    <article className="prose">
      <title>How it works · Roblox Game Tracker</title>
      <h1>How it works</h1>
      <p className="lead">
        Roblox Game Tracker records the numbers of Roblox games every hour, so you can see how
        any game is doing over time and compare it with others.
      </p>

      <h2>Where the data comes from</h2>
      <p>
        Everything comes from Roblox&apos;s public API, the same data the Roblox website shows.
        Every tracked game is checked <strong>once an hour</strong>: players online, total visits,
        favourites, likes and dislikes, its title, and when its developer last published.
      </p>
      <p>
        Live numbers on a game&apos;s page (like &ldquo;Playing now&rdquo;) are fetched fresh and
        refresh every minute while the page is open.
      </p>

      <h2>Which games are tracked</h2>
      <ul>
        <li>Every hour, the tracker adds the games on Roblox&apos;s front-page lists (Top Playing, Trending, Up-and-Coming and others).</li>
        <li>Opening any game&apos;s page here adds that game too, so smaller games get tracked as soon as someone looks them up.</li>
        <li>Up to 1,500 games are tracked at once. Games with no players for 30 days are paused to make room; their history is kept, and they resume if someone opens them again.</li>
      </ul>
      <p>
        You can search <strong>any</strong> Roblox game, tracked or not. Untracked games show live numbers,
        and history starts from the moment they&apos;re added.
      </p>

      <h2>What the numbers mean</h2>
      <dl className="definitions">
        <dt>Peak (hourly)</dt>
        <dd>The highest of the hourly player readings in the chosen range. A short spike between two readings can be missed.</dd>
        <dt>Visits gained</dt>
        <dd>How much a game&apos;s total visit count went up. Today isn&apos;t over yet, so it&apos;s left out of daily charts rather than shown as a fake drop.</dd>
        <dt>Rating</dt>
        <dd>Likes as a share of all votes (likes ÷ (likes + dislikes)). Changes are shown in percentage points.</dd>
        <dt>Trending on Roblox</dt>
        <dd>Roblox&apos;s own Trending list, in Roblox&apos;s order. Roblox doesn&apos;t publish how it&apos;s chosen.</dd>
        <dt>Rising</dt>
        <dd>Our own list: the biggest percentage rise in players compared with the same hour yesterday, among games that had at least 100 players yesterday.</dd>
        <dt>Top rated</dt>
        <dd>The highest ratings among games with at least 1,000 votes and 100 players online, so a game with three votes can&apos;t top it.</dd>
        <dt>Updated</dt>
        <dd>When Roblox says the game was last updated. Small edits, like a new description, can count as well as gameplay updates.</dd>
      </dl>

      <h2>Limits worth knowing</h2>
      <ul>
        <li><strong>History starts when tracking starts.</strong> Roblox doesn&apos;t provide past numbers, so no tracker can show a game&apos;s history from before it began recording.</li>
        <li><strong>Hourly readings</strong> show the shape of a day well but can miss short spikes, for example right after an update.</li>
        <li><strong>Long ranges use daily summaries.</strong> Hourly readings are kept for 90 days; after that, each day is kept as its average, peak and end-of-day totals.</li>
        <li>Roblox&apos;s search and front-page lists aren&apos;t officially documented, so they could change. If search fails, the site falls back to searching games it already tracks.</li>
      </ul>

      <h2>Privacy</h2>
      <p>
        There are no accounts and no cookies. Your main game, recently viewed games and light/dark
        choice are saved only in your own browser and never sent anywhere.
        {HAS_ANALYTICS && (
          <> Visits are counted with Cloudflare Web Analytics, which doesn&apos;t use cookies or
          track individuals; it only reports totals like page views.</>
        )}
      </p>

      <h2>About this project</h2>
      <p>
        An unofficial fan project, not affiliated with or endorsed by Roblox Corporation.
        Built with React, Cloudflare Workers and a Cloudflare D1 database. The source code is on{" "}
        <a href={SOURCE_CODE} target="_blank" rel="noreferrer">GitHub</a>.
      </p>
      <p><Link to="/" className="button">Back to home</Link></p>
    </article>
  );
}
