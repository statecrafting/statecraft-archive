import { api, RawRequest, RawResponse } from "encore.dev/api";
import { createRequestListener } from "@react-router/node";
import { getOrigin, handlerPromise, readBody, sendFetchResponse, toHeaders } from "./api.tools";

// Your server build (Vite output). Exact import path depends on your build setup.
// @ts-ignore
const buildPromise = import("./build/server/index.js");

const listenerPromise = (async () => {
  const build = await buildPromise;
  return createRequestListener({ build });
})();

// Serve all files in the ./assets directory under the /public path prefix.
export const assets = api.static({
  expose: true,
  path: "/assets/*path",
  dir: "./build/client/assets",
});

export const reactrouter = api.raw({ expose: true, path: "/!rest", method: "*" }, async (req, res) => {
  // Chrome DevTools requests - return 404 without hitting React Router
  if (req.url?.startsWith("/.well-known/")) {
    res.writeHead(404);
    res.end();
    return;
  }

  const handle = await handlerPromise;

  const origin = getOrigin(req);
  const url = new URL(req.url ?? "/", origin);

  const headers = toHeaders(req.headers ?? {});
  // Help RR CSRF checks: make sure origin and referer are absolute if present
  if (!headers.get("origin")) headers.set("origin", origin);
  const ref = headers.get("referer");
  if (ref && !/^https?:\/\//i.test(ref)) headers.set("referer", new URL(ref, origin).toString());

  const body = await readBody(req);

  const request = new Request(url.toString(), {
    method: req.method,
    headers,
    // @ts-ignore
    body: body ?? undefined,
  });

  const rrResponse = await handle(request);
  await sendFetchResponse(res, rrResponse);
});
