#!/bin/bash

# Quick deployment script for Sully Medical Translator
# This script deploys with the current fixes applied

echo "🚀 Quick deployment for Sully Medical Translator..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the project root directory"
    exit 1
fi

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

echo "✅ Deployment complete!"
echo "⚠️  Don't forget to set your OPENAI_API_KEY in the Vercel dashboard!"
