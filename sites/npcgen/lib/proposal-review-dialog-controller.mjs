// UI-only modal lifecycle. Closing/Escape never choose or discard a request.
export function createProposalReviewDialogController({dialog,busy,focusInitial,opened}){
 let opener=null;
 return {
  open(trigger){const d=dialog();if(!d||d.open||busy())return false;opener=trigger;d.showModal();focusInitial();opened?.();return true;},
  close(){const d=dialog();if(!d?.open||busy())return false;d.close();return true;},
  cancel(event){if(busy())event.preventDefault();},
  closed(){if(opener?.isConnected)opener.focus({preventScroll:true});opener=null;},
  keyDown(event){
   const d=dialog();if(event.defaultPrevented||event.key!=='Tab'||event.target?.closest?.('dialog')!==d)return;
   const elements=Array.from(d.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')).filter(e=>e.getClientRects().length);
   const first=elements[0],last=elements.at(-1);
   if(!first){event.preventDefault();d.focus();return;}
   const active=d.ownerDocument.activeElement;
   if(event.shiftKey&&active===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}
  }
 };
}
