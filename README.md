# Movie Festival Guest Manager

A complete guest management system for movie festivals with invitation workflows and email confirmations.

## Features

- 📋 **Guest Database Management** - Permanent database of guests with contact information
- 🎭 **Festival Edition Management** - Create and manage different festival years/editions
- 👥 **Guest Assignment System** - Assign guests to editions with categories (filmmaker, press, guest, staff)
- 📧 **Email Invitation Workflow** - Send branded invitation emails via Mailgun
- ✅ **Confirmation System** - Secure token-based confirmation links
- 📊 **Status Tracking** - Track invitation and confirmation status per guest/edition

## Technology Stack

- **Backend:** Node.js + Express + PostgreSQL
- **Frontend:** React + Vite + Tailwind CSS  
- **Database:** PostgreSQL (Docker)
- **Email:** Mailgun API + SMTP fallback
- **No vendor lock-in:** Runs on any server/VPS

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Mailgun account (for email sending)

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo>
   cd movie-festival-guest-manager
   npm install
   cd client && npm install && cd ..
   ```

2. **Start PostgreSQL database:**
   ```bash
   docker-compose up -d
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your Mailgun credentials:
   ```env
   # Mailgun Configuration
   MAILGUN_API_KEY=your-mailgun-api-key
   MAILGUN_DOMAIN=your-domain.com
   MAILGUN_FROM_EMAIL=noreply@your-domain.com
   ```

4. **Run database migrations:**
   ```bash
   npm run db:migrate
   ```

5. **Start the application:**
   ```bash
   # Terminal 1: Start backend
   npm run server:dev
   
   # Terminal 2: Start frontend  
   npm run client:dev
   ```

6. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001

## Mailgun Setup

### Option 1: Mailgun API (Recommended)

1. Sign up at [Mailgun](https://mailgun.com)
2. Add your domain and verify it
3. Get your API key from the dashboard
4. Configure in `.env`:
   ```env
   MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxxxxxxxxx
   MAILGUN_DOMAIN=yourdomain.com
   MAILGUN_FROM_EMAIL=noreply@yourdomain.com
   ```

### Option 2: Mailgun SMTP (Fallback)

```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@yourdomain.com
SMTP_PASS=your-mailgun-smtp-password
```

## Usage Workflow

1. **Create Festival Edition**
   - Go to "Editions" tab
   - Create new festival year (e.g., "Festival 2025")

2. **Add Guests**
   - Go to "Guests" tab  
   - Add guest information (name, email, phone)

3. **Assign Guests to Edition**
   - Click on an edition
   - Assign guests with categories (filmmaker, press, guest, staff)

4. **Send Invitations**
   - Click "Send Invite" for each guest
   - Branded emails sent via Mailgun
   - Guests receive confirmation links

5. **Track Confirmations**
   - Monitor invitation status in real-time
   - View confirmation timestamps

## API Endpoints

### Guests
- `GET /api/guests` - List all guests
- `POST /api/guests` - Create guest
- `PUT /api/guests/:id` - Update guest
- `DELETE /api/guests/:id` - Delete guest

### Editions  
- `GET /api/editions` - List all editions
- `POST /api/editions` - Create edition
- `GET /api/editions/:id/guests` - Get assigned guests
- `POST /api/editions/:id/guests` - Assign guest to edition

### Invitations
- `POST /api/invitations/send` - Send invitation email
- `POST /api/invitations/confirm/:token` - Confirm invitation
- `GET /api/invitations/status/:guestId/:editionId` - Get invitation status

## Database Schema

```sql
-- Permanent guest database
guests (id, name, email, phone, created_at, updated_at)

-- Festival editions/years
editions (id, year, name, start_date, end_date, created_at)

-- Guest assignments per edition
guest_editions (id, guest_id, edition_id, category, invited_at, confirmed_at, confirmation_token)
```

## Development

### Scripts
```bash
npm run dev          # Start both frontend and backend
npm run server:dev   # Start backend only
npm run client:dev   # Start frontend only
npm run build        # Build for production
npm run db:migrate   # Run database migrations
```

### Docker Commands
```bash
docker-compose up -d     # Start PostgreSQL
docker-compose down      # Stop services
docker-compose logs      # View logs
```

## Production Deployment

1. **Environment Setup:**
   - Set production database URL
   - Configure production Mailgun settings
   - Set APP_URL to your domain

2. **Build Application:**
   ```bash
   npm run build
   ```

3. **Deploy Options:**
   - Any VPS (DigitalOcean, Linode, etc.)
   - Docker containers
   - Node.js hosting platforms

## License

MIT License