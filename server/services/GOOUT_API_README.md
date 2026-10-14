# GoOut API Integration

This module provides integration with the GoOut ticketing platform API.

## Overview

The GoOut API service handles:
- Automatic token management (access & refresh tokens)
- Token refresh when needed (access tokens expire after 24h)
- Searching for purchases by barcode
- Checking in tickets
- Retrieving sales information

## Database

Tokens are stored in the `goout_tokens` table with automatic expiration tracking.

## Usage

```javascript
const goOutAPI = require('./services/goout-api');

// Search for a purchase by barcode
const purchase = await goOutAPI.getPurchaseByBarcode('1400528549781');

// Check in a ticket
const result = await goOutAPI.checkInTicket('1400528549781', checkInId);

// Get sales information
const sales = await goOutAPI.getSales([117477]);
```

## API Endpoints

### Token Management
- **POST** `/services/user/v3/refresh-tokens` - Refresh access token
  - Access tokens valid for 24 hours
  - Refresh tokens valid for 60 days
  - Automatically handled by the service

### Purchases
- **GET** `/services/reporting/v1/purchases` - Search purchases
  - Query parameters:
    - `query` - Search by barcode, email, name, purchase ID, etc.
    - `languages[]` - Language for localization (cs, en, pl, uk, de, sk)
    - `include` - Entities to include (tickets, events, schedules, deals, etc.)

### Check-in
- **POST** `/services/entitystore/v2/checkin-entries` - Check in a ticket
  - Request body:
    ```json
    {
      "checkInId": 123456,
      "ticketId": "1400528549781",
      "entryAt": "2026-10-22T18:25:00.000Z",
      "scannerId": "my-irmf"
    }
    ```
    The ticket id is the same as its barcode.
  - Responses:
    - 200 - Successfully checked in
    - 404 - Ticket or check-in not found
    - 422 - Ticket already scanned or not paid
    - 403 - Unauthorized

### Sales
- **GET** `/services/entitystore/v2/sales` - Get sales information
  - Query parameters:
    - `ids[]` - Array of sale IDs
    - `include` - Entities to include (deals, discounts, schedules, events)

## Token Refresh

The service automatically:
1. Loads tokens from database on first use
2. Checks if access token needs refresh (< 1 hour remaining)
3. Refreshes token automatically before API calls
4. Saves new tokens to database
5. Retries failed requests once after token refresh

## Testing

Run the test script:
```bash
node server/scripts/test-goout.js
```

## Error Handling

The service handles:
- Automatic token refresh on 401 errors
- Token expiration checking
- API request retries
- Database connection errors

## Configuration

Initial tokens are stored in the database via migration `040_create_goout_tokens_table.sql`.

To update tokens manually:
```sql
UPDATE goout_tokens
SET access_token = 'new_token',
    refresh_token = 'new_refresh_token',
    expires_at = NOW() + INTERVAL '24 hours',
    refresh_expires_at = NOW() + INTERVAL '60 days',
    updated_at = NOW();
```

## Integration with Scanner

`services/goout-ticket-verifier.js` verifies GoOut tickets scanned in the scanner:

1. The code must be 13 digits with an EAN-13 check digit (GoOut tickets carry it in a QR code)
2. Double entry to the same screening is blocked locally first
3. The ticket is looked up (`findTicket`: purchase search by barcode, then the purchase by hash for exact ticket match, state and schedule)
4. Ticket for this screening or festival pass of this edition: checked in to the screening's check-in at GoOut (422 = already used; a ticket can be checked in to each check-in once, so a pass works for every screening); anything else is rejected
5. If GoOut does not answer within 1 s, the ticket is let in and stored with `goout_status = 'unverified'`
6. The name on the ticket comes back in the check-in response and is stored in `badge_scans.holder_name`, so the scanner can show who came in

## API Documentation

Full API documentation: https://goout.net/services/partners/swagger-ui/index.html?url=/services/partners/v1/extracted-docs