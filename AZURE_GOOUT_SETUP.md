# GoOut API - Azure Deployment Setup

This guide explains how to set up automatic GoOut token refresh on Azure Web App deployment.

## Overview

The GoOut API integration includes automatic token refresh that:
- Refreshes tokens every 12 hours (tokens expire in 24 hours)
- Runs on app startup
- Auto-refreshes before each API call if needed
- Handles refresh token rotation (60-day expiration)

## Initial Setup on Azure

### Step 1: Deploy the Application

Deploy your application to Azure Web App as usual. The migrations will automatically create the `goout_tokens` table.

### Step 2: Get Initial Tokens from GoOut

1. Log in to GoOut Partner Portal
2. Generate or obtain your access and refresh tokens
3. Save them securely

### Step 3: Populate Tokens in Azure Database

Connect to your Azure PostgreSQL database and run the token initialization script:

```bash
# Option A: Run directly against Azure database
PGPASSWORD=your_password psql \
  -h your-server.postgres.database.azure.com \
  -U your_username \
  -d festival_db \
  -c "DELETE FROM goout_tokens; \
      INSERT INTO goout_tokens (access_token, refresh_token, expires_at, refresh_expires_at) \
      VALUES ('YOUR_ACCESS_TOKEN', 'YOUR_REFRESH_TOKEN', \
              NOW() + INTERVAL '24 hours', NOW() + INTERVAL '60 days');"

# Option B: Use the initialization script via SSH to Azure
az webapp ssh --name your-app-name --resource-group your-resource-group
cd /home/site/wwwroot
node server/scripts/init-goout-tokens.js YOUR_ACCESS_TOKEN YOUR_REFRESH_TOKEN
```

### Step 4: Restart the Web App

After populating the tokens, restart your Azure Web App:

```bash
az webapp restart --name your-app-name --resource-group your-resource-group
```

## How It Works

### Automatic Token Refresh

The system uses a three-layer approach to ensure tokens are always valid:

1. **Background Scheduler** (`goout-token-scheduler.js`)
   - Runs every 12 hours
   - Proactively refreshes tokens before they expire
   - Starts automatically when the app starts

2. **Pre-Request Check** (`goout-api.js` - `ensureValidToken()`)
   - Checks if token expires in <1 hour before each API call
   - Refreshes if needed
   - Happens synchronously before the API request

3. **Error Recovery** (`goout-api.js` - `apiRequest()`)
   - Catches 401 Unauthorized errors
   - Refreshes token and retries the request once
   - Handles unexpected token invalidation

### Token Lifecycle

```
Access Token:  24 hours validity
Refresh Token: 60 days validity

Timeline:
├─ 0h:  Token created
├─ 12h: Background refresh (scheduled)
├─ 23h: Pre-request refresh (if API call happens)
├─ 24h: Token expired (would be refreshed by now)
├─ ...
└─ 60d: Refresh token expires → Manual token renewal required
```

## Monitoring

### Check Token Status

You can check the current token status by querying the database:

```sql
SELECT
  expires_at,
  refresh_expires_at,
  CASE
    WHEN expires_at < NOW() THEN 'EXPIRED'
    WHEN expires_at < NOW() + INTERVAL '1 hour' THEN 'EXPIRING SOON'
    ELSE 'VALID'
  END as status,
  extract(epoch from (expires_at - NOW())) / 3600 as hours_until_expiry
FROM goout_tokens;
```

### Application Logs

The scheduler logs token refresh events:

```
[GoOut Token Scheduler] Refreshing tokens...
[GoOut Token Scheduler] ✓ Tokens refreshed successfully at 2025-09-30T10:00:00Z
[GoOut Token Scheduler] Next refresh: 2025-09-30T22:00:00Z
```

Check Azure logs:
```bash
az webapp log tail --name your-app-name --resource-group your-resource-group
```

## Troubleshooting

### Problem: Tokens Not Refreshing

**Check:**
1. Are tokens in the database?
   ```sql
   SELECT * FROM goout_tokens;
   ```

2. Is the scheduler running? Check app logs for:
   ```
   Starting GoOut token refresh scheduler...
   ✓ GoOut token refresh scheduler started (runs every 12 hours)
   ```

3. Are there error logs?
   ```
   [GoOut Token Scheduler] ✗ Failed to refresh tokens: <error>
   ```

**Solution:**
- Re-run the token initialization script
- Check GoOut API credentials
- Verify refresh token hasn't expired (60 days)

### Problem: Refresh Token Expired

Refresh tokens expire after 60 days. You'll need to manually obtain new tokens from GoOut.

**Symptoms:**
```
Error: GoOut API Error - Status: 401
Response: {"error": "invalid_grant", "error_description": "Refresh token expired"}
```

**Solution:**
1. Log in to GoOut Partner Portal
2. Generate new access and refresh tokens
3. Run the initialization script again (Step 3 above)
4. Restart the app

### Problem: Database Connection Issues

If the scheduler can't connect to the database:

**Check:**
- Azure PostgreSQL firewall rules (allow Azure services)
- Connection string in environment variables
- Database user permissions

## Environment Variables

Ensure these are set in Azure Web App Configuration:

```bash
# Database connection (usually inherited from connection string)
DATABASE_URL=postgresql://user:password@host:5432/database

# Or separate variables
DB_HOST=your-server.postgres.database.azure.com
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=festival_db
DB_PORT=5432

# Node environment
NODE_ENV=production
```

## Manual Token Refresh

If you need to manually refresh tokens (for testing or emergency):

```bash
# SSH into Azure Web App
az webapp ssh --name your-app-name --resource-group your-resource-group

# Run test script to verify and refresh
cd /home/site/wwwroot
node server/scripts/test-goout.js
```

## Best Practices

1. **Monitor Refresh Token Expiration**: Set up alerts for when refresh token is close to 60-day expiration
2. **Log Monitoring**: Regularly check logs for token refresh failures
3. **Backup Tokens**: Keep a secure backup of valid refresh tokens
4. **Automated Alerts**: Set up Azure Monitor alerts for repeated API failures

## Azure Application Insights (Recommended)

Set up Application Insights to monitor GoOut API health:

```javascript
// Add to your monitoring dashboard
- Metric: GoOut API Success Rate
- Alert: When success rate < 95% in last 5 minutes
- Alert: When token refresh fails 3 times consecutively
```

## Security Notes

- Tokens are stored encrypted in Azure PostgreSQL
- Never commit tokens to git
- Use Azure Key Vault for additional token security (optional)
- Rotate tokens regularly (within the 60-day window)
