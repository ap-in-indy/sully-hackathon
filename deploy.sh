#!/bin/bash

echo "🚀 Building and deploying Sully Medical Translator to GitHub Pages..."

# Navigate to client directory
cd client

# Install dependencies if needed
echo "📦 Installing dependencies..."
npm install

# Install gh-pages if not already installed
echo "📦 Installing gh-pages..."
npm install gh-pages --save-dev

# Build the production version
echo "🔨 Building production version..."
npm run build

# Deploy to GitHub Pages
echo "🚀 Deploying to GitHub Pages..."
npm run deploy

echo "✅ Deployment complete!"
echo "🌐 Your app should be available at: https://apinindyap-in-indy.github.io/sully-hackathon"
echo ""
echo "📝 Note: It may take a few minutes for the changes to appear on GitHub Pages."
echo "📝 Make sure your repository is public and GitHub Pages is enabled in the repository settings."
