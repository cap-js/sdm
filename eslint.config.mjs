import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {
    ignores: ["app/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs" },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node, // Add this line to include Node.js globals
        response: "writable",
        cds: "writable",
        payload: "writable",
        err: "writable",
        Buffer: "writable",
        api: "writable"
      },
    },
  },
  pluginJs.configs.recommended,
];