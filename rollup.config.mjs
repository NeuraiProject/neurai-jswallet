import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import pkg from "./package.json" with { type: "json" };

const externalForNpm = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
];

const isExternal = (id) =>
  externalForNpm.some((dep) => id === dep || id.startsWith(`${dep}/`));

const browserPlugins = [
  nodeResolve({
    browser: true,
    preferBuiltins: false,
  }),
  commonjs(),
  json(),
];

const npmPlugins = [
  nodeResolve({
    preferBuiltins: true,
  }),
  commonjs(),
  json(),
];

export default [
  {
    input: "./build/entries/index.js",
    external: isExternal,
    output: [
      {
        file: "./dist/index.js",
        format: "esm",
        sourcemap: true,
      },
      {
        file: "./dist/index.cjs",
        format: "cjs",
        exports: "named",
        sourcemap: true,
      },
    ],
    plugins: npmPlugins,
  },
  {
    input: "./build/entries/browser.js",
    output: {
      file: "./dist/browser.js",
      format: "esm",
      sourcemap: true,
    },
    plugins: browserPlugins,
  },
  {
    input: "./build/entries/global.js",
    output: {
      file: "./dist/NeuraiJsWallet.global.js",
      format: "iife",
      name: "NeuraiJsWalletBundle",
      sourcemap: true,
    },
    plugins: browserPlugins,
  },
];
