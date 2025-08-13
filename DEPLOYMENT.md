# Sully Medical Translator - Deployment Guide

This guide will help you deploy the Sully Medical Translator to Vercel.

## Prerequisites

1. **Node.js** (v16 or higher)
2. **npm** or **yarn**
3. **Vercel CLI** - Install with: `npm install -g vercel`
4. **OpenAI API Key** - Get one from [OpenAI Platform](https://platform.openai.com/api-keys)

## Quick Deployment

### Option 1: Using the fixed deployment script (Recommended)

```bash
# Make the script executable
chmod +x deploy-fixed.sh

# Run the fixed deployment script
./deploy-fixed.sh
```

### Option 2: Using the original deployment script

```bash
# Make the script executable
chmod +x deploy.sh

# Run the deployment script
./deploy.sh
```

### Option 3: Using the simple deployment script

```bash
# Make the script executable
chmod +x deploy-simple.sh

# Run the simple deployment script
./deploy-simple.sh
```

### Option 4: Manual deployment

```bash
# Install dependencies
npm run install-all

# Build the project
npm run build

# Deploy to Vercel
vercel --prod
```

## Environment Variables Setup

After deployment, you need to set up environment variables in your Vercel dashboard:

1. Go to your Vercel dashboard
2. Select your project
3. Go to Settings → Environment Variables
4. Add the following variables:

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | `sk-...` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Database connection string | `file:./dev.db` |
| `JWT_SECRET` | Secret for JWT tokens | Random string |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment | `production` |
| `WEBHOOK_URL` | Webhook URL for demos | None |

## Troubleshooting

### 404 Errors

If you get 404 errors after deployment:

1. **Check the deployment URL**: Make sure you're using the correct URL from Vercel
2. **Verify environment variables**: Ensure `OPENAI_API_KEY` is set in Vercel dashboard
3. **Check function logs**: Go to Vercel dashboard → Functions → View logs
4. **Test the build locally**: Run `./test-build.sh` to verify the build works

### Build Errors

If you encounter build errors:

1. **"react-scripts: command not found"**
   - Run: `cd client && npm install && cd ..`
   - Then try building again

2. **Missing dependencies**
   - Run: `npm run install-all`
   - This installs both root and client dependencies

3. **Environment variables not found**
   - Make sure you've set up the environment variables in Vercel dashboard
   - The `OPENAI_API_KEY` is required for the app to function

### Common Issues

1. **Database issues**: The app uses SQLite by default. For production, consider using a cloud database like PostgreSQL.

2. **CORS issues**: The server is configured to handle CORS, but you may need to update the allowed origins in production.

3. **WebSocket connections**: Make sure your Vercel plan supports WebSocket connections for real-time features.

4. **React Router issues**: The app uses React Router. The `_redirects` file and Vercel configuration handle client-side routing.

## Project Structure

```
sully-hackathon/
├── client/                 # React frontend
│   ├── src/
│   ├── public/
│   │   └── _redirects      # Vercel redirects for React Router
│   └── package.json
├── server/                 # Express backend
│   └── index.js
├── prisma/                 # Database schema
│   └── schema.prisma
├── package.json           # Root package.json
├── vercel.json           # Vercel configuration
├── deploy.sh             # Original deployment script
├── deploy-fixed.sh       # Fixed deployment script
├── deploy-simple.sh      # Simple deployment script
└── test-build.sh         # Test build script
```

## Development vs Production

- **Development**: Uses local SQLite database, development environment
- **Production**: Uses environment variables, production optimizations

## Support

If you encounter issues:

1. Check the build logs in Vercel dashboard
2. Verify all environment variables are set
3. Ensure all dependencies are properly installed
4. Check the console for any error messages
5. Run the test build script: `./test-build.sh`

## Security Notes

- Never commit your `.env` file to version control
- Keep your OpenAI API key secure
- Use strong JWT secrets in production
- Consider using environment-specific database URLs

## Recent Fixes

The following fixes have been applied to resolve 404 issues:

1. **Updated `vercel.json`**: Proper routing configuration for React Router
2. **Added `_redirects` file**: Handles client-side routing in Vercel
3. **Fixed build configuration**: Ensures proper static file serving
4. **Enhanced deployment scripts**: Better error handling and verification
