#!/bin/bash

# Test build script for Sully Medical Translator
# This script tests the build process locally before deploying

echo "🧪 Testing build process..."

# Clean up
rm -rf client/build
rm -rf node_modules
rm -rf client/node_modules

# Install dependencies
echo "📦 Installing dependencies..."
npm run install-all

# Test build
echo "🔨 Testing build..."
npm run build

# Check if build was successful
if [ -d "client/build" ]; then
    echo "✅ Build successful! Build directory created at client/build"
    echo "📁 Build contents:"
    ls -la client/build/
else
    echo "❌ Build failed! No build directory found."
    exit 1
fi

echo "🎉 Build test completed successfully!"
