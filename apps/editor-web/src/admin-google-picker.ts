import {loadGoogleScripts} from "@blocksync/google-drive-sync";

type GooglePickerGlobal = {
  picker: {
    PickerBuilder: new () => {
      enableFeature(feature: unknown): GooglePickerGlobal["picker"]["PickerBuilder"];
      setDeveloperKey(key: string): GooglePickerGlobal["picker"]["PickerBuilder"];
      setAppId(appId: string): GooglePickerGlobal["picker"]["PickerBuilder"];
      setOAuthToken(token: string): GooglePickerGlobal["picker"]["PickerBuilder"];
      setOrigin(origin: string): GooglePickerGlobal["picker"]["PickerBuilder"];
      addView(view: unknown): GooglePickerGlobal["picker"]["PickerBuilder"];
      setCallback(
        callback: (data: Record<string, unknown>) => void,
      ): GooglePickerGlobal["picker"]["PickerBuilder"];
      build(): {setVisible(visible: boolean): void};
    };
    DocsView: new () => {
      setIncludeFolders(include: boolean): unknown;
      setSelectFolderEnabled(enabled: boolean): unknown;
      setEnableDrives(enabled: boolean): unknown;
    };
    Feature: {SUPPORT_DRIVES: unknown};
    Action: {CANCEL: string; PICKED: string};
    Response: {DOCUMENTS: string};
    Document: {ID: string};
  };
};

type GapiGlobal = {
  load: (
    api: string,
    options: {callback: () => void; onerror?: () => void},
  ) => void;
};

function googleGlobal(): GooglePickerGlobal | undefined {
  return (window as unknown as {google?: GooglePickerGlobal}).google;
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
      .setCallback(data => {
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
