import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";

// Preserve the independent review's exact oracle/generator text; adapt only I/O and add vector capture.
const root = new URL("../../", import.meta.url);
const baseline = process.argv.includes("--baseline");
const target = baseline ? new URL("../relative-oscillators-math/", root) : root;
const fixture = new URL(
  "../fixtures/relative-invariance/original-review-probes.mjs.txt",
  import.meta.url
);
const phase = baseline ? "before" : "after";
const output = new URL("artifacts/stoch-invariance-replay/", root);
mkdirSync(output, { recursive: true });
let source = readFileSync(fixture, "utf8");
function replaceOnce(from, to) {
  if (source.split(from).length !== 2) throw new Error(`Expected one frozen probe token: ${from}`);
  source = source.replace(from, to);
}
replaceOnce(
  '"./relative-oscillators-math/test/helpers/relative-oscillator-source.mjs"',
  JSON.stringify(new URL("test/helpers/relative-oscillator-source.mjs", target).href)
);
replaceOnce(
  '"./relative-oscillators-math/docs/RELATIVE_OSCILLATORS_PRIMARY_CAPTURE.json"',
  JSON.stringify(new URL("docs/RELATIVE_OSCILLATORS_PRIMARY_CAPTURE.json", target).href)
);
for (const [old, name] of [
  ["relative-oscillators-readonly-failing-vector.json", `first-failure-${phase}.json`],
  ["relative-oscillators-readonly-evidence.json", `evidence-${phase}.json`]
])
  replaceOnce(JSON.stringify("./" + old), JSON.stringify(new URL(name, output).href));
const sourceHash = createHash("sha256")
  .update(
    readFileSync(
      new URL("src/model/technical-indicators/relative-oscillators/oscillators.ts", target)
    )
  )
  .digest("hex");
replaceOnce(
  "const evidence={sourceSHA:",
  `const evidence={executionTarget:${JSON.stringify(phase)},oscillatorSourceSha256:${JSON.stringify(sourceHash)},oracleSourceSHA:`
);
replaceOnce(
  "  for(const [fn,oracle,p]of",
  `  if(trial===47||trial===113)writeFileSync(new URL(${JSON.stringify(output.href)}+"trial-"+trial+"-${phase}.json"),JSON.stringify({trial,options:sp,bars:b,actual:api.stochasticRsi(b,sp),expected:stoch(b,sp)},null,2)+"\\n");\n  for(const [fn,oracle,p]of`
);
await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
