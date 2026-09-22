# Homestay Server

Backend foundation for the homestay booking project.

## Requirements

- Node.js 20+ recommended
- npm
- A Supabase project

## Setup

1. Copy `.env.example` to `.env`
2. Fill in:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Install dependencies:

```bash
npm install
```

4. Start development server:

```bash
npm run dev
```

5. Test:

```text
http://localhost:3000/health
```

Expected:

```json
{
  "success": true,
  "service": "homestay-server",
  "timestamp": "..."
}
```

## Important

Never commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.

# homstay-server