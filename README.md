# Lightweight Static Site Generator

A minimal, high-performance static site generator built with Node.js for creating professional information websites using markdown and HTML templates.

## Features

- **Markdown-based content** - Write pages in simple, readable markdown
- **Template system** - Define common elements (header, footer, navigation) once
- **Navigation hierarchy** - Navigation menu built from directory structure, ordered by `src/nav.order.json`
- **Image support** - Simple markdown syntax for images with assets in `/public` folder
- **Lightweight** - Minimal dependencies (just `marked` for markdown parsing)
- **SSG output** - Pre-rendered HTML files ready for GitHub Pages
- **Watch mode** - Auto-rebuild on file changes during development

## Project Structure

```
.
├── src/                    # Markdown source files
│   ├── nav.order.json     # Nav order spec (required — see below)
│   ├── index.md           # Home page
│   ├── about.md           # About page
│   ├── services/          # Service section
│   │   ├── equity.md
│   │   └── bonds.md
│   └── insights.md        # Insights/blog page
├── layouts/               # HTML templates
│   └── page.html          # Main page template
├── public/                # Static assets
│   └── images/            # Images folder
├── dist/                  # Built HTML output (generated)
├── build.ts              # Build script
├── package.json
└── README.md
```

## Getting Started

### Installation

```bash
npm install
```

### Build

Generate the static site to `/dist`:

```bash
npm run build
```

### Watch Mode

Auto-rebuild on changes during development:

```bash
npm run watch
```

Then open `dist/index.html` in your browser (or serve with any static server).

## Writing Content

### Creating Pages

Create markdown files in the `src/` directory. Files are automatically converted to HTML with the same directory structure in `dist/`.

**Example:** `src/services/pricing.md` → `dist/services/pricing.html`

### Front Matter

Add metadata at the top of markdown files using simple key-value pairs:

```markdown
---
title: Page Title
---

# Page Content

Your markdown content here...
```

**Available front matter:**
- `title` - Page title (used in HTML `<title>` and nav)

### Navigation Order — `src/nav.order.json`

Nav order lives in a single file, `src/nav.order.json` — not in per-page
frontmatter. It is an ordered JSON array: an entry's position in the array is
its position in the nav. To reorder the nav, reorder the lines.

```json
[
  "index.md",
  "about.md",
  { "services": ["equity.md", "bonds.md"] },
  "insights.md"
]
```

- Plain string entries are markdown filenames (relative to their directory).
- A `{ "dirname": [ ... ] }` object is a submenu; its position places the
  submenu in the parent nav, and its array orders the pages within it.
- Underscore-prefixed files and directories (`_draft.md`, `_wip/`) are
  drafts: excluded from the nav and the published site, and must not be
  listed in the spec.

The build **fails with a detailed error** if the spec and the files in `src/`
disagree in any way — a page missing from the spec, an entry with no matching
file, a duplicate, a typo, or malformed JSON — so the two can never silently
drift apart. Adding a new page means adding one line to `nav.order.json`; the
error message tells you exactly what to add if you forget.

### Images

1. Place image files in `public/images/`
2. Reference in markdown using:

```markdown
![Alt text](images/my-image.jpg)
```

The build script automatically converts this to proper HTML `<img>` tags:

```html
<img src="/images/my-image.jpg" alt="Alt text">
```

## Customization

### Styling

Edit `layouts/page.html` to modify the template and styles. The template includes:

- `{{title}}` - Page title placeholder
- `{{nav}}` - Auto-generated navigation menu
- `{{content}}` - Rendered markdown content

### Layout

The included template provides:
- Professional investment firm styling
- Responsive design (mobile-friendly)
- Navigation bar with active page highlighting
- Footer with copyright

### Adding Future Dynamic Features

The structure supports future additions:

1. **Data files** - Add JSON files for product listings, testimonials, etc.
2. **Post-build processing** - Extend `build.ts` to inject dynamic data into templates
3. **Server-side rendering** - Add an Express app to serve with real-time data
4. **API integration** - Modify templates to include API calls for live content

The current build script is designed to be easily extended without adding heavy dependencies.

## Deployment to GitHub Pages

### Quick Publish (Recommended)

Use the automated publish script:

```bash
npm run publish
```

This script:
1. Builds the site
2. Commits changes to the `gh-pages` branch
3. Pushes to GitHub
4. Returns to main branch

That's it! Your site is published.

### Manual Publishing

If you prefer manual control:

1. Build the site:
   ```bash
   npm run build
   ```

2. Switch to gh-pages branch:
   ```bash
   git checkout gh-pages
   ```

3. Copy built files to root:
   ```bash
   cp dist/* .
   git add -A
   git commit -m "Publish: [date]"
   git push origin gh-pages
   git checkout main
   ```

### GitHub Pages Configuration

Ensure your repository settings have GitHub Pages configured:
- Go to **Settings** → **Pages**
- Source: Branch `gh-pages`, folder `/ (root)`

Your site will be live at: `https://<username>.github.io/`

### Automated Deploy with GitHub Actions

Alternatively, use GitHub Actions to auto-publish on each push to main:

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
          publish_branch: gh-pages
```

## Tips

- **Organizing content** - Use directories to group related pages
- **Homepage** - `index.md` in the root becomes the homepage
- **SEO** - The `<title>` tag is automatically set from front matter
- **Performance** - Pre-rendered HTML loads instantly; no JavaScript required for basic functionality
- **Extending** - Modify `build.ts` to add processing for other file types (JSON data, YAML config, etc.)

## Lightweight Philosophy

This project intentionally uses minimal dependencies:
- **marked** (~10KB) - Lightweight markdown parser
- Everything else is vanilla Node.js

No build tools, bundlers, or heavy frameworks. The entire build script is under 300 lines of readable JavaScript.

## License

MIT
