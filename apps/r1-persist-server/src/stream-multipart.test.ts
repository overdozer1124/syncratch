import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { streamMultipartSb3File } from "./stream-multipart.js";

function streamingRequest(
  headers: Record<string, string>,
  body: ReadableStream<Uint8Array>,
): Request {
  return new Request("http://localhost/v1/projects/import", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

function multipartRequest(
  title: string,
  fileBytes: Uint8Array,
  boundary: string,
): Request {
  const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.sb3"\r\nContent-Type: application/zip\r\n\r\n`;
  const suffix = `\r\n--${boundary}--\r\n`;
  const head = new TextEncoder().encode(prefix);
  const tail = new TextEncoder().encode(suffix);
  const body = new Uint8Array(head.length + fileBytes.length + tail.length);
  body.set(head, 0);
  body.set(fileBytes, head.length);
  body.set(tail, head.length + fileBytes.length);
  return new Request("http://localhost/v1/projects/import", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
}

describe("streamMultipartSb3File", () => {
  it("rejects file bytes above the configured limit", async () => {
    const maxFileBytes = 1024;
    const payload = new Uint8Array(1025);
    const req = multipartRequest("TooBig", payload, "limit1");

    await expect(
      streamMultipartSb3File(req, maxFileBytes, async (stream) => {
        let written = 0;
        for await (const chunk of stream) {
          written += Buffer.isBuffer(chunk) ? chunk.length : chunk.byteLength;
        }
        return written;
      }),
    ).rejects.toThrow(/exceeds 1024 bytes/);
  });

  it("waits for busboy finish and writer completion before resolving", async () => {
    const payload = new Uint8Array(512);
    const req = multipartRequest("Ok", payload, "ok1");
    const events: string[] = [];

    const result = await streamMultipartSb3File(req, 1024, async (stream) => {
      events.push("writer-start");
      let written = 0;
      for await (const chunk of stream) {
        written += Buffer.isBuffer(chunk) ? chunk.length : chunk.byteLength;
      }
      events.push("writer-done");
      return written;
    });
    events.push("resolved");

    expect(result).toEqual({ title: "Ok", bytesWritten: 512 });
    expect(events).toEqual(["writer-start", "writer-done", "resolved"]);
  });

  it("rejects extra file fields", async () => {
    const boundary = "extra1";
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="title"`,
      "",
      "Extra",
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="a.sb3"`,
      "Content-Type: application/zip",
      "",
      "abc",
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="b.sb3"`,
      "Content-Type: application/zip",
      "",
      "def",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const req = new Request("http://localhost/v1/projects/import", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    await expect(
      streamMultipartSb3File(req, 1024, async (stream) => {
        drain(stream);
        return 3;
      }),
    ).rejects.toThrow(/too many files/);
  });

  it("rejects when source aborts before the file field", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("--abort\r\n"));
        controller.error(new Error("client aborted"));
      },
    });
    const req = streamingRequest(
      {
        "content-type": "multipart/form-data; boundary=abort",
      },
      stream,
    );

    await expect(
      Promise.race([
        streamMultipartSb3File(req, 1024, async () => 0),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 300),
        ),
      ]),
    ).rejects.toThrow("client aborted");
  });

  it("rejects when source aborts mid-file", async () => {
    const boundary = "abortmid";
    const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nMid\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.sb3"\r\n\r\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(prefix));
        controller.enqueue(new Uint8Array(128).fill(0x41));
        controller.error(new Error("client aborted mid-file"));
      },
    });
    const req = streamingRequest(
      {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      stream,
    );

    await expect(
      Promise.race([
        streamMultipartSb3File(req, 1024, async (fileStream) => {
          let written = 0;
          for await (const chunk of fileStream) {
            written += Buffer.isBuffer(chunk) ? chunk.length : chunk.byteLength;
          }
          return written;
        }),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 300),
        ),
      ]),
    ).rejects.toThrow("client aborted mid-file");
  });
});

async function drain(stream: Readable): Promise<void> {
  for await (const _chunk of stream) {
    /* drain */
  }
}
