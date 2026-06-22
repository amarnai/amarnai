// Email sending lives in the shared @amarnai/email package so both the web app
// and the API server can send the same transactional emails. This module is a
// thin re-export kept for the existing "@/lib/email" import sites.
export {
  sendVerificationEmail,
  sendWorkspaceInvitationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "@amarnai/email";
