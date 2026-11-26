import backgroundPlayback from "../ngs-local/sites/npcgen/build/background-playback.mjs?raw";
import propFolderDelete from "../ngs-local/sites/npcgen/build/prop-folder-delete-contract.mjs?raw";
import html from "../ngs-local/sites/npcgen/build/local-project-page.html?raw";
import css from "../ngs-local/sites/npcgen/build/local-project-page.css?raw";
import page from "../ngs-local/sites/npcgen/build/local-project-page.js?raw";
import propPackageContract from "../ngs-local/sites/npcgen/build/prop-package-contract.mjs?raw";
import cine0 from "../ngs-local/sites/npcgen/build/cinematic-sequence-contract.mjs?raw";
import cine1 from "../ngs-local/sites/npcgen/build/cinematic-timeline.mjs?raw";
import cine2 from "../ngs-local/sites/npcgen/build/cinematic-player.mjs?raw";
import catalogRosterEdit from "../ngs-local/sites/npcgen/build/catalog-roster-edit.mjs?raw";
import cinematicWorkspace from "../ngs-local/sites/npcgen/build/cinematic-workspace-ui.mjs?raw";
import cinematicContract from "../ngs-local/sites/npcgen/build/cinematic-contract.mjs?raw";
import propWorkspace from "../ngs-local/sites/npcgen/build/prop-workspace-ui.mjs?raw";
import propContract from "../ngs-local/sites/npcgen/build/prop-workspace-contract.mjs?raw";
import workspace from "../ngs-local/sites/npcgen/build/local-npc-workspace-ui.mjs?raw";
import oneStop from "../ngs-local/sites/npcgen/build/local-npc-one-stop-ui.mjs?raw";
import motionSelection from "../ngs-local/sites/npcgen/build/npc-motion-selection.mjs?raw";
import concept from "../ngs-local/sites/npcgen/build/local-concept-category-ui.mjs?raw";
import contract from "../ngs-local/sites/npcgen/build/local-concept-category-contract.mjs?raw";
import planning from "../ngs-local/sites/npcgen/build/local-npc-planning-ui.mjs?raw";
import audio from "../ngs-local/sites/npcgen/build/local-audio-workspace.mjs?raw";
import queue from "../ngs-local/sites/npcgen/build/local-request-queue-browser.mjs?raw";
import motionConversion from "../ngs-local/sites/npcgen/build/motion-preset-convert-2d.mjs?raw";
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
 ["/prop-package-contract.mjs", {type: javascript, body: propPackageContract}],
 ["/cinematic-sequence-contract.mjs",{type:javascript,body:cine0}],
 ["/cinematic-timeline.mjs",{type:javascript,body:cine1}],
 ["/background-playback.mjs",{type:javascript,body:backgroundPlayback}],
 ["/cinematic-player.mjs",{type:javascript,body:cine2}],
 ["/prop-folder-delete-contract.mjs",{type:javascript,body:propFolderDelete}],
 ["/catalog-roster-edit.mjs",{type:javascript,body:catalogRosterEdit}],
 ["/cinematic-workspace-ui.mjs",{type:javascript,body:cinematicWorkspace}],
 ["/cinematic-contract.mjs",{type:javascript,body:cinematicContract}],
 ["/prop-workspace-ui.mjs",{type:javascript,body:propWorkspace}],
 ["/prop-workspace-contract.mjs",{type:javascript,body:propContract}],
 ["/local-npc-workspace-ui.mjs", {type: javascript, body: workspace}],
 ["/local-npc-one-stop-ui.mjs", {type: javascript, body: oneStop}],
 ["/npc-motion-selection.mjs", {type: javascript, body: motionSelection}],
 ["/local-concept-category-ui.mjs", {type: javascript, body: concept}],
 ["/local-concept-category-contract.mjs", {type: javascript, body: contract}],
 ["/local-npc-planning-ui.mjs", {type: javascript, body: planning}],
 ["/local-audio-workspace.mjs", {type: javascript, body: audio}],
 ["/local-request-queue-browser.mjs", {type: javascript, body: queue}],
 ["/motion-preset-convert-2d.mjs", {type: javascript, body: motionConversion}],
 ["/assets/vinus-mark.png", {type: "image/png", body: png}],
]);

export const sharedNgsResponse = createSharedNgsResponse(staticAssets);
