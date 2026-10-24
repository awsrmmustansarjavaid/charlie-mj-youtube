/**
 * Package validation: manifest version, country and language counts.
 * Usage: node scripts/validate.mjs (run from the extension root).
 */
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.version !== "2.0.0") throw new Error("Version changed.");
const countries = JSON.parse(
  fs.readFileSync(path.join(root, "database/countries/countries.json"), "utf8"),
);
const languages = JSON.parse(
  fs.readFileSync(path.join(root, "database/languages/languages.json"), "utf8"),
);
console.log(`Charlie MJ YouTube ${manifest.version}`);
console.log(`Countries: ${countries.countries.length}`);
console.log(`Languages: ${languages.languages.length}`);
console.log("Validation OK");
