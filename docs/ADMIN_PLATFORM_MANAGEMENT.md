# AquaSense platform administration

The admin console uses the existing `aquasense-admin` Edge Function for privileged reads and writes. The browser sends the user's access token and the public publishable key; the function validates the Auth user, checks `aquasense_admins`, and requires a password authentication method for administrator operations. The service-role key remains in Supabase's Edge Function environment.

## What the pages manage

- **Roles & Access:** account email/name, allowlist role, Supabase Auth ban status, joined date, and last sign-in. Role promotion/removal and suspension/reactivation require confirmation. The function blocks self-suspension, self-demotion, and removal of the final active administrator. Admin accounts must first be demoted before suspension.
- **Audit Logs:** server-written events for role changes, account suspension/reactivation, content changes, announcements, and platform settings. Browser roles cannot read or modify the table. Metadata contains operation identifiers/status only; passwords, tokens, device credentials, and message bodies are not recorded.
- **System Operations:** registered device state, last request, last accepted reading, and recent ingestion outcomes. Rejected requests are recorded only after a registered device key is verified. Invalid credential traffic is not persisted. History starts when the migration and updated `ingest-reading` function are deployed; old failures cannot be reconstructed.
- **Content Management:** edits the existing `aquasense_knowledge_chunks` library used by the Explore assistant's retrieval flow. Publishing changes affect future retrievals. The separate Fish Encyclopedia in the user dashboard remains a static `FISH_GUIDE` array in `src/App.jsx`; it is not represented as editable CMS content.
- **Announcements:** drafts, publication status, optional publication/expiration times, preview, and archive. Signed-in users receive only published announcements inside their active time window. The user dashboard refreshes them every five minutes. No email or push delivery is performed.
- **Platform Reports:** real current counts from Supabase Auth, aquariums, device registry, knowledge content, and audit rows, plus new registrations in the previous 30 days. The registration metric supports 7, 30, 90, or 365-day windows. The page does not claim daily active users because the project does not collect reliable activity telemetry. CSV export includes these report metrics.
- **System Settings:** the default category for new announcements and the timezone used to render dates in the admin console.

## Migration and deployment

`202610220004_admin_platform_management.sql` depends on the preceding ownership/password-auth migrations, `aquasense_knowledge_chunks` from the RAG migration, `aquasense_devices` from the ingestion migration, and the existing Supabase Auth schema. It references `auth.users.banned_until` to make suspended accounts' still-valid JWTs fail the protected RLS helpers. It recreates the `aquasense_admins` policies with a restrictive self-row fence, so it does not depend on policy names from an earlier deployment. The migration is additive and does not touch aquarium ownership mappings or reading rows.

Apply and deploy in staging first:

1. Back up the database and inspect the actual schema, grants, and policies. Confirm `aquasense_admins.user_id` is unique because the existing admin function uses `upsert(... onConflict: 'user_id')`.
2. Apply migrations through `202610220004_admin_platform_management.sql` only after all prerequisite migrations and tables are confirmed. Do not apply this file alone to a project missing those prerequisites.
3. Deploy the updated functions:

   ```powershell
   npx supabase functions deploy aquasense-admin --project-ref <project-ref>
   npx supabase functions deploy ingest-reading --project-ref <project-ref>
   ```

4. Keep `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the ingestion pepper, and device credentials in their existing server-side secret stores. The admin UI does not create or display device keys.
5. Test in staging with one password-authenticated administrator and two regular accounts: verify admin-only actions, final-admin guards, suspended-account data denial, published versus draft content, announcement schedule/expiry behavior, and audit event creation. Verify the updated ingestion function stores accepted and authenticated rejected events without storing credentials or payloads.
6. Verify regular users cannot select the private tables directly and can only read active announcements through the authenticated function. Test OAuth regular-user sign-in and the separate admin password login after deployment.

No migration has been applied and no Edge Function has been deployed from this checkout. Local tests/build cannot confirm live schema, SMTP/Auth state, RLS behavior, or function secrets.
