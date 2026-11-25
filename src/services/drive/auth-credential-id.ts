import { DRIVE_CLIENT_ID } from "./types.js";

/** Local vault namespace only; this identifier is never part of portable data. */
export const driveCredentialId = (owner: string, clientId = DRIVE_CLIENT_ID): string =>
  `drive-auth:${clientId}:${owner}`;
