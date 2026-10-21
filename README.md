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

## 3. Connect an existing AquaSense database
This checkout does not contain `supabase/schema.sql` or a base migration for `aquariums` and `sensor_readings`. For a new Supabase project, first restore the project's authoritative base schema and ingestion setup. Do not use the dashboard migrations as a substitute for those base tables; the migrations in this repository extend them.

## 4. Connect the frontend
1. In Supabase Dashboard, open Connect and copy the Project URL and publishable key. Alternatively, find them under Project Settings > API Keys.
2. Create `.env.local` in the project root with the values below.
3. Stop and restart Vite (Ctrl+C, then `npm run dev`).

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

## 6. User and administrator accounts
The sign-in screen supports regular email/password registration and login. Public registration never assigns administrator access. An administrator is an Auth user whose UUID is present in `public.aquasense_admins`; add that UUID only through a trusted Supabase SQL Editor or other restricted operator process. The client retrieves this membership after authentication, and database RLS must be enabled for actual authorization.

Apply the repository migrations only after checking the live database's tables, columns, and policies. The numbered `202610210001` through `202610210005` migrations add app features; ownership migration `202610220001` depends on the existing base tables and `aquasense_admins`. It adds `aquariums.owner_id`, owner fences, and revokes client insert/update/delete access to readings. `202610220002_secure_device_ingestion.sql` adds a private per-device registry for the server-side `ingest-reading` Edge Function. `202610220004_admin_platform_management.sql` adds private admin audit, announcement, settings, and ingestion-diagnostic storage; it depends on the RAG and device migrations and the standard Supabase Auth `banned_until` field. This checkout still contains no ESP32 firmware, so compare the documented request and response contract with the deployed firmware before rollout. Direct ESP32 writes using anon/authenticated credentials stop working; use the trusted ingestion function described in [ESP32 sensor ingestion setup](docs/ESP32_SENSOR_INGESTION.md).

Safe existing-data backfill: before applying the migration, export `aquariums.id`, `name`, and any existing ownership/device mapping from the live database. In Supabase Auth, identify each legitimate owner's Auth UUID, record a reviewed `aquarium_id → owner UUID` mapping, and resolve unassigned or ambiguous rows with the project operator. After the migration, apply only the reviewed mapping in SQL, for example `update public.aquariums set owner_id = '<verified-auth-user-uuid>' where id = <verified-aquarium-id>;`. Do not bulk assign rows to the first account. Keep unverified rows unassigned; they remain visible only to administrators until their owner is confirmed. Verify owner and non-owner reads with separate test accounts before opening registration.

The dashboard reads aquarium rows visible to the authenticated account. A new user with no assigned aquarium sees the no-aquarium state; aquarium creation and ownership assignment are currently an operator/database setup step. Do not run the migration on production until the base schema and any device ingestion policies have been reviewed. Supabase migrations are not applied by the frontend build.

Administrators can open `#/admin`. The console includes Overview, Users, Aquariums, Roles & Access, Audit Logs, System Operations, Content Management, Announcements, Platform Reports, and System Settings. Privileged reads and writes go through the authenticated `aquasense-admin` Edge Function; the browser never receives the service-role key. See [platform administration setup](docs/ADMIN_PLATFORM_MANAGEMENT.md) for the new migration, protected actions, announcement delivery behavior, staging tests, and deployment commands. Do not deploy using a URL as `--project-ref`; use the project reference string.

## 7. Explore assistant setup
The Explore module calls the `aquasense-assistant` Supabase Edge Function. Configure the Gemini API key as a server-side function secret in the Supabase Dashboard under **Project Settings > Edge Functions > Secrets** (or with the Supabase CLI):

```powershell
supabase secrets set GEMINI_API_KEY=your_gemini_api_key
supabase functions deploy aquasense-assistant --project-ref agogwocjfhvcxmvdliom
```

The assistant uses retrieval-augmented generation (RAG) for aquarium questions. Before deploying the updated function, apply `supabase/migrations/202610210004_aquasense_knowledge_rag.sql` in the Supabase SQL Editor (or run `supabase db push`). It creates a curated reference library and a PostgreSQL full-text search function. Relevant passages are added to the Gemini prompt, with cited source links shown beneath supported answers. This first version retrieves curated references by full-text relevance; it does not index uploaded files or private external documents.

The function verifies the signed-in user, then limits regular-user aquarium context to `owner_id`; allowlisted administrators may inspect platform data. Supabase supplies project keys to the function runtime. Keep `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` out of frontend environment variables and browser code.

## Notes
- Temperature and pH reference ranges in the UI are generic placeholders. Correct ranges depend on the species and tank setup; they are not veterinary or water-quality guarantees.
- The demo readings shown before configuration are generated locally and are not real measurements.
- The base setup describes public reads for an early prototype. Apply the ownership migration and verify its policies before using private accounts or production data.

