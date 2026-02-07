# Dashboard Frontend

React + TypeScript + Vite + Shadcn/UI dashboard for monitoring employee ADMS registration status.

## Features

- **Employee Status Overview**: See which employees are registered in ADMS system
- **Real-time Data**: Fetches from Frappe HR and compares with Supabase attendance logs
- **Filtering**: View all, registered only, or not-registered only
- **Statistics**: Total employees, registered count, not-registered count
- **Last Scan Tracking**: Shows when each employee last scanned

## Setup

1. Install dependencies:
```bash
bun install
```

2. Configure environment variables in `.env`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_FRAPPE_URL=your_frappe_url (optional)
VITE_FRAPPE_API_KEY=your_api_key (optional)
```

3. Run development server:
```bash
bun run dev
```

4. Build for production:
```bash
bun run build
```

## Frappe HR Integration

Currently using mock data in `src/lib/frappe.ts`. To integrate with real Frappe HR:

1. Update the `fetchFrappeEmployees()` function with your Frappe API endpoint
2. Add authentication headers with your API key/secret
3. Map the response to the `FrappeEmployee` interface

Example:
```typescript
export async function fetchFrappeEmployees(): Promise<FrappeEmployee[]> {
  const response = await fetch(`${FRAPPE_URL}/api/resource/Employee`, {
    headers: {
      'Authorization': `token ${API_KEY}:${API_SECRET}`
    }
  })
  const data = await response.json()
  return data.data // Adjust based on your API response structure
}
```

## How It Works

1. Fetches all employees from Frappe HR
2. Fetches all attendance logs from Supabase
3. Compares employee IDs with attendance log user_ids
4. Shows registration status, last scan time, and total scans for each employee

## Deployment

Can be deployed to:
- Cloudflare Pages (free)
- Vercel (free)
- Netlify (free)
- Any static hosting service

Build command: `bun run build`
Output directory: `dist`

import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
