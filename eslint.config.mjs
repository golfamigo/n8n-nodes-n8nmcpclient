import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { FlatCompat } from "@eslint/eslintrc";
import path from "path";
import { fileURLToPath } from "url";

// mimic CommonJS variables -- needed for FlatCompat
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize FlatCompat
const compat = new FlatCompat({
    baseDirectory: __dirname,
    // Recommended: use the same resolvePluginsRelativeTo for consistency
    // resolvePluginsRelativeTo: __dirname,
});

export default tseslint.config(
    // Base ESLint recommended config
    js.configs.recommended,

    // Base TypeScript config
    ...tseslint.configs.recommended,
    // If you used parserOptions.project in eslintrc, you might need this:
    // {
    //     languageOptions: {
    //         parserOptions: {
    //             project: true, // or ['./tsconfig.json']
    //             tsconfigRootDir: __dirname,
    //         },
    //     },
    // },

    // Global ignores
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/*.js", // Assuming you want to lint only TS files based on old ignore
            "eslint.config.mjs", // Ignore the config file itself (updated extension)
            "package.json", // Explicitly ignore package.json from general TS rules
        ],
    },

    // General language options (applies to most files unless overridden)
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.es2021, // or a more specific ES version if needed
                ...globals.node,
            },
            // parserOptions from old config (sourceType is default 'module' in flat config)
            // ecmaVersion: 2019, // Set if needed, often inferred
        },
    },

    // Config for package.json (using FlatCompat for extends) - This still applies
    ...compat.extends("plugin:n8n-nodes-base/community").map(config => ({
        ...config,
        files: ["package.json"], // Target package.json specifically
        rules: {
            // Keep existing rules for package.json
            ...(config.rules || {}),
            'n8n-nodes-base/community-package-json-name-still-default': 'off',
        }
    })),

    // Config for credentials (using FlatCompat for extends)
    ...compat.extends("plugin:n8n-nodes-base/credentials").map(config => ({
        ...config,
        files: ["credentials/**/*.ts"],
        rules: {
            ...(config.rules || {}),
            'n8n-nodes-base/cred-class-field-documentation-url-missing': 'off',
            'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
        }
    })),

    // Config for nodes (using FlatCompat for extends)
    ...compat.extends("plugin:n8n-nodes-base/nodes").map(config => ({
        ...config,
        files: ["nodes/**/*.ts"],
        rules: {
            ...(config.rules || {}),
            'n8n-nodes-base/node-execute-block-missing-continue-on-fail': 'off',
            'n8n-nodes-base/node-resource-description-filename-against-convention': 'off',
            'n8n-nodes-base/node-param-fixed-collection-type-unsorted-items': 'off',
            // Disable rules conflicting with TS types for inputs/outputs
            'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
            'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
        }
    })),
);
