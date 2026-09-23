import { dts } from "rollup-plugin-dts";

// CommonJS declarations for the `require` entry (dist/index.cjs).
//
// dist/entries/index.d.ts is ESM ("type": "module"), so a CommonJS consumer
// resolving it under moduleResolution node16/nodenext gets TS1471/TS1479.
// The same declarations are bundled into dist/index.d.cts. Other packages
// stay external: in a .d.cts they resolve through their own `require`
// condition, i.e. their .d.cts (neurai-key >= 5.0.2, create-transaction and
// scripts >= 0.9.1, assets >= 1.7.2), so their types are shared, not copied.
export default {
  input: "./dist/entries/index.d.ts",
  output: { file: "./dist/index.d.cts", format: "es" },
  external: (id) => !id.startsWith(".") && !id.startsWith("/"),
  plugins: [dts()],
};
