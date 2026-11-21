import html from "../ngs-local/sites/npcgen/build/local-project-page.html?raw";
import css from "../ngs-local/sites/npcgen/build/local-project-page.css?raw";
import page from "../ngs-local/sites/npcgen/build/local-project-page.js?raw";
import workspace from "../ngs-local/sites/npcgen/build/local-npc-workspace-ui.mjs?raw";
import oneStop from "../ngs-local/sites/npcgen/build/local-npc-one-stop-ui.mjs?raw";
import concept from "../ngs-local/sites/npcgen/build/local-concept-category-ui.mjs?raw";
import contract from "../ngs-local/sites/npcgen/build/local-concept-category-contract.mjs?raw";
import planning from "../ngs-local/sites/npcgen/build/local-npc-planning-ui.mjs?raw";
import audio from "../ngs-local/sites/npcgen/build/local-audio-workspace.mjs?raw";
import logo from "../public/assets/vinus-mark.png?inline";
import {createSharedNgsResponse, withProductionAudio} from "./shared-ngs-response.mjs";

const pngPrefix = "data:image/png;base64,";
if (!logo.startsWith(pngPrefix)) throw Error("SHARED_NGS_LOGO_BUILD_UNCONFIRMED");
const png = Uint8Array.from(atob(logo.slice(pngPrefix.length)), c => c.charCodeAt(0));
const javascript = "text/javascript; charset=utf-8";
const staticAssets = new Map<string, {type: string; body: string | Uint8Array}>([
 ["/", {type: "text/html; charset=utf-8", body: withProductionAudio(html)}],
 ["/local-project-page.css", {type: "text/css; charset=utf-8", body: css}],
 ["/local-project-page.js", {type: javascript, body: page}],
 ["/local-npc-workspace-ui.mjs", {type: javascript, body: workspace}],
 ["/local-npc-one-stop-ui.mjs", {type: javascript, body: oneStop}],
 ["/local-concept-category-ui.mjs", {type: javascript, body: concept}],
 ["/local-concept-category-contract.mjs", {type: javascript, body: contract}],
 ["/local-npc-planning-ui.mjs", {type: javascript, body: planning}],
 ["/local-audio-workspace.mjs", {type: javascript, body: audio}],
 ["/assets/vinus-mark.png", {type: "image/png", body: png}],
]);

export const sharedNgsResponse = createSharedNgsResponse(staticAssets);
