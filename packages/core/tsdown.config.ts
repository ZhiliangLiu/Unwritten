import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  fixedExtension: false,
  noExternal: ["@unwritten/contracts"],
  copy: [
    { from: "src/store/migrations", to: "dist" },
    { from: "src/log/migrations", to: "dist", rename: "diagnostic-migrations" },
  ],
});
