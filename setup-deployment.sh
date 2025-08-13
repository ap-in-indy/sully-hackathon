#!/bin/bash

echo "🚀 Sully Medical Translator - Deployment Setup"
echo "=============================================="
echo ""

echo "This script will help you set up deployment for your application."
echo ""

echo "Choose your deployment approach:"
echo "1) Vercel Backend + GitHub Pages Frontend (Recommended - Secure)"
echo "2) GitHub Pages with Environment Variables (Demo - Less Secure)"
echo ""

read -p "Enter your choice (1 or 2): " choice

case $choice in
  1)
    echo ""
    echo "🎯 Setting up Vercel Backend + GitHub Pages Frontend"
    echo "=================================================="
    echo ""
    echo "Step 1: Install Vercel CLI"
    echo "Run: npm install -g vercel"
    echo ""
    echo "Step 2: Login to Vercel"
    echo "Run: vercel login"
    echo ""
    echo "Step 3: Deploy backend"
    echo "Run: cd server && vercel"
    echo ""
    echo "Step 4: Set environment variables in Vercel dashboard:"
    echo "- OPENAI_API_KEY = your OpenAI API key"
    echo "- DATABASE_URL = your database URL"
    echo "- JWT_SECRET = your JWT secret"
    echo ""
    echo "Step 5: Update client/package.json proxy URL with your Vercel app URL"
    echo ""
    echo "Step 6: Deploy frontend"
    echo "Run: cd client && npm run deploy"
    echo ""
    echo "✅ This approach keeps your API key secure on the server side."
    ;;
  2)
    echo ""
    echo "🎯 Setting up GitHub Pages with Environment Variables"
    echo "==================================================="
    echo ""
    echo "Step 1: Add GitHub Repository Secret"
    echo "- Go to your GitHub repository"
    echo "- Settings → Secrets and variables → Actions"
    echo "- Add: REACT_APP_OPENAI_API_KEY = your OpenAI API key"
    echo ""
    echo "Step 2: Push to main branch to trigger deployment"
    echo "The GitHub Actions workflow will automatically deploy your app."
    echo ""
    echo "⚠️  WARNING: This approach exposes your API key in the frontend bundle."
    echo "Only use this for demos or prototypes."
    ;;
  *)
    echo "Invalid choice. Please run the script again and select 1 or 2."
    exit 1
    ;;
esac

echo ""
echo "📚 For detailed instructions, see DEPLOYMENT.md"
echo ""
echo "🔗 Your app will be available at: https://ap-in-indy.github.io/sully-hackathon"
echo ""
