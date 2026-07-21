/**
 * Google Drive disconnect must not tear down an active collaboration room.
 * Drive is optional backup; Collab continues with the local project.
 */
export function shouldLeaveCollaborationOnGoogleDisconnect(): boolean {
  return false;
}
