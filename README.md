# AquaSense

A React + Vite aquarium monitoring dashboard with a Supabase PostgreSQL backend.

## Requirements
- Node.js 20.19+ or 22.12+
- VS Code
- A Supabase account

## 1. Install dependencies
Open a terminal in this project folder and run:

```powershell
npm install
```

## 2. Start the frontend in demo mode
```powershell
npm run dev
```
Open the local URL Vite prints, usually http://localhost:5173. Demo mode uses simulated sample data and does not send it to Supabase.

## 3. Create the Supabase database
1. Create a Supabase project at https://supabase.com/dashboard.
2. Open SQL Editor > New query.
3. Paste and run all contents of `supabase/schema.sql`.
4. The SQL creates `aquariums` and `sensor_readings`, read-only public policies, one aquarium, and five clearly labelled manual test readings.

## 4. Connect the frontend
1. In Supabase Dashboard, open Connect and copy the Project URL and publishable key. Alternatively, find them under Project Settings > API Keys.
2. Copy `.env.example` to a new file named `.env.local` in the project root.
3. Replace the placeholder values in `.env.local`.
4. Stop and restart Vite (Ctrl+C, then `npm run dev`).

Example:
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Only put a publishable key in the frontend. Never put a `sb_secret_...` or legacy `service_role` key in `.env.local` or browser code.

## FadeHost Free plan
The Free plan's memory limit can be too low for Vite to build this dashboard on the host. Build it locally with `npm run build`, then commit the generated `dist/` folder along with your source changes. In FadeHost, set the Build command to `true` and the Start command to `npm start`; the app serves the committed static build without running Vite on the 256 MB host. Rebuild `dist/` locally whenever frontend code or the Supabase frontend settings change.

## 5. Verify
- Dashboard should show `Supabase mode`.
- Temperature and pH should load from `sensor_readings`.
- New inserts should appear through Supabase Realtime if Realtime is enabled for the table.
- The dashboard is read-only. It does not insert sensor readings from the browser.

## 6. Administrator sign-in
The dashboard requires a Supabase Auth email and password account. Create the account in Supabase Authentication, then add its Auth user UUID to `public.aquasense_admins`. The browser checks this table to allow administrator access. Keep Row Level Security enabled and add policies that authorize dashboard data access for administrators; the UI check alone does not secure database rows.

If Supabase is not configured, the sign-in page explains which environment variables are needed. Demo readings are not shown as an authenticated admin dashboard.

## 7. Explore assistant setup
The Explore module calls the `aquasense-assistant` Supabase Edge Function. Configure the Gemini API key as a server-side function secret in the Supabase Dashboard under **Project Settings > Edge Functions > Secrets** (or with the Supabase CLI):

```powershell
supabase secrets set GEMINI_API_KEY=your_gemini_api_key
supabase functions deploy aquasense-assistant --project-ref agogwocjfhvcxmvdliom
```

The function checks the signed-in user's membership in `aquasense_admins` before calling Gemini. Supabase supplies its project URL and keys to the function runtime. Keep `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` out of frontend environment variables and browser code.

## Notes
- Temperature and pH reference ranges in the UI are generic placeholders. Correct ranges depend on the species and tank setup; they are not veterinary or water-quality guarantees.
- The demo readings shown before configuration are generated locally and are not real measurements.
- Public read access is appropriate only for a prototype with non-sensitive readings. For a private deployment, add Supabase Auth and owner-specific RLS policies before exposing data.

