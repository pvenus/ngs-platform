import browserSha256 from "../ngs-local/sites/npcgen/build/browser-sha256.mjs?raw";
import browserRequestId from "../ngs-local/sites/npcgen/build/browser-request-id.mjs?raw";
import {withPuzzleCore,servePuzzleCore,puzzleCoreCsp} from "../ngs-local/sites/npcgen/build/puzzle-core-release.mjs";
import assembly0 from "../ngs-local/sites/npcgen/build/assembly-catalog-ui.mjs?raw";
import assembly1 from "../ngs-local/sites/npcgen/build/assembly-contract.mjs?raw";
import assembly2 from "../ngs-local/sites/npcgen/build/well-assembly-ui.mjs?raw";
import assembly3 from "../ngs-local/sites/npcgen/build/well-puzzle-demo.mjs?raw";
import assembly4 from "../ngs-local/sites/npcgen/build/puzzle-state-runtime.mjs?raw";
import assembly5 from "../ngs-local/sites/npcgen/build/assembly-sprite-layout.mjs?raw";
import assembly6 from "../ngs-local/sites/npcgen/build/assembly-actor.mjs?raw";
import mapWarp from "../ngs-local/sites/npcgen/build/map-warp.mjs?raw";
import mapContract from "../ngs-local/sites/npcgen/build/map-contract.mjs?raw";
import fileUpdate from "../ngs-local/sites/npcgen/build/file-update-envelope.mjs?raw";
import mapWorkspace from "../ngs-local/sites/npcgen/build/map-workspace-ui.mjs?raw";
import backgroundPlayback from "../ngs-local/sites/npcgen/build/background-playback.mjs?raw";
import propFolderDelete from "../ngs-local/sites/npcgen/build/prop-folder-delete-contract.mjs?raw";
import html from "../ngs-local/sites/npcgen/build/local-project-page.html?raw";
import css from "../ngs-local/sites/npcgen/build/local-project-page.css?raw";
import uiAssetContract from "../ngs-local/sites/npcgen/build/ui-asset-contract.mjs?raw";
import uiWorkspaceUi from "../ngs-local/sites/npcgen/build/ui-workspace-ui.mjs?raw";
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
import {createSharedNgsResponse, withProductionAudio, withSharedPuzzlePlaytests} from "./shared-ngs-response.mjs";

const pngPrefix = "data:image/png;base64,";
if (!logo.startsWith(pngPrefix)) throw Error("SHARED_NGS_LOGO_BUILD_UNCONFIRMED");
const png = Uint8Array.from(atob(logo.slice(pngPrefix.length)), c => c.charCodeAt(0));
const javascript = "text/javascript; charset=utf-8";
const staticAssets = new Map<string, {type: string; body: string | Uint8Array}>([
 ["/browser-sha256.mjs",{type:javascript,body:browserSha256}],
 ["/browser-request-id.mjs",{type:javascript,body:browserRequestId}],
 ["/", {type: "text/html; charset=utf-8", body: withSharedPuzzlePlaytests(withPuzzleCore(withProductionAudio(html)))}],
 ["/local-project-page.css", {type: "text/css; charset=utf-8", body: css}],
 ["/ui-asset-contract.mjs", {type: javascript, body: uiAssetContract}],
 ["/ui-workspace-ui.mjs", {type: javascript, body: uiWorkspaceUi}],
 ["/local-project-page.js", {type: javascript, body: page}],
 ["/prop-package-contract.mjs", {type: javascript, body: propPackageContract}],
 ["/cinematic-sequence-contract.mjs",{type:javascript,body:cine0}],
 ["/cinematic-timeline.mjs",{type:javascript,body:cine1}],
 ["/map-warp.mjs",{type:javascript,body:mapWarp}],
 ["/assembly-catalog-ui.mjs",{type:javascript,body:assembly0}],
 ["/assembly-contract.mjs",{type:javascript,body:assembly1}],
 ["/well-assembly-ui.mjs",{type:javascript,body:assembly2}],
 ["/well-puzzle-demo.mjs",{type:javascript,body:assembly3}],
 ["/puzzle-state-runtime.mjs",{type:javascript,body:assembly4}],
 ["/assembly-sprite-layout.mjs",{type:javascript,body:assembly5}],
 ["/assembly-actor.mjs",{type:javascript,body:assembly6}],
 ["/map-contract.mjs",{type:javascript,body:mapContract}],
 ["/file-update-envelope.mjs",{type:javascript,body:fileUpdate}],
 ["/map-workspace-ui.mjs",{type:javascript,body:mapWorkspace}],
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

export const sharedNgsResponse = createSharedNgsResponse(staticAssets,{servePuzzleCore,puzzleCoreCsp});
