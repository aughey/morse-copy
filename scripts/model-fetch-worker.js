// A same-origin, streaming model archive assembled from hosting-sized assets.
// Vosk retains its own stable IndexedDB cache of the extracted model.
const originalFetch = self.fetch.bind(self);
self.fetch = async function (input, options) {
  const url = typeof input === "string" ? input : input.url;
  if (!url.endsWith("/models/vosk-en-us-0.15.tar.gz"))
    return originalFetch(input, options);
  const manifestResponse = await originalFetch(new URL("manifest.json", url));
  if (!manifestResponse.ok)
    throw new Error("Could not load the speech model manifest.");
  const manifest = await manifestResponse.json();
  let loaded = 0,
    index = 0,
    reader = null;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            if (index === manifest.parts.length) {
              controller.close();
              return;
            }
            const part = manifest.parts[index++];
            const response = await originalFetch(new URL(part.file, url));
            if (!response.ok)
              throw new Error("Speech model download failed. Please retry.");
            reader = response.body.getReader();
          }
          const { done, value } = await reader.read();
          if (done) {
            reader.releaseLock();
            reader = null;
            continue;
          }
          loaded += value.length;
          self.postMessage({
            event: "downloadprogress",
            loaded,
            total: manifest.bytes,
          });
          controller.enqueue(value);
          return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      if (reader) return reader.cancel();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(manifest.bytes),
    },
  });
};
