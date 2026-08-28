import { chromium } from "playwright";

// The connection line telegraphs the release: green dashed over void when a
// drawer will spawn, red dashed when the port's drawer already exists, red
// over a refusing card. Screenshots mid-drag + the dead-release scratch.

const recipe = (id, name, machine, inputs, outputs) => ({
  id, name, kind: "custom", machineType: machine, minimumTier: "LV",
  durationTicks: 40, eut: 30,
  machineHandlers: [{ id: machine.toLowerCase(), label: machine, machineType: machine, minimumTier: "LV", kind: "single" }],
  inputs: inputs.map(([rid, amount]) => ({ kind: "item", id: rid, amount, displayName: rid })),
  outputs: outputs.map(([rid, amount]) => ({ kind: "item", id: rid, amount, displayName: rid })),
});

const PROJECT = {
  schemaVersion: 1,
  id: "sound-line",
  name: "Sound line",
  recipes: [
    recipe("r-a", "Make Mid", "Macerator", [["ore", 1]], [["mid", 1]]),
    recipe("r-b", "Use Mid", "Compressor", [["mid", 1]], [["out", 1]]),
  ],
  nodes: [
    { id: "n-a", recipeId: "r-a", machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x: 100, y: 160 } },
    { id: "n-b", recipeId: "r-b", machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x: 700, y: 160 } },
  ],
  storages: [
    // n-a's mid output ALREADY has its drawer, wired with real handles: a
    // void drop from that port must telegraph and land dead.
    { id: "s-1", kind: "item", resourceId: "mid", position: { x: 420, y: 520 } },
  ],
  edges: [
    { id: "e-1", source: "n-a", target: "n-b", resourceKind: "item", resourceId: "mid", sourceHandle: "output:item:mid", targetHandle: "input:item:mid" },
    { id: "e-2", source: "n-a", target: "s-1", resourceKind: "item", resourceId: "mid", sourceHandle: "output:item:mid", targetHandle: "input:item:mid" },
  ],
  fuelProfiles: [],
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.addInitScript(() => {
  window.__starts = [];
  const oscStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...args) {
    window.__starts.push("osc");
    return oscStart.apply(this, args);
  };
  const bufStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    window.__starts.push("noise");
    return bufStart.apply(this, args);
  };
});

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.evaluate((p) => {
  localStorage.setItem("gtnh-factory-flow.project.v2", JSON.stringify(p));
}, PROJECT);
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
await page.getByText("Sound line", { exact: true }).first().click();
await page.waitForTimeout(2500);

const drain = () => page.evaluate(() => window.__starts.splice(0));
const countCards = () => page.evaluate(() => document.querySelectorAll(".react-flow__node").length);

// 1. n-a's ore INPUT (no source drawer yet) dragged over void: GREEN
// dashed with the drawer ghost.
const inA = await page.locator('.react-flow__node[data-id="n-a"] .react-flow__handle.target').first().boundingBox();
await page.mouse.move(inA.x + inA.width / 2, inA.y + inA.height / 2);
await page.mouse.down();
await page.mouse.move(inA.x - 120, inA.y + 320, { steps: 8 });
await page.waitForTimeout(300);
await page.screenshot({ path: "line-01-void-spawn.png" });
await page.mouse.up();
await page.waitForTimeout(500);
console.log("spawn release sounds:", JSON.stringify(await drain()));

// 2. n-a's "mid" output, whose drawer already exists, over void: RED dashed.
const outA = await page.locator('.react-flow__node[data-id="n-a"] .react-flow__handle.source').first().boundingBox();
await page.mouse.move(outA.x + outA.width / 2, outA.y + outA.height / 2);
await page.mouse.down();
await page.mouse.move(outA.x + 60, outA.y + 300, { steps: 8 });
await page.waitForTimeout(300);
await page.screenshot({ path: "line-02-void-dead.png" });
const cardsBefore = await countCards();
await page.mouse.up();
await page.waitForTimeout(600);
const deadSounds = await drain();
const cardsAfter = await countCards();
console.log("dead release -> cards:", cardsBefore, "->", cardsAfter, "sounds:", JSON.stringify(deadSounds));

// 3. n-a's ore input dragged onto the MID drawer, which refuses it: RED
// over the card, scratch on release. (The fresh source drawer from step 1
// sits far left; s-1 is the mid drawer below the cards.)
const inA2 = await page.locator('.react-flow__node[data-id="n-a"] .react-flow__handle.target').first().boundingBox();
await page.mouse.move(inA2.x + inA2.width / 2, inA2.y + inA2.height / 2);
await page.mouse.down();
const drawer = await page.locator('.react-flow__node[data-id="s-1"]').boundingBox();
await page.mouse.move(drawer.x + drawer.width / 2, drawer.y + drawer.height / 2, { steps: 8 });
await page.waitForTimeout(300);
await page.screenshot({ path: "line-03-refusing-card.png" });
await page.mouse.up();
await page.waitForTimeout(500);
console.log("refusing card sounds:", JSON.stringify(await drain()));

const deadOk = cardsBefore === cardsAfter && deadSounds.filter((s) => s === "noise").length === 2 && !deadSounds.includes("osc");
console.log(deadOk ? "DEAD RELEASE PASS" : "DEAD RELEASE FAIL");

// 4. Snap: drag n-a's mid output over n-b's mid input and hold. One grab
// sound on the transition, and the line marches green.
const outA2 = await page.locator('.react-flow__node[data-id="n-a"] .react-flow__handle.source').first().boundingBox();
await page.mouse.move(outA2.x + outA2.width / 2, outA2.y + outA2.height / 2);
await page.mouse.down();
await page.mouse.move(outA2.x + 200, outA2.y + 200, { steps: 6 });
await page.waitForTimeout(200);
await drain();
const cardB = await page.locator('.react-flow__node[data-id="n-b"]').boundingBox();
await page.mouse.move(cardB.x + 40, cardB.y + 40, { steps: 8 });
await page.waitForTimeout(300);
const snapSounds = await drain();
const marching = await page.evaluate(() => document.querySelectorAll(".connection-march").length);
await page.screenshot({ path: "line-04-snapped.png" });
await page.mouse.up();
await page.waitForTimeout(400);
console.log("snap sounds:", JSON.stringify(snapSounds), "marching paths:", marching);
const snapOk = snapSounds.filter((s) => s === "noise").length === 1 && marching === 1;
console.log(snapOk ? "SNAP PASS" : "SNAP FAIL");
await browser.close();
