var BLOCKSYNC_MAX_REQUEST_BYTES = 32 * 1024;
var BLOCKSYNC_ACTIONS = {
  listRoster: true,
  getRoom: true,
  upsertRoom: true,
  createInvitation: true,
  setDrivePermission: true
};
var BLOCKSYNC_FORBIDDEN_KEYS = {
  project: true,
  projectdocument: true,
  projectpayload: true,
  yjsupdate: true,
  sb3: true,
  assets: true,
  assetbytes: true,
  accesstoken: true,
  refreshtoken: true,
  pickertoken: true
};

function _error(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function _safeSheetText(value, field) {
  var text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    throw _error("INVALID_REQUEST", "Unsafe spreadsheet value for " + field);
  }
  return text;
}

function _json(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function _validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw _error("INVALID_REQUEST", "Classroom request must be an object");
  }
  if (typeof request.action !== "string" || !BLOCKSYNC_ACTIONS[request.action]) {
    throw _error("INVALID_REQUEST", "Classroom request action is not allowed");
  }
  var stack = [{value: request, depth: 0}];
  var nodes = 0;
  while (stack.length > 0) {
    var current = stack.pop();
    nodes += 1;
    if (nodes > 10000 || current.depth > 32) {
      throw _error("INVALID_REQUEST", "Classroom request is too deeply nested");
    }
    if (Array.isArray(current.value)) {
      current.value.forEach(function (value) {
        stack.push({value: value, depth: current.depth + 1});
      });
    } else if (current.value && typeof current.value === "object") {
      Object.keys(current.value).forEach(function (key) {
        if (BLOCKSYNC_FORBIDDEN_KEYS[key.toLowerCase()]) {
          throw _error(
            "INVALID_REQUEST",
            "Classroom request must not contain project payloads or credentials"
          );
        }
        stack.push({
          value: current.value[key],
          depth: current.depth + 1
        });
      });
    }
  }
  if (
    Utilities.newBlob(JSON.stringify(request)).getBytes().length >
    BLOCKSYNC_MAX_REQUEST_BYTES
  ) {
    throw _error(
      "INVALID_REQUEST",
      "Classroom request exceeds the 32 KiB metadata limit"
    );
  }
}

function _properties() {
  return PropertiesService.getScriptProperties();
}

function _verifyIdentityToken(identityToken) {
  if (typeof identityToken !== "string" || identityToken.length < 20) {
    throw _error("FORBIDDEN", "Google account access is required");
  }
  var expectedAudience = _properties().getProperty("BLOCKSYNC_GOOGLE_CLIENT_ID");
  if (!expectedAudience) {
    throw _error("CONFIGURATION", "Classroom identity verification is not configured");
  }
  var response = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" +
      encodeURIComponent(identityToken),
    {muteHttpExceptions: true}
  );
  if (response.getResponseCode() !== 200) {
    throw _error("FORBIDDEN", "Google account access is required");
  }
  var claims = JSON.parse(response.getContentText());
  var verified = claims.email_verified === true ||
    String(claims.email_verified).toLowerCase() === "true";
  var expiresAt = Number(claims.exp || 0);
  if (
    claims.aud !== expectedAudience ||
    !verified ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    typeof claims.email !== "string" ||
    claims.email.length === 0
  ) {
    throw _error("FORBIDDEN", "Google account access is required");
  }
  return claims.email.trim().toLowerCase();
}

function _adminEmails() {
  return String(_properties().getProperty("BLOCKSYNC_ADMIN_EMAILS") || "")
    .split(",")
    .map(function (email) { return email.trim().toLowerCase(); })
    .filter(function (email) { return email.length > 0; });
}

function _requireAdmin(actor) {
  if (_adminEmails().indexOf(actor) === -1) {
    throw _error("FORBIDDEN", "Classroom administrator access is required");
  }
}

function _spreadsheet() {
  var id = _properties().getProperty("BLOCKSYNC_SHEET_ID");
  if (!id) {
    throw _error("CONFIGURATION", "BLOCKSYNC_SHEET_ID is not configured");
  }
  return SpreadsheetApp.openById(id);
}

function _sheet(name, headers) {
  var spreadsheet = _spreadsheet();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _objects(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(String);
  return values.slice(1).map(function (row, index) {
    var value = {_row: index + 2};
    headers.forEach(function (header, column) {
      value[header] = row[column];
    });
    return value;
  });
}

function _rosterRows() {
  return _objects(_sheet("Roster", [
    "classId", "email", "displayName", "role", "active"
  ]));
}

function _isTeacher(actor, classId) {
  if (_adminEmails().indexOf(actor) !== -1) return true;
  return _rosterRows().some(function (row) {
    return String(row.classId) === String(classId) &&
      String(row.email).toLowerCase() === actor &&
      String(row.role) === "teacher" &&
      row.active !== false &&
      String(row.active).toLowerCase() !== "false";
  });
}

function _requireTeacher(actor, classId) {
  if (!_isTeacher(actor, classId)) {
    throw _error("FORBIDDEN", "Teacher access is required for this class");
  }
}

function _listRoster(request, actor) {
  _requireTeacher(actor, request.classId);
  var members = _rosterRows()
    .filter(function (row) {
      return String(row.classId) === String(request.classId) &&
        row.active !== false &&
        String(row.active).toLowerCase() !== "false";
    })
    .map(function (row) {
      return {
        email: String(row.email),
        displayName: String(row.displayName),
        role: String(row.role)
      };
    });
  return {members: members};
}

function _roomsSheet() {
  return _sheet("Rooms", [
    "roomId", "classId", "driveFileId", "inviteFragment",
    "updatedAt", "updatedBy"
  ]);
}

function _getRoom(request, actor) {
  var room = _objects(_roomsSheet()).filter(function (row) {
    return String(row.roomId) === String(request.roomId);
  })[0];
  if (!room) return null;
  _requireTeacher(actor, room.classId);
  return {
    roomId: String(room.roomId),
    classId: String(room.classId),
    driveFileId: String(room.driveFileId),
    inviteFragment: String(room.inviteFragment),
    updatedAt: String(room.updatedAt)
  };
}

function _upsertRoom(request, actor) {
  var room = request.room || {};
  _requireTeacher(actor, room.classId);
  if (!room.roomId || !room.classId || !room.driveFileId) {
    throw _error("INVALID_REQUEST", "roomId, classId, and driveFileId are required");
  }
  var sheet = _roomsSheet();
  var existing = _objects(sheet).filter(function (row) {
    return String(row.roomId) === String(room.roomId);
  })[0];
  if (existing) {
    _requireTeacher(actor, existing.classId);
    if (String(existing.classId) !== String(room.classId)) {
      throw _error("FORBIDDEN", "A room cannot be moved between classes");
    }
  }
  var updatedAt = new Date().toISOString();
  var values = [[
    _safeSheetText(room.roomId, "roomId"),
    _safeSheetText(room.classId, "classId"),
    _safeSheetText(room.driveFileId, "driveFileId"),
    _safeSheetText(room.inviteFragment || "", "inviteFragment"),
    updatedAt,
    actor
  ]];
  if (existing) {
    sheet.getRange(existing._row, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
  return {
    roomId: String(room.roomId),
    classId: String(room.classId),
    driveFileId: String(room.driveFileId),
    inviteFragment: String(room.inviteFragment || ""),
    updatedAt: updatedAt
  };
}

function _createInvitation(request, actor) {
  var invitation = request.invitation || {};
  _requireTeacher(actor, invitation.classId);
  if (
    !invitation.classId ||
    !invitation.roomId ||
    !invitation.driveFileId ||
    !invitation.inviteFragment ||
    !invitation.expiresAt
  ) {
    throw _error("INVALID_REQUEST", "Invitation metadata is incomplete");
  }
  var invitationId = Utilities.getUuid();
  var createdAt = new Date().toISOString();
  _sheet("Invitations", [
    "invitationId", "classId", "roomId", "driveFileId", "inviteFragment",
    "expiresAt", "createdBy", "createdAt"
  ]).appendRow([
    invitationId,
    _safeSheetText(invitation.classId, "classId"),
    _safeSheetText(invitation.roomId, "roomId"),
    _safeSheetText(invitation.driveFileId, "driveFileId"),
    _safeSheetText(invitation.inviteFragment, "inviteFragment"),
    _safeSheetText(invitation.expiresAt, "expiresAt"),
    actor,
    createdAt
  ]);
  return {
    invitationId: invitationId,
    classId: String(invitation.classId),
    roomId: String(invitation.roomId),
    driveFileId: String(invitation.driveFileId),
    inviteFragment: String(invitation.inviteFragment),
    expiresAt: String(invitation.expiresAt)
  };
}

function _setDrivePermission(request, actor) {
  _requireAdmin(actor);
  var permission = request.permission || {};
  var allowedDomain = String(
    _properties().getProperty("BLOCKSYNC_ALLOWED_EMAIL_DOMAIN") || ""
  ).trim().toLowerCase();
  if (
    !permission.fileId ||
    !permission.email ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(permission.email)) ||
    (
      allowedDomain &&
      !String(permission.email).toLowerCase().endsWith("@" + allowedDomain)
    ) ||
    (permission.role !== "reader" && permission.role !== "writer")
  ) {
    throw _error("INVALID_REQUEST", "Drive permission metadata is invalid");
  }
  var file = DriveApp.getFileById(String(permission.fileId));
  if (permission.role === "writer") {
    file.addEditor(String(permission.email));
  } else {
    file.addViewer(String(permission.email));
  }
  _sheet("PermissionResults", [
    "fileId", "email", "role", "appliedBy", "appliedAt"
  ]).appendRow([
    _safeSheetText(permission.fileId, "fileId"),
    _safeSheetText(permission.email, "email"),
    _safeSheetText(permission.role, "role"),
    actor,
    new Date().toISOString()
  ]);
  return {applied: true};
}

function _dispatch(request, actor) {
  switch (request.action) {
    case "listRoster": return _listRoster(request, actor);
    case "getRoom": return _getRoom(request, actor);
    case "upsertRoom": return _upsertRoom(request, actor);
    case "createInvitation": return _createInvitation(request, actor);
    case "setDrivePermission": return _setDrivePermission(request, actor);
    default: throw _error("INVALID_REQUEST", "Classroom request action is not allowed");
  }
}

function _dispatchWithLock(request, actor) {
  if (request.action === "listRoster" || request.action === "getRoom") {
    return _dispatch(request, actor);
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw _error("UNAVAILABLE", "Classroom adapter is busy");
  }
  try {
    return _dispatch(request, actor);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return _json({
    ok: true,
    data: {service: "blocksync-classroom-adapter", version: 1}
  });
}

function doPost(event) {
  try {
    var contents = event && event.postData && event.postData.contents;
    if (typeof contents !== "string") {
      throw _error("INVALID_REQUEST", "Request body is required");
    }
    if (
      event.postData.length > BLOCKSYNC_MAX_REQUEST_BYTES ||
      Utilities.newBlob(contents).getBytes().length > BLOCKSYNC_MAX_REQUEST_BYTES
    ) {
      throw _error(
        "INVALID_REQUEST",
        "Classroom request exceeds the 32 KiB metadata limit"
      );
    }
    var request = JSON.parse(contents);
    _validateRequest(request);
    var actor = _verifyIdentityToken(request.identityToken);
    delete request.identityToken;
    return _json({ok: true, data: _dispatchWithLock(request, actor)});
  } catch (error) {
    var known = error && error.code;
    var code = known ? String(error.code) : "UNAVAILABLE";
    var message = known
      ? String(error.message)
      : "Classroom adapter is unavailable";
    if (!known && typeof console !== "undefined") {
      console.error("Classroom adapter request failed");
    }
    return _json({ok: false, error: {code: code, message: message}});
  }
}
