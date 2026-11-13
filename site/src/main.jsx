// The starting point: wraps the app in the two "providers" everything else relies on.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "./styles.css";
import App from "./App.jsx";

// TanStack Query fetches data from our API and keeps a copy, so going back
// to a page is instant and repeated requests aren't sent.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // treat data as fresh for a minute
      // Retry network blips and server errors twice; don't retry things like
      // "game not found", which won't change by asking again.
      retry: (failures, error) => (error.status === 0 || error.status >= 500) && failures < 2,
    },
  },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* BrowserRouter gives each page a normal web address (e.g. /game/123). */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
