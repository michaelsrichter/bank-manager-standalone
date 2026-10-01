import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

const siteUrl = process.argv[2] ?? "https://bankmanager.eps-demos.site/";
const outputFile = process.argv[3] ?? "public/presentation/demo-qr.svg";
const url = new URL(siteUrl);
if (url.protocol !== "https:") throw new Error("Use the public HTTPS address of the demo site.");
const svg = await QRCode.toString(url.href, {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 2,
  color: { dark: "#231f20ff", light: "#ffffffff" },
});
mkdirSync(path.dirname(outputFile), { recursive: true });
writeFileSync(outputFile, svg);
console.log(`Wrote ${outputFile} for ${url.href}`);
