# Deployment Guide

This guide covers two approaches to deploy your Sully Medical Translator application while securely handling the OpenAI API key.

## Option 1: Vercel Backend + GitHub Pages Frontend (Recommended)

This is the most secure approach as it keeps your API key on the server side.

### Step 1: Deploy Backend to Vercel

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy the backend**:
   ```bash
   cd server
   vercel
   ```

4. **Set environment variables in Vercel**:
   - Go to your Vercel dashboard
   - Select your project
   - Go to Settings → Environment Variables
   - Add: `OPENAI_API_KEY` = your actual OpenAI API key

5. **Update client configuration**:
   - Replace `your-vercel-app-name.vercel.app` in `client/package.json` with your actual Vercel app URL
   - The proxy should point to your Vercel deployment

### Step 2: Deploy Frontend to GitHub Pages

1. **Update the proxy URL** in `client/package.json`:
   ```json
   "proxy": "https://your-actual-vercel-app.vercel.app"
   ```

2. **Deploy to GitHub Pages**:
   ```bash
   cd client
   npm run deploy
   ```

## Option 2: GitHub Pages with Environment Variables (Less Secure)

This approach exposes your API key to the frontend but works for demos.

### Step 1: Set GitHub Repository Secrets

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add a new repository secret:
   - Name: `REACT_APP_OPENAI_API_KEY`
   - Value: your actual OpenAI API key

### Step 2: Create GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: |
        npm install
        cd client && npm install
    
    - name: Build React app
      run: cd client && npm run build
      env:
        REACT_APP_OPENAI_API_KEY: ${{ secrets.REACT_APP_OPENAI_API_KEY }}
    
    - name: Deploy to GitHub Pages
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./client/build
```

### Step 3: Enable GitHub Pages

1. Go to your repository Settings → Pages
2. Set source to "Deploy from a branch"
3. Select the `gh-pages` branch
4. Save

## Security Considerations

### Option 1 (Vercel Backend) - ✅ Secure
- API key stays on server
- Client only gets ephemeral tokens
- No exposure of sensitive data

### Option 2 (GitHub Pages) - ⚠️ Less Secure
- API key is embedded in the frontend bundle
- Visible in browser developer tools
- Only suitable for demos/prototypes

## Environment Variables Reference

### Backend (Vercel)
```env
OPENAI_API_KEY=your_openai_api_key_here
DATABASE_URL="file:./dev.db"
PORT=3001
NODE_ENV=production
JWT_SECRET=your_jwt_secret_here
```

### Frontend (GitHub Pages - Option 2 only)
```env
REACT_APP_OPENAI_API_KEY=your_openai_api_key_here
```

## Troubleshooting

### CORS Issues
If you encounter CORS errors, ensure your Vercel backend has proper CORS configuration:

```javascript
app.use(cors({
  origin: ['https://your-github-username.github.io', 'http://localhost:3000'],
  credentials: true
}));
```

### Database Issues
For production, consider using a cloud database instead of SQLite:

- **PlanetScale** (MySQL)
- **Supabase** (PostgreSQL)
- **MongoDB Atlas**

Update your `DATABASE_URL` in Vercel environment variables accordingly.

### Build Errors
If you encounter build errors, ensure all dependencies are properly installed:

```bash
npm run install-all
cd client && npm install
```

## Recommended Approach

For a production application, **use Option 1 (Vercel Backend)** as it provides the best security while maintaining functionality. Option 2 should only be used for demos or prototypes where security is not a primary concern.
