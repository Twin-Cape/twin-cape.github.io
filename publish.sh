#!/bin/bash

# Publish script for GitHub Pages
# Builds the site and pushes to gh-pages branch

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting GitHub Pages publish...${NC}\n"

# Check if we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo -e "${YELLOW}⚠️  Not on main branch (currently on: $CURRENT_BRANCH)${NC}"
  echo "Please switch to main branch first: git checkout main"
  exit 1
fi

# Check if working tree is clean
if ! git diff-index --quiet HEAD --; then
  echo -e "${YELLOW}⚠️  Working tree has uncommitted changes${NC}"
  echo "Please commit or stash changes first"
  exit 1
fi

# Step 1: Build the site
echo -e "${BLUE}📦 Building site...${NC}"
npm run build
echo -e "${GREEN}✓ Build complete${NC}\n"

# Step 2: Prepare temporary directory with built files
echo -e "${BLUE}📁 Preparing files...${NC}"
TEMP_DIR=$(mktemp -d)
cp -r dist/* "$TEMP_DIR/"
echo -e "${GREEN}✓ Files prepared${NC}\n"

# Step 3: Switch to gh-pages branch
echo -e "${BLUE}🔀 Switching to gh-pages branch...${NC}"
git checkout gh-pages
echo -e "${GREEN}✓ On gh-pages branch${NC}\n"

# Step 4: Replace published files with the fresh build
echo -e "${BLUE}🗑️  Updating published files...${NC}"
# Sanity check: never wipe the site if the build produced no pages.
if [ -z "$(find "$TEMP_DIR" -maxdepth 1 -name '*.html' -print -quit)" ]; then
  echo -e "${YELLOW}⚠️  Build output has no HTML — aborting to avoid wiping gh-pages${NC}"
  exit 1
fi
# Clean-slate the *previously published* files, then copy the fresh build.
# This prevents stale fingerprinted assets (old style.<hash>.css,
# nav.<hash>.js, images) and the old tracked dist/ copy from accumulating.
#
# IMPORTANT: we use `git rm` (tracked files only) rather than a filesystem
# wipe. The gh-pages working tree shares this directory with main's
# untracked / gitignored files (node_modules/, the local dist/ build), and a
# blanket `rm` would delete those too — they don't come back on `checkout
# main` because they're gitignored. Metadata is preserved via exclude
# pathspecs.
git rm -r -q --ignore-unmatch . \
  ':(exclude)CNAME' ':(exclude).gitignore' ':(exclude).nojekyll' >/dev/null
cp -r "$TEMP_DIR"/* .
rm -rf "$TEMP_DIR"
echo -e "${GREEN}✓ Files updated${NC}\n"

# Step 5: Commit and push
echo -e "${BLUE}📤 Committing and pushing...${NC}"
# Stage everything except the local build dir — dist/ is a dev artifact, not
# something we publish to the branch root (it isn't in gh-pages' .gitignore).
git add -A -- . ':(exclude)dist'
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
git commit -m "Publish: $TIMESTAMP" || echo "No changes to commit"
git push origin gh-pages
echo -e "${GREEN}✓ Published to gh-pages${NC}\n"

# Step 6: Return to main branch
echo -e "${BLUE}🔀 Returning to main branch...${NC}"
git checkout main
echo -e "${GREEN}✓ Back on main branch${NC}\n"

echo -e "${GREEN}✨ Publish complete! Site is live at: https://twin-cape.github.io${NC}\n"
