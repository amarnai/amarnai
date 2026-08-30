// Draft presentation helpers shared by every surface that inserts an Aziru
// draft into a mail client's own compose: the Gmail content script and the
// Outlook task pane. Kept as its own entry point rather than folded into
// ./emails so the extension's content-script bundle does not pull the emails
// module tree (and React with it) in for one pure function.
export { draftBodyToHtml } from "./draftBody.js";
