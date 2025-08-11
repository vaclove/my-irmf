#!/bin/bash

# Azure deployment optimization script
echo "🚀 Starting optimized Azure deployment..."

# Set environment variables for faster installs
export NODE_ENV=production
export HUSKY=0
export CI=true
export npm_config_audit=false
export npm_config_fund=false
export npm_config_optional=false

# Install server dependencies (production only)
echo "📦 Installing server dependencies..."
npm ci --production --silent

# Build client
echo "🏗️  Building client..."
cd client
npm ci --silent
npm run build --silent
cd ..

# Clean up to save space
echo "🧹 Cleaning up..."
rm -rf client/node_modules/.cache
rm -rf /tmp/.npm*

echo "✅ Deployment optimized and ready!"