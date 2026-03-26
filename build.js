#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const autoprefixer = require('autoprefixer');
const postcss = require('postcss');
const { minify: minifyHTML } = require('html-minifier');
const csso = require('csso');

// Configuration
const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');
const LAYOUTS_DIR = path.join(__dirname, 'layouts');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure output directory exists
function ensureDir(dir) {
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
function parseFrontMatter(content) {
  const frontMatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontMatterRegex);

  if (!match) {
    return { metadata: {}, content };
  }

  const metadata = {};
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
function loadTemplate(templateName = 'page.html') {
  const templatePath = path.join(LAYOUTS_DIR, templateName);
  if (!fs.existsSync(templatePath)) {
    console.warn(`Template ${templateName} not found, using minimal fallback`);
    return '<html><head><title>{{title}}</title></head><body>{{nav}}\n<main>{{content}}</main>\n</body></html>';
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

// Build navigation structure from source tree
function buildNavigation(srcPath = SRC_DIR, navPath = '') {
  const nav = [];
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
      const mdPath = fullPath;
      const content = fs.readFileSync(mdPath, 'utf-8');
      const { metadata } = parseFrontMatter(content);

      nav.push({
        title: metadata.title || item.replace('.md', '').replace(/-/g, ' '),
        path: `/${relPath.replace('.md', '.html')}`,
        order: parseInt(metadata.nav_order || '999'),
      });
    }
  });

  // Sort by order
  nav.sort((a, b) => (a.order || 999) - (b.order || 999));

  return nav;
}

// Render navigation as HTML
function renderNav(navItems, currentPath = '', isNested = false) {
  if (navItems.length === 0) return '';

  let html = isNested ? '<ul>\n' : '<nav><ul>\n';
  navItems.forEach((item) => {
    const isActive = currentPath === item.path;
    const activeClass = isActive ? ' class="active"' : '';

    if (item.children) {
      html += `  <li class="has-submenu">\n`;
      html += `    <span class="submenu-toggle" data-toggle="submenu">${item.title}<span class="arrow">▼</span></span>\n`;
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
function processMarkdown(srcFile, relDir) {
  const content = fs.readFileSync(srcFile, 'utf-8');
  const { metadata, content: mdContent } = parseFrontMatter(content);

  // Parse markdown to HTML
  const htmlContent = marked(mdContent);

  // Load and render template
  const template = loadTemplate();
  const nav = buildNavigation(SRC_DIR);
  const navHtml = renderNav(nav, `/${relDir}/${path.basename(srcFile, '.md')}.html`);

  let html = template
    .replace(/{{title}}/g, metadata.title || 'Page')
    .replace(/{{nav}}/g, navHtml)
    .replace(/{{content}}/g, htmlContent);

  // Replace image references: ![alt](images/filename.jpg) -> <img src="/images/filename.jpg" alt="alt">
  html = html.replace(/!\[([^\]]*)\]\(images\/([^)]+)\)/g, '<img src="/images/$2" alt="$1">');

  return html;
}

// Process CSS: add vendor prefixes and minify
async function processCSS(cssContent) {
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
function minifyHTMLOutput(html) {
  try {
    const minified = minifyHTML(html, {
      removeComments: true,
      collapseWhitespace: true,
      removeRedundantAttributes: false,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      minifyCSS: true,
      minifyJS: true,
      conservativeCollapse: true,
      ignoreCustomComments: [/data-/],
    });
    
    // Validate that essential structure is preserved
    if (!minified.includes('<nav') || !minified.includes('</nav>')) {
      console.warn('⚠️  Warning: Navigation tags may have been corrupted during minification');
    }
    
    return minified;
  } catch (error) {
    console.error('HTML minification error:', error.message);
    console.warn('⚠️  Returning unminified HTML due to minification error');
    return html;
  }
}

// Recursively process all markdown files
function processDirectory(dir, baseDir = '') {
  ensureDir(DIST_DIR);

  const items = fs.readdirSync(dir);

  items.forEach((item) => {
    if (item.startsWith('.')) return;

    const srcPath = path.join(dir, item);
    const stat = fs.statSync(srcPath);
    const relDir = baseDir ? `${baseDir}/${item}` : item;

    if (stat.isDirectory()) {
      const distDir = path.join(DIST_DIR, relDir);
      ensureDir(distDir);
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
async function copyCSSFiles() {
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
function copyPublicAssets() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    return;
  }

  function copyRecursive(src, dest) {
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

// Main build function
async function build() {
  console.log('🔨 Building site...\n');

  ensureDir(DIST_DIR);
  processDirectory(SRC_DIR);
  await copyCSSFiles();
  copyPublicAssets();

  console.log('\n✨ Build complete!');
}

// Build lock to prevent concurrent builds
let isBuilding = false;
let buildQueued = false;

async function queuedBuild() {
  if (isBuilding) {
    buildQueued = true;
    return;
  }

  isBuilding = true;
  try {
    await build();
  } catch (error) {
    console.error('Build failed:', error.message);
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
function watch() {
  console.log('👀 Watching for changes...\n');
  queuedBuild();

  fs.watch(SRC_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.md')) {
      console.log(`\n📝 Changed: ${filename}`);
      queuedBuild();
    }
  });

  fs.watch(LAYOUTS_DIR, { recursive: true }, () => {
    console.log('\n🎨 Layout changed');
    queuedBuild();
  });
}

// CLI
const args = process.argv.slice(2);
if (args.includes('--watch') || args.includes('-w')) {
  watch();
} else {
  build().catch(error => {
    console.error('Build failed:', error.message);
    process.exit(1);
  });
}
