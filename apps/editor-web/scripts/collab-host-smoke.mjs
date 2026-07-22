import {chromium} from "playwright";

const BASE = "http://127.0.0.1:8080/";
const browser = await chromium.launch({headless: true});
const hostCtx = await browser.newContext();
const guestCtx = await browser.newContext();
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();
const lines = [];
host.on("console", (m) => lines.push(`[host] ${m.type()}: ${m.text()}`));
guest.on("console", (m) => lines.push(`[guest] ${m.type()}: ${m.text()}`));

await host.goto(BASE, {waitUntil: "networkidle", timeout: 60000});
await host.waitForFunction(() => {
  const btn = document.getElementById("create-room");
  return btn && !btn.disabled;
}, null, {timeout: 60000});

await host.evaluate(() => {
  const details = [...document.querySelectorAll("details")].find((d) =>
    d.textContent.includes("友だちといっしょに作る"),
  );
  if (details) details.open = true;
});
await host.click("#create-room");
await host.waitForFunction(() => {
  return [...document.querySelectorAll("input")].some((f) =>
    (f.value || "").includes("blocksync-collab"),
  );
}, null, {timeout: 30000});
const invite = await host.evaluate(() => {
  const hit = [...document.querySelectorAll("input")].find((f) =>
    (f.value || "").includes("blocksync-collab"),
  );
  return hit?.value || "";
});
console.log("INVITE=" + invite);

await guest.goto(invite, {waitUntil: "domcontentloaded", timeout: 60000});
await host.getByTestId("collab-status").filter({hasText: "いっしょに作っています"}).waitFor({
  timeout: 60000,
}).catch(() => null);
await guest.getByTestId("collab-status").filter({hasText: "いっしょに作っています"}).waitFor({
  timeout: 60000,
}).catch(() => null);
await guest.waitForTimeout(2000);

const hostStatus = await host.getByTestId("collab-status").innerText().catch(() => "");
const guestStatus = await guest.getByTestId("collab-status").innerText().catch(() => "");
const hostBody = await host.innerText("body");
const guestBody = await guest.innerText("body");
console.log("HOST_STATUS=" + hostStatus);
console.log("GUEST_STATUS=" + guestStatus);
console.log("HOST_PEER=" + /いっしょに作っています/.test(hostBody));
console.log("GUEST_PEER=" + /いっしょに作っています/.test(guestBody));
console.log("HAS_4455=" + lines.some((l) => l.includes("4455")));
console.log("---relevant logs---");
for (const l of lines
  .filter((l) => /4455|signal|collab|joined|peer|WebSocket/i.test(l))
  .slice(0, 50)) {
  console.log(l);
}
await host.screenshot({
  path: "/opt/cursor/artifacts/screenshots/collab-host-host.png",
  fullPage: true,
});
await guest.screenshot({
  path: "/opt/cursor/artifacts/screenshots/collab-host-guest.png",
  fullPage: true,
});
await browser.close();
console.log("DONE");
