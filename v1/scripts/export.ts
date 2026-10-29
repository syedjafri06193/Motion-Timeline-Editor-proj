/** Export the demo scene (or a Lottie file) from the command line. Usage: npm run export -- [in.json] [outdir] */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportCss } from "../src/export/css/emit.js";
import { toDotLottie } from "../src/export/dotlottie.js";
import { exportLottie } from "../src/export/lottie/emit.js";
import { summarize } from "../src/export/matrix.js";
import { bounceAndSpin } from "../src/fixtures.js";
import { importLottie } from "../src/import/lottie.js";

const [input, outDir = "out/export"] = process.argv.slice(2);
let anim = bounceAndSpin();
if (input) {
  const r = importLottie(readFileSync(input, "utf8"));
  for (const i of r.issues) console.log(`${i.severity}: ${i.layer ? i.layer + ": " : ""}${i.message}`);
  if (!r.animation) process.exit(1);
  anim = r.animation;
}
mkdirSync(outDir, { recursive: true });
const l = exportLottie(anim), c = exportCss(anim, { iterations: "infinite" }), o = exportCss(anim, { offsetPath: true, iterations: "infinite" });
writeFileSync(join(outDir, "animation.json"), JSON.stringify(l.json));
writeFileSync(join(outDir, "animation.lottie"), toDotLottie(l.json));
writeFileSync(join(outDir, "animation.html"), c.document);
writeFileSync(join(outDir, "animation-offset-path.html"), o.document);
for (const [name, a] of [["Lottie", l.analysis], ["CSS", c.analysis], ["CSS (offset-path)", o.analysis]] as const) {
  console.log(`\n${name}:`);
  for (const line of summarize(a)) console.log(`  ${line}`);
  for (const w of a.warnings) console.log(`  warning: ${w}`);
  if (!summarize(a).length) console.log("  everything exact");
}
console.log(`\nwrote ${outDir}/animation.{json,lottie,html} and animation-offset-path.html`);
