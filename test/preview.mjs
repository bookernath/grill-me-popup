// Opens the popup with a sample round so you can look at it without a grilling session.
//   npm run preview                      → opens a Chrome app window
//   GRILL_NO_OPEN=1 npm run preview      → just prints the URL
//   PREVIEW_CLOSE=1 npm run preview      → after you submit, exercises grill_close too
//   PREVIEW_LOOP=1 npm run preview       → keep re-asking the round until it is actually submitted (screenshots, theme work)
import { askRound, ensureServer, uiUrl, closeSession } from "../ui-server.mjs";
import { SAMPLE } from "./sample-round.mjs";

const keepAlive = setInterval(() => {}, 60_000); // the ui server is unref'd; keep the loop alive
await ensureServer();
console.log("URL:", uiUrl());

let res;
do { res = await askRound(SAMPLE, { timeoutMs: 30 * 60_000 }); }
while (process.env.PREVIEW_LOOP === "1" && res.outcome !== "submitted");
console.log("\n--- outcome ---");
console.log(JSON.stringify(res, null, 2));
if (process.env.PREVIEW_CLOSE === "1") {
  closeSession("Preview over — 5 decisions settled in 1 round.");
  await new Promise((r) => setTimeout(r, 4000));
}
process.exit(0);
