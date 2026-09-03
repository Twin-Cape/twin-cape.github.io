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

// Read a single KEY=value from a local .env file (dependency-free), if one
// exists. Real environment variables take precedence over the file.
function readEnvFile(key: string): string | undefined {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return undefined;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1 || trimmed.slice(0, eq).trim() !== key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

// Google Analytics 4 Measurement ID. Resolution order: real env var, then the
// local (gitignored) .env file, then empty (analytics disabled). The ID is NOT
// a secret — it ships in the page HTML to every visitor — but keeping it in
// .env stays out of source control. See .env.example.
const GA_MEASUREMENT_ID =
  process.env.GA_MEASUREMENT_ID ?? readEnvFile('GA_MEASUREMENT_ID') ?? '';

// gtag.js loader for the <head>. Returns '' when no ID is configured, and
// skips loading on localhost so dev previews don't pollute your stats.
function analyticsSnippet(): string {
  if (!GA_MEASUREMENT_ID) return '';
  return `<!-- Google Analytics (GA4) -->
<script>
  (function () {
    var id = '${GA_MEASUREMENT_ID}';
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '') return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', id);
  })();
</script>`;
}

interface FrontMatter {
  title?: string;
  [key: string]: string | undefined;
}

interface ParsedContent {
  metadata: FrontMatter;
  content: string;
}

interface NavItem {
  title: string;
  path: string;
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
// ---
function parseFrontMatter(content: string): ParsedContent {
  // Tolerate CRLF line endings (Windows editors, core.autocrlf checkouts) —
  // otherwise the frontmatter silently fails to match and leaks into the page.
  const frontMatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontMatterRegex);

  if (!match) {
    return { metadata: {}, content };
  }

  const metadata: FrontMatter = {};
  const lines = match[1].split('\n');

  lines.forEach((line) => {
    const [key, ...valueParts] = line.trimEnd().split(':');
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

// ---------------------------------------------------------------------------
// Navigation order spec — src/nav.order.json
//
// Nav order is controlled by ONE file instead of per-page frontmatter. It is
// an ordered JSON array: an entry's position in the array IS its position in
// the nav, top to bottom. Entries are either a markdown filename (relative to
// its directory) or, for a submenu, an object mapping a directory name to its
// own ordered array:
//
//   [
//     "index.md",
//     "faq.md",
//     { "essays": ["how-to-invest-well.md", "when-to-sell.md"] }
//   ]
//
// To reorder the nav, reorder the lines. The build FAILS LOUDLY if the spec
// and the files on disk disagree in any way — missing, extra, duplicate, or
// misspelled entries — so the spec can never silently drift from reality.
// Page titles still come from each file's `title:` frontmatter. Files AND
// directories whose names start with "_" are drafts: excluded from the nav,
// the spec, and the published output.
// ---------------------------------------------------------------------------

const NAV_ORDER_FILE = path.join(SRC_DIR, 'nav.order.json');
const NAV_ORDER_BASENAME = path.basename(NAV_ORDER_FILE);
const NAV_ORDER_REL = path.relative(__dirname, NAV_ORDER_FILE);

// A validated, ready-to-render page. Collected while the spec is validated so
// rendering works from the same snapshot validation approved — files added,
// changed, or deleted mid-build cannot slip past (or crash) the render pass.
interface NavPage {
  urlPath: string;   // e.g. "/" or "/essays/when-to-sell.html"
  content: string;   // raw markdown, frontmatter included
}

// stat() that treats unreadable entries (broken symlinks, permission holes)
// as absent instead of crashing the build with a raw ENOENT/ELOOP.
function safeStat(fullPath: string): fs.Stats | null {
  try {
    return fs.statSync(fullPath);
  } catch {
    return null;
  }
}

// Files that never appear in the nav: hidden, underscore-prefixed (drafts),
// non-markdown (e.g. the spec file itself lives in src/). The .md test is
// case-insensitive so a Finder-renamed "NOTES.MD" can't silently vanish.
function navigableFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((item) => {
    if (item.startsWith('.') || item.startsWith('_') || !/\.md$/i.test(item)) return false;
    return safeStat(path.join(dir, item))?.isFile() ?? false;
  });
}

// Non-draft directories that (recursively) contain at least one navigable page.
function navigableDirs(dir: string): string[] {
  return fs.readdirSync(dir).filter((item) => {
    if (item.startsWith('.') || item.startsWith('_')) return false;
    const full = path.join(dir, item);
    return (safeStat(full)?.isDirectory() ?? false) && hasNavigablePages(full);
  });
}

function hasNavigablePages(dir: string): boolean {
  return navigableFiles(dir).length > 0
    || navigableDirs(dir).length > 0;
}

// Generate spec JSON matching what is currently on disk (alphabetical), used
// to bootstrap a missing spec file with paste-ready content.
function scaffoldNavSpec(dir: string = SRC_DIR): unknown[] {
  const entries: unknown[] = [...navigableFiles(dir)].sort();
  for (const sub of navigableDirs(dir).sort()) {
    entries.push({ [sub]: scaffoldNavSpec(path.join(dir, sub)) });
  }
  return entries;
}

// Load src/nav.order.json, validate it EXACTLY matches the pages on disk, and
// build the nav tree in spec order. Any mismatch collects into one aggregate
// error so a single failed build reports every problem at once. Returns the
// nav tree AND the validated page snapshot that the render pass works from.
function buildNavigation(): { navItems: NavItem[]; pages: NavPage[] } {
  if (!fs.existsSync(NAV_ORDER_FILE)) {
    throw new Error(
      `✗ Missing ${NAV_ORDER_REL} — nav order is defined there (array position = nav position).\n`
      + `  Create it with the following content (current pages, alphabetical), then reorder to taste:\n\n`
      + JSON.stringify(scaffoldNavSpec(), null, 2),
    );
  }

  const raw = fs.readFileSync(NAV_ORDER_FILE, 'utf-8');
  let spec: unknown;
  try {
    spec = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `✗ ${NAV_ORDER_REL} is not valid JSON: ${(error as Error).message}\n`
      + `  (Watch for trailing commas and unquoted strings — JSON allows neither.)`,
    );
  }

  const errors: string[] = [];
  const pages: NavPage[] = [];

  function walk(entries: unknown, dir: string, navPath: string): NavItem[] {
    const here = navPath ? `${navPath}/` : '';

    if (!Array.isArray(entries)) {
      errors.push(`"${here || '(top level)'}" must be a JSON array of entries, got ${typeof entries}`);
      return [];
    }

    const actualFiles = navigableFiles(dir);
    const actualDirs = navigableDirs(dir);
    const seenFiles = new Set<string>();
    const seenDirs = new Set<string>();
    const nav: NavItem[] = [];

    for (const entry of entries) {
      if (typeof entry === 'string') {
        if (entry.includes('/')) {
          errors.push(`"${entry}" contains a slash — nest directories as { "dirname": [ ... ] } instead`);
          continue;
        }
        if (entry.startsWith('_')) {
          errors.push(`"${here}${entry}" is a draft (underscore-prefixed) and never appears in the nav — remove it from the spec`);
          continue;
        }
        if (!/\.md$/i.test(entry)) {
          errors.push(`"${here}${entry}" must be a markdown filename ending in .md (did you mean "${entry.replace(/\.html?$/i, '')}.md"?)`);
          continue;
        }
        if (seenFiles.has(entry)) {
          errors.push(`"${here}${entry}" is listed more than once`);
          continue;
        }
        seenFiles.add(entry);
        if (!actualFiles.includes(entry)) {
          // Exact-case match failed; a case-insensitive hit means a casing typo
          // (macOS's case-insensitive FS would otherwise mask it until deploy).
          const caseTwin = actualFiles.find((f) => f.toLowerCase() === entry.toLowerCase());
          if (caseTwin) {
            errors.push(`"${here}${entry}" does not match the file's exact casing — use "${caseTwin}"`);
            continue;
          }
          const unlisted = actualFiles.filter((f) => !entries.includes(f));
          const hint = unlisted.length ? ` — files on disk not yet listed: ${unlisted.join(', ')}` : '';
          errors.push(`"${here}${entry}" does not exist in src/${here}${hint}`);
          continue;
        }

        const raw = fs.readFileSync(path.join(dir, entry), 'utf-8');
        const { metadata } = parseFrontMatter(raw);
        if (metadata.nav_order !== undefined || metadata.nav_parent !== undefined) {
          errors.push(`"${here}${entry}" still has nav_order/nav_parent frontmatter — nav order now lives only in ${NAV_ORDER_REL}; delete those lines`);
        }
        const relPath = `${here}${entry}`;
        const urlPath = relPath === 'index.md' ? '/' : `/${relPath.replace(/\.md$/i, '.html')}`;
        pages.push({ urlPath, content: raw });
        nav.push({
          title: metadata.title ?? entry.replace(/\.md$/i, '').replace(/-/g, ' '),
          path: urlPath,
        });
      } else if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        const keys = Object.keys(entry as Record<string, unknown>);
        if (keys.length !== 1) {
          errors.push(`directory entries must have exactly one key, got {${keys.join(', ')}} under "${here || '(top level)'}"`);
          continue;
        }
        const [dirName] = keys;
        if (dirName.startsWith('_')) {
          errors.push(`directory "${here}${dirName}" is a draft (underscore-prefixed) and never appears in the nav or the published site — remove it from the spec`);
          continue;
        }
        if (seenDirs.has(dirName)) {
          errors.push(`directory "${here}${dirName}" is listed more than once`);
          continue;
        }
        seenDirs.add(dirName);
        if (!actualDirs.includes(dirName)) {
          // Check for a casing typo BEFORE fs.existsSync — on macOS's
          // case-insensitive FS, existsSync("Essays") finds "essays" and the
          // branches below would misdiagnose the problem as an empty directory.
          const caseTwin = actualDirs.find((d) => d.toLowerCase() === dirName.toLowerCase());
          const full = path.join(dir, dirName);
          if (caseTwin) {
            errors.push(`directory "${here}${dirName}" does not match the directory's exact casing — use "${caseTwin}"`);
          } else if (safeStat(full)?.isFile()) {
            errors.push(`"${here}${dirName}" is a file, not a directory — list it as a plain string entry`);
          } else if (safeStat(full)?.isDirectory()) {
            errors.push(`directory "${here}${dirName}" contains no pages — remove it from the spec`);
          } else {
            errors.push(`directory "${here}${dirName}" does not exist in src/${here}`);
          }
          continue;
        }
        const children = walk(
          (entry as Record<string, unknown>)[dirName],
          path.join(dir, dirName),
          `${here}${dirName}`,
        );
        nav.push({
          title: dirName.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
          path: `${here}${dirName}`,
          children,
        });
      } else {
        errors.push(`unsupported entry ${JSON.stringify(entry)} under "${here || '(top level)'}" — use "file.md" or { "dirname": [ ... ] }`);
      }
    }

    const unlistedFiles = actualFiles.filter((f) => !seenFiles.has(f));
    const unlistedDirs = actualDirs.filter((d) => !seenDirs.has(d));
    for (const f of unlistedFiles) {
      errors.push(`src/${here}${f} exists on disk but is not in the spec — add "${f}" where it belongs in the order`);
    }
    for (const d of unlistedDirs) {
      errors.push(`src/${here}${d}/ has pages but is not in the spec — add { "${d}": [ ... ] } where it belongs in the order`);
    }

    return nav;
  }

  const navItems = walk(spec, SRC_DIR, '');

  if (errors.length > 0) {
    throw new Error(
      `✗ ${NAV_ORDER_REL} does not match the pages in src/ (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n\n`
      + errors.map((e) => `  • ${e}`).join('\n')
      + `\n\nEvery page must be listed exactly once; array position = nav position.`,
    );
  }

  return { navItems, pages };
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

// Convert standalone images into semantic <figure> blocks.
//
// In Markdown, write an image with an optional title to attach a caption:
//
//   ![alt text](images/content/chart.svg "Heading || Caption sentence.")
//
//   • alt text  — accessibility description (required; never shown visually)
//   • title     — becomes the <figcaption>. If it contains the "||" delimiter,
//                 the part before it renders as a bold heading/label and the
//                 part after as the caption body. With no "||", the whole title
//                 is the caption. With no title at all, no caption is rendered.
//
// marked emits a standalone image wrapped in its own <p>; we match that whole
// paragraph and replace it so the <figure> is not nested inside a <p>.
function renderFigures(html: string): string {
  return html.replace(
    /<p>\s*(<img\b[^>]*>)\s*<\/p>/g,
    (_match, imgTag: string) => {
      const titleMatch = imgTag.match(/\stitle="([^"]*)"/);
      const title = titleMatch ? titleMatch[1] : '';
      // The title drives the caption, so strip it off the <img> itself.
      const cleanImg = imgTag.replace(/\stitle="[^"]*"/, '');

      let caption = '';
      if (title) {
        const [head, ...rest] = title.split('||');
        caption = rest.length
          ? `<figcaption><strong class="figure-label">${head.trim()}</strong> ${rest.join('||').trim()}</figcaption>`
          : `<figcaption>${head.trim()}</figcaption>`;
      }

      return `<figure>${cleanImg}${caption}</figure>`;
    }
  );
}

// Render a validated page (from the buildNavigation snapshot) to full HTML
function processMarkdown(page: NavPage, navItems: NavItem[]): string {
  const { metadata, content: mdContent } = parseFrontMatter(page.content);

  // Parse markdown to HTML
  let htmlContent = marked(mdContent) as string;

  // Strip the " - " separator that lives between the bold lead-in and the
  // description in list items (e.g. `<strong>X</strong> - Y...`). With the
  // CSS treatment the lead-in now displays as the item's title on its own
  // line, so the dash reads as orphaned punctuation rather than a separator.
  htmlContent = htmlContent.replace(/<\/strong>\s+[-–—]\s+/g, '</strong> ');

  // Normalize content-image paths to be absolute from the site root. Markdown
  // images are authored with a relative `images/...` src, but every page lives
  // at a different depth (e.g. /essays/foo.html), so the path must be rooted
  // for the browser — and for the fingerprinting pass to rewrite it.
  htmlContent = htmlContent.replace(/(<img\b[^>]*\bsrc=")images\//g, '$1/images/');

  // Wrap standalone images in <figure>/<figcaption>.
  htmlContent = renderFigures(htmlContent);

  // Load and render template. The page's canonical URL comes straight from
  // the validated snapshot, so the nav's active-link match and the output
  // filename can never disagree with the nav's own hrefs.
  const template = loadTemplate();
  const navHtml = renderNav(navItems, page.urlPath);

  let html = template
    .replace(/{{title}}/g, metadata.title ?? 'Page')
    .replace(/{{year}}/g, String(new Date().getFullYear()))
    .replace(/{{nav}}/g, navHtml)
    .replace(/{{content}}/g, htmlContent)
    .replace(/{{analytics}}/g, analyticsSnippet());

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

// Render every page from the validated snapshot. Working from the snapshot —
// not a fresh directory walk — means files added/removed after validation
// can neither publish unvalidated content nor crash a half-cleaned build,
// and draft (underscore-prefixed) files and directories are never emitted.
function renderPages(pages: NavPage[], navItems: NavItem[]): void {
  ensureDir(DIST_DIR);

  pages.forEach((page) => {
    const htmlContent = processMarkdown(page, navItems);
    const minifiedHTML = minifyHTMLOutput(htmlContent);
    const relOut = page.urlPath === '/' ? 'index.html' : page.urlPath.replace(/^\//, '');
    const distPath = path.join(DIST_DIR, relOut);

    ensureDir(path.dirname(distPath));
    fs.writeFileSync(distPath, minifiedHTML, 'utf-8');

    // Verify minification preserved structure
    if (minifiedHTML.length === 0) {
      console.error(`✗ ERROR: Minification resulted in empty output for ${relOut}`);
    } else if (!minifiedHTML.includes('<nav')) {
      console.error(`✗ ERROR: Navigation missing after minification for ${relOut}`);
    }
    console.log(`✓ Built: ${relOut}`);
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

  // Validate the nav spec against src/ BEFORE touching dist, so a bad spec
  // fails the build without wiping the previous good output. Page content is
  // snapshotted here too — rendering never re-reads src/.
  const { navItems, pages } = buildNavigation();

  // Clean dist before each build to avoid stale fingerprinted files
  cleanDistDirectory();
  compileClientScripts();
  renderPages(pages, navItems);
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
    if (filename && (filename.endsWith('.md') || path.basename(filename) === NAV_ORDER_BASENAME)) {
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
