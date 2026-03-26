# Quick Start Guide

## Building & Development

```bash
# Install dependencies (one time only)
npm install

# Build the site (one-time)
npm run build

# Development mode - watch for changes + live server on http://localhost:8080
npm run dev
# or with yarn
yarn dev

# Watch mode only (no server)
npm run watch
```

## How to Write Pages

### 1. Create a markdown file in `src/`

```markdown
---
title: My Page Title
nav_order: 2
---

# Page Heading

Your content here in **markdown**.

## Subsection

- Bullet points
- Work great
```

### 2. Add images

Place images in `public/images/` then reference in markdown:

```markdown
![Company photo](images/company.jpg)
```

### 3. Development workflow

During development, use the dev server which combines watch mode + local preview:

```bash
yarn dev
```

Then open your browser to **http://localhost:8080**. The site will auto-rebuild whenever you save changes to markdown or template files. Simply refresh your browser to see the latest changes.

To stop the dev server, press `Ctrl+C` in the terminal.

### 4. Build for production

When ready to deploy:

```bash
npm run build
```

Files are now in `dist/` ready for GitHub Pages.

## Key Features

- **Automatic Navigation** - Built from your directory structure
- **Import Front Matter** - Set `title` and `nav_order` at top of files
- **Hierarchical Pages** - Use folders to organize (e.g., `services/equity-funds.md`)
- **Professional Styling** - Responsive, investment-firm themed template included
- **Image Support** - Simple markdown syntax with automatic path handling
- **Zero JavaScript** - Pure static HTML (ready for future dynamic features)

## Customization

### Change styling/layout
Edit `layouts/page.html`:
- Modify CSS in the `<style>` block
- Change header/footer text
- Adjust template placeholders (`{{title}}`, `{{nav}}`, `{{content}}`)

### Add new template features
1. Edit `layouts/page.html`
2. Add new `{{placeholder}}` 
3. Update `build.js` to populate it:
   ```javascript
   html = html.replace(/{{placeholder}}/g, value);
   ```

## For Future: Adding Dynamic Features

The current structure supports easy additions:

1. **Data files** - Create `src/data.json` for products/testimonials
2. **API integration** - Modify build.js to fetch and inject data
3. **Server** - Add Express server to serve with dynamic content
4. **Blog** - Extend with date-based post generation

The build script is intentionally simple and extensible without heavy frameworks.
