import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The dependency direction is a rule, not a convention: `core` is the harness and must stay
 * ignorant of GoHighLevel, otherwise the claim that it ports to another CRM is untestable.
 */
const ELEMENTS = [
  { type: "config", pattern: "packages/config/**", mode: "full" },
  { type: "db", pattern: "packages/db/**", mode: "full" },
  { type: "core", pattern: "packages/core/**", mode: "full" },
  { type: "ghl", pattern: "packages/ghl/**", mode: "full" },
  { type: "skills-ghl", pattern: "packages/skills-ghl/**", mode: "full" },
  // Captured so an app can import its own files while still being blocked from reaching into
  // a sibling app.
  { type: "app", pattern: "apps/*/**", mode: "full", capture: ["appName"] },
  { type: "evals", pattern: "evals/**", mode: "full" },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "packages/db/migrations/**",
      "internal/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { boundaries },
    settings: {
      "boundaries/elements": ELEMENTS,
      "boundaries/include": ["packages/**", "apps/**", "evals/**"],
    },
    rules: {
      "no-console": "error",
      "no-warning-comments": [
        "error",
        { terms: ["todo", "fixme", "xxx", "hack"], location: "anywhere" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: ["config"], allow: [] },
            { from: ["db"], allow: [] },
            { from: ["core"], allow: ["config"] },
            { from: ["ghl"], allow: ["config"] },
            { from: ["skills-ghl"], allow: ["config", "core", "ghl"] },
            {
              from: [["app", { appName: "*" }]],
              allow: [
                "config",
                "core",
                "db",
                "ghl",
                "skills-ghl",
                ["app", { appName: "${from.appName}" }],
              ],
            },
            // Evals sit at the same tier as apps: top-level consumers, not a package anything
            // depends on. They reach `db` because the grounding cases are scored against the real
            // vector index — an eval that retrieves from a fixture the author wrote to match the
            // answer they wanted measures nothing.
            { from: ["evals"], allow: ["app", "config", "core", "db", "ghl", "skills-ghl"] },
          ],
        },
      ],
      // Cross-package imports are bare specifiers, so `element-types` (which matches file paths)
      // never sees them. This is the rule that actually keeps GoHighLevel out of the harness.
      "boundaries/external": [
        "error",
        {
          default: "allow",
          rules: [
            { from: ["config"], disallow: ["@harness/*"] },
            { from: ["db"], disallow: ["@harness/*"] },
            { from: ["core"], disallow: ["@harness/ghl", "@harness/db", "@harness/skills-ghl"] },
            { from: ["ghl"], disallow: ["@harness/core", "@harness/db", "@harness/skills-ghl"] },
            { from: ["skills-ghl"], disallow: ["@harness/db"] },
          ],
        },
      ],
    },
  },
  {
    // Config files sit outside the element graph and are loaded by their own tooling.
    files: ["**/*.config.ts", "**/*.config.js", "scripts/**/*.ts"],
    rules: { "boundaries/element-types": "off", "no-console": "off" },
  },
  {
    files: ["evals/**/*.test.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  ...vue.configs["flat/recommended"],
  {
    // Single-file components are typechecked by vue-tsc, which understands the template block.
    // ESLint only parses them, so type-aware rules have no program to consult here.
    files: ["**/*.vue"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser },
    },
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["apps/admin/**/*.ts", "apps/chat/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // This file configures the linter and so belongs to no TypeScript project; type-aware rules
    // have nothing to read for it.
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Last: turns off everything Prettier already decides, so the two never disagree.
  prettier,
);
