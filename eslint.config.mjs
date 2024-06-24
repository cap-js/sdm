import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  { 
    files: ["**/*.js"], 
    languageOptions: { sourceType: "commonjs" },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
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
