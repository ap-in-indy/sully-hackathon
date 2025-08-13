#!/bin/bash

echo "🔐 Setting up GitHub authentication for deployment..."
echo ""

echo "📋 Follow these steps to create a Personal Access Token:"
echo ""
echo "1. Go to: https://github.com/settings/tokens"
echo "2. Click 'Generate new token (classic)'"
echo "3. Give it a name like 'GitHub Pages Deployment'"
echo "4. Select scopes: ✓ repo (full control of private repositories)"
echo "5. Click 'Generate token'"
echo "6. Copy the token (you won't see it again!)"
echo ""

read -p "Have you created your Personal Access Token? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "✅ Great! Now let's configure Git to store your credentials..."
    echo ""
    
    # Configure Git to store credentials
    git config --global credential.helper store
    
    echo "🔧 Git credential helper configured!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Run: ./deploy.sh"
    echo "2. When prompted for username: enter 'ap-in-indy'"
    echo "3. When prompted for password: paste your Personal Access Token"
    echo ""
    echo "⚠️  Note: Your credentials will be stored securely for future deployments."
else
    echo "❌ Please create a Personal Access Token first, then run this script again."
    echo "   You can find the instructions above."
fi
