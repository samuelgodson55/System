# Inventory Manager — Frontend

Lightweight React inventory management UI. Designed to run locally via Docker (WSL Ubuntu friendly).

## Features (Frontend)

- **Units of measurement** with configurable conversion factors (Piece, Pack, Carton, custom)
- **Receive stock** from Head Office or Vendor
- **Issue / Return stock** — recipient & department on every issue; reusable items can be returned
- **Consumable vs Reusable** item types (returns only for reusable)
- **Events management** + **event stock usage view** with export
- **Inventory list** with search, category/type filter, pagination
- **Item detail** page showing full issuance, receiving & returns history
- **Export** to CSV or PDF with optional **date range margin**
- **Everything editable** (items, units, events)
- **Simple login** (demo users, localStorage session)

> Backend is not included yet — all data is in-memory/mock. State resets on refresh (except auth session).

---

## Quick Start (Docker on WSL Ubuntu)

### Prerequisites

- Docker installed and running in WSL
- Docker Compose (usually bundled with Docker Desktop / docker-compose-plugin)

```bash
# Check Docker is available
docker --version
docker compose version
```

### 1. Build & run

```bash
cd inventory-app

# Build and start (first run will take a minute)
docker compose up --build -d

# View logs if needed
docker compose logs -f
```

### 2. Open the app

Visit: **http://localhost:3000**

### 3. Demo login

| Username | Password  | Role  |
|----------|-----------|-------|
| `admin`  | `admin123`| Admin |
| `staff`  | `staff123`| Staff |

### 4. Stop

```bash
docker compose down
```

---

## Development (without Docker)

```bash
cd inventory-app
npm install
npm run dev
```

App runs at **http://localhost:5173**

---

## Project Structure

```
inventory-app/
├── public/
├── src/
│   ├── components/     # Shared UI (Layout, Modal, Pagination, SearchBar…)
│   ├── context/        # AuthContext + InventoryContext (state)
│   ├── data/           # Mock data
│   ├── pages/          # Route pages
│   ├── types/          # JSDoc type notes
│   ├── utils/          # Export helpers, date formatting
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css       # Tailwind + component classes
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── package.json
├── vite.config.js
├── tailwind.config.js
└── README.md
```

---

## Tech Stack

- **React 18** + **Vite** (fast, lightweight)
- **React Router v6**
- **Tailwind CSS**
- **Lucide React** (icons)
- **date-fns**
- **Nginx** (production container)

No heavy UI libraries — keeps the bundle small and maintainable.

---

## Next Steps (Backend)

When ready we can add:

- Node/Express or FastAPI backend
- SQLite / PostgreSQL persistence
- JWT auth
- Real API calls replacing the context mock layer
