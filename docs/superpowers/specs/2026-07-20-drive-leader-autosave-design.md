# Drive leader autosave

## Goal

Keep the Google Drive snapshot current after collaborative block edits without
allowing multiple peers to write the same file.

## Behavior

- A local edit continues to save immediately to IndexedDB.
- When the current peer is the collaboration leader, an edit schedules a Drive
  save after two seconds of inactivity.
- Further edits restart the delay so a continuous block drag or editing burst
  produces one Drive write.
- A follower never schedules or performs a Drive write.
- Manual **Save to Google Drive** remains available and saves immediately.
- The Drive status is `Unsynced` while a save is pending, `Syncing…` while the
  write is running, and `Synced` after success.
- Disconnection, leadership loss, conflict, or a failed write prevents automatic
  persistence. Local IndexedDB data remains intact and the status explains that
  Drive is not current.

## Design

Add a small autosave coordinator at the editor integration boundary. It receives
edit notifications from `markDirty`, owns the debounce timer, and calls the
existing `driveIntegration.saveToDrive()` operation. Existing collaboration
write gates remain the source of truth for leadership and connection safety.

The coordinator must re-check eligibility when its timer fires. It must cancel a
pending timer when leaving a room, disconnecting Google, changing projects, or
losing leadership. At most one Drive save may run at a time; changes arriving
during a save schedule one follow-up save.

## Error handling

The existing Drive integration maps authentication, network, permission, and
conflict failures to visible statuses. Autosave does not retry continuously
after a failure. A later edit or explicit manual save may try again.

## Tests

- Leader edits are debounced into one Drive save.
- Repeated edits restart the delay.
- Followers never autosave.
- A pending save is cancelled when the peer becomes ineligible.
- An edit during an in-flight save produces one follow-up save.
- Existing manual save, conflict, local persistence, and collaboration tests
  remain green.
