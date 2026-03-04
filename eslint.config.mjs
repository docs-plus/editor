import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    settings: {
      react: {
        version: "19",
      },
    },
    rules: {
      "import/order": "off",
      "import/newline-after-import": "off",
      "import/no-duplicates": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-const": "off",
      "no-console": "off",
      "no-extra-semi": "off",
      semi: "off",
      quotes: "off",
      "comma-dangle": "off",
      indent: "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
    },
  },
]);

export default eslintConfig;
