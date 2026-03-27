import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  shims: true,
  external: [
    "react",
    "ink",
    "react-devtools-core",
    /hooks\//,
    /components\//,
  ],
});
