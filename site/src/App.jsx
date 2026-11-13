// The page layout every page shares, and which page shows for which address.
import { Route, Routes } from "react-router";
import Header from "./components/Header.jsx";
import HomePage from "./pages/HomePage.jsx";
import GamePage from "./pages/GamePage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="container page">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/game/:universeId" element={<GamePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
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
