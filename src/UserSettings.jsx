import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell, BookOpen, CircleHelp, Download, FileText, Fish, KeyRound,
  LoaderCircle, ShieldCheck, Sun, Thermometer, Trash2, UserRound,
} from 'lucide-react';
import { DEFAULT_USER_PREFERENCES, normalizeUserPreferences } from './lib/userPreferences';

const sections = [
  ['Account & Profile', UserRound], ['Notifications', Bell], ['Aquarium Preferences', Fish],
  ['Appearance', Sun], ['Security & Privacy', ShieldCheck], ['Legal & Data', FileText], ['Help & About', CircleHelp],
];

function StatusMessage({ children, error = false }) {
  if (!children) return null;
  return <p className={`settings-feedback ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{children}</p>;
}

function PreferenceToggle({ checked, onChange, label, description, disabled = false }) {
  return <label className={`settings-toggle-row ${disabled ? 'is-disabled' : ''}`}>
    <span><strong>{label}</strong><small>{description}</small></span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
  </label>;
}

async function readAllRows(supabase, table, aquariumId, select = '*') {
  const pageSize = 500;
  const maxRows = 50000;
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(select).eq('aquarium_id', aquariumId).order('created_at', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
  throw new Error(`${table} has more than 50,000 records for this aquarium. Ask the administrator for a larger export.`);
}

export default function UserSettings({
  user, supabase, isSupabaseConfigured, preferences, preferencesLoading, preferencesError,
  onSavePreferences, aquariums, aquariumId, aquariumName, onSelectAquarium,
  settingsForm, setSettingsForm, saveAquariumSettings, settingsSaving, settingsMessage,
  onSignOut, onDeleteAccount, unitLabel, previewTheme,
  notificationPermission, onEnableBrowserNotifications,
}) {
  const recoveryRoute = window.location.hash.includes('recovery=1');
  const [section, setSection] = useState(() => recoveryRoute ? 'Security & Privacy' : 'Account & Profile');
  const [draft, setDraft] = useState(() => normalizeUserPreferences(preferences || DEFAULT_USER_PREFERENCES));
  const [profileName, setProfileName] = useState(user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState('');
  const [preferencesSaveError, setPreferencesSaveError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState('');
  const [accountError, setAccountError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => setDraft(normalizeUserPreferences(preferences)), [preferences]);
  useEffect(() => {
    setProfileName(user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || '');
    setProfileEmail(user?.email || '');
  }, [user?.id, user?.email]);

  const providers = useMemo(() => [...new Set((user?.identities || []).map(identity => identity.provider).filter(Boolean))], [user?.identities]);
  const hasPasswordAccount = providers.includes('email') || user?.app_metadata?.provider === 'email';
  const canSavePreferences = isSupabaseConfigured ? !preferencesLoading && !preferencesError : true;
  const updateDraft = (key, value) => setDraft(current => normalizeUserPreferences({ ...current, [key]: { ...current[key], ...value } }));

  const savePreferences = async () => {
    setPreferencesBusy(true); setPreferencesMessage(''); setPreferencesSaveError('');
    try {
      await onSavePreferences(draft);
      setPreferencesMessage('Preferences saved.');
    } catch (error) {
      setPreferencesSaveError(error?.message || 'Could not save preferences.');
    } finally { setPreferencesBusy(false); }
  };

  const saveProfile = async event => {
    event.preventDefault(); setProfileBusy(true); setProfileMessage(''); setProfileError('');
    const name = profileName.trim();
    if (name.length > 80) { setProfileError('Display name must be 80 characters or fewer.'); setProfileBusy(false); return; }
    try {
      const attributes = { data: { ...(user.user_metadata || {}), display_name: name } };
      const nextEmail = profileEmail.trim();
      if (nextEmail && nextEmail.toLowerCase() !== user.email?.toLowerCase()) attributes.email = nextEmail;
      const { error } = await supabase.auth.updateUser(attributes, { emailRedirectTo: window.location.origin });
      if (error) throw error;
      setProfileMessage(attributes.email ? 'Profile saved. Check your new email address to confirm the change.' : 'Profile saved.');
    } catch (error) { setProfileError(error?.message || 'Could not update the profile.'); }
    finally { setProfileBusy(false); }
  };

  const changePassword = async event => {
    event.preventDefault(); setAccountBusy(true); setAccountMessage(''); setAccountError('');
    if (newPassword.length < 8) { setAccountError('Choose a password with at least 8 characters.'); setAccountBusy(false); return; }
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword(''); setAccountMessage('Password updated.');
    } catch (error) { setAccountError(error?.message || 'Could not update the password.'); }
    finally { setAccountBusy(false); }
  };

  const sendPasswordRecovery = async () => {
    setResetBusy(true); setAccountMessage(''); setAccountError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/#/settings?recovery=1` });
      if (error) throw error;
      setAccountMessage('Password recovery instructions were requested. Check your inbox and spam folder.');
    } catch (error) { setAccountError(error?.message || 'Could not request password recovery.'); }
    finally { setResetBusy(false); }
  };

  const exportData = async () => {
    setExportBusy(true); setExportMessage(''); setExportError('');
    try {
      if (!isSupabaseConfigured) throw new Error('Connect AquaSense to Supabase to export account data.');
      const { data: ownedAquariums, error: aquariumError } = await supabase.from('aquariums').select('*').eq('owner_id', user.id).order('id');
      if (aquariumError) throw aquariumError;
      const aquariumData = [];
      for (const aquarium of ownedAquariums || []) {
        const [readings, settings, alerts, tasks, reports] = await Promise.all([
          readAllRows(supabase, 'sensor_readings', aquarium.id, 'id,aquarium_id,temperature,ph_level,source,device_id,created_at'),
          supabase.from('aquarium_settings').select('*').eq('aquarium_id', aquarium.id).maybeSingle(),
          readAllRows(supabase, 'aquarium_alerts', aquarium.id),
          readAllRows(supabase, 'aquarium_care_tasks', aquarium.id),
          readAllRows(supabase, 'aquarium_health_reports', aquarium.id),
        ]);
        for (const result of [settings]) if (result.error) throw result.error;
        aquariumData.push({ aquarium, settings: settings.data, readings, alerts, care_tasks: tasks, health_reports: reports });
      }
      const payload = {
        exported_at: new Date().toISOString(),
        account: { id: user.id, email: user.email || null, display_name: profileName || null, created_at: user.created_at || null, providers },
        preferences: draft,
        aquariums: aquariumData,
        excluded: ['authentication credentials and tokens', 'administrator audit records', 'device credential hashes', 'data for aquariums not owned by this account'],
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `aquasense-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      setExportMessage('Your JSON export was generated and downloaded.');
    } catch (error) { setExportError(error?.message || 'Could not export account data.'); }
    finally { setExportBusy(false); }
  };

  const deleteAccount = async event => {
    event.preventDefault(); setDeleteBusy(true); setDeleteError(''); setDeleteMessage('');
    try {
      if (deleteConfirmEmail.trim().toLowerCase() !== user.email?.toLowerCase()) throw new Error('Enter the email address for this account to confirm deletion.');
      if (hasPasswordAccount) {
        if (!deletePassword) throw new Error('Enter your current password to verify your identity.');
        const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: deletePassword });
        if (reauthError) throw new Error('The current password could not be verified.');
      }
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirmation_email: deleteConfirmEmail.trim() } });
      if (error) {
        let serverMessage = data?.error;
        try { if (!serverMessage && error.context?.json) serverMessage = (await error.context.json())?.error; } catch {}
        throw new Error(serverMessage || error.message || 'The account deletion request failed.');
      }
      if (!data?.success) throw new Error(data?.error || 'The account could not be deleted.');
      setDeleteMessage('Account deleted. Signing out…');
      await onDeleteAccount();
    } catch (error) { setDeleteError(error?.message || 'The account could not be deleted.'); }
    finally { setDeleteBusy(false); }
  };

  const appearanceSaved = draft.appearance;
  return <section className="user-settings-page">
    <header className="user-settings-heading"><div><h1>Settings</h1></div></header>
    <div className="user-settings-layout">
      <nav className="user-settings-nav" aria-label="Settings sections">
        {sections.map(([name, Icon]) => <button type="button" key={name} className={section === name ? 'selected' : ''} aria-current={section === name ? 'page' : undefined} onClick={() => setSection(name)}><Icon size={16}/><span>{name}</span></button>)}
      </nav>
      <div className="user-settings-content" aria-live="polite">
        {preferencesLoading && <div className="settings-inline-status"><LoaderCircle size={15} className="spin"/> Loading your saved preferences…</div>}
        {preferencesError && <StatusMessage error>{preferencesError}</StatusMessage>}

        {section === 'Account & Profile' && <div className="settings-section-stack">
          <section className="panel settings-card"><div className="settings-card-heading"><UserRound size={18}/><div><h2>Account & Profile</h2><p>Update your display name and account email.</p></div></div>
            <form className="settings-form" onSubmit={saveProfile}>
              <label>Display name<input value={profileName} maxLength={80} onChange={event => setProfileName(event.target.value)} placeholder="Your name"/></label>
              <label>Email address<input type="email" value={profileEmail} onChange={event => setProfileEmail(event.target.value)} required/></label>
              <p className="settings-help">If you change your email, Supabase will require email verification before the new address takes effect.</p>
              <p className="settings-readonly">Account created {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'date unavailable'} · Sign-in: {providers.length ? providers.join(', ') : user.app_metadata?.provider || 'email'}</p>
              <div className="settings-form-actions"><StatusMessage>{profileMessage}</StatusMessage><StatusMessage error>{profileError}</StatusMessage><button className="primary-button" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button></div>
            </form>
          </section>
        </div>}

        {section === 'Notifications' && <div className="settings-section-stack">
          <section className="panel settings-card"><div className="settings-card-heading"><Bell size={18}/><div><h2>Notification preferences</h2><p>These options affect reminders and browser alerts, not sensor monitoring or alert history.</p></div></div>
            <div className="settings-toggle-list">
              <PreferenceToggle checked={draft.notifications.waterQuality} label="Water quality alerts" description="Allow browser notices for newly detected water quality conditions." onChange={value => updateDraft('notifications', { waterQuality: value })}/>
              <PreferenceToggle checked={draft.notifications.temperature} label="Temperature alerts" description="Browser notices for readings outside the aquarium's configured range." onChange={value => updateDraft('notifications', { temperature: value })}/>
              <PreferenceToggle checked={draft.notifications.ph} label="pH alerts" description="Browser notices for readings outside the configured pH range." onChange={value => updateDraft('notifications', { ph: value })}/>
              <PreferenceToggle checked={draft.notifications.maintenance} label="Maintenance reminders" description="Browser reminders for due maintenance tasks while the dashboard is open." onChange={value => updateDraft('notifications', { maintenance: value })}/>
              <PreferenceToggle checked={draft.notifications.feeding} label="Feeding reminders" description="Browser reminders for due feeding tasks while the dashboard is open." onChange={value => updateDraft('notifications', { feeding: value })}/>
              <PreferenceToggle checked={draft.notifications.browser} label="Browser notifications" description="Local browser notifications work only while AquaSense is open; permission is controlled by your browser." onChange={value => updateDraft('notifications', { browser: value })}/>
              {draft.notifications.browser && notificationPermission !== 'granted' && <button type="button" className="text-button settings-permission-button" onClick={onEnableBrowserNotifications}>{notificationPermission === 'denied' ? 'Browser permission is blocked; change it in browser settings' : notificationPermission === 'unsupported' ? 'This browser does not support notifications' : 'Allow browser notifications'}</button>}
            </div>
            <div className="settings-quiet-hours"><label className="settings-checkbox"><input type="checkbox" checked={draft.notifications.quietHoursEnabled} onChange={event => updateDraft('notifications', { quietHoursEnabled: event.target.checked })}/><span>Enable quiet hours</span></label><label>From<input type="time" value={draft.notifications.quietStart} onChange={event => updateDraft('notifications', { quietStart: event.target.value })}/></label><label>Until<input type="time" value={draft.notifications.quietEnd} onChange={event => updateDraft('notifications', { quietEnd: event.target.value })}/></label></div>
            <p className="settings-help">Quiet hours pause optional browser notices on this device. Sensor readings and recorded alerts continue normally. No background push or email delivery is configured.</p>
            <div className="settings-form-actions"><StatusMessage>{preferencesMessage}</StatusMessage><StatusMessage error>{preferencesSaveError}</StatusMessage><button className="primary-button" onClick={() => void savePreferences()} disabled={preferencesBusy || !canSavePreferences}>{preferencesBusy ? 'Saving…' : 'Save notification preferences'}</button></div>
          </section>
        </div>}

        {section === 'Aquarium Preferences' && <div className="settings-section-stack">
          <section className="panel settings-card"><div className="settings-card-heading"><Fish size={18}/><div><h2>Aquarium Preferences</h2><p>Select an aquarium and adjust its existing water alert thresholds and device timeout.</p></div></div>
            {aquariums.length > 0 && <label className="settings-select-label">Default aquarium<select value={aquariumId || ''} onChange={event => onSelectAquarium(event.target.value)}>{aquariums.map(aquarium => <option key={aquarium.id} value={aquarium.id}>{aquarium.name || `Aquarium ${aquarium.id}`}</option>)}</select><small>This also selects which aquarium's existing alert thresholds are shown below.</small></label>}
            {!aquariums.length ? <div className="module-empty">No aquarium is assigned to this account. Ask an administrator to assign aquarium ownership before changing aquarium preferences.</div> : <><p className="settings-current-aquarium">Editing: <strong>{aquariumName}</strong></p>
              <form className="device-settings-form settings-aquarium-form" onSubmit={saveAquariumSettings}>
                <div className="settings-field-group"><div className="settings-group-heading"><Thermometer size={16}/><strong>Temperature alert range</strong><span>°C</span></div><label>Minimum temperature<input name="temp_min" type="number" min="-5" max="60" step="0.1" required value={settingsForm.temp_min} onChange={event => setSettingsForm(form => ({ ...form, temp_min: event.target.value }))}/></label><label>Maximum temperature<input name="temp_max" type="number" min="-5" max="60" step="0.1" required value={settingsForm.temp_max} onChange={event => setSettingsForm(form => ({ ...form, temp_max: event.target.value }))}/></label></div>
                <div className="settings-field-group"><div className="settings-group-heading"><Thermometer size={16}/><strong>pH alert range</strong><span>pH</span></div><label>Minimum pH<input name="ph_min" type="number" min="0" max="14" step="0.1" required value={settingsForm.ph_min} onChange={event => setSettingsForm(form => ({ ...form, ph_min: event.target.value }))}/></label><label>Maximum pH<input name="ph_max" type="number" min="0" max="14" step="0.1" required value={settingsForm.ph_max} onChange={event => setSettingsForm(form => ({ ...form, ph_max: event.target.value }))}/></label></div>
                <div className="settings-field-group settings-timeout-group"><div className="settings-group-heading"><Bell size={16}/><strong>Device timeout</strong><span>seconds</span></div><label>Mark device offline after<input name="device_timeout_seconds" type="number" min="30" step="1" required value={settingsForm.device_timeout_seconds ?? 300} onChange={event => setSettingsForm(form => ({ ...form, device_timeout_seconds: event.target.value }))}/></label><p>Minimum 30 seconds. Used to detect a missed ESP32 heartbeat.</p></div>
                <div className="settings-form-footer"><StatusMessage>{settingsMessage}</StatusMessage><button className="primary-button settings-save-button" disabled={settingsSaving || !aquariumId}>{settingsSaving ? 'Saving…' : 'Save aquarium preferences'}</button></div>
              </form>
              <p className="settings-help">Thresholds are stored in Celsius and compared to the sensor's original Celsius readings, regardless of display unit. Feeding and maintenance schedules are managed in Care Planner.</p>
            </>}
          </section>
        </div>}

        {section === 'Appearance' && <div className="settings-section-stack">
          <section className="panel settings-card"><div className="settings-card-heading"><Sun size={18}/><div><h2>Appearance & Preferences</h2><p>Choose how AquaSense displays the dashboard on this account.</p></div></div>
            <div className="settings-form">
              <label>Theme<select value={appearanceSaved.theme} onChange={event => { updateDraft('appearance', { theme: event.target.value }); previewTheme(event.target.value); }}><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select><small>Theme previews immediately and is saved with your preferences.</small></label>
              <label>Temperature unit<select value={appearanceSaved.temperatureUnit} onChange={event => updateDraft('appearance', { temperatureUnit: event.target.value })}><option value="C">Celsius (°C)</option><option value="F">Fahrenheit (°F)</option></select><small>Raw sensor values and threshold comparisons remain in Celsius.</small></label>
              <label>Time display<select value={appearanceSaved.timeFormat} onChange={event => updateDraft('appearance', { timeFormat: event.target.value })}><option value="12h">12-hour clock</option><option value="24h">24-hour clock</option></select></label>
              <label>Date display<select value={appearanceSaved.dateFormat} onChange={event => updateDraft('appearance', { dateFormat: event.target.value })}><option value="locale">Local format</option><option value="iso">Year-month-day</option></select></label>
              <p className="settings-help">Date and time use your browser's local timezone. Temperature display is {unitLabel}.</p>
              <div className="settings-form-actions"><StatusMessage>{preferencesMessage}</StatusMessage><StatusMessage error>{preferencesSaveError}</StatusMessage><button className="primary-button" onClick={() => void savePreferences()} disabled={preferencesBusy || !canSavePreferences}>{preferencesBusy ? 'Saving…' : 'Save appearance'}</button></div>
            </div>
          </section>
        </div>}

        {section === 'Security & Privacy' && <div className="settings-section-stack">
          <section className="panel settings-card"><div className="settings-card-heading"><KeyRound size={18}/><div><h2>Security & Privacy</h2><p>Authentication methods and device session controls.</p></div></div>
            <p className="settings-readonly">Signed-in email: <strong>{user.email || 'Unavailable'}</strong><br/>Methods linked to this account: <strong>{providers.join(', ') || user.app_metadata?.provider || 'email'}</strong></p>
            {hasPasswordAccount ? <form className="settings-form" onSubmit={changePassword}><label>{recoveryRoute ? 'New password' : 'New password'}<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={event => setNewPassword(event.target.value)} required/></label><div className="settings-form-actions"><StatusMessage>{accountMessage}</StatusMessage><StatusMessage error>{accountError}</StatusMessage><button className="primary-button" disabled={accountBusy}>{accountBusy ? 'Updating…' : recoveryRoute ? 'Set new password' : 'Change password'}</button></div><button type="button" className="text-button" onClick={() => void sendPasswordRecovery()} disabled={resetBusy}>{resetBusy ? 'Requesting…' : 'Send password recovery email'}</button></form> : <p className="settings-help">This account signs in with {providers.join(' or ') || 'a social provider'}. Change its password with that provider; AquaSense cannot change your provider password. Linked sign-in methods cannot currently be added or removed in AquaSense.</p>}
            <div className="settings-security-actions"><div><strong>Current device</strong><small>Sign out of this browser. AquaSense does not currently offer individual session revocation.</small></div><button className="secondary-button" onClick={onSignOut}>Sign out</button></div>
          </section>
          <section className="panel settings-card settings-danger-card"><div className="settings-card-heading"><Trash2 size={18}/><div><h2>Delete My Account</h2><p>Request removal of your account and its aquarium data.</p></div></div>
            <p className="settings-danger-copy">This permanently deletes your owned aquariums, sensor readings, aquarium settings, alerts, care tasks, reports, and account preferences, then removes your AquaSense Auth account. It cannot be undone. Administrator accounts cannot use self-service deletion. Requests can fail if the database has other dependent records; no success will be reported unless account deletion completes.</p>
            {!deleteOpen ? <button className="danger-button" onClick={() => { setDeleteOpen(true); setDeleteError(''); }}>Delete My Account</button> : <form className="settings-form settings-delete-form" onSubmit={deleteAccount}>
              <label>Type your sign-in email to confirm<input type="email" autoComplete="email" value={deleteConfirmEmail} onChange={event => setDeleteConfirmEmail(event.target.value)} required/></label>
              {hasPasswordAccount && <label>Current password for identity verification<input type="password" autoComplete="current-password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} required/></label>}
              {!hasPasswordAccount && <p className="settings-help">For security, your session must have been created by Google/Facebook sign-in within the last 15 minutes. If it is older, sign out, sign in again, then return here.</p>}
              <p className="settings-danger-copy">Deleting an aquarium removes its sensor history and associated app records. Third-party provider accounts are not deleted. Data held in provider backups may persist for their retention period.</p>
              <StatusMessage error>{deleteError}</StatusMessage><StatusMessage>{deleteMessage}</StatusMessage>
              <div className="settings-form-actions"><button type="button" className="secondary-button" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>Cancel</button><button className="danger-button" disabled={deleteBusy}>{deleteBusy ? 'Deleting account…' : 'Permanently delete my account'}</button></div>
            </form>}
          </section>
        </div>}

        {section === 'Legal & Data' && <div className="settings-section-stack">
          <section className="panel settings-card"><div className="settings-card-heading"><FileText size={18}/><div><h2>Legal & Data</h2><p>Review AquaSense terms, privacy information, and data choices.</p></div></div>
            <div className="settings-link-list"><a href="/terms.html" target="_blank" rel="noreferrer"><FileText size={17}/><span><strong>Terms of Service</strong><small>Rules and limitations for using AquaSense.</small></span></a><a href="/privacy.html" target="_blank" rel="noreferrer"><ShieldCheck size={17}/><span><strong>Privacy Policy</strong><small>Information handled by AquaSense and why.</small></span></a><a href="/data-deletion.html" target="_blank" rel="noreferrer"><Trash2 size={17}/><span><strong>User Data Deletion</strong><small>How to delete this account and its aquarium data.</small></span></a></div>
          </section>
          <section className="panel settings-card"><div className="settings-card-heading"><Download size={18}/><div><h2>Export your data</h2><p>Download records visible to this account as a JSON file.</p></div></div><p className="settings-help">Includes profile identifiers, saved preferences, owned aquariums, sensor readings, aquarium settings, alerts, care tasks, and health reports. Authentication secrets and records for other users are excluded.</p><button className="secondary-button" onClick={() => void exportData()} disabled={exportBusy || !isSupabaseConfigured}>{exportBusy ? 'Preparing export…' : 'Download my data'}</button><StatusMessage>{exportMessage}</StatusMessage><StatusMessage error>{exportError}</StatusMessage></section>
        </div>}

        {section === 'Help & About' && <div className="settings-section-stack">
          <section className="panel settings-card"><div className="settings-card-heading"><BookOpen size={18}/><div><h2>Help & About</h2><p>AquaSense aquarium monitoring.</p></div></div><p className="settings-help">For account access or aquarium ownership help, contact the administrator who manages your AquaSense account. No public support email or separate help center is configured.</p><p className="settings-readonly">Version {import.meta.env.VITE_APP_VERSION || '1.0.0'}</p><div className="settings-link-list"><a href="/terms.html" target="_blank" rel="noreferrer"><FileText size={17}/><span><strong>Terms of Service</strong></span></a><a href="/privacy.html" target="_blank" rel="noreferrer"><ShieldCheck size={17}/><span><strong>Privacy Policy</strong></span></a><a href="/data-deletion.html" target="_blank" rel="noreferrer"><Trash2 size={17}/><span><strong>Data deletion instructions</strong></span></a></div></section>
        </div>}
      </div>
    </div>
    {deleteOpen && <span className="sr-only" aria-live="polite">{deleteMessage}</span>}
  </section>;
}
