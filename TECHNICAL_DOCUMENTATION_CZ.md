# Technická dokumentace - My IRMF

## Komplexní systém pro správu International Road Movie Festival

**Verze dokumentace:** 2.0  
**Datum:** Prosinec 2024  
**Autor:** Festival Management Team

---

## 1. Přehled systému

### 1.1 Účel systému
My IRMF je komplexní festivalový management systém poskytující kompletní řešení pro organizaci mezinárodního filmového festivalu. Systém integruje všechny klíčové oblasti festivalového managementu:

#### Správa hostů a akreditací
- Databáze hostů, filmařů, novinářů a VIP
- Automatizace pozvánek a komunikace
- Sledování statusu účasti
- Správa ubytování
- Generování akreditačních visaček s QR kódy

#### Filmový katalog
- Kompletní databáze filmů s metadaty
- Správa filmových sekcí a kategorií
- Import dat z předchozích systémů
- Veřejné API pro web festivalu
- Správa obrazových materiálů

#### Programování a scheduling
- Tvorba festivalového programu
- Správa promítacích sálů a časů
- Bloky filmů a speciální projekce
- Kapacitní plánování
- Export programu pro různé výstupy

#### Ticketing a předprodej
- Online prodej vstupenek
- Správa cen a kategorií
- QR kódy pro validaci
- Integrace s pokladním systémem
- Statistiky prodeje

### 1.2 Technologický stack

#### Backend
- **Node.js** (v18+) - serverové prostředí
- **Express.js** - webový framework
- **PostgreSQL** (v14+) - databáze
- **Passport.js** - autentizace (Google OAuth 2.0)

#### Frontend
- **React** (v18) - uživatelské rozhraní
- **Vite** - build nástroj
- **Tailwind CSS** - stylování
- **React Router** - navigace

#### Infrastruktura
- **Azure App Service** - hosting
- **Azure PostgreSQL** - databázový server
- **AWS S3** - úložiště obrázků
- **Mailgun API** - odesílání emailů
- **GitHub Actions** - CI/CD

---

## 2. Architektura systému

### 2.1 Komponenty systému

#### Architektura systému - vysokoúrovňový pohled

```mermaid
graph TB
    subgraph "Klientská vrstva"
        U[Uživatelé systému]
        AI[Admin Interface<br/>React SPA]
        PW[Festival Website<br/>WordPress]
        MA[Mobile App<br/>budoucí]
    end
    
    subgraph "API vrstva"
        AG[API Gateway<br/>Express.js]
        PA[Public API<br/>REST]
        AA[Admin API<br/>REST + Auth]
    end
    
    subgraph "Business Logic vrstva"
        GM[Guest Manager]
        FC[Film Catalog]
        PS[Programming Scheduler]
        IS[Invitation Service]
        TS[Ticketing Service]
        AS[Accommodation Service]
        BG[Badge Generator]
        ES[Email Service]
        IMG[Image Service]
    end
    
    subgraph "Data vrstva"
        PG[(PostgreSQL<br/>Database)]
        RD[(Redis<br/>Cache)]
    end
    
    subgraph "Externí služby"
        S3[AWS S3<br/>Storage]
        MG[Mailgun<br/>Email API]
        PY[Payment<br/>Gateway]
        CDN[CDN<br/>Static Assets]
    end
    
    U --> AI
    U --> PW
    U --> MA
    
    AI --> AG
    PW --> PA
    MA --> PA
    
    AG --> AA
    PA --> FC
    PA --> PS
    
    AA --> GM
    AA --> FC
    AA --> PS
    AA --> IS
    AA --> TS
    AA --> AS
    AA --> BG
    
    GM --> PG
    FC --> PG
    PS --> PG
    IS --> PG
    TS --> PG
    AS --> PG
    
    IS --> ES
    ES --> MG
    
    FC --> IMG
    GM --> IMG
    BG --> IMG
    IMG --> S3
    
    TS --> PY
    
    AI --> CDN
    PW --> CDN
    
    AA --> RD
    PA --> RD
```

#### Detailní komponenty Backend služeb

```mermaid
graph LR
    subgraph "API Gateway Layer"
        MW[Middleware Stack]
        MW --> AUTH[Auth Middleware<br/>Google OAuth]
        MW --> CORS[CORS Handler]
        MW --> LOG[Request Logger]
        MW --> RATE[Rate Limiter]
        MW --> ERR[Error Handler]
    end
    
    subgraph "Service Layer"
        subgraph "Guest Management"
            GS[Guest Service]
            GS --> GT[Tag Manager]
            GS --> GI[Invitation Handler]
            GS --> GB[Badge Creator]
        end
        
        subgraph "Film Management"
            MS[Movie Service]
            MS --> MI[Image Processor]
            MS --> ME[Metadata Manager]
            MS --> MW[WordPress Importer]
        end
        
        subgraph "Programming"
            PS[Schedule Service]
            PS --> PC[Conflict Checker]
            PS --> PB[Block Manager]
            PS --> PE[Export Generator]
        end
        
        subgraph "Ticketing"
            TS[Ticket Service]
            TS --> TR[Reservation Manager]
            TS --> TQ[QR Generator]
            TS --> TV[Validator]
        end
    end
```

#### Databázové schéma - hlavní vztahy

```mermaid
erDiagram
    EDITIONS ||--o{ GUESTS : "has guests via tags"
    EDITIONS ||--o{ MOVIES : "contains"
    EDITIONS ||--o{ PROGRAMMING_SCHEDULE : "has"
    EDITIONS ||--o{ HOTELS : "provides"
    
    GUESTS ||--o{ GUEST_TAGS : "has"
    TAGS ||--o{ GUEST_TAGS : "assigned to"
    GUESTS ||--o{ GUEST_INVITATIONS : "receives"
    
    GUEST_INVITATIONS ||--o{ ACCOMMODATION_SELECTIONS : "selects"
    GUEST_INVITATIONS }o--|| EDITIONS : "for"
    
    MOVIES ||--o{ PROGRAMMING_SCHEDULE : "scheduled in"
    MOVIES ||--o{ BLOCK_MOVIES : "part of"
    MOVIE_BLOCKS ||--o{ BLOCK_MOVIES : "contains"
    MOVIE_BLOCKS ||--o{ PROGRAMMING_SCHEDULE : "scheduled"
    
    VENUES ||--o{ PROGRAMMING_SCHEDULE : "hosts"
    
    PROGRAMMING_SCHEDULE ||--o{ TICKETS : "sells"
    
    HOTELS ||--o{ ROOM_TYPES : "offers"
    ROOM_TYPES ||--o{ ROOM_AVAILABILITY : "has"
    
    GUESTS {
        uuid id PK
        string first_name
        string last_name
        string email UK
        string language
        string company
    }
    
    MOVIES {
        uuid id PK
        string name_cs
        string name_en
        string director
        int year
        string country
        int runtime
        uuid edition_id FK
    }
    
    PROGRAMMING_SCHEDULE {
        uuid id PK
        uuid edition_id FK
        uuid venue_id FK
        uuid movie_id FK
        uuid block_id FK
        date scheduled_date
        time scheduled_time
    }
    
    TICKETS {
        uuid id PK
        uuid programming_id FK
        string ticket_type
        decimal price
        string qr_code UK
        string status
    }
```

#### Datové toky - pozvánka hosta

```mermaid
sequenceDiagram
    participant Admin
    participant Frontend
    participant API
    participant DB
    participant Email
    participant Guest
    
    Admin->>Frontend: Vybere hosty k pozvání
    Frontend->>API: POST /api/invitations/send
    API->>DB: Vytvoří invitation záznam
    API->>DB: Generuje unikátní token
    API->>Email: Odešle pozvánku
    Email->>Guest: Doručí email
    Guest->>Email: Klikne na odkaz
    Guest->>Frontend: Otevře potvrzovací stránku
    Frontend->>API: GET /api/public/invitation/:token
    API->>DB: Načte detaily pozvánky
    API->>Frontend: Vrátí data
    Guest->>Frontend: Potvrdí účast
    Frontend->>API: POST /api/public/confirm/:token
    API->>DB: Aktualizuje status na 'confirmed'
    API->>Email: Odešle potvrzovací email
    Email->>Guest: Doručí potvrzení
    Email->>Admin: CC kopie potvrzení
```

#### Deployment architektura

```mermaid
graph TB
    subgraph "Development"
        DEV[Local Dev<br/>localhost:3001/5173]
    end
    
    subgraph "CI/CD Pipeline"
        GH[GitHub]
        GA[GitHub Actions]
        GH --> GA
    end
    
    subgraph "Azure Cloud"
        subgraph "Production"
            AS[App Service<br/>my.irmf.cz]
            PG_PROD[(Azure PostgreSQL<br/>Production DB)]
            AS --> PG_PROD
        end
        
        subgraph "Staging"
            AS_STAGE[App Service<br/>staging.irmf.cz]
            PG_STAGE[(Azure PostgreSQL<br/>Staging DB)]
            AS_STAGE --> PG_STAGE
        end
    end
    
    subgraph "External Services"
        S3[AWS S3<br/>Images]
        MG[Mailgun<br/>Email]
        CF[Cloudflare<br/>CDN]
    end
    
    DEV --> GH
    GA --> AS_STAGE
    GA --> AS
    
    AS --> S3
    AS --> MG
    AS --> CF
    AS_STAGE --> S3
    AS_STAGE --> MG
```

### 2.2 Databázová struktura

#### Core tabulky - Správa hostů

**guests** - Databáze hostů
```sql
- id (UUID) - primární klíč
- first_name, last_name - jméno hosta
- email - kontaktní email
- language (czech/english) - preferovaný jazyk
- company - společnost/organizace
- greeting - oslovení pro komunikaci
- image_path - cesta k fotografii v S3
- notes - interní poznámky
```

**guest_invitations** - Pozvánky hostů
```sql
- id (UUID) - primární klíč
- guest_id - odkaz na hosta
- edition_id - odkaz na ročník
- status - stav pozvánky (pending/confirmed/declined/badge_printed)
- token - unikátní token pro potvrzení
- invited_at, confirmed_at, badge_printed_at - časové značky
- accommodation - příznak ubytování
- covered_nights - počet hrazených nocí
```

#### Filmový katalog

**movies** - Databáze filmů
```sql
- id (UUID) - primární klíč
- mysql_id (INTEGER) - legacy ID z WordPress
- name_cs, name_en - název filmu (CZ/EN)
- synopsis_cs, synopsis_en - synopse
- director - režisér
- year - rok výroby
- country - země původu
- runtime - délka filmu v minutách
- section - sekce filmu (main_competition, documentaries, etc.)
- premiere - typ premiéry (world, european, czech)
- language - originální jazyk
- subtitles - jazyk titulků
- cast - obsazení
- genre - žánr
- is_35mm - příznak 35mm filmu
- has_delegation - má delegaci
- image_url - cesta k plakátu v S3
- edition_id - odkaz na ročník
- is_public - veřejně viditelný
```

**sections** - Filmové sekce
```sql
- id (UUID) - primární klíč
- name_cs, name_en - název sekce
- description_cs, description_en - popis
- sort_order - pořadí zobrazení
- color - barva pro UI
```

#### Programování

**venues** - Promítací sály
```sql
- id (UUID) - primární klíč
- name_cs, name_en - název sálu
- capacity - kapacita
- address - adresa
- sort_order - pořadí zobrazení
- active - aktivní/neaktivní
```

**programming_schedule** - Program festivalu
```sql
- id (UUID) - primární klíč
- edition_id - odkaz na ročník
- venue_id - odkaz na sál
- movie_id - odkaz na film (nullable)
- block_id - odkaz na blok filmů (nullable)
- scheduled_date - datum projekce
- scheduled_time - čas začátku
- base_runtime - základní délka
- discussion_time - čas pro diskusi
- total_runtime - celková délka včetně přestávek
- title_override_cs, title_override_en - přepsaný název
- notes - poznámky
```

**movie_blocks** - Bloky filmů
```sql
- id (UUID) - primární klíč
- name_cs, name_en - název bloku
- description_cs, description_en - popis
- total_runtime - celková délka
- edition_id - odkaz na ročník
```

**block_movies** - Filmy v blocích
```sql
- id (UUID) - primární klíč
- block_id - odkaz na blok
- movie_id - odkaz na film
- sort_order - pořadí v bloku
```

#### Ticketing

**tickets** - Vstupenky
```sql
- id (UUID) - primární klíč
- programming_id - odkaz na program
- ticket_type - typ vstupenky (normal, student, senior, vip)
- price - cena
- currency - měna (CZK/EUR)
- barcode - čárový kód
- qr_code - QR kód
- status - stav (available, reserved, sold, used)
- purchased_at - datum nákupu
- used_at - datum použití
- buyer_email - email kupujícího
- buyer_name - jméno kupujícího
```

**ticket_categories** - Kategorie vstupenek
```sql
- id (UUID) - primární klíč
- name - název kategorie
- discount_percentage - sleva v procentech
- requires_validation - vyžaduje ověření (student ID, etc.)
```

#### Ubytování

**hotels** - Hotely
```sql
- id (UUID) - primární klíč
- name - název hotelu
- address - adresa
- description - popis
- edition_id - odkaz na ročník
- sort_order - pořadí zobrazení
- active - aktivní/neaktivní
```

**room_types** - Typy pokojů
```sql
- id (UUID) - primární klíč
- hotel_id - odkaz na hotel
- name - název typu (single, double, suite)
- description - popis
- capacity - kapacita osob
- price_per_night - cena za noc
- currency - měna
- amenities - vybavení (JSON)
```

**room_availability** - Dostupnost pokojů
```sql
- id (UUID) - primární klíč
- room_type_id - odkaz na typ pokoje
- available_date - datum
- total_rooms - celkový počet pokojů
- available_rooms - volné pokoje
- blocked_rooms - blokované pokoje
```

**accommodation_selections** - Výběr ubytování hostem
```sql
- id (UUID) - primární klíč
- invitation_id - odkaz na pozvánku
- selected_date - vybrané datum
- is_extra_night - je to extra noc (placená)
- price_per_night - cena za noc
- payment_status - stav platby
```

#### Systémové tabulky

**editions** - Ročníky festivalu
```sql
- id (UUID) - primární klíč
- year (INTEGER) - rok konání
- name - název ročníku
- start_date, end_date - termín konání
- registration_open - registrace otevřena
- ticketing_open - předprodej otevřen
```

**tags** - Kategorizační štítky
```sql
- id (UUID) - primární klíč
- name - název štítku (např. "2025", "filmmaker", "press")
- color - barva pro UI zobrazení
- category - kategorie tagu (year, role, special)
```

**audit_logs** - Audit logy
```sql
- id (UUID) - primární klíč
- table_name - název tabulky
- record_id - ID záznamu
- action - akce (INSERT, UPDATE, DELETE)
- old_data - původní data (JSON)
- new_data - nová data (JSON)
- user_email - email uživatele
- ip_address - IP adresa
- created_at - časová značka
```

**email_templates** - Šablony emailů
```sql
- id (UUID) - primární klíč
- edition_id - odkaz na ročník
- template_type - typ šablony (invitation, confirmation, reminder)
- language - jazyk (czech/english)
- subject - předmět emailu
- body - tělo emailu (HTML)
- markdown_content - Markdown verze
- variables - dostupné proměnné (JSON)
```

---

## 3. Klíčové funkcionality

### 3.1 Správa hostů

#### Implementace
- **Tag-based system**: Hosté jsou přiřazováni k ročníkům pomocí štítků (např. tag "2025")
- **Kategorie**: Automatické určení kategorie podle prioritních tagů (filmmaker > press > staff > guest)
- **Vyhledávání**: Full-text search s podporou diakritiky
- **Bulk operations**: Hromadné operace (import CSV, hromadné tagování)
- **Duplicity**: Automatická detekce duplicit podle emailu

#### API Endpoints
```javascript
GET /api/guests - seznam všech hostů
GET /api/guests/:id - detail hosta
POST /api/guests - vytvoření nového hosta
PUT /api/guests/:id - aktualizace hosta
DELETE /api/guests/:id - smazání hosta
POST /api/guests/bulk-import - hromadný import
GET /api/guests/search?q=term - vyhledávání
```

### 3.2 Filmový katalog

#### Funkcionality
- **Kompletní metadata**: Všechny informace o filmu včetně technických parametrů
- **Multijazyčnost**: Názvy a synopse v CZ/EN
- **Sekce a kategorie**: Organizace filmů do sekcí (soutěž, dokumenty, retrospektiva)
- **Import legacy dat**: Migrace z WordPress databáze
- **Správa médií**: Plakáty, stills, trailery přes S3

#### API Endpoints
```javascript
// Admin API
GET /api/movies - seznam filmů s filtrováním
GET /api/movies/:id - detail filmu
POST /api/movies - vytvoření filmu
PUT /api/movies/:id - aktualizace filmu
DELETE /api/movies/:id - smazání filmu
POST /api/movies/:id/image - upload plakátu

// Public API (pro web festivalu)
GET /api/public/movies - veřejný seznam filmů
GET /api/public/movies/:id - veřejný detail filmu
GET /api/public/editions/:year/movies - filmy ročníku
GET /api/public/sections - seznam sekcí
```

#### Integrace s webem
```javascript
// WordPress kompatibilní URL struktura
/movie/:id/ - detail filmu
/program/2025/ - program ročníku
/section/main-competition/ - sekce filmů
```

### 3.3 Programování a scheduling

#### Funkce scheduleru
- **Drag & drop interface**: Intuitivní plánování programu
- **Collision detection**: Detekce konfliktů (stejný film ve dvou sálech)
- **Automatický výpočet**: Časy konce, přestávky mezi projekcemi
- **Bloky filmů**: Podpora krátkometrážních bloků
- **Export formátů**: PDF katalog, CSV, JSON, iCal

#### Workflow
1. Import filmů do katalogu
2. Definice promítacích sálů a jejich kapacit
3. Vytvoření programových slotů
4. Přiřazení filmů/bloků do slotů
5. Kontrola konfliktů a kapacit
6. Publikování programu

#### API Endpoints
```javascript
// Správa programu
GET /api/programming/schedule - kompletní program
POST /api/programming/schedule - vytvoření slotu
PUT /api/programming/schedule/:id - úprava slotu
DELETE /api/programming/schedule/:id - smazání slotu
GET /api/programming/conflicts - kontrola konfliktů

// Venues (sály)
GET /api/venues - seznam sálů
POST /api/venues - vytvoření sálu
PUT /api/venues/:id - úprava sálu

// Bloky
GET /api/blocks - seznam bloků
POST /api/blocks - vytvoření bloku
PUT /api/blocks/:id - úprava bloku
POST /api/blocks/:id/movies - přidání filmu do bloku
```

### 3.4 Ticketing a předprodej

#### Funkcionality
- **Online prodej**: Integrace s platební bránou
- **Kategorie vstupenek**: Normální, student, senior, VIP
- **QR kódy**: Unikátní QR pro každou vstupenku
- **Validace**: Skenování QR při vstupu
- **Statistiky**: Real-time přehledy prodeje
- **Rezervace**: Časově omezené rezervace

#### Ticketing workflow
```
1. Návštěvník vybere projekci
2. Výběr typu vstupenky
3. Rezervace míst (15 minut)
4. Platba (karta/převod)
5. Generování QR kódu
6. Odeslání emailu s vstupenkou
7. Validace při vstupu
```

#### API Endpoints
```javascript
// Public ticketing API
GET /api/tickets/availability/:programming_id
POST /api/tickets/reserve
POST /api/tickets/purchase
GET /api/tickets/validate/:qr_code

// Admin API
GET /api/tickets/stats - statistiky prodeje
GET /api/tickets/report - reporty
POST /api/tickets/bulk-generate - hromadné generování
```

### 3.5 Systém pozvánek

#### Workflow
1. Výběr hostů podle tagů
2. Generování unikátního tokenu
3. Odeslání emailu s personalizovaným obsahem
4. Sledování otevření a kliknutí
5. Potvrzení/odmítnutí účasti
6. Výběr ubytování (pokud je součástí)

#### Šablonový systém
```javascript
// Podporované proměnné v šablonách
{{greeting}} - oslovení hosta
{{guest_name}} - celé jméno
{{edition_name}} - název ročníku
{{category}} - kategorie hosta
{{confirmation_link}} - odkaz pro potvrzení
{{accommodation_dates_info}} - informace o ubytování
{{programme_highlights}} - výběr z programu
```

### 3.6 Správa ubytování

#### Funkce
- Definice hotelů a typů pokojů
- Sledování dostupnosti v reálném čase
- Rezervace noclehu při potvrzení
- Správa extra nocí (placené/neplacené)
- Automatické blokování pokojů
- Reporting pro hotely

#### Datový model
```javascript
hotels -> room_types -> room_availability
guest_invitations -> accommodation_selections
```

### 3.7 Generování visaček

#### Technické řešení
- **Canvas API** pro renderování visaček
- **QR kódy** s identifikací hosta
- **Batch processing** pro hromadný tisk
- **Různé šablony**: Host, Press, VIP, Staff
- Export do PDF pro tiskárnu

#### Workflow
1. Výběr potvrzených hostů
2. Výběr šablony visačky
3. Generování QR s daty hosta
4. Renderování visačky
5. Export do PDF (A4, 8 visaček/stránka)
6. Označení jako vytištěno

### 3.8 Reporty a statistiky

#### Dostupné reporty
- **Hosté**: Počty podle kategorií, potvrzení účasti
- **Filmy**: Statistiky podle sekcí, zemí, žánrů
- **Program**: Vytížení sálů, časové rozložení
- **Ticketing**: Prodeje, výnosy, obsazenost
- **Ubytování**: Obsazenost hotelů, náklady

#### Export formátů
- PDF reporty s grafy
- Excel tabulky
- CSV pro další zpracování
- JSON pro API integraci

---

## 4. Bezpečnost

### 4.1 Autentizace a autorizace

#### Google OAuth 2.0
- Přihlášení pouze pro domény `@irmf.cz` a `@irmf.net`
- Session-based autentizace
- PostgreSQL session store

#### Implementace middleware
```javascript
// Kontrola IRMF domény
const requireIrmfDomain = (req, res, next) => {
  const email = req.user?.email || '';
  const allowedDomains = ['@irmf.cz', '@irmf.net'];
  
  if (allowedDomains.some(domain => email.endsWith(domain))) {
    return next();
  }
  
  return res.status(403).json({ 
    error: 'Access denied. IRMF domain required.' 
  });
};
```

### 4.2 Zabezpečení API

- **CORS** - povolené pouze definované domény
- **Helmet.js** - bezpečnostní hlavičky
- **Rate limiting** - ochrana proti DoS
- **SQL injection** - parametrizované dotazy
- **XSS ochrana** - sanitizace vstupů

### 4.3 Ochrana dat

- **Tokeny**: Kryptograficky bezpečné (crypto.randomBytes)
- **Session**: HTTP-only cookies, secure flag v produkci
- **Databáze**: SSL připojení, šifrování at-rest
- **S3**: Privátní buckety, signed URLs

---

## 5. Migrace a údržba

### 5.1 Databázové migrace

#### Struktura migračních souborů
```
server/migrations/
├── 001_initial_schema.sql
├── 002_add_guest_invitations.sql
├── 003_add_tags_system.sql
└── ...
```

#### Spuštění migrací
```bash
npm run db:migrate
```

#### Vytvoření nové migrace
```sql
-- server/migrations/XXX_migration_name.sql
-- Popis změny

ALTER TABLE table_name 
ADD COLUMN column_name TYPE;

-- Rollback instrukce (komentář)
-- ALTER TABLE table_name DROP COLUMN column_name;
```

### 5.2 Zálohování

#### Databáze
```bash
# Záloha databáze
pg_dump -h <host> -U <user> -d festival_db > backup_$(date +%Y%m%d).sql

# Obnovení ze zálohy
psql -h <host> -U <user> -d festival_db < backup_20241211.sql
```

#### S3 Storage
- Automatické verzování souborů
- Cross-region replikace
- Lifecycle policies pro archivaci

### 5.3 Monitoring a logování

#### Aplikační logy
```javascript
// Winston logger konfigurace
{
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'combined.log' 
    })
  ]
}
```

#### Audit trail
- Všechny změny v systému jsou logovány
- Tabulka `audit_logs` obsahuje:
  - Uživatel, čas, akce
  - Původní a nové hodnoty
  - IP adresa

---

## 6. Deployment

### 6.1 Lokální vývoj

```bash
# Backend
npm install
npm run server:dev

# Frontend
cd client
npm install
npm run dev
```

#### Environment variables (.env)
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/festival_db
PORT=3001
NODE_ENV=development
CLIENT_URL=http://localhost:5173
SESSION_SECRET=your-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_DOMAIN=irmf.cz
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
S3_BUCKET_NAME=irmf-images
```

### 6.2 Produkční deployment (Azure)

#### Build proces
```bash
# Build frontend
cd client && npm run build

# Zkopírování build souborů
cp -r dist/* ../server/public/

# Start produkčního serveru
npm run start
```

#### Azure App Service konfigurace
- **Node version**: 18 LTS
- **Startup command**: `npm run azure:start`
- **Environment variables**: Nastavit v Azure Portal

### 6.3 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy to Azure

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - uses: azure/webapps-deploy@v2
        with:
          app-name: 'my-irmf'
          publish-profile: ${{ secrets.AZURE_PUBLISH_PROFILE }}
```

---

## 7. Troubleshooting

### 7.1 Časté problémy

#### CORS chyby
```javascript
// Řešení: Přidat origin do povolených domén
const corsOptions = {
  origin: ['http://localhost:5173', 'https://my.irmf.cz'],
  credentials: true
};
```

#### Databázové připojení
```bash
# Kontrola připojení
psql -h localhost -U festival_user -d festival_db -c "SELECT 1"

# Azure PostgreSQL - kontrola firewall rules
az postgres server firewall-rule list
```

#### Email nefunguje
```javascript
// Kontrola Mailgun konfigurace
console.log('Mailgun configured:', mailgunService.isConfigured());

// Test odeslání
await mailgunService.sendEmail({
  to: 'test@irmf.cz',
  subject: 'Test',
  html: '<p>Test email</p>'
});
```

### 7.2 Performance optimalizace

#### Databázové indexy
```sql
-- Indexy pro rychlé vyhledávání
CREATE INDEX idx_guests_email ON guests(email);
CREATE INDEX idx_guests_name ON guests(first_name, last_name);
CREATE INDEX idx_invitations_token ON guest_invitations(token);
CREATE INDEX idx_tags_name ON tags(name);
```

#### Frontend optimalizace
- Lazy loading komponent
- Image optimization (různé velikosti)
- Bundle splitting
- CDN pro statické assety

---

## 8. Údržba a best practices

### 8.1 Pravidelná údržba

#### Denní
- Kontrola error logů
- Monitoring dostupnosti

#### Týdenní
- Záloha databáze
- Kontrola diskového prostoru
- Review audit logů

#### Měsíční
- Aktualizace dependencies
- Performance review
- Security patching

### 8.2 Kódové standardy

#### Backend
```javascript
// Používat async/await místo callbacks
const getData = async () => {
  try {
    const result = await pool.query('SELECT * FROM guests');
    return result.rows;
  } catch (error) {
    logError(error);
    throw error;
  }
};
```

#### Frontend
```javascript
// React komponenty - funkční s hooks
const GuestList = () => {
  const [guests, setGuests] = useState([]);
  
  useEffect(() => {
    fetchGuests().then(setGuests);
  }, []);
  
  return <div>{/* render */}</div>;
};
```

### 8.3 Verzování

- **Semantic versioning** (MAJOR.MINOR.PATCH)
- **Git flow** - main, develop, feature branches
- **Commit messages** - konvenční formát

---

## 9. Kontakty a podpora

### Technická podpora
- **Email**: tech@irmf.cz
- **GitHub**: https://github.com/vaclove/my-irmf

### Dokumentace
- **API dokumentace**: `/api-docs`
- **User manual**: `/docs/user-guide`
- **GitHub Wiki**: Repository wiki

### Vendor podpora
- **Azure**: Azure support portal
- **Mailgun**: support@mailgun.com
- **AWS**: AWS support center

---

## 10. API Reference

### 10.1 Autentizace

Všechny API endpointy kromě public vyžadují autentizaci přes Google OAuth.

```javascript
// Login flow
GET /auth/google - redirect na Google OAuth
GET /auth/google/callback - callback po přihlášení
GET /auth/user - informace o přihlášeném uživateli
POST /auth/logout - odhlášení
```

### 10.2 Response formáty

#### Úspěšná odpověď
```json
{
  "data": {
    // response data
  },
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

#### Chybová odpověď
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

### 10.3 Pagination

```javascript
GET /api/resource?page=1&limit=20&sort=name&order=asc
```

### 10.4 Filtering

```javascript
GET /api/movies?year=2025&section=competition&country=CZ
```

---

## 11. Integrace s externími systémy

### 11.1 WordPress festival web

#### REST API endpoints
- `/api/public/movies` - katalog filmů
- `/api/public/programming` - program projekcí
- `/api/public/venues` - seznam sálů
- `/api/public/editions` - ročníky festivalu

#### WordPress plugin
```php
// Příklad volání API z WordPress
$response = wp_remote_get('https://api.irmf.cz/public/movies');
$movies = json_decode(wp_remote_retrieve_body($response));
```

### 11.2 Mailgun

#### Konfigurace
```env
MAILGUN_API_KEY=your-api-key
MAILGUN_DOMAIN=irmf.cz
MAILGUN_FROM_EMAIL=irmf@irmf.cz
```

#### Webhook endpoints
```javascript
POST /webhooks/mailgun/delivered
POST /webhooks/mailgun/opened
POST /webhooks/mailgun/clicked
POST /webhooks/mailgun/bounced
```

### 11.3 AWS S3

#### Bucket struktura
```
irmf-images/
├── guests/
│   ├── {guest_id}/
│   │   ├── original.jpg
│   │   ├── medium.jpg
│   │   └── thumbnail.jpg
├── movies/
│   ├── {movie_id}/
│   │   ├── poster.jpg
│   │   └── stills/
└── badges/
    └── {edition_year}/
```

### 11.4 Payment Gateway (budoucí)

#### Podporované metody
- Kreditní/debetní karty
- Bankovní převod
- PayPal
- Google Pay / Apple Pay

---

## 12. Performance optimalizace

### 12.1 Databáze

#### Kritické indexy
```sql
-- Často používané dotazy
CREATE INDEX idx_guests_email ON guests(email);
CREATE INDEX idx_guests_name ON guests(first_name, last_name);
CREATE INDEX idx_invitations_token ON guest_invitations(token);
CREATE INDEX idx_invitations_status ON guest_invitations(status);
CREATE INDEX idx_movies_edition ON movies(edition_id);
CREATE INDEX idx_movies_section ON movies(section);
CREATE INDEX idx_programming_date ON programming_schedule(scheduled_date);
CREATE INDEX idx_programming_venue ON programming_schedule(venue_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tags_name ON tags(name);

-- Composite indexy
CREATE INDEX idx_guest_tags ON guest_tags(guest_id, tag_id);
CREATE INDEX idx_invitations_guest_edition ON guest_invitations(guest_id, edition_id);
```

#### Query optimization
```javascript
// Použití SELECT pouze potřebných sloupců
const query = `
  SELECT id, first_name, last_name, email
  FROM guests
  WHERE ...
`;

// Použití LIMIT pro pagination
const query = `
  SELECT * FROM movies
  LIMIT 20 OFFSET 40
`;

// Použití JOIN místo N+1 queries
const query = `
  SELECT g.*, array_agg(t.name) as tags
  FROM guests g
  LEFT JOIN guest_tags gt ON g.id = gt.guest_id
  LEFT JOIN tags t ON gt.tag_id = t.id
  GROUP BY g.id
`;
```

### 12.2 Caching strategie

#### Redis cache layers
```javascript
// API response cache
cache.set(`api:movies:${year}`, movies, 3600);

// Database query cache
cache.set(`query:guests:${hash}`, results, 300);

// Session cache
cache.set(`session:${sessionId}`, userData, 86400);
```

#### CDN pro statické assety
- Obrázky hostů a filmů
- JavaScript/CSS bundles
- PDF dokumenty

### 12.3 Frontend optimalizace

#### Code splitting
```javascript
// Lazy loading routes
const GuestManager = lazy(() => import('./pages/GuestManager'));
const MovieCatalog = lazy(() => import('./pages/MovieCatalog'));
const Programming = lazy(() => import('./pages/Programming'));
```

#### Image optimization
```javascript
// Responsive images
<img 
  srcset="
    image-320w.jpg 320w,
    image-640w.jpg 640w,
    image-1280w.jpg 1280w
  "
  sizes="(max-width: 320px) 280px, (max-width: 640px) 600px, 1200px"
  src="image-640w.jpg"
/>
```

---

## 13. Disaster Recovery

### 13.1 Backup strategie

#### Databáze
- **Denní zálohy**: Automatické v 02:00 CET
- **Týdenní zálohy**: Neděle 03:00 CET (uchovány 4 týdny)
- **Měsíční zálohy**: První neděle v měsíci (uchovány 12 měsíců)
- **Geo-redundance**: Zálohy v jiném Azure regionu

#### S3 Storage
- **Versioning**: Všechny soubory verzované
- **Cross-region replication**: Automatická replikace
- **Lifecycle policies**: Archivace starých verzí

### 13.2 Recovery procedures

#### Database recovery
```bash
# 1. Stop aplikaci
az webapp stop --name my-irmf

# 2. Restore databáze
pg_restore -h <host> -U <user> -d festival_db_restore backup.sql

# 3. Verify data
psql -h <host> -U <user> -d festival_db_restore -c "SELECT COUNT(*) FROM guests"

# 4. Switch databáze
az postgres server update --name <server> --database festival_db_restore

# 5. Restart aplikaci
az webapp start --name my-irmf
```

#### RTO/RPO targets
- **RTO (Recovery Time Objective)**: 4 hodiny
- **RPO (Recovery Point Objective)**: 24 hodin

---

## 14. Changelog

### Verze 2.0.0 (Prosinec 2024)
- Kompletní reimplementace filmového katalogu
- Nový systém programování s drag & drop
- Implementace ticketing modulu
- Public API pro web festivalu
- Vylepšené reporty a statistiky

### Verze 1.4.1 (Prosinec 2024)
- Implementace tag-based systému pro správu hostů
- Vylepšení CORS konfigurace
- Oprava aktualizace statusu při potvrzení pozvánky
- Přidání podpory pro extra noclehy

### Verze 1.4.0 (Listopad 2024)
- Migrace na Azure PostgreSQL
- Implementace S3 storage pro obrázky
- Nový systém šablon emailů
- Audit logging

### Verze 1.3.0 (Říjen 2024)
- Generování QR kódů na visačky
- Hromadné odesílání emailů
- Správa ubytování

### Verze 1.2.0 (Září 2024)
- Import filmů z WordPress
- Základní programování
- API pro veřejný web

### Verze 1.1.0 (Srpen 2024)
- Systém pozvánek
- Email šablony
- Google OAuth integrace

### Verze 1.0.0 (Červenec 2024)
- Iniciální release
- Správa hostů
- Základní CRUD operace

---

## 15. Roadmap

### Q1 2025
- [ ] Mobile app pro skenování vstupenek
- [ ] Integrace platební brány
- [ ] Real-time dashboard

### Q2 2025
- [ ] AI-powered scheduling optimizer
- [ ] Automatické generování katalogů
- [ ] Sociální média integrace

### Q3 2025
- [ ] Mobilní aplikace pro hosty
- [ ] Virtual screening room
- [ ] Live streaming integrace

### Q4 2025
- [ ] Kompletní CRM modul
- [ ] Marketing automation
- [ ] Advanced analytics

---

## 16. Přílohy

### 16.1 Databázové schéma
Kompletní ERD diagram je dostupný v `/docs/database-schema.pdf`

### 16.2 API dokumentace
Swagger/OpenAPI specifikace: `/api-docs`

### 16.3 UI/UX guidelines
Design system dokumentace: `/docs/design-system.md`

### 16.4 Deployment checklist
Kontrolní seznam pro produkční nasazení: `/docs/deployment-checklist.md`

---

*Konec dokumentu*

**Dokument vytvořen:** Prosinec 2024  
**Poslední aktualizace:** Prosinec 2024  
**Verze dokumentu:** 2.0  
**Kontakt:** tech@irmf.cz