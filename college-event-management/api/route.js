import app from "../server/vercel-app.js";

export default function handler(req, res) {
  const routedPath = req.query?._route;
  const segments = Array.isArray(routedPath) ? routedPath : [routedPath];
  const pathname = segments.filter(Boolean).join("/");

  if (!pathname) {
    return res.status(404).json({ error: "API route not found." });
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  url.searchParams.delete("_route");
  req.url = `/api/${pathname}${url.search}`;
  return app(req, res);
}
