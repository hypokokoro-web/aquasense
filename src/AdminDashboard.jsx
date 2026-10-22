import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, BookOpen, Check, Cpu,
  FileText, Fish, LayoutDashboard, LogOut, Menu, RefreshCw, Save, Search,
  Settings, Shield, Users, Sun, Moon, Wifi,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { callAquaSenseAdmin } from './lib/adminApi';

const pages = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Users', icon: Users },
  { name: 'Aquariums', icon: Fish },
  { name: 'Roles & Access', icon: Shield },
  { name: 'Audit Logs', icon: FileText },
  { name: 'System Operations', icon: Activity },
  { name: 'Content Management', icon: BookOpen },
  { name: 'Announcements', icon: Bell },
  { name: 'System Settings', icon: Settings },
];

const pageRoutes = Object.fromEntries(pages.map(({ name }) => [name, name === 'Overview' ? '' : name.toLowerCase().replaceAll(' ', '-') .replace('&', 'and')]));
const routePages = Object.fromEntries(Object.entries(pageRoutes).map(([name, route]) => [route, name]));
function pageFromLocation() {
  const path = window.location.pathname.startsWith('/admin/') ? window.location.pathname.split('/')[2] : '';
  const hash = window.location.hash.match(/^#\/admin\/?([^/]*)/)?.[1] || '';
  return routePages[hash || path] || 'Overview';
}

const descriptions = {
  Overview: 'A quick look at your platform.',
  Users: 'Review account status and administrator access.',
  Aquariums: 'Review aquarium records and ownership assignments.',
  'Roles & Access': 'Review account verification, manage suspensions, and revoke account sessions.',
  'Audit Logs': 'Review recorded privileged changes.',
  'System Operations': 'Inspect registered device activity and recorded ingestion outcomes.',
  'Content Management': 'Maintain the published reference library used by AquaSense Explore.',
  Announcements: 'Prepare platform notices and publish them to regular user dashboards.',
  'System Settings': 'Set the announcement default and administrative display timezone.',
};
const emptyContent = { id: null, title: '', content: '', source_title: '', source_url: '', category: 'learning', is_published: false };
const emptyAnnouncement = { id: null, title: '', message: '', category: 'general', status: 'draft', publish_at: '', expires_at: '' };
const defaultSettings = {
  default_announcement_category: 'general', platform_timezone: 'UTC',
  announcement_visibility_days: 7,
  device_offline_timeout_seconds: 300,
  maintenance_mode_enabled: false,
  maintenance_mode_message: 'AquaSense is undergoing scheduled maintenance. Some features may be temporarily unavailable.',
  esp32_minimum_interval_ms: 1000,
  esp32_temperature_min: 0, esp32_temperature_max: 50,
  esp32_ph_min: 0, esp32_ph_max: 14,
};
const adminSettingsSections = [
  { id: 'general', label: 'General preferences', icon: Settings },
  { id: 'announcements', label: 'Announcement visibility', icon: Bell },
  { id: 'devices', label: 'Device monitoring', icon: Wifi },
  { id: 'maintenance', label: 'Maintenance mode', icon: AlertTriangle },
  { id: 'esp32', label: 'ESP32 defaults', icon: Cpu },
];

async function requestRows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export default function AdminDashboard({ user, onSignOut }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth > 820);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('aquasense-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const [page, setPage] = useState(pageFromLocation);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [aquariums, setAquariums] = useState([]);
  const [newAquariumName, setNewAquariumName] = useState('');
  const [showAquariumDialog, setShowAquariumDialog] = useState(false);
  const [counts, setCounts] = useState({ aquariums: 0, unassigned: 0 });
  const [userRows, setUserRows] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [auditRows, setAuditRows] = useState([]);
  const [operationData, setOperationData] = useState({ devices: [], events: [], offline_timeout_seconds: 300 });
  const [contentRows, setContentRows] = useState([]);
  const [announcementRows, setAnnouncementRows] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [adminSettingsSection, setAdminSettingsSection] = useState('general');
  const [contentForm, setContentForm] = useState(emptyContent);
  const [announcementForm, setAnnouncementForm] = useState(emptyAnnouncement);
  const [busyAction, setBusyAction] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditEntityFilter, setAuditEntityFilter] = useState('');
  const [auditActorFilter, setAuditActorFilter] = useState('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [contentCategoryFilter, setContentCategoryFilter] = useState('all');
  const [contentStatusFilter, setContentStatusFilter] = useState('all');
  const [announcementStatusFilter, setAnnouncementStatusFilter] = useState('all');
  const [operationFilter, setOperationFilter] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [previewContent, setPreviewContent] = useState(false);
  const [previewAnnouncement, setPreviewAnnouncement] = useState(false);

  useEffect(() => {
    if (!showSignOutConfirm) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') setShowSignOutConfirm(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showSignOutConfirm]);

  useEffect(() => {
    const syncSidebarForViewport = () => setSidebarCollapsed(window.innerWidth > 820);
    window.addEventListener('resize', syncSidebarForViewport);
    return () => window.removeEventListener('resize', syncSidebarForViewport);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError(''); setSuccess('');
    try {
      if (page === 'Overview' || page === 'Aquariums') {
        const [rows, total, unassigned] = await Promise.all([
          requestRows(supabase.from('aquariums').select('id,name,owner_id,created_at').order('created_at', { ascending: false }).limit(100)),
          supabase.from('aquariums').select('id', { count: 'exact', head: true }),
          supabase.from('aquariums').select('id', { count: 'exact', head: true }).is('owner_id', null),
        ]);
        if (total.error || unassigned.error) throw total.error || unassigned.error;
        setAquariums(rows); setCounts({ aquariums: total.count || 0, unassigned: unassigned.count || 0 });
      } else if (page === 'Users' || page === 'Roles & Access') {
        const result = await callAquaSenseAdmin('list_users', { page: tablePage, search, role_filter: roleFilter, status_filter: statusFilter }); setUserRows(result.users || []); setUserTotal(result.total || 0);
      } else if (page === 'Audit Logs') {
        const result = await callAquaSenseAdmin('list_audit_logs', { limit: 100, action_filter: auditActionFilter, entity_type: auditEntityFilter, actor_id: auditActorFilter || null, from: auditFrom || null, to: auditTo ? new Date(`${auditTo}T23:59:59`).toISOString() : null });
        setAuditRows(result.logs || []);
      } else if (page === 'System Operations') {
        const result = await callAquaSenseAdmin('list_operations'); setOperationData({ devices: result.devices || [], events: result.events || [], offline_timeout_seconds: result.offline_timeout_seconds || 300 });
      } else if (page === 'Content Management') {
        const result = await callAquaSenseAdmin('list_content'); setContentRows(result.content || []);
      } else if (page === 'Announcements') {
        const result = await callAquaSenseAdmin('list_admin_announcements'); setAnnouncementRows(result.announcements || []);
        const saved = await callAquaSenseAdmin('get_platform_settings'); setSettings({ ...defaultSettings, ...saved.settings });
      } else if (page === 'System Settings') {
        const result = await callAquaSenseAdmin('get_platform_settings'); setSettings({ ...defaultSettings, ...result.settings });
      }
    } catch (loadError) {
      setError(loadError?.message || `Could not load ${page.toLowerCase()}.`);
    } finally { setLoading(false); }
  }, [page, auditActionFilter, auditEntityFilter, auditActorFilter, auditFrom, auditTo, tablePage, search, roleFilter, statusFilter]);

  useEffect(() => {
    const syncRoute = () => setPage(pageFromLocation());
    window.addEventListener('popstate', syncRoute); window.addEventListener('hashchange', syncRoute);
    return () => { window.removeEventListener('popstate', syncRoute); window.removeEventListener('hashchange', syncRoute); };
  }, []);
  useEffect(() => { setTablePage(1); }, [page, search, statusFilter, roleFilter, contentCategoryFilter, contentStatusFilter, announcementStatusFilter, auditActionFilter, auditEntityFilter, auditActorFilter, auditFrom, auditTo, operationFilter]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let active = true;
    void callAquaSenseAdmin('get_platform_settings').then(result => {
      if (active) setSettings({ ...defaultSettings, ...result.settings });
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const navigateAdmin = name => {
    setPage(name); setMobileNavOpen(false); setSearch(''); setError(''); setSuccess('');
    const route = pageRoutes[name]; window.history.pushState({}, '', route ? `#/admin/${route}` : '#/admin');
  };

  const toggleTheme = () => setTheme(current => {
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('aquasense-theme', next); } catch {}
    return next;
  });

  const perform = async (action, fields, message, reload = true) => {
    setBusyAction(true); setError(''); setSuccess('');
    try { await callAquaSenseAdmin(action, fields); if (reload) await refresh(); setSuccess(message); return true; }
    catch (operationError) { setError(operationError?.message || 'The requested operation failed.'); return false; }
    finally { setBusyAction(false); }
  };

  const filteredUsers = userRows;
  const filteredContent = useMemo(() => contentRows.filter(row =>
    `${row.title} ${row.content} ${row.source_title}`.toLowerCase().includes(search.toLowerCase()) &&
    (contentCategoryFilter === 'all' || row.category === contentCategoryFilter) &&
    (contentStatusFilter === 'all' || (contentStatusFilter === 'archived' ? row.is_archived : contentStatusFilter === 'published' ? row.is_published && !row.is_archived : !row.is_published && !row.is_archived))
  ), [contentRows, search, contentCategoryFilter, contentStatusFilter]);
  const filteredAnnouncements = useMemo(() => announcementRows.filter(row =>
    `${row.title} ${row.message}`.toLowerCase().includes(search.toLowerCase()) && (announcementStatusFilter === 'all' || row.status === announcementStatusFilter)
  ), [announcementRows, search, announcementStatusFilter]);
  const filteredOperations = useMemo(() => operationData.events.filter(event => `${event.device_id || ''} ${event.aquarium_id || ''} ${event.event_code} ${event.outcome}`.toLowerCase().includes(operationFilter.toLowerCase())), [operationData.events, operationFilter]);
  const visibleRows = rows => rows.slice((tablePage - 1) * 25, tablePage * 25);
  const activeListLength = page === 'Users' || page === 'Roles & Access' ? userTotal
    : page === 'Content Management' ? filteredContent.length
    : page === 'Announcements' ? filteredAnnouncements.length
    : page === 'Audit Logs' ? auditRows.length
    : page === 'System Operations' ? filteredOperations.length
    : page === 'Aquariums' ? aquariums.length : 0;
  const activePageCount = Math.max(1, Math.ceil(activeListLength / 25));

  const changeSuspension = account => {
    const suspended = !(account.banned_until && Date.parse(account.banned_until) > Date.now());
    const verb = suspended ? 'Suspend' : 'Reactivate';
    if (!window.confirm(`${verb} ${account.email || account.id}? ${suspended ? 'They will be unable to sign in or continue using protected aquarium data.' : 'They will be able to sign in again.'}`)) return;
    void perform('set_user_suspended', { user_id: account.id, suspended }, `Account ${suspended ? 'suspended' : 'reactivated'}.`);
  };
  const revokeSessions = account => {
    if (!window.confirm(`Revoke active sessions for ${account.email || account.id}? They will need to sign in again. Existing access tokens may remain valid until they expire.`)) return;
    void perform('revoke_user_sessions', { user_id: account.id }, 'Account sessions revoked.');
  };
  const editContent = row => setContentForm({ ...row, is_published: row.is_published && !row.is_archived });
  const saveContent = event => {
    event.preventDefault();
    void perform('save_content', contentForm, 'Explore reference content saved.').then(saved => { if (saved) setContentForm(emptyContent); });
  };
  const saveAquarium = event => {
    event.preventDefault();
    void perform('create_aquarium', { name: newAquariumName.trim() }, 'Aquarium created.').then(saved => {
      if (saved) { setNewAquariumName(''); setShowAquariumDialog(false); }
    });
  };
  const editAnnouncement = row => setAnnouncementForm({ ...row, publish_at: toLocalInput(row.publish_at), expires_at: toLocalInput(row.expires_at) });
  const saveAnnouncement = event => {
    event.preventDefault();
    const fields = { ...announcementForm, publish_at: localToIso(announcementForm.publish_at), expires_at: localToIso(announcementForm.expires_at) };
    void perform('save_announcement', fields, 'Announcement saved.').then(saved => { if (saved) { setAnnouncementForm(emptyAnnouncement); setPreviewAnnouncement(false); } });
  };
  return (
    <div className={`app-shell admin-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-theme={theme}>
      {mobileNavOpen && <button className="sidebar-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <aside className={`sidebar admin-sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand"><div className="brand-mark"><img src="/images/aquasense-logo.png" alt="" /></div><div><div className="brand-name">AquaSense</div><div className="brand-caption">ADMIN</div></div></div>
          <div className="nav-label">PLATFORM</div>
          <nav className="side-nav" aria-label="Admin pages">{pages.map(({ name, icon: Icon }) => <button className={`nav-item ${page === name ? 'active' : ''}`} key={name} title={name} aria-label={name} aria-current={page === name ? 'page' : undefined} onClick={() => navigateAdmin(name)}><Icon size={17}/><span>{name}</span></button>)}</nav>
        </div>
        <div className="sidebar-bottom"><div className="profile-row"><div className="profile-avatar">{(user.email || 'A').slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.user_metadata?.full_name || user.email}</strong><span>Administrator</span></div><button className="signout-button" onClick={() => setShowSignOutConfirm(true)} aria-label="Sign out" title="Sign out"><LogOut size={16}/></button></div></div>
      </aside>

      <main className="main-content admin-main">
        <header className="topbar admin-topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={18}/></button><strong>Admin</strong><span className="admin-breadcrumb-divider">/</span><span>{page}</span></div><div className="topbar-actions"><button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}</button><button className="icon-button" onClick={() => void refresh()} aria-label="Refresh current page" title="Refresh"><RefreshCw size={16}/></button></div></header>
        <div className={`page-content admin-content ${page === 'System Settings' ? 'admin-content-settings' : ''}`}>
          <section className="admin-page-heading"><div><p className="admin-eyebrow">AQUASENSE ADMIN</p><h1>{page === 'System Settings' ? 'Settings' : page}</h1><p>{descriptions[page]}</p></div></section>
          {error && <div className="notice connection-error" role="alert"><AlertTriangle size={17}/><div><strong>Could not complete request</strong><span>{error}</span></div><button className="secondary-button" onClick={() => void refresh()}>Retry</button></div>}
          {success && <div className="notice admin-success" role="status"><Check size={17}/><div>{success}</div></div>}

          {loading ? <div className="module-empty">Loading {page.toLowerCase()}…</div> : <>
            {page === 'Overview' && <>
              <div className="admin-stat-grid">{[['Aquariums', counts.aquariums], ['Unassigned aquariums', counts.unassigned]].map(([label, value]) => <Stat key={label} label={label} value={value}/>)}</div>
              <AdminTable title="Recently added aquariums" columns={['Name', 'ID', 'Owner', 'Created']} rows={aquariums.slice(0, 8).map(row => [row.name || 'Unnamed aquarium', row.id, row.owner_id ? 'Assigned' : 'Unassigned', formatDate(row.created_at, settings.platform_timezone)])}/>
              <p className="admin-help-text">The overview reports registered records. Device readings and user activity are available in the user dashboard and audit history respectively.</p>
            </>}

            {(page === 'Users' || page === 'Roles & Access') && <section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>{page === 'Users' ? 'User directory' : 'Account access'}</h2><p>{page === 'Users' ? 'Review registered accounts and their current status.' : 'Review account verification, suspension state, and recent sign-in.'}</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={loading}>Refresh</button></div>
              <div className="admin-filter-row"><label className="admin-search"><Search size={15}/><input aria-label="Search accounts" placeholder="Search email, name, or account ID" value={search} onChange={event => setSearch(event.target.value)}/></label><label>Role<select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="all">All roles</option><option value="user">User</option><option value="admin">Administrator</option></select></label><label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label></div>
              {filteredUsers.length ? <div className="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Account status</th>{page === 'Roles & Access' && <th>Email verified</th>}<th>Joined</th><th>Last sign in</th>{page === 'Roles & Access' && <th>Actions</th>}</tr></thead><tbody>{filteredUsers.map(account => { const suspended = account.banned_until && Date.parse(account.banned_until) > Date.now(); const self = account.id === user.id; return <tr key={account.id}><td className="admin-email-cell">{account.email || account.id}{account.name && <small className="admin-subline">{account.name}</small>}</td><td><span className={`admin-role-badge ${account.role === 'admin' ? 'is-admin' : ''}`}>{account.role === 'admin' ? 'Administrator' : 'User'}</span></td><td>{suspended ? 'Suspended' : 'Active'}</td>{page === 'Roles & Access' && <td>{account.email_verified ? 'Verified' : 'Not verified'}</td>}<td>{formatDate(account.created_at, settings.platform_timezone)}</td><td>{formatDate(account.last_sign_in_at, settings.platform_timezone)}</td>{page === 'Roles & Access' && <td className="admin-action-cell"><button className="secondary-button" disabled={busyAction || self} onClick={() => revokeSessions(account)}>Revoke sessions</button><button className="secondary-button" title={account.role === 'admin' && !suspended ? 'Administrator accounts cannot be suspended here.' : undefined} disabled={busyAction || self || (account.role === 'admin' && !suspended)} onClick={() => changeSuspension(account)}>{suspended ? 'Reactivate' : 'Suspend'}</button></td>}</tr>; })}</tbody></table></div> : <div className="module-empty">No accounts match those filters.</div>}
              {page === 'Roles & Access' && <p className="admin-help-text">Suspending blocks new sign-ins and protected data requests. Revoking sessions invalidates refresh sessions; existing access tokens remain valid until expiry. Access tokens cannot be revoked immediately through Supabase Auth.</p>}
              {page === 'Users' && <p className="admin-help-text">Suspending an account blocks new sign-ins and protected data requests. Administrator accounts must first be removed from the protected allowlist before suspension.</p>}
            </section>}

            {page === 'Aquariums' && <><section className="panel admin-table-panel admin-aquarium-create"><div><h2>Add an aquarium</h2><p>Create a new aquarium record. It will remain unassigned until ownership is assigned through the verified ownership workflow.</p></div><button className="primary-button" type="button" onClick={() => setShowAquariumDialog(true)}><Fish size={15}/> Add aquarium</button></section><div className="admin-stat-grid"><Stat label="Registered aquariums" value={counts.aquariums}/><Stat label="Owner not assigned" value={counts.unassigned}/><Stat className="admin-stat-last-added" label="Last added" value={aquariums[0]?.created_at ? formatDate(aquariums[0].created_at, settings.platform_timezone) : 'No records'}/></div><AdminTable title="Aquarium records" columns={['Name', 'ID', 'Owner', 'Created']} rows={visibleRows(aquariums).map(row => [row.name || 'Unnamed aquarium', row.id, row.owner_id ? 'Assigned' : 'Unassigned', formatDate(row.created_at, settings.platform_timezone)])}/><p className="admin-help-text">New aquarium records start unassigned. Ownership assignment remains a verified database operation.</p>{showAquariumDialog && <div className="admin-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busyAction) setShowAquariumDialog(false); }} onKeyDown={event => { if (event.key === 'Escape' && !busyAction) setShowAquariumDialog(false); }}><section className="panel admin-dialog" role="dialog" aria-modal="true" aria-labelledby="add-aquarium-title"><div className="admin-dialog-heading"><div><h2 id="add-aquarium-title">Add an aquarium</h2><p>The new aquarium will start unassigned.</p></div><button className="secondary-button" type="button" onClick={() => setShowAquariumDialog(false)} disabled={busyAction}>Close</button></div><form className="admin-form" onSubmit={saveAquarium}><label htmlFor="new-aquarium-name">Aquarium name<input id="new-aquarium-name" autoFocus required maxLength={120} value={newAquariumName} onChange={event => setNewAquariumName(event.target.value)} placeholder="e.g. Community Tank"/></label><div className="admin-form-actions"><button className="secondary-button" type="button" onClick={() => setShowAquariumDialog(false)} disabled={busyAction}>Cancel</button><button className="primary-button" type="submit" disabled={busyAction}><Fish size={15}/>{busyAction ? 'Adding…' : 'Add aquarium'}</button></div></form></section></div>}</>}

            {page === 'Audit Logs' && <section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Administrative history</h2><p>Only completed or failed trusted backend actions are recorded. Results are bounded to 100 records.</p></div><button className="secondary-button" onClick={() => void refresh()}>Refresh logs</button></div><div className="admin-filter-row"><label>Action<input value={auditActionFilter} onChange={event => setAuditActionFilter(event.target.value)} placeholder="e.g. role_change"/></label><label>Entity<input value={auditEntityFilter} onChange={event => setAuditEntityFilter(event.target.value)} placeholder="e.g. user"/></label><label>Actor UUID<input value={auditActorFilter} onChange={event => setAuditActorFilter(event.target.value)} placeholder="Filter actor ID"/></label><label>From<input type="date" value={auditFrom} onChange={event => setAuditFrom(event.target.value)}/></label><label>To<input type="date" value={auditTo} onChange={event => setAuditTo(event.target.value)}/></label><button className="secondary-button" onClick={() => void refresh()}>Apply filters</button></div>{auditRows.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor ID</th><th>Action</th><th>Entity</th><th>Record</th><th>Outcome</th><th>Details</th></tr></thead><tbody>{visibleRows(auditRows).map(row => <tr key={row.id}><td>{formatDate(row.created_at, settings.platform_timezone)}</td><td>{row.actor_id || 'Deleted account'}</td><td>{row.action}</td><td>{row.entity_type}</td><td>{row.entity_id || '—'}</td><td>{row.outcome}</td><td><details><summary>Details</summary><pre>{JSON.stringify(row.metadata, null, 2)}</pre></details></td></tr>)}</tbody></table></div> : <div className="module-empty">No audit events match these filters.</div>}</section>}

            {page === 'System Operations' && <div className="admin-operations">
              <section className="panel admin-table-panel">
                <div className="admin-panel-heading"><div><h2>Device registry activity</h2><p>Last request and accepted reading times are read from Supabase records.</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh diagnostics'}</button></div>
                {operationData.devices.length ? <AdminTableGrid columns={['Device', 'Aquarium', 'Registry status', 'Connection', 'Last request', 'Last accepted reading']} rows={operationData.devices.map(device => {
                  const seenAt = device.last_seen_at ? Date.parse(device.last_seen_at) : NaN;
                  const online = device.is_active && Number.isFinite(seenAt) && Date.now() - seenAt <= operationData.offline_timeout_seconds * 1000;
                  return [device.device_id, device.aquarium_id, device.is_active ? 'Enabled' : 'Disabled', device.is_active ? (online ? 'Online' : 'Offline') : 'Disabled', formatDate(device.last_request_at, settings.platform_timezone), formatDate(device.last_reading_at, settings.platform_timezone)];
                })}/> : <div className="module-empty">No registered devices were returned.</div>}
              </section>
              <section className="panel admin-table-panel">
                <div className="admin-operations-heading"><div><h2>Recent ingestion outcomes</h2><p>Review the latest recorded device requests and their outcomes.</p></div><label className="admin-search operation-search"><Search size={15}/><input aria-label="Filter ingestion events" placeholder="Filter by device, aquarium, event, or outcome" value={operationFilter} onChange={event => setOperationFilter(event.target.value)}/></label></div>
                {filteredOperations.length ? <AdminTableGrid columns={['Time', 'Device', 'Aquarium', 'Event', 'Outcome']} rows={visibleRows(filteredOperations).map(event => [formatDate(event.created_at, settings.platform_timezone), event.device_id || '—', event.aquarium_id || '—', event.event_code, event.outcome])}/> : <div className="module-empty">No ingestion diagnostic events match this filter.</div>}
                <p className="admin-help-text">Only requests with a valid registered device credential are recorded. Invalid credentials are intentionally not persisted. Device metrics include records collected by this application.</p>
              </section>
            </div>}

            {page === 'Content Management' && <div className="admin-two-column"><section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Explore reference library</h2><p>These passages power AquaSense Explore retrieval.</p></div><button className="secondary-button" onClick={() => { setContentForm(emptyContent); setPreviewContent(false); }}>New entry</button></div><div className="admin-filter-row"><label className="admin-search"><Search size={15}/><input placeholder="Search content" value={search} onChange={event => setSearch(event.target.value)}/></label><label>Category<select value={contentCategoryFilter} onChange={event => setContentCategoryFilter(event.target.value)}><option value="all">All</option><option value="fish">Fish</option><option value="water_quality">Water quality</option><option value="care">Care</option><option value="learning">Learning</option></select></label><label>Status<select value={contentStatusFilter} onChange={event => setContentStatusFilter(event.target.value)}><option value="all">All</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option></select></label></div>{filteredContent.length ? <div className="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{visibleRows(filteredContent).map(row => <tr key={row.id}><td>{row.title}<small className="admin-subline">{row.source_title}</small></td><td>{row.category.replace('_', ' ')}</td><td>{row.is_archived ? 'Archived' : row.is_published ? 'Published' : 'Draft'}</td><td>{formatDate(row.updated_at, settings.platform_timezone)}</td><td className="admin-action-cell"><button className="secondary-button" onClick={() => { editContent(row); setPreviewContent(false); }}>Edit</button>{!row.is_archived && <button className="secondary-button" onClick={() => void perform('set_content_state', { id: row.id, is_published: !row.is_published, is_archived: false }, row.is_published ? 'Content unpublished.' : 'Content published.')}>{row.is_published ? 'Unpublish' : 'Publish'}</button>}<button className="secondary-button" onClick={() => window.confirm(`Archive “${row.title}”?`) && void perform('set_content_state', { id: row.id, is_published: false, is_archived: true }, 'Content archived.')}>Archive</button></td></tr>)}</tbody></table></div> : <div className="module-empty">No Explore content matches those filters.</div>}</section>
              <section className="panel admin-table-panel"><h2>{contentForm.id ? 'Edit reference entry' : 'Create reference entry'}</h2>{previewContent ? <article className="admin-preview"><h3>{contentForm.title || 'Untitled entry'}</h3><p>{contentForm.category.replace('_', ' ')} · {contentForm.source_title || 'No source'}</p><div>{contentForm.content || 'Content preview will appear here.'}</div>{contentForm.source_url && <a href={contentForm.source_url} target="_blank" rel="noreferrer">Open source</a>}</article> : <form className="admin-form" onSubmit={saveContent}><label>Title<input required maxLength="200" value={contentForm.title} onChange={event => setContentForm({ ...contentForm, title: event.target.value })}/></label><label>Category<select value={contentForm.category} onChange={event => setContentForm({ ...contentForm, category: event.target.value })}><option value="fish">Fish</option><option value="water_quality">Water quality</option><option value="care">Care</option><option value="learning">Learning</option></select></label><label>Content<textarea required minLength="20" maxLength="12000" rows="7" value={contentForm.content} onChange={event => setContentForm({ ...contentForm, content: event.target.value })}/></label><label>Source title<input required maxLength="200" value={contentForm.source_title} onChange={event => setContentForm({ ...contentForm, source_title: event.target.value })}/></label><label>Source URL (optional)<input type="url" value={contentForm.source_url || ''} onChange={event => setContentForm({ ...contentForm, source_url: event.target.value })}/></label><label className="admin-checkbox"><input type="checkbox" checked={contentForm.is_published} onChange={event => setContentForm({ ...contentForm, is_published: event.target.checked })}/> Publish after saving</label><div className="admin-form-actions"><button className="secondary-button" type="button" onClick={() => setPreviewContent(true)}>Preview</button><button className="primary-button" type="submit" disabled={busyAction}><Save size={15}/> Save entry</button><button className="secondary-button" type="button" onClick={() => setContentForm(emptyContent)}>Clear</button></div></form>}{previewContent && <button className="secondary-button" onClick={() => setPreviewContent(false)}>Back to edit</button>}</section></div>}

            {page === 'Announcements' && <div className="admin-two-column"><section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Platform announcements</h2><p>Published notices appear for signed-in users on their dashboard.</p></div><button className="secondary-button" onClick={() => { setAnnouncementForm({ ...emptyAnnouncement, category: settings.default_announcement_category }); setPreviewAnnouncement(false); }}>New announcement</button></div><div className="admin-filter-row"><label className="admin-search"><Search size={15}/><input placeholder="Search announcements" value={search} onChange={event => setSearch(event.target.value)}/></label><label>Status<select value={announcementStatusFilter} onChange={event => setAnnouncementStatusFilter(event.target.value)}><option value="all">All</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label></div>{filteredAnnouncements.length ? <div className="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Publish</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{visibleRows(filteredAnnouncements).map(row => <tr key={row.id}><td>{row.title}</td><td>{row.category}</td><td>{row.status}</td><td>{formatDate(row.publish_at, settings.platform_timezone)}</td><td>{formatDate(row.expires_at, settings.platform_timezone)}</td><td className="admin-action-cell"><button className="secondary-button" onClick={() => { editAnnouncement(row); setPreviewAnnouncement(false); }}>Edit</button>{row.status !== 'archived' && <button className="secondary-button" onClick={() => window.confirm(`Archive “${row.title}”?`) && void perform('save_announcement', { ...row, status: 'archived', publish_at: row.publish_at, expires_at: row.expires_at }, 'Announcement archived.')}>Archive</button>}</td></tr>)}</tbody></table></div> : <div className="module-empty">No announcements match those filters.</div>}</section>
              <section className="panel admin-table-panel"><h2>{announcementForm.id ? 'Edit announcement' : 'Create announcement'}</h2>{previewAnnouncement ? <article className="announcement-preview"><span>{announcementForm.category}</span><h3>{announcementForm.title || 'Untitled announcement'}</h3><p>{announcementForm.message || 'Announcement preview will appear here.'}</p></article> : <form className="admin-form" onSubmit={saveAnnouncement}><label>Title<input required maxLength="160" value={announcementForm.title} onChange={event => setAnnouncementForm({ ...announcementForm, title: event.target.value })}/></label><label>Message<textarea required maxLength="5000" rows="5" value={announcementForm.message} onChange={event => setAnnouncementForm({ ...announcementForm, message: event.target.value })}/></label><label>Category<select value={announcementForm.category} onChange={event => setAnnouncementForm({ ...announcementForm, category: event.target.value })}><option value="general">General</option><option value="maintenance">Maintenance</option><option value="feature">Feature</option><option value="important">Important</option></select></label><label>Status<select value={announcementForm.status} onChange={event => setAnnouncementForm({ ...announcementForm, status: event.target.value })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label><label>Publish date (optional)<input type="datetime-local" value={announcementForm.publish_at} onChange={event => setAnnouncementForm({ ...announcementForm, publish_at: event.target.value })}/></label><label>Expiration date (optional)<input type="datetime-local" value={announcementForm.expires_at} onChange={event => setAnnouncementForm({ ...announcementForm, expires_at: event.target.value })}/></label><div className="admin-form-actions"><button className="secondary-button" type="button" onClick={() => setPreviewAnnouncement(true)}>Preview</button><button className="primary-button" type="submit" disabled={busyAction}><Save size={15}/> Save announcement</button></div></form>}{previewAnnouncement && <button className="secondary-button" onClick={() => setPreviewAnnouncement(false)}>Back to edit</button>}</section></div>}

            {page === 'System Settings' && <section className="admin-settings-page">
              <form className="admin-settings-layout" onSubmit={event => { event.preventDefault(); void perform('save_platform_settings', settings, 'Platform settings saved.'); }}>
                <nav className="user-settings-nav admin-settings-nav" aria-label="Admin settings sections">
                  {adminSettingsSections.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={adminSettingsSection === id ? 'selected' : ''} aria-current={adminSettingsSection === id ? 'page' : undefined} onClick={() => setAdminSettingsSection(id)}><Icon size={16}/><span>{label}</span></button>)}
                </nav>
                <div className="user-settings-content admin-settings-content">
                  {adminSettingsSection === 'general' && <section className="panel settings-card admin-settings-group">
                    <div className="settings-card-heading"><Settings size={18}/><div><h2>General preferences</h2><p>Choose the default announcement category and date display timezone.</p></div></div>
                    <div className="admin-settings-basics">
                      <label>Default announcement category<select value={settings.default_announcement_category} onChange={event => setSettings({ ...settings, default_announcement_category: event.target.value })}><option value="general">General</option><option value="maintenance">Maintenance</option><option value="feature">Feature</option><option value="important">Important</option></select><small>Selected when starting a new announcement.</small></label>
                      <label>Administrative display timezone<select value={settings.platform_timezone} onChange={event => setSettings({ ...settings, platform_timezone: event.target.value })}>{['UTC', 'Asia/Manila', 'Asia/Singapore', 'America/Los_Angeles', 'America/New_York', 'Europe/London'].map(zone => <option key={zone}>{zone}</option>)}</select><small>Used for dates displayed in the admin console.</small></label>
                    </div>
                  </section>}
                  {adminSettingsSection === 'announcements' && <section className="panel settings-card admin-settings-group">
                    <div className="settings-card-heading"><Bell size={18}/><div><h2>Announcement visibility</h2><p>Set the default lifetime for published announcements.</p></div></div>
                    <label>Default visibility (days)<input type="number" min="1" max="365" step="1" value={settings.announcement_visibility_days} onChange={event => setSettings({ ...settings, announcement_visibility_days: Number(event.target.value) })}/><small>Published announcements without an expiration date will expire after this many days.</small></label>
                  </section>}
                  {adminSettingsSection === 'devices' && <section className="panel settings-card admin-settings-group">
                    <div className="settings-card-heading"><Wifi size={18}/><div><h2>Device monitoring</h2><p>Control when an ESP32 is considered offline.</p></div></div>
                    <label>Device offline timeout (seconds)<input type="number" min="30" max="86400" step="30" value={settings.device_offline_timeout_seconds} onChange={event => setSettings({ ...settings, device_offline_timeout_seconds: Number(event.target.value) })}/><small>System Operations marks an enabled ESP32 offline after it has not been seen for this long.</small></label>
                  </section>}
                  {adminSettingsSection === 'maintenance' && <section className="panel settings-card admin-settings-group">
                    <div className="settings-card-heading"><AlertTriangle size={18}/><div><h2>Maintenance mode</h2><p>Show a maintenance notice to signed-in users.</p></div></div>
                    <label className="admin-checkbox"><input type="checkbox" checked={settings.maintenance_mode_enabled} onChange={event => setSettings({ ...settings, maintenance_mode_enabled: event.target.checked })}/> Enable maintenance notice</label>
                    <label>Notice shown to users<textarea rows="3" maxLength="500" value={settings.maintenance_mode_message} onChange={event => setSettings({ ...settings, maintenance_mode_message: event.target.value })}/><small>Shown at the top of signed-in user dashboards while maintenance mode is enabled.</small></label>
                  </section>}
                  {adminSettingsSection === 'esp32' && <section className="panel settings-card admin-settings-group">
                    <div className="settings-card-heading"><Cpu size={18}/><div><h2>ESP32 ingestion defaults</h2><p>Set rate limits and accepted reading bounds.</p></div></div>
                    <label>Minimum reading interval (seconds)<input type="number" min="0.1" max="60" step="0.1" value={settings.esp32_minimum_interval_ms / 1000} onChange={event => setSettings({ ...settings, esp32_minimum_interval_ms: Math.round(Number(event.target.value) * 1000) })}/><small>Requests arriving sooner are rate limited.</small></label>
                    <div className="admin-settings-range">
                      <label>Minimum temperature (°C)<input type="number" min="0" max="50" step="0.1" value={settings.esp32_temperature_min} onChange={event => setSettings({ ...settings, esp32_temperature_min: Number(event.target.value) })}/></label>
                      <label>Maximum temperature (°C)<input type="number" min="0" max="50" step="0.1" value={settings.esp32_temperature_max} onChange={event => setSettings({ ...settings, esp32_temperature_max: Number(event.target.value) })}/></label>
                      <label>Minimum pH<input type="number" min="0" max="14" step="0.1" value={settings.esp32_ph_min} onChange={event => setSettings({ ...settings, esp32_ph_min: Number(event.target.value) })}/></label>
                      <label>Maximum pH<input type="number" min="0" max="14" step="0.1" value={settings.esp32_ph_max} onChange={event => setSettings({ ...settings, esp32_ph_max: Number(event.target.value) })}/></label>
                    </div>
                    <p className="admin-help-text">These platform-wide bounds apply to ESP32 readings; each registered device’s own limits also remain in effect.</p>
                  </section>}
                  <div className="settings-form-actions admin-settings-actions"><button className="primary-button" disabled={busyAction}><Save size={15}/> Save settings</button></div>
                </div>
              </form>
            </section>}
          </>}
          {!loading && activeListLength > 25 && <nav className="admin-pagination" aria-label={`${page} results pages`}><span>{(tablePage - 1) * 25 + 1}–{Math.min(tablePage * 25, activeListLength)} of {activeListLength}</span><button className="secondary-button" disabled={tablePage <= 1} onClick={() => setTablePage(value => Math.max(1, value - 1))}>Previous</button><span>Page {tablePage} of {activePageCount}</span><button className="secondary-button" disabled={tablePage >= activePageCount} onClick={() => setTablePage(value => Math.min(activePageCount, value + 1))}>Next</button></nav>}
        </div>
      </main>
      {showSignOutConfirm && <div className="signout-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowSignOutConfirm(false); }}>
        <section className="signout-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-signout-confirm-title" aria-describedby="admin-signout-confirm-description">
          <div className="signout-confirm-icon"><LogOut size={19}/></div>
          <h2 id="admin-signout-confirm-title">Sign out?</h2>
          <p id="admin-signout-confirm-description">Are you sure you want to sign out of AquaSense?</p>
          <div className="signout-confirm-actions">
            <button type="button" className="secondary-button" onClick={() => setShowSignOutConfirm(false)}>Cancel</button>
            <button type="button" className="signout-confirm-button" onClick={() => { setShowSignOutConfirm(false); onSignOut(); }}><LogOut size={15}/> Sign out</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

function Stat({ label, value, className = '' }) { return <article className={`panel admin-stat ${className}`}><span>{label}</span><strong>{value ?? '—'}</strong></article>; }
function formatDate(value, timeZone = 'UTC') { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { timeZone }); }
function toLocalInput(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function localToIso(value) { return value ? new Date(value).toISOString() : null; }

function AdminTable({ title, columns, rows }) {
  return <section className="panel admin-table-panel"><h2>{title}</h2>{rows.length ? <AdminTableGrid columns={columns} rows={rows}/> : <div className="module-empty">No records available.</div>}</section>;
}

function AdminTableGrid({ columns, rows }) {
  return <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}
