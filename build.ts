#!/usr/bin/env ts-node
/// <reference path="./config/declarations.d.ts" />

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { marked } from 'marked';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import { minify as minifyHTML } from 'html-minifier';
import csso from 'csso';
import { execSync } from 'child_process';

// Configuration
const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');
const LAYOUTS_DIR = path.join(__dirname, 'layouts');
const PUBLIC_DIR = path.join(__dirname, 'public');

interface FrontMatter {
  title?: string;
  nav_order?: string;
  nav_parent?: string;
  [key: string]: string | undefined;
}

interface ParsedContent {
  metadata: FrontMatter;
  content: string;
}

interface NavItem {
  title: string;
  path: string;
  order?: number;
  children?: NavItem[];
}

// Ensure output directory exists
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Parse front matter from markdown (simple YAML-like format)
// Expects format:
// ---
// title: Page Title
// nav_order: 1
// nav_parent: /path
// ---
function parseFrontMatter(content: string): ParsedContent {
  const frontMatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontMatterRegex);

  if (!match) {
    return { metadata: {}, content };
  }

  const metadata: FrontMatter = {};
  const lines = match[1].split('\n');

  lines.forEach((line) => {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      const value = valueParts.join(':').trim();
      metadata[key.trim()] = value;
    }
  });

  return { metadata, content: match[2] };
}

// Load template
function loadTemplate(templateName = 'page.html'): string {
  const templatePath = path.join(LAYOUTS_DIR, templateName);
  if (!fs.existsSync(templatePath)) {
    console.warn(`Template ${templateName} not found, using minimal fallback`);
    return '<html><head><title>{{title}}</title></head><body>{{nav}}\n<main>{{content}}</main>\n</body></html>';
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

// Build navigation structure from source tree
function buildNavigation(srcPath: string = SRC_DIR, navPath = ''): NavItem[] {
  const nav: NavItem[] = [];
  const items = fs.readdirSync(srcPath);

  items.forEach((item) => {
    const fullPath = path.join(srcPath, item);
    const stat = fs.statSync(fullPath);
    const relPath = navPath ? `${navPath}/${item}` : item;

    if (stat.isDirectory()) {
      const subNav = buildNavigation(fullPath, relPath);
      if (subNav.length > 0) {
        nav.push({
          title: item
            .replace(/-/g, ' ')
            .replace(/^\w/, (c) => c.toUpperCase()),
          path: relPath,
          children: subNav,
        });
      }
    } else if (item.endsWith('.md') && !item.startsWith('_')) {
      const mdContent = fs.readFileSync(fullPath, 'utf-8');
      const { metadata } = parseFrontMatter(mdContent);

      const navPath = relPath === 'index.md' ? '/' : `/${relPath.replace('.md', '.html')}`;
      nav.push({
        title: metadata.title ?? item.replace('.md', '').replace(/-/g, ' '),
        path: navPath,
        order: parseInt(metadata.nav_order ?? '999', 10),
      });
    }
  });

  // Sort by order
  nav.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  return nav;
}

// Render navigation as HTML
function renderNav(navItems: NavItem[], currentPath = '', isNested = false): string {
  if (navItems.length === 0) return '';

  let html = isNested ? '<ul>\n' : '<nav id="site-nav" aria-label="Primary"><ul>\n';
  navItems.forEach((item) => {
    const isActive = currentPath === item.path;
    const activeClass = isActive ? ' class="active"' : '';

    if (item.children) {
      html += `  <li class="has-submenu">\n`;
      html += `    <button class="submenu-toggle" type="button" aria-expanded="false" aria-haspopup="true">${item.title}<span class="arrow" aria-hidden="true">▼</span></button>\n`;
      html += renderNav(item.children, currentPath, true);
      html += `  </li>\n`;
    } else {
      html += `    <li><a href="${item.path}"${activeClass}>${item.title}</a></li>\n`;
    }
  });
  html += isNested ? '</ul>\n' : '</ul></nav>\n';

  return html;
}

// Process a single markdown file
function processMarkdown(srcFile: string, relDir: string): string {
  const content = fs.readFileSync(srcFile, 'utf-8');
  const { metadata, content: mdContent } = parseFrontMatter(content);

  // Parse markdown to HTML
  const htmlContent = marked(mdContent) as string;

  // Load and render template
  const template = loadTemplate();
  const nav = buildNavigation(SRC_DIR);
  const baseName = path.basename(srcFile, '.md');
  const currentPath = (relDir === '' && baseName === 'index')
    ? '/'
    : relDir === ''
      ? `/${baseName}.html`
      : `/${relDir}/${baseName}.html`;
  const navHtml = renderNav(nav, currentPath);

  let html = template
    .replace(/{{title}}/g, metadata.title ?? 'Page')
    .replace(/{{year}}/g, String(new Date().getFullYear()))
    .replace(/{{nav}}/g, navHtml)
    .replace(/{{content}}/g, htmlContent);

  // Replace image references: ![alt](images/filename.jpg) -> <img src="/images/filename.jpg" alt="alt">
  html = html.replace(/!\[([^\]]*)\]\(images\/([^)]+)\)/g, '<img src="/images/$2" alt="$1">');

  return html;
}

// Process CSS: add vendor prefixes and minify
async function processCSS(cssContent: string): Promise<string> {
  try {
    const result = await postcss([autoprefixer]).process(cssContent, { from: undefined });
    const minified = csso.minify(result.css).css;
    return minified;
  } catch (error) {
    console.error('CSS processing error:', error);
    return cssContent;
  }
}

// Minify HTML output
function minifyHTMLOutput(html: string): string {
  try {
    const minified = minifyHTML(html, {
      removeComments: true,
      collapseWhitespace: true,
      removeRedundantAttributes: false,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      minifyCSS: true,
      minifyJS: false,
      conservativeCollapse: true,
    });

    // Validate that essential structure is preserved
    if (!minified.includes('<nav') || !minified.includes('</nav>')) {
      console.warn('⚠️  Warning: Navigation tags may have been corrupted during minification');
    }

    return minified;
  } catch (error) {
    console.error('HTML minification error:', (error as Error).message);
    console.warn('⚠️  Returning unminified HTML due to minification error');
    return html;
  }
}

// Recursively process all markdown files
function processDirectory(dir: string, baseDir = ''): void {
  ensureDir(DIST_DIR);

  const items = fs.readdirSync(dir);

  items.forEach((item) => {
    if (item.startsWith('.')) return;

    const srcPath = path.join(dir, item);
    const stat = fs.statSync(srcPath);
    const relDir = baseDir ? `${baseDir}/${item}` : item;

    if (stat.isDirectory()) {
      const distDirPath = path.join(DIST_DIR, relDir);
      ensureDir(distDirPath);
      processDirectory(srcPath, relDir);
    } else if (item.endsWith('.md') && !item.startsWith('_')) {
      const htmlContent = processMarkdown(srcPath, baseDir);
      const minifiedHTML = minifyHTMLOutput(htmlContent);
      const htmlFileName = item.replace('.md', '.html');
      const distPath = path.join(DIST_DIR, baseDir, htmlFileName);

      ensureDir(path.dirname(distPath));
      fs.writeFileSync(distPath, minifiedHTML, 'utf-8');

      // Verify minification preserved structure
      if (minifiedHTML.length === 0) {
        console.error(`✗ ERROR: Minification resulted in empty output for ${path.join(baseDir, htmlFileName)}`);
      } else if (!minifiedHTML.includes('<nav')) {
        console.error(`✗ ERROR: Navigation missing after minification for ${path.join(baseDir, htmlFileName)}`);
      }
      console.log(`✓ Built: ${path.join(baseDir, htmlFileName)}`);
    }
  });
}

// Copy CSS files from layouts to dist
async function copyCSSFiles(): Promise<void> {
  const items = fs.readdirSync(LAYOUTS_DIR);

  for (const item of items) {
    if (item.endsWith('.css')) {
      const srcPath = path.join(LAYOUTS_DIR, item);
      const destPath = path.join(DIST_DIR, item);
      const cssContent = fs.readFileSync(srcPath, 'utf-8');
      const processedCSS = await processCSS(cssContent);
      fs.writeFileSync(destPath, processedCSS, 'utf-8');
      console.log(`✓ Processed & minified: ${item}`);
    }
  }
}

// Copy public assets (images, etc.)
function copyPublicAssets(): void {
  if (!fs.existsSync(PUBLIC_DIR)) {
    return;
  }

  function copyRecursive(src: string, dest: string): void {
    ensureDir(dest);
    const items = fs.readdirSync(src);

    items.forEach((item) => {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);
      const stat = fs.statSync(srcPath);

      if (stat.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        console.log(`✓ Copied: ${item}`);
      }
    });
  }

  copyRecursive(PUBLIC_DIR, DIST_DIR);
}

// Compute an 8-character content hash for a file
function contentHash(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

// Extensions that get fingerprinted
const FINGERPRINT_EXTS = new Set(['.css', '.js', '.jpeg', '.jpg', '.png', '.gif', '.svg', '.webp', '.woff', '.woff2', '.ttf']);

// Walk dist/ and rename every fingerprintable asset, returning an old→new URL map
function fingerprintAssets(): Map<string, string> {
  const map = new Map<string, string>();

  function walk(dir: string): void {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(item).toLowerCase();
      if (!FINGERPRINT_EXTS.has(ext)) continue;

      // Skip files already fingerprinted (e.g. from a prior incomplete build)
      if (/\.[0-9a-f]{8}$/.test(path.basename(item, ext))) continue;

      const hash = contentHash(full);
      const base = path.basename(item, ext);
      const hashedName = `${base}.${hash}${ext}`;
      const hashedFull = path.join(dir, hashedName);

      fs.renameSync(full, hashedFull);

      // Build public URL mappings (relative to dist root, with leading slash)
      const relOld = '/' + path.relative(DIST_DIR, full).replace(/\\/g, '/');
      const relNew = '/' + path.relative(DIST_DIR, hashedFull).replace(/\\/g, '/');
      map.set(relOld, relNew);
    }
  }

  walk(DIST_DIR);
  return map;
}

// Rewrite all asset references in HTML and CSS files using the fingerprint map
function rewriteReferences(map: Map<string, string>): void {
  // Sort longest key first so more-specific paths replace before shorter ones
  const sorted = [...map.entries()].sort((a, b) => b[0].length - a[0].length);

  function rewriteFile(filePath: string): void {
    let src = fs.readFileSync(filePath, 'utf-8');
    for (const [oldUrl, newUrl] of sorted) {
      // Match the URL literally (quoted attrs, url() values, srcset, etc.)
      src = src.replaceAll(oldUrl, newUrl);
    }
    fs.writeFileSync(filePath, src, 'utf-8');
  }

  function walk(dir: string): void {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      const ext = path.extname(item).toLowerCase();
      if (ext === '.html' || ext === '.css') rewriteFile(full);
    }
  }

  walk(DIST_DIR);
  console.log(`✓ Fingerprinted ${map.size} asset(s)`);
}

// Compile client-side TypeScript (nav.ts → public/nav.js)
function compileClientScripts(): void {
  try {
    execSync('tsc --project config/tsconfig.client.json', {
      cwd: __dirname,
      stdio: 'inherit',
    });
    console.log('✓ Compiled: nav.ts → public/nav.js');
  } catch (error) {
    console.error('✗ Client TypeScript compilation failed:', (error as Error).message);
  }
}

// Clear dist contents without removing the dist root directory.
// On macOS, removing the root itself can intermittently throw ENOTEMPTY in watch mode.
function cleanDistDirectory(): void {
  ensureDir(DIST_DIR);
  const entries = fs.readdirSync(DIST_DIR);
  for (const entry of entries) {
    const fullPath = path.join(DIST_DIR, entry);
    fs.rmSync(fullPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
}

// Main build function
async function build(): Promise<void> {
  console.log('🔨 Building site...\n');

  // Clean dist before each build to avoid stale fingerprinted files
  cleanDistDirectory();
  compileClientScripts();
  processDirectory(SRC_DIR);
  await copyCSSFiles();
  copyPublicAssets();

  const fingerprintMap = fingerprintAssets();
  rewriteReferences(fingerprintMap);

  console.log('\n✨ Build complete!');
}

// Build lock to prevent concurrent builds
let isBuilding = false;
let buildQueued = false;

async function queuedBuild(): Promise<void> {
  if (isBuilding) {
    buildQueued = true;
    return;
  }

  isBuilding = true;
  try {
    await build();
  } catch (error) {
    console.error('Build failed:', (error as Error).message);
  } finally {
    isBuilding = false;
    if (buildQueued) {
      buildQueued = false;
      console.log('\n🔄 Running queued rebuild...');
      await queuedBuild();
    }
  }
}

// Watch mode
function watch(): void {
  console.log('👀 Watching for changes...\n');
  void queuedBuild();

  fs.watch(SRC_DIR, { recursive: true }, (_eventType, filename) => {
    if (filename && filename.endsWith('.md')) {
      console.log(`\n📝 Changed: ${filename}`);
      void queuedBuild();
    }
  });

  fs.watch(LAYOUTS_DIR, { recursive: true }, () => {
    console.log('\n🎨 Layout changed');
    void queuedBuild();
  });
}

// CLI
const args = process.argv.slice(2);
if (args.includes('--watch') || args.includes('-w')) {
  watch();
} else {
  build().catch((error: unknown) => {
    console.error('Build failed:', (error as Error).message);
    process.exit(1);
  });
}
