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

**CRITICAL**: NEVER commit or push changes automatically. ALWAYS ask the user for explicit permission before creating commits or pushing to the repository. The user wants to review all changes before they are committed to git history.

**STOP AND ASK**: Before running any `git commit` or `git push` commands, you MUST:
1. STOP what you are doing
2. ASK the user: "Should I commit and push these changes?"
3. WAIT for explicit user permission
4. Only proceed if the user explicitly says yes

**NO EXCEPTIONS**: This rule applies to ALL changes, including:
- Bug fixes
- Version bumps
- Documentation updates
- Any code changes, no matter how small

The user will decide when and what to commit to git history.

### Version Bump Guidelines

**IMPORTANT**: This project uses SEPARATE versioning for Backend (BE) and Frontend (FE). Always bump versions for both components when making changes.

#### Backend and Frontend Separate Versioning

- **Backend version**: Located in root `package.json` 
- **Frontend version**: Located in `client/package.json`

When making changes:

1. **Backend changes only**: Bump version in root `package.json` using `npm version patch|minor|major --no-git-tag-version`
2. **Frontend changes only**: Bump version in `client/package.json` using `cd client && npm version patch|minor|major --no-git-tag-version`
3. **Both backend and frontend changes**: Bump versions in BOTH package.json files

#### Version Bump Types:
- **PATCH (x.x.X)**: Bug fixes, small improvements, refactoring, documentation updates
- **MINOR (x.X.x)**: New features, new API endpoints, significant UI changes  
- **MAJOR (X.x.x)**: Breaking changes, major refactoring, API changes that affect compatibility

#### Version Bump Process:
1. Determine which components are affected (BE, FE, or both)
2. Bump appropriate version(s) using `npm version` commands above
3. Commit all changes including both package.json and package-lock.json files
4. The commit message should indicate which component versions were bumped

**Rule**: Default to PATCH if unsure. Only skip version bumping if the change is truly non-functional (like fixing a typo in a comment).

**Commit Message Format**: When package.json files are committed (version bump), mention the component versions in the commit message (e.g., "BE v1.2.3, FE v2.1.4").

**Package Lock Files**: ALWAYS include package-lock.json files when committing version bumps. Both root and client package-lock.json files must be committed together with their respective package.json files.

### Git Repository Structure

**IMPORTANT**: When running git commands, always execute them from the repository root directory (`/Users/vaclav.martinovsky/GitHub/claude-test`) to ensure all changes from both client and server directories are included. Use `cd /Users/vaclav.martinovsky/GitHub/claude-test && git command` format to avoid missing changes in subdirectories.