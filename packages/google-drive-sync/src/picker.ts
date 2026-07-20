import {DriveConfigurationError} from "./errors.js";

export const SB3_MIME_TYPE = "application/x.scratch.sb3";

export interface PickerCallbackData {
  action?: string;
  documents?: Array<{id?: string}>;
}

export interface PickFileOptions {
  /**
   * When set, the Picker shows only these Drive file IDs (comma-separated
   * under the hood). Used for collaboration join so guests confirm the
   * shared invite file instead of browsing Shared drives.
   */
  fileIds?: string[];
}

export interface PickerBuildOptions {
  apiKey: string;
  appId: string;
  accessToken: string;
  mimeType: string;
  fileIds?: string[];
  callback(data: PickerCallbackData): void;
}

export interface GooglePicker {
  pickFile(
    accessToken: string,
    options?: PickFileOptions,
  ): Promise<string | null>;
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
    async pickFile(accessToken, pickOptions = {}) {
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
          fileIds: pickOptions.fileIds,
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
