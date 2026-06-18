// Re-export shim. The canonical API-response -> view-model mapping lives in
// @amarnai/core/emails so both the web app and the mobile app share it.
export { mapThreads, mapFolders } from "@amarnai/core/emails";
