# Azure Deployment Guide

This guide explains how to deploy the Festival Guest Management System to Azure App Service with both frontend and backend served from the same domain (`https://my.irmf.cz`).

## Architecture

```
https://my.irmf.cz/
├── / (Frontend - React SPA)
├── /api/* (Backend - Express API)  
└── /confirm/* (Public confirmation links)
```

## Prerequisites

1. Azure subscription
2. Azure CLI installed
3. Node.js 18+ installed locally
4. PostgreSQL database (Azure Database for PostgreSQL recommended)

## Environment Variables

### Production Environment Variables

Copy `.env.production` and update with your production values:

```bash
# Application URLs
APP_URL=https://my.irmf.cz
CLIENT_URL=https://my.irmf.cz

# Database Configuration (Azure Database for PostgreSQL)
DATABASE_URL=postgresql://username:password@your-server.postgres.database.azure.com:5432/festival_db?ssl=true

# Server Configuration
PORT=3001
NODE_ENV=production

# Security
JWT_SECRET=your-production-jwt-secret-change-this
SESSION_SECRET=your-production-session-secret-change-this

# Email Configuration
MAILGUN_API_KEY=your-mailgun-api-key
MAILGUN_DOMAIN=irmf.cz
MAILGUN_FROM_EMAIL=irmf@irmf.cz

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Authentication Configuration
BYPASS_AUTH_ON_LOCALHOST=false
```

## Deployment Steps

### 1. Create Azure Resources

```bash
# Create resource group
az group create --name festival-app-rg --location eastus

# Create App Service plan
az appservice plan create \
  --name festival-app-plan \
  --resource-group festival-app-rg \
  --sku B1 \
  --is-linux

# Create web app
az webapp create \
  --name my-irmf-festival \
  --resource-group festival-app-rg \
  --plan festival-app-plan \
  --runtime "NODE|18-lts"
```

### 2. Configure Environment Variables

```bash
# Set application settings
az webapp config appsettings set \
  --name my-irmf-festival \
  --resource-group festival-app-rg \
  --settings \
  NODE_ENV=production \
  APP_URL=https://my.irmf.cz \
  CLIENT_URL=https://my.irmf.cz \
  DATABASE_URL="your-database-connection-string" \
  JWT_SECRET="your-jwt-secret" \
  SESSION_SECRET="your-session-secret" \
  MAILGUN_API_KEY="your-mailgun-key" \
  MAILGUN_DOMAIN="irmf.cz" \
  MAILGUN_FROM_EMAIL="irmf@irmf.cz" \
  GOOGLE_CLIENT_ID="your-google-client-id" \
  GOOGLE_CLIENT_SECRET="your-google-client-secret" \
  BYPASS_AUTH_ON_LOCALHOST=false
```

### 3. Configure Custom Domain

```bash
# Add custom domain
az webapp config hostname add \
  --webapp-name my-irmf-festival \
  --resource-group festival-app-rg \
  --hostname my.irmf.cz

# Enable HTTPS
az webapp config ssl bind \
  --name my-irmf-festival \
  --resource-group festival-app-rg \
  --certificate-thumbprint your-cert-thumbprint \
  --ssl-type SNI
```

### 4. Deploy from GitHub

```bash
# Configure GitHub deployment
az webapp deployment source config \
  --name my-irmf-festival \
  --resource-group festival-app-rg \
  --repo-url https://github.com/vaclove/claude-test \
  --branch main \
  --manual-integration
```

## Build Process

The deployment will automatically:

1. Run `npm install` (install server dependencies)
2. Run `cd client && npm install` (install client dependencies)  
3. Run `cd client && npm run build` (build React production bundle)
4. Start the Node.js server with `npm start`

## Local Testing

To test the production build locally:

```bash
# Build the application
npm run build

# Start in production mode
npm run start

# Or test the full production pipeline
npm run test:production
```

The application will be available at `http://localhost:3001` with:
- Frontend served from `/`
- API available at `/api/*`
- Health check at `/health`

## Database Setup

### Azure Database for PostgreSQL

1. Create the database:
```bash
az postgres server create \
  --resource-group festival-app-rg \
  --name festival-db-server \
  --location eastus \
  --admin-user festival_admin \
  --admin-password "YourSecurePassword" \
  --sku-name GP_Gen5_2
```

2. Create the database:
```bash
az postgres db create \
  --resource-group festival-app-rg \
  --server-name festival-db-server \
  --name festival_db
```

3. Configure firewall to allow Azure services:
```bash
az postgres server firewall-rule create \
  --resource-group festival-app-rg \
  --server festival-db-server \
  --name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

4. Run database migrations:
```bash
# Connect to your Azure database and run the init.sql script
psql "postgresql://festival_admin:YourSecurePassword@festival-db-server.postgres.database.azure.com:5432/festival_db?ssl=true" -f server/scripts/init.sql
```

## Production Considerations

### Security
- All secrets should be stored in Azure Key Vault or App Service application settings
- Enable HTTPS only
- Configure proper CORS origins
- Use strong JWT and session secrets

### Performance
- Enable gzip compression
- Configure CDN for static assets if needed
- Monitor application performance with Application Insights

### Monitoring
- Configure Application Insights for monitoring
- Set up alerts for critical metrics
- Enable application logging

### Scaling
- Configure auto-scaling rules based on CPU/memory usage
- Consider using Azure Database for PostgreSQL with read replicas for high traffic

## Troubleshooting

### Common Issues

1. **Build fails**: Check that all dependencies are in `package.json` dependencies (not devDependencies)
2. **Static files not served**: Verify that `client/dist` exists after build
3. **API routes not working**: Check that API routes are defined before the static file middleware
4. **CORS errors**: Verify `APP_URL` and `CLIENT_URL` environment variables are set correctly

### Debugging

- Check application logs: `az webapp log tail --name my-irmf-festival --resource-group festival-app-rg`
- Check build logs in Azure Portal deployment center
- Test API endpoints directly: `https://my.irmf.cz/api/health`

## Useful Commands

```bash
# Restart the application
az webapp restart --name my-irmf-festival --resource-group festival-app-rg

# View logs
az webapp log tail --name my-irmf-festival --resource-group festival-app-rg

# SSH into the container (for debugging)
az webapp ssh --name my-irmf-festival --resource-group festival-app-rg
```