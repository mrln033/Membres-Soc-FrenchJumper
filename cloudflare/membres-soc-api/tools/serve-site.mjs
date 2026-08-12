import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const host = "127.0.0.1";
const port = 8787;
const contentTypes = {
  ".css": "text/css; charset=UTF-8",
  ".html": "text/html; charset=UTF-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=UTF-8",
  ".png": "image/png"
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(siteRoot, relativePath);

    if (filePath !== siteRoot && !filePath.startsWith(siteRoot + sep)) {
      response.writeHead(403).end("Accès refusé");
      return;
    }

    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Fichier indisponible");
  }
}).listen(port, host, () => {
  console.log(`Site de test disponible sur http://${host}:${port}`);
});
