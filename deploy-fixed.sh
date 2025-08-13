#!/bin/bash

# Fixed Vercel Deployment Script for Sully Medical Translator
# This script addresses the 404 issues and ensures proper deployment

set -e  # Exit on any error

echo "🚀 Starting fixed deployment for Sully Medical Translator..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    print_error "Vercel CLI is not installed. Please install it first:"
    echo "npm install -g vercel"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "client" ] || [ ! -d "server" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

# Clean up any previous builds
print_status "Cleaning up previous builds..."
rm -rf client/build
rm -rf node_modules
rm -rf client/node_modules

# Install root dependencies
print_status "Installing root dependencies..."
npm install

# Install client dependencies
print_status "Installing client dependencies..."
cd client
npm install
cd ..

# Check if .env file exists, if not create from example
if [ ! -f ".env" ]; then
    print_warning "No .env file found. Creating from env.example..."
    cp env.example .env
    print_warning "Please update .env with your actual API keys before deploying"
fi

# Fix ESLint issues before building
print_status "Fixing ESLint issues..."
if [ -f "fix-eslint.sh" ]; then
    chmod +x fix-eslint.sh
    ./fix-eslint.sh
fi

# Build the client
print_status "Building React client..."
cd client
npm run build
cd ..

# Check if build was successful
if [ ! -d "client/build" ]; then
    print_error "Client build failed. Please check the build output above."
    exit 1
fi

# Verify build contents
print_status "Verifying build contents..."
if [ ! -f "client/build/index.html" ]; then
    print_error "index.html not found in build directory!"
    exit 1
fi

print_success "Build verification passed!"

# Deploy to Vercel
print_status "Deploying to Vercel..."
vercel --prod

print_success "Deployment completed!"
print_status "Your app should now be live on Vercel!"
print_warning "Remember to set up your environment variables in the Vercel dashboard:"
echo "  - OPENAI_API_KEY (required)"
echo "  - DATABASE_URL (if using external database)"
echo "  - JWT_SECRET (for authentication)"
echo "  - Other environment variables as needed"

print_status "If you still get 404 errors, check:"
echo "  1. Environment variables are set in Vercel dashboard"
echo "  2. The deployment URL is correct"
echo "  3. Check Vercel function logs for any server errors"
