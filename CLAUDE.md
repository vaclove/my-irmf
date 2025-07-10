# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Information

This is a fresh repository connected to GitHub at: https://github.com/vaclove/claude-test

## Current State

The repository is currently empty except for:
- Git configuration
- Claude Code settings in `.claude/settings.local.json`

## Development Setup

Since this is a new repository, the development setup will depend on what type of project is created. Common patterns to consider:

### For Node.js/JavaScript projects:
- `npm install` - Install dependencies
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run lint` - Run linting

### For Python projects:
- `pip install -r requirements.txt` - Install dependencies
- `python -m pytest` - Run tests
- `python -m flake8` or `ruff check` - Run linting

### For other project types:
Commands will be added as the project structure is established.

## Claude Code Configuration

The repository has Claude Code permissions configured in `.claude/settings.local.json` with selective permissions for bash commands.