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

**Important**: IRMF stands for "International Road Movie Festival" (not Roma Music Festival). Contact email: irmf@irmf.cz

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

## Git Workflow Instructions

**IMPORTANT**: NEVER commit or push changes automatically. Always ask the user for explicit permission before creating commits or pushing to the repository. The user wants to review all changes before they are committed to git history.

### Version Bump Guidelines

**IMPORTANT**: ALWAYS bump the version for any functional changes. Never skip version bumping unless the commit only contains non-functional changes like typos in comments.

When committing changes, bump the package.json version:

- **PATCH (x.x.X)**: Bug fixes, small improvements, refactoring, documentation updates
- **MINOR (x.X.x)**: New features, new API endpoints, significant UI changes  
- **MAJOR (X.x.x)**: Breaking changes, major refactoring, API changes that affect compatibility

Use `npm version patch|minor|major` before committing to update the version. The pre-commit hook will prompt you to decide on version bumping.

**Rule**: Default to PATCH if unsure. Only skip if the change is truly non-functional (like fixing a typo in a comment).

**Commit Message Format**: When package.json is committed (version bump), the version number will be automatically appended to the commit message in the format "v1.1.2" before the Co-Authored-By line. Never use just the version number as the entire commit message.