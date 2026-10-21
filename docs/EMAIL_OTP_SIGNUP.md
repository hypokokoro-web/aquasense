# Email OTP signup

AquaSense preserves email/password accounts and asks Supabase Auth to send a numeric signup confirmation code. Users enter the code in the app; the client calls `verifyOtp({ email, token, type: 'signup' })`. Resend calls `resend({ type: 'signup', email })`. Supabase controls code issuance, expiration, verification, and server-side rate limits. AquaSense does not store or log OTP values.

The input accepts 6–12 numeric digits. Confirm the email OTP length configured in the Supabase project. The resend control uses a 60-second client cooldown in addition to Supabase Auth rate limits.

## Supabase dashboard setup required

Supabase controls the email body; frontend code cannot turn a confirmation link into a numeric code. A polished, paste-ready HTML template is in [`AQUASENSE_SIGNUP_OTP_TEMPLATE.html`](./AQUASENSE_SIGNUP_OTP_TEMPLATE.html). In the Supabase Dashboard:

1. Keep **Confirm email** enabled.
2. Open **Authentication → Email Templates → Confirm signup**.
3. Replace the confirmation-link template with the contents of `AQUASENSE_SIGNUP_OTP_TEMPLATE.html`. It uses `{{ .Token }}` and intentionally has no `{{ .ConfirmationURL }}`. Set the subject to **Your AquaSense verification code**.

4. Save the template and verify the configured code length. The next signup confirmation should contain digits rather than a link. A previously sent confirmation email remains a link and will not become an OTP after changing the template.
5. Keep local and production origins in Auth's allowed redirect URLs. The existing signup call sets `emailRedirectTo` to the current origin for session handling when the signup is verified.
6. Test in staging with a new account: request a code, enter it once, test invalid/expired code handling, and resend after the cooldown. Confirm an unverified user cannot sign in.

New accounts never receive administrator privileges from signup metadata. After OTP verification, AquaSense resolves roles through the trusted `aquasense_admins` allowlist and only enters the regular-user path when that lookup confirms the account is not an administrator. The admin sign-in flow and Google/Facebook OAuth behavior remain separate.

The repository contains no profile table creation or profile trigger and no password reset flow. Signup currently collects email and password only; absence from the admin allowlist is the regular-user role convention.

SMTP delivery and the hosted email template must be verified in Supabase and the SMTP provider. No live project settings are changed by the code.
