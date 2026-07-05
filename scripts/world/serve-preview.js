/* Minimal dependency-free static file server for the world-map preview.
   Serves the world-data/ directory on :8080 WITH HTTP Range support —
   required by the PMTiles reader (python's http.server ignores Range and
   returns the whole 14MB file, which breaks pmtiles). "/" redirects to
   "/preview/". */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(process.cwd(), "world-data");
const PORT = 8080;

const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/octet-stream",
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") {
      res.writeHead(302, { Location: "/preview/" });
      return res.end();
    }
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const type = TYPES[path.extname(filePath)] || "application/octet-stream";
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${st.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Type": type,
          "Content-Length": st.size,
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  })
  .listen(PORT, () =>
    console.log(`Preview at http://localhost:${PORT}/  (serving world-data/, Ctrl-C to stop)`)
  );
