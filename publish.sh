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

# Step 4: Remove old files and copy new ones
echo -e "${BLUE}🗑️  Updating published files...${NC}"
find . -maxdepth 1 -type f -name "*.html" -delete
rm -rf services
cp -r "$TEMP_DIR"/* .
rm -rf "$TEMP_DIR"
echo -e "${GREEN}✓ Files updated${NC}\n"

# Step 5: Commit and push
echo -e "${BLUE}📤 Committing and pushing...${NC}"
git add -A
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
git commit -m "Publish: $TIMESTAMP" || echo "No changes to commit"
git push origin gh-pages
echo -e "${GREEN}✓ Published to gh-pages${NC}\n"

# Step 6: Return to main branch
echo -e "${BLUE}🔀 Returning to main branch...${NC}"
git checkout main
echo -e "${GREEN}✓ Back on main branch${NC}\n"

echo -e "${GREEN}✨ Publish complete! Site is live at: https://twin-cape.github.io${NC}\n"
