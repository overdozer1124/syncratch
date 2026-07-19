export const CLASSROOM_REQUEST_MAX_BYTES = 32 * 1024;

const FORBIDDEN_KEYS = new Set([
  "project",
  "projectdocument",
  "projectpayload",
  "yjsupdate",
  "sb3",
  "assets",
  "assetbytes",
  "accesstoken",
  "refreshtoken",
  "pickertoken",
]);
const ALLOWED_ACTIONS = new Set([
  "listRoster",
  "getRoom",
  "upsertRoom",
  "createInvitation",
  "setDrivePermission",
]);

export type ClassroomAdapterErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "UNAVAILABLE"
  | "FORBIDDEN";

export class ClassroomAdapterError extends Error {
  readonly code: ClassroomAdapterErrorCode;

  constructor(code: ClassroomAdapterErrorCode, message: string) {
    super(message);
    this.name = "ClassroomAdapterError";
    this.code = code;
  }
}

export interface RosterMember {
  email: string;
  displayName: string;
  role: "teacher" | "student";
}

export interface ClassroomRoom {
  roomId: string;
  driveFileId: string;
  classId: string;
  inviteFragment?: string;
  updatedAt?: string;
}

export interface ClassroomInvitation {
  invitationId: string;
  classId: string;
  roomId: string;
  driveFileId: string;
  inviteFragment: string;
  expiresAt: string;
}

export interface DrivePermissionRequest {
  fileId: string;
  email: string;
  role: "reader" | "writer";
}

type ClassroomRequest = {action: string} & Record<string, unknown>;

function invalidRequest(message: string): never {
  throw new ClassroomAdapterError("INVALID_REQUEST", message);
}

export function validateClassroomRequest(request: unknown): asserts request is ClassroomRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    invalidRequest("Classroom request must be an object");
  }
  const action = (request as Record<string, unknown>).action;
  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
    invalidRequest("Classroom request action is not allowed");
  }

  const stack: Array<{value: unknown; depth: number}> = [{value: request, depth: 0}];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > 10_000 || current.depth > 32) {
      invalidRequest("Classroom request is too deeply nested");
    }
    if (Array.isArray(current.value)) {
      for (const value of current.value) {
        stack.push({value, depth: current.depth + 1});
      }
      continue;
    }
    if (current.value && typeof current.value === "object") {
      for (const [key, value] of Object.entries(current.value)) {
        if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
          invalidRequest("Classroom request must not contain project payloads or credentials");
        }
        stack.push({value, depth: current.depth + 1});
      }
    }
  }

  const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
  if (bytes > CLASSROOM_REQUEST_MAX_BYTES) {
    invalidRequest("Classroom request exceeds the 32 KiB metadata limit");
  }
}

interface SuccessResponse<T> {
  ok: true;
  data: T;
}

interface ErrorResponse {
  ok: false;
  error?: {code?: string; message?: string};
}

function parseResponse<T>(value: unknown): T {
  if (!value || typeof value !== "object") {
    throw new ClassroomAdapterError("INVALID_RESPONSE", "Classroom adapter returned an invalid response");
  }
  const response = value as SuccessResponse<T> | ErrorResponse;
  if (response.ok === true && "data" in response) return response.data;
  if (response.ok === false && response.error?.code === "FORBIDDEN") {
    throw new ClassroomAdapterError("FORBIDDEN", "Classroom adapter denied the request");
  }
  if (
    response.ok === false &&
    (response.error?.code === "UNAVAILABLE" ||
      response.error?.code === "CONFIGURATION")
  ) {
    throw new ClassroomAdapterError("UNAVAILABLE", "Classroom adapter is unavailable");
  }
  if (response.ok === false && response.error?.code === "INVALID_REQUEST") {
    throw new ClassroomAdapterError("INVALID_REQUEST", "Classroom adapter rejected the request");
  }
  throw new ClassroomAdapterError("INVALID_RESPONSE", "Classroom adapter returned an invalid response");
}

export interface ClassroomAppsScriptClientOptions {
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  getIdentityToken: () => Promise<string>;
  timeoutMs?: number;
}

export interface ClassroomAppsScriptClient {
  listRoster(classId: string): Promise<RosterMember[]>;
  getRoom(roomId: string): Promise<ClassroomRoom | null>;
  upsertRoom(room: ClassroomRoom): Promise<ClassroomRoom>;
  createInvitation(invitation: Omit<ClassroomInvitation, "invitationId">): Promise<ClassroomInvitation>;
  setDrivePermission(permission: DrivePermissionRequest): Promise<{applied: true}>;
}

export function createClassroomAppsScriptClient(
  options: ClassroomAppsScriptClientOptions,
): ClassroomAppsScriptClient {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== "https:") {
    throw new ClassroomAdapterError("INVALID_REQUEST", "Classroom adapter endpoint must use HTTPS");
  }
  const requestFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const call = async <T>(request: ClassroomRequest): Promise<T> => {
    let identityToken: string;
    try {
      identityToken = await options.getIdentityToken();
    } catch {
      throw new ClassroomAdapterError(
        "UNAVAILABLE",
        "Classroom adapter authentication is unavailable",
      );
    }
    if (!identityToken) {
      throw new ClassroomAdapterError(
        "UNAVAILABLE",
        "Classroom adapter authentication is unavailable",
      );
    }
    const authenticatedRequest = {...request, identityToken};
    validateClassroomRequest(authenticatedRequest);
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await requestFetch(endpoint, {
        method: "POST",
        credentials: "omit",
        headers: {"content-type": "text/plain;charset=utf-8"},
        body: JSON.stringify(authenticatedRequest),
        signal: controller.signal,
      });
    } catch {
      throw new ClassroomAdapterError("UNAVAILABLE", "Classroom adapter is unavailable");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ClassroomAdapterError("UNAVAILABLE", "Classroom adapter is unavailable");
    }
    try {
      return parseResponse<T>(await response.json());
    } catch (error) {
      if (error instanceof ClassroomAdapterError) throw error;
      throw new ClassroomAdapterError("INVALID_RESPONSE", "Classroom adapter returned an invalid response");
    }
  };

  return {
    async listRoster(classId) {
      const data = await call<{members: RosterMember[]}>({action: "listRoster", classId});
      if (!data || !Array.isArray(data.members)) {
        throw new ClassroomAdapterError(
          "INVALID_RESPONSE",
          "Classroom adapter returned an invalid response",
        );
      }
      return data.members;
    },
    getRoom: roomId => call<ClassroomRoom | null>({action: "getRoom", roomId}),
    upsertRoom: room => call<ClassroomRoom>({action: "upsertRoom", room}),
    createInvitation: invitation =>
      call<ClassroomInvitation>({action: "createInvitation", invitation}),
    setDrivePermission: permission =>
      call<{applied: true}>({action: "setDrivePermission", permission}),
  };
}
