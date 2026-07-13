# THE PROJECT (JavaScript)

This project is a static front-end (HTML/CSS) with a Node.js + Express backend and PostgreSQL for data persistence.

## What I added
- Express server (`server.js`) serving static files and API endpoints
- `db.js` using `pg` pool
- API routes: `/api/companies` and `/api/contacts` (basic CRUD)
- Front-end changes to submit and fetch data via `fetch()` (in `add_contact_person.html`, `company_records.html`, `contact_person_records.html`)

## Setup
1. Install dependencies

   npm install

2. Copy `.env.example` to `.env` and set Postgres connection values (PGUSER, PGPASSWORD, PGDATABASE, PGHOST)

3. Initialize database: run the SQL in `database.sql` against your PostgreSQL instance (e.g., `psql -U user -d db -f database.sql`).

4. Start the server

   npm run dev  # requires nodemon
   or
   npm start

5. Open the HTML pages in the browser via `http://localhost:3000/` (e.g., `http://localhost:3000/company_records.html`)

## Notes & next steps
- The server and API are minimal and intended as a starting point. Add validation, authentication, and more endpoints as needed.
- If you want SQL run automatically, I can add a migration runner or instructions for a `psql` command/script.

## New API additions
- GET `/api/metadata/industries` - list industries
- POST `/api/metadata/industries` - add industry
- GET `/api/metadata/categories` - list categories
- POST `/api/metadata/categories` - add category
- POST `/api/companies` now accepts additional nested objects:
  - `contact` (object): `isd_code`, `area_code`, `phone_primary`, `phone_secondary`, `fax`, `email_primary`, `email_secondary`
  - `address` (object): `address_line1`, `address_line2`, `city`, `state`, `country`, `pincode`, `address_type`

Example payload to create a company (JSON):

{
  "legal_name": "Example Co",
  "brand": "ExCo",
  "scale": "Medium",
  "industry_id": 1,
  "category_id": 2,
  "website": "https://example.com",
  "linkedin_url": "https://linkedin.com/company/example",
  "company_type": "client",
  "status": "active",
  "contact": { "phone_primary": "+91 99999 99999", "email_primary": "info@example.com" },
  "address": { "address_line1": "123 Main St", "city": "City", "country": "Country", "pincode": "123456" }
}

## Manual testing checklist ✅
1. Start the server: `npm start` (after creating `.env` and running `database.sql`).
2. Ensure `.env` contains correct DB credentials (PGHOST, PGUSER, PGPASSWORD, PGDATABASE). If the server exits with a message `Postgres connection test FAILED` check your DB username/password and that Postgres is running.
3. Open `http://localhost:3000/company_records.html` → "Create New" → complete the extended form and submit. The company, contact and address (if provided) will be inserted into the DB.
4. Open `http://localhost:3000/add_contact_person.html` → add a contact → verify on `contact_person_records.html`.
5. Verify DB: `SELECT * FROM company; SELECT * FROM company_contact; SELECT * FROM address; SELECT * FROM company_address;`

If you'd like, I can run the smoke tests (create an industry, category, then create a company) — tell me if I should start the server and run them for you.