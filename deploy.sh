#!/bin/bash

# Sully Medical Translator - Vercel Deployment Script
# This script builds and deploys the project to Vercel

set -e  # Exit on any error

echo "🚀 Starting Sully Medical Translator deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

print_success "Build completed successfully!"

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
