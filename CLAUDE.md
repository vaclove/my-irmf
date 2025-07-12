# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Information

This is a repository connected to GitHub at: https://github.com/vaclove/my-irmf

## Current State

This repository contains a complete Movie Festival Guest Management System with:
- Node.js/Express backend with PostgreSQL database
- React frontend with Tailwind CSS
- Google OAuth authentication
- Email invitation system with Mailgun
- Audit logging system
- Tag-based guest assignment system
- Azure deployment configuration

## Development Setup

This is a Node.js/JavaScript project with the following commands:

### Development:
- `npm install` - Install server dependencies
- `cd client && npm install` - Install client dependencies
- `npm run dev` - Start both server and client in development mode
- `npm run server:dev` - Start only the backend server
- `npm run client:dev` - Start only the frontend client

### Production:
- `npm run build` - Build the React frontend for production
- `npm run start` - Start the production server (serves both FE and BE)
- `npm run test:production` - Test the full production build locally

### Azure Deployment:
- `npm run azure:build` - Build for Azure deployment
- `npm run azure:start` - Start in Azure production mode

### Database:
- `npm run db:migrate` - Run database migrations

## Claude Code Configuration

The repository has Claude Code permissions configured in `.claude/settings.local.json` with selective permissions for bash commands.