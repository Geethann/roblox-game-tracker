// ESLint: reads the code and flags likely mistakes before they reach the site.
// Runs with `npm run lint`, and automatically on every pull request.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/"] },

  // JavaScript's standard checks: unused variables, unreachable code, typos in names...
  js.configs.recommended,

  // React's own checks for hooks (useState, useEffect...): calling them in the
  // wrong place, forgetting something an effect depends on, and similar.
  reactHooks.configs.flat.recommended,

  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Components are used in JSX (<GameIcon />), which this rule can't see,
      // so names starting with a capital letter are allowed to look "unused".
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]" }],
    },
  },

  // Config files and tests run in Node, not the browser.
  {
    files: ["*.config.js", "**/*.test.js"],
    languageOptions: { globals: globals.node },
  },
];
