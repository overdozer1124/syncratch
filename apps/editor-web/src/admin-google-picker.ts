import {loadGoogleScripts} from "@blocksync/google-drive-sync";

interface GapiGlobal {
  load(
    module: string,
    options: {
      callback(): void;
      onerror(): void;
    },
  ): void;
}

interface PickerView {
  setMimeTypes(mimeTypes: string): PickerView;
}

interface DocsView extends PickerView {
  setIncludeFolders(include: boolean): DocsView;
  setSelectFolderEnabled(enabled: boolean): DocsView;
  setEnableDrives(enabled: boolean): DocsView;
  setOwnedByMe(ownedByMe: boolean): DocsView;
}

interface PickerBuilder {
  setDeveloperKey(value: string): PickerBuilder;
  setAppId(value: string): PickerBuilder;
  setOAuthToken(value: string): PickerBuilder;
  setOrigin(value: string): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  addView(value: PickerView): PickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): {setVisible(visible: boolean): void};
}

interface PickerGlobal {
  Action: {PICKED: string; CANCEL: string};
  Response: {DOCUMENTS: string};
  Document: {ID: string};
  Feature: {SUPPORT_DRIVES: string};
  DocsView: new () => DocsView;
  PickerBuilder: new () => PickerBuilder;
}

interface GoogleBrowserGlobal {
  picker: PickerGlobal;
}

function googleGlobal(): GoogleBrowserGlobal | undefined {
  return (window as unknown as {google?: GoogleBrowserGlobal}).google;
}

function gapiGlobal(): GapiGlobal | undefined {
  return (window as unknown as {gapi?: GapiGlobal}).gapi;
}

let pickerInitPromise: Promise<void> | undefined;

async function ensurePickerLoaded(): Promise<void> {
  pickerInitPromise ??= (async () => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY?.trim() ?? "";
    const appId = import.meta.env.VITE_GOOGLE_APP_ID?.trim() ?? "";
    if (!apiKey || !appId) {
      throw new Error("Google Picker API key / app ID is not configured");
    }
    await loadGoogleScripts()();
    const gapi = gapiGlobal();
    if (!gapi) throw new Error("Google API loader did not initialize");
    await new Promise<void>((resolve, reject) => {
      gapi.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("Google Picker failed to load")),
      });
    });
  })();
  await pickerInitPromise;
}

function raisePickerAboveAdmin(): void {
  for (const node of document.querySelectorAll<HTMLElement>(
    ".picker-dialog, .picker-dialog-bg",
  )) {
    node.style.zIndex = "2147483647";
  }
}

export async function pickTeacherDriveFolder(accessToken: string): Promise<string | null> {
  await ensurePickerLoaded();
  const picker = googleGlobal()?.picker;
  if (!picker) throw new Error("Google Picker did not initialize");

  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY?.trim() ?? "";
  const appId = import.meta.env.VITE_GOOGLE_APP_ID?.trim() ?? "";

  return new Promise<string | null>((resolve, reject) => {
    const built = new picker.PickerBuilder()
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setOAuthToken(accessToken)
      .setOrigin(window.location.origin)
      .addView(
        new picker.DocsView()
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true),
      )
      .addView(
        new picker.DocsView()
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setEnableDrives(true),
      )
      .setCallback((data: Record<string, unknown>) => {
        if (data.action === picker.Action.CANCEL) {
          resolve(null);
          return;
        }
        if (data.action !== picker.Action.PICKED) return;
        const documents = data[picker.Response.DOCUMENTS] as unknown;
        const first = Array.isArray(documents) ? documents[0] : undefined;
        const folderId =
          typeof first === "object" && first !== null
            ? (first as Record<string, unknown>)[picker.Document.ID]
            : undefined;
        if (typeof folderId !== "string" || !folderId) {
          reject(new Error("Google Picker returned no folder ID"));
          return;
        }
        resolve(folderId);
      })
      .build();
    built.setVisible(true);
    raisePickerAboveAdmin();
    requestAnimationFrame(raisePickerAboveAdmin);
  });
}

/** Test hook — reset lazy Picker init between jsdom tests. */
export function resetAdminGooglePickerForTests(): void {
  pickerInitPromise = undefined;
}
