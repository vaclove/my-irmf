# Database Migrations

This directory contains versioned SQL migration files for the Movie Festival Guest Management System.

## Migration System Features

- **Versioned migrations**: Each migration has a unique version number (e.g., 001, 002, etc.)
- **Tracking**: Applied migrations are tracked in the `schema_migrations` table
- **Integrity checking**: MD5 checksums ensure migration files haven't been modified after application
- **Transactional**: Each migration runs in a transaction (rollback on failure)
- **Idempotent**: Safe to run multiple times

## Usage

### Run Migrations
```bash
npm run db:migrate
```

### Check Migration Status
```bash
npm run db:status
```

## Migration File Format

Migration files follow the naming convention: `{version}_{description}.sql`

Example: `002_add_user_roles.sql`

Each migration file should include:
```sql
-- Migration: 002_add_user_roles.sql
-- Description: Add role-based access control for users
-- Date: 2025-07-13

-- Your SQL statements here
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL
);
```

## Creating New Migrations

1. Create a new SQL file with the next version number
2. Include the header comment with description and date
3. Write your SQL statements
4. Test locally before deploying

## Best Practices

- **One logical change per migration**: Keep migrations focused and atomic
- **Use IF NOT EXISTS**: Make migrations idempotent when possible
- **Test rollbacks**: Consider how to undo changes if needed
- **Don't modify existing migrations**: Once applied, never change a migration file
- **Use descriptive names**: Make it clear what the migration does

## Migration Order

- `000_migration_tracking.sql` - Creates the migration tracking system
- `001_initial_schema.sql` - Creates the complete initial database schema
- Future migrations will be numbered sequentially (002, 003, etc.)

## Azure Compatibility Notes

- Uses `gen_random_uuid()` instead of `uuid_generate_v4()` (Azure PostgreSQL compatible)
- No dependency on extensions that may not be available in Azure
- Designed to work with both local PostgreSQL and Azure Database for PostgreSQL