# Deployment Guide - GitHub Pages

This guide will help you deploy the Sully Medical Translator to GitHub Pages.

## Prerequisites

1. **GitHub Repository**: Make sure your repository is pushed to GitHub
2. **Public Repository**: GitHub Pages requires the repository to be public (unless you have GitHub Pro)
3. **Node.js**: Ensure you have Node.js installed on your system
4. **GitHub Personal Access Token**: You'll need a PAT for authentication (see setup below)

## Quick Deployment

### Option 1: Using the deployment script

```bash
# Make the script executable (if not already)
chmod +x deploy.sh

# Run the deployment script
./deploy.sh
```

### Option 2: Manual deployment

```bash
# Navigate to the client directory
cd client

# Install dependencies
npm install

# Install gh-pages for deployment
npm install gh-pages --save-dev

# Build the production version
npm run build

# Deploy to GitHub Pages
npm run deploy
```

## GitHub Authentication Setup

Before deploying, you need to set up GitHub authentication:

### Option 1: Personal Access Token (Recommended)

1. **Create a Personal Access Token**:
   - Go to GitHub.com → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Click "Generate new token (classic)"
   - Give it a name like "GitHub Pages Deployment"
   - Select scopes: `repo` (full control of private repositories)
   - Copy the generated token (you won't see it again!)

2. **Configure Git to use the token**:
   ```bash
   git config --global credential.helper store
   ```
   
   When prompted during deployment:
   - **Username**: Your GitHub username (`ap-in-indy`)
   - **Password**: Use your Personal Access Token (not your GitHub password)

### Option 2: SSH Keys (Alternative)

If you prefer SSH authentication:
1. Generate SSH keys: `ssh-keygen -t ed25519 -C "your_email@example.com"`
2. Add the public key to your GitHub account
3. Update your repository remote to use SSH: `git remote set-url origin git@github.com:ap-in-indy/sully-hackathon.git`

## GitHub Pages Setup

After running the deployment script, you need to configure GitHub Pages:

1. **Go to your repository on GitHub**
2. **Navigate to Settings** → **Pages**
3. **Source**: Select "Deploy from a branch"
4. **Branch**: Select "gh-pages" branch
5. **Folder**: Leave as "/ (root)"
6. **Click Save**

## Important Notes

### Backend Configuration
⚠️ **Important**: The current app is configured to connect to a local backend server (`http://localhost:3001`). For production deployment, you'll need to:

1. **Deploy your backend server** to a hosting service (Heroku, Railway, etc.)
2. **Update the backend URL** in your frontend code
3. **Configure CORS** on your backend to allow requests from your GitHub Pages domain

### Environment Variables
If you need to configure different backend URLs for development vs production, consider using environment variables:

```javascript
// In your realtimeService.ts or similar
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';
```

### CORS Configuration
Your backend server needs to allow requests from your GitHub Pages domain. Add this to your backend CORS configuration:

```javascript
// Example CORS configuration for your backend
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://alexpritchard.github.io'
  ]
}));
```

## Troubleshooting

### Build Errors
- Make sure all dependencies are installed: `npm install`
- Check for TypeScript errors: `npm run build`
- Ensure all imports are correct

### Deployment Issues
- Verify your repository is public
- Check that GitHub Pages is enabled in repository settings
- Ensure the `gh-pages` branch was created successfully

### Routing Issues
- The app is configured to work with GitHub Pages routing
- If you encounter 404 errors on direct navigation, the 404.html redirect should handle it
- Test navigation by refreshing pages and using browser back/forward buttons

## Production URL

Once deployed, your app will be available at:
**https://ap-in-indy.github.io/sully-hackathon**

## Updating the Deployment

To update your deployed app:

1. Make your changes to the code
2. Commit and push to GitHub
3. Run the deployment script again: `./deploy.sh`

The new version will be deployed automatically.
