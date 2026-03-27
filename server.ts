#!/usr/bin/env ts-node

import http from 'http';
import fs from 'fs';
import path from 'path';

const DEFAULT_PORT = 8080;
const DEFAULT_PORT_SCAN_LIMIT = 20;
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  let pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

  // Handle root path
  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Security: prevent directory traversal
  const safePathname = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(DIST_DIR, safePathname);

  // Ensure the file is within dist directory
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Try to serve the file
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 - File Not Found</h1><p>The requested file could not be found.</p>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    // HTML: always revalidate so stale cached HTML never references a deleted CSS hash.
    // Fingerprinted assets (CSS/JS/images): cache aggressively since the URL changes on content change.
    const isHTML = ext === '.html';
    const cacheControl = isHTML
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=31536000, immutable';

    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
    res.end(content);
  });
}

function listenWithFallback(port: number, remainingAttempts: number): void {
  const server = http.createServer(requestHandler);

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && remainingAttempts > 0) {
      const fallbackPort = port + 1;
      console.warn(`\n⚠️  Port ${port} is in use, retrying on ${fallbackPort}...`);
      listenWithFallback(fallbackPort, remainingAttempts - 1);
      return;
    }

    if (error.code === 'EADDRINUSE' && remainingAttempts === 0) {
      console.error(`Server failed: no free port found after scanning up to ${port}`);
      process.exit(1);
    }

    console.error('Server failed:', error.message);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`\n🌐 Server running at http://localhost:${port}`);
    console.log(`📁 Serving files from: ${DIST_DIR}\n`);
  });
}

const preferredPort = Number.parseInt(process.env.PORT ?? '', 10);
const startPort = Number.isNaN(preferredPort) ? DEFAULT_PORT : preferredPort;
const scanLimit = Number.parseInt(process.env.PORT_SCAN_LIMIT ?? '', 10);
const maxAttempts = Number.isNaN(scanLimit) ? DEFAULT_PORT_SCAN_LIMIT : scanLimit;
listenWithFallback(startPort, Math.max(0, maxAttempts));
