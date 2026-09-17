// Vendor simulation: serves PaymentHub spec v1 or v2 over HTTP.
// `node vendor.mjs v1` (default) or `node vendor.mjs v2` — like a vendor shipping a release.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2] === "v2" ? "v2" : "v1";
const specDir = join(dirname(fileURLToPath(import.meta.url)), "..", "paymenthub-specs");
const spec = readFileSync(join(specDir, `paymenthub-${version}.json`), "utf8");

createServer((req, res) => {
  if (req.url === "/openapi.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(spec);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(9911, "127.0.0.1", () => {
  console.log(`PaymentHub spec server: ${version} on http://127.0.0.1:9911/openapi.json`);
});
