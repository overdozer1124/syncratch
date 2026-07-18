import {DriveConfigurationError} from "./errors.js";

export const SB3_MIME_TYPE = "application/x.scratch.sb3";

export interface PickerCallbackData {
  action?: string;
  documents?: Array<{id?: string}>;
}

export interface PickerBuildOptions {
  apiKey: string;
  appId: string;
  accessToken: string;
  mimeType: string;
  callback(data: PickerCallbackData): void;
}

export interface GooglePicker {
  pickFile(accessToken: string): Promise<string | null>;
}

export interface GooglePickerOptions {
  apiKey: string;
  appId: string;
  initializePicker: () => Promise<void>;
  buildPicker: (options: PickerBuildOptions) => {
    setVisible(visible: boolean): void;
  };
}

export function createGooglePicker(options: GooglePickerOptions): GooglePicker {
  let initialized = false;
  return {
    async pickFile(accessToken) {
      if (!options.apiKey || !options.appId) {
        throw new DriveConfigurationError(
          "Google Picker API key and app ID are required",
        );
      }
      if (!initialized) {
        await options.initializePicker();
        initialized = true;
      }
      return new Promise<string | null>((resolve, reject) => {
        const picker = options.buildPicker({
          apiKey: options.apiKey,
          appId: options.appId,
          accessToken,
          mimeType: SB3_MIME_TYPE,
          callback(data) {
            if (data.action === "cancel") {
              resolve(null);
              return;
            }
            if (data.action !== "picked") return;
            const fileId = data.documents?.[0]?.id;
            if (!fileId) {
              reject(new DriveConfigurationError(
                "Google Picker returned no file ID",
              ));
              return;
            }
            resolve(fileId);
          },
        });
        picker.setVisible(true);
      });
    },
  };
}
