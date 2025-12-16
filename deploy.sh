#!/bin/bash

# Deploy script for Modern Webflow Gallery
# This script syncs images to/from VPS and pushes code to GitHub

set -e  # Exit on any error

# Configuration
VPS_USER="root"
VPS_HOST="178.156.177.252"
VPS_IMAGE_PATH="/data/webflow-gallery"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

show_menu() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   Modern Webflow Gallery Deployer${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    echo -e "${YELLOW}What would you like to do?${NC}"
    echo ""
    echo "  1) Push to VPS    - Send local images TO the VPS"
    echo "  2) Pull from VPS  - Download VPS images to local"
    echo "  3) Sync both ways - Full bidirectional sync"
    echo "  4) Git operations - Commit and push code"
    echo "  5) Full deploy    - Push images + Git push"
    echo "  6) Exit"
    echo ""
}

show_local_stats() {
    SCREENSHOT_COUNT=$(ls public/screenshots/ 2>/dev/null | wc -l | tr -d ' ')
    THUMBNAIL_COUNT=$(ls public/thumbnails/ 2>/dev/null | wc -l | tr -d ' ')
    SCREENSHOT_SIZE=$(du -sh public/screenshots/ 2>/dev/null | cut -f1 || echo "0B")
    THUMBNAIL_SIZE=$(du -sh public/thumbnails/ 2>/dev/null | cut -f1 || echo "0B")

    echo -e "${BLUE}Local Storage:${NC}"
    echo -e "  Screenshots: ${GREEN}$SCREENSHOT_COUNT files${NC} ($SCREENSHOT_SIZE)"
    echo -e "  Thumbnails:  ${GREEN}$THUMBNAIL_COUNT files${NC} ($THUMBNAIL_SIZE)"
    echo ""
}

show_vps_stats() {
    echo -e "${BLUE}VPS Storage:${NC}"
    VPS_SCREENSHOT_COUNT=$(ssh ${VPS_USER}@${VPS_HOST} "ls ${VPS_IMAGE_PATH}/screenshots/ 2>/dev/null | wc -l" 2>/dev/null || echo "0")
    VPS_THUMBNAIL_COUNT=$(ssh ${VPS_USER}@${VPS_HOST} "ls ${VPS_IMAGE_PATH}/thumbnails/ 2>/dev/null | wc -l" 2>/dev/null || echo "0")
    VPS_SCREENSHOT_SIZE=$(ssh ${VPS_USER}@${VPS_HOST} "du -sh ${VPS_IMAGE_PATH}/screenshots/ 2>/dev/null | cut -f1" 2>/dev/null || echo "0B")
    VPS_THUMBNAIL_SIZE=$(ssh ${VPS_USER}@${VPS_HOST} "du -sh ${VPS_IMAGE_PATH}/thumbnails/ 2>/dev/null | cut -f1" 2>/dev/null || echo "0B")

    echo -e "  Screenshots: ${GREEN}$VPS_SCREENSHOT_COUNT files${NC} ($VPS_SCREENSHOT_SIZE)"
    echo -e "  Thumbnails:  ${GREEN}$VPS_THUMBNAIL_COUNT files${NC} ($VPS_THUMBNAIL_SIZE)"
    echo ""
}

push_to_vps() {
    echo -e "${YELLOW}[PUSH] Syncing local images TO VPS...${NC}"
    echo ""

    echo -e "${YELLOW}  → Pushing screenshots...${NC}"
    rsync -avz --progress public/screenshots/ ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/screenshots/
    echo -e "${GREEN}  ✓ Screenshots pushed!${NC}"
    echo ""

    echo -e "${YELLOW}  → Pushing thumbnails...${NC}"
    rsync -avz --progress public/thumbnails/ ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/thumbnails/
    echo -e "${GREEN}  ✓ Thumbnails pushed!${NC}"
    echo ""

    echo -e "${GREEN}Push complete!${NC}"
}

pull_from_vps() {
    echo -e "${YELLOW}[PULL] Downloading VPS images to local...${NC}"
    echo ""

    # Create directories if they don't exist
    mkdir -p public/screenshots
    mkdir -p public/thumbnails

    echo -e "${YELLOW}  → Pulling screenshots...${NC}"
    rsync -avz --progress ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/screenshots/ public/screenshots/
    echo -e "${GREEN}  ✓ Screenshots downloaded!${NC}"
    echo ""

    echo -e "${YELLOW}  → Pulling thumbnails...${NC}"
    rsync -avz --progress ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/thumbnails/ public/thumbnails/
    echo -e "${GREEN}  ✓ Thumbnails downloaded!${NC}"
    echo ""

    echo -e "${GREEN}Pull complete!${NC}"
}

sync_bidirectional() {
    echo -e "${YELLOW}[SYNC] Bidirectional sync (newest wins)...${NC}"
    echo ""

    # Create directories if they don't exist
    mkdir -p public/screenshots
    mkdir -p public/thumbnails

    echo -e "${YELLOW}  → Syncing screenshots (bidirectional)...${NC}"
    # Pull first (get any new files from VPS)
    rsync -avzu --progress ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/screenshots/ public/screenshots/
    # Then push (send any new local files)
    rsync -avzu --progress public/screenshots/ ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/screenshots/
    echo -e "${GREEN}  ✓ Screenshots synced!${NC}"
    echo ""

    echo -e "${YELLOW}  → Syncing thumbnails (bidirectional)...${NC}"
    rsync -avzu --progress ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/thumbnails/ public/thumbnails/
    rsync -avzu --progress public/thumbnails/ ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/thumbnails/
    echo -e "${GREEN}  ✓ Thumbnails synced!${NC}"
    echo ""

    echo -e "${GREEN}Bidirectional sync complete!${NC}"
}

git_operations() {
    echo -e "${YELLOW}[GIT] Checking for changes...${NC}"
    echo ""

    if [[ -n $(git status --porcelain) ]]; then
        echo "Changes detected in repository:"
        git status --short
        echo ""
        read -p "Do you want to commit and push? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            read -p "Enter commit message: " COMMIT_MSG
            git add -A
            git commit -m "$COMMIT_MSG"
            git push origin main
            echo -e "${GREEN}✓ Code pushed to GitHub!${NC}"
        else
            echo -e "${YELLOW}Skipping git push.${NC}"
        fi
    else
        echo -e "${GREEN}No code changes to commit.${NC}"
    fi
}

# Main script
clear
show_menu
show_local_stats

read -p "Enter your choice (1-6): " choice
echo ""

case $choice in
    1)
        push_to_vps
        ;;
    2)
        echo -e "${YELLOW}Checking VPS connection...${NC}"
        show_vps_stats
        read -p "Download all images from VPS? This will overwrite local files. (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            pull_from_vps
        else
            echo -e "${YELLOW}Pull cancelled.${NC}"
        fi
        ;;
    3)
        echo -e "${YELLOW}Checking VPS connection...${NC}"
        show_vps_stats
        read -p "Sync both directions? Newest files win. (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sync_bidirectional
        else
            echo -e "${YELLOW}Sync cancelled.${NC}"
        fi
        ;;
    4)
        git_operations
        ;;
    5)
        push_to_vps
        echo ""
        git_operations
        ;;
    6)
        echo -e "${GREEN}Goodbye!${NC}"
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice. Please run the script again.${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Operation complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
