import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves the site at https://geethann.github.io/roblox-game-tracker/,
  // so every link and file path needs that folder in front of it.
  base: "/roblox-game-tracker/",
  plugins: [react()],
});
