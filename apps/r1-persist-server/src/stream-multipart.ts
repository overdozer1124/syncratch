import Busboy from "busboy";
import { Readable } from "node:stream";
import { BadRequestError } from "@blocksync/project-service";

export interface StreamMultipartFileResult {
  title: string;
  bytesWritten: number;
}

function drainStream(stream: Readable): void {
  stream.on("data", () => {});
  stream.resume();
}

function cancelRequestBody(body: ReadableStream<Uint8Array>, reason: string): void {
  void body.cancel(reason).catch(() => {
    /* ignore */
  });
}

/**
 * Stream the `file` field of a multipart body to a writer without buffering
 * the entire upload in memory. Hard-rejects when file exceeds maxFileBytes.
 */
export async function streamMultipartSb3File(
  req: Request,
  maxFileBytes: number,
  writeStream: (fileStream: Readable) => Promise<number>,
): Promise<StreamMultipartFileResult> {
  const contentType = req.headers.get("content-type");
  if (!contentType?.includes("multipart/form-data")) {
    throw new BadRequestError("Content-Type must be multipart/form-data");
  }
  if (!req.body) {
    throw new BadRequestError("request body required");
  }

  const webBody = req.body as ReadableStream<Uint8Array>;

  return new Promise((resolve, reject) => {
    let title = "";
    let fileSeen = false;
    let settled = false;
    let rejectErr: Error | null = null;
    let writerPromise: Promise<number> | null = null;
    let busboyFinished = false;
    let fileTruncated = false;
    let failureScheduled = false;

    const settleOnce = (
      action: "resolve" | "reject",
      value: StreamMultipartFileResult | Error,
    ) => {
      if (settled) return;
      settled = true;
      queueMicrotask(() => {
        if (action === "resolve") {
          resolve(value as StreamMultipartFileResult);
        } else {
          reject(value as Error);
        }
      });
    };

    const tearDown = (cause?: Error) => {
      try {
        source.unpipe(busboy);
      } catch {
        /* ignore */
      }
      try {
        source.destroy(cause);
      } catch {
        /* ignore */
      }
      try {
        busboy.destroy(cause);
      } catch {
        /* ignore */
      }
      cancelRequestBody(webBody, cause?.message ?? "multipart aborted");
    };

    const afterWriter = (fn: () => void) => {
      if (writerPromise) {
        void writerPromise.finally(fn).catch(() => {
          /* writer completion is folded into fail()/tryResolve() settlement */
        });
      } else {
        queueMicrotask(fn);
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      rejectErr = err;
      tearDown(err);
      if (failureScheduled) return;
      failureScheduled = true;
      afterWriter(() => {
        if (rejectErr) {
          settleOnce("reject", rejectErr);
        }
      });
    };

    const tryResolve = () => {
      if (settled || rejectErr || fileTruncated) return;
      if (!busboyFinished || !writerPromise) return;
      void writerPromise.then(
        (bytesWritten) => {
          if (settled || rejectErr || fileTruncated) return;
          settleOnce("resolve", { title, bytesWritten });
        },
        (err) => {
          settleOnce(
            "reject",
            err instanceof Error ? err : new BadRequestError(String(err)),
          );
        },
      );
    };

    const busboy = Busboy({
      headers: { "content-type": contentType },
      limits: { files: 1, parts: 4, fields: 2, fileSize: maxFileBytes },
    });

    busboy.on("field", (name, value) => {
      if (name === "title" && typeof value === "string") {
        title = value;
      }
    });

    busboy.on("file", (name, fileStream) => {
      if (name !== "file") {
        drainStream(fileStream);
        fail(new BadRequestError("unexpected file field"));
        return;
      }
      if (fileSeen) {
        drainStream(fileStream);
        fail(new BadRequestError("multiple file fields"));
        return;
      }
      fileSeen = true;

      fileStream.once("limit", () => {
        if (settled) return;
        fileTruncated = true;
        drainStream(fileStream);
        fail(
          new BadRequestError(`file exceeds ${maxFileBytes} bytes`),
        );
      });

      fileStream.on("error", (err) => {
        fail(
          err instanceof Error ? err : new BadRequestError(String(err)),
        );
      });

      writerPromise = writeStream(fileStream);
      void writerPromise.catch(() => {
        /* writer errors are settled via fail()/tryResolve() */
      });
      tryResolve();
    });

    busboy.on("partsLimit", () => {
      fail(new BadRequestError("too many multipart parts"));
    });

    busboy.on("filesLimit", () => {
      fail(new BadRequestError("too many files"));
    });

    busboy.on("fieldsLimit", () => {
      fail(new BadRequestError("too many fields"));
    });

    busboy.on("error", (err) => {
      fail(
        err instanceof Error ? err : new BadRequestError(String(err)),
      );
    });

    busboy.on("finish", () => {
      busboyFinished = true;
      if (!fileSeen && !rejectErr) {
        fail(new BadRequestError("file required"));
        return;
      }
      if (rejectErr) {
        return;
      }
      tryResolve();
    });

    const source = Readable.fromWeb(webBody as never);
    source.on("error", (err) => {
      fail(err instanceof Error ? err : new BadRequestError(String(err)));
    });
    source.pipe(busboy);
  });
}
