// The page layout every page shares, and which page shows for which address.
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import Header from "./components/Header.jsx";
import HomePage from "./pages/HomePage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import { Skeleton } from "./components/Feedback.jsx";

// The game page includes the chart library, which is large. Loading it
// "lazily" means its code only downloads when someone opens a game, so the
// home page stays fast. ("Code splitting".)
const GamePage = lazy(() => import("./pages/GamePage.jsx"));

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="container page">
        <Suspense fallback={<Skeleton height={400} radius={12} />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/game/:universeId" element={<GamePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="site-footer">
        <div className="container">
          Unofficial fan project, not affiliated with or endorsed by Roblox Corporation.
          Data comes from Roblox&apos;s public API; each game is checked once an hour.
        </div>
      </footer>
    </div>
  );
}
