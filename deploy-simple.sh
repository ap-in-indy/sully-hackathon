#!/bin/bash

# Simple Vercel Deployment Script for Sully Medical Translator

echo "🚀 Deploying Sully Medical Translator to Vercel..."

# Make sure we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the project root directory"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm run install-all

# Build the project
echo "🔨 Building project..."
npm run build

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

echo "✅ Deployment complete!"
echo "⚠️  Don't forget to set your OPENAI_API_KEY in the Vercel dashboard!"
