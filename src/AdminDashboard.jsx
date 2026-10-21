import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, BookOpen, Check, Clock3, Download,
  FileText, Fish, LayoutDashboard, LogOut, Menu, RefreshCw, Save, Search,
  Settings, Shield, Users,
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
  { name: 'Platform Reports', icon: Clock3 },
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
  'Roles & Access': 'Search accounts and manage roles or account suspension.',
  'Audit Logs': 'Review recorded privileged changes.',
  'System Operations': 'Inspect registered device activity and recorded ingestion outcomes.',
  'Content Management': 'Maintain the published reference library used by AquaSense Explore.',
  Announcements: 'Prepare platform notices and publish them to regular user dashboards.',
  'Platform Reports': 'Review counts derived from registered accounts and platform records.',
  'System Settings': 'Set the announcement default and administrative display timezone.',
};
const emptyContent = { id: null, title: '', content: '', source_title: '', source_url: '', category: 'learning', is_published: false };
const emptyAnnouncement = { id: null, title: '', message: '', category: 'general', status: 'draft', publish_at: '', expires_at: '' };
const defaultSettings = { default_announcement_category: 'general', platform_timezone: 'UTC' };

async function requestRows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export default function AdminDashboard({ user, onSignOut }) {
  const [page, setPage] = useState(pageFromLocation);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [aquariums, setAquariums] = useState([]);
  const [counts, setCounts] = useState({ aquariums: 0, unassigned: 0 });
  const [userRows, setUserRows] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [auditRows, setAuditRows] = useState([]);
  const [operationData, setOperationData] = useState({ devices: [], events: [] });
  const [contentRows, setContentRows] = useState([]);
  const [announcementRows, setAnnouncementRows] = useState([]);
  const [reportMetrics, setReportMetrics] = useState(null);
  const [reportDays, setReportDays] = useState(30);
  const [settings, setSettings] = useState(defaultSettings);
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
        if (page === 'Overview') {
          const result = await callAquaSenseAdmin('get_platform_report', { days: reportDays });
          setReportMetrics({ ...result.metrics, generated_at: result.generated_at });
        }
      } else if (page === 'Users' || page === 'Roles & Access') {
        const result = await callAquaSenseAdmin('list_users', { page: tablePage, search, role_filter: roleFilter, status_filter: statusFilter }); setUserRows(result.users || []); setUserTotal(result.total || 0);
      } else if (page === 'Audit Logs') {
        const result = await callAquaSenseAdmin('list_audit_logs', { limit: 100, action_filter: auditActionFilter, entity_type: auditEntityFilter, actor_id: auditActorFilter || null, from: auditFrom || null, to: auditTo ? new Date(`${auditTo}T23:59:59`).toISOString() : null });
        setAuditRows(result.logs || []);
      } else if (page === 'System Operations') {
        const result = await callAquaSenseAdmin('list_operations'); setOperationData({ devices: result.devices || [], events: result.events || [] });
      } else if (page === 'Content Management') {
        const result = await callAquaSenseAdmin('list_content'); setContentRows(result.content || []);
      } else if (page === 'Announcements') {
        const result = await callAquaSenseAdmin('list_admin_announcements'); setAnnouncementRows(result.announcements || []);
        const saved = await callAquaSenseAdmin('get_platform_settings'); setSettings({ ...defaultSettings, ...saved.settings });
      } else if (page === 'Platform Reports') {
        const result = await callAquaSenseAdmin('get_platform_report', { days: reportDays }); setReportMetrics({ ...result.metrics, generated_at: result.generated_at });
      } else if (page === 'System Settings') {
        const result = await callAquaSenseAdmin('get_platform_settings'); setSettings({ ...defaultSettings, ...result.settings });
      }
    } catch (loadError) {
      setError(loadError?.message || `Could not load ${page.toLowerCase()}.`);
    } finally { setLoading(false); }
  }, [page, auditActionFilter, auditEntityFilter, auditActorFilter, auditFrom, auditTo, reportDays, tablePage, search, roleFilter, statusFilter]);

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

  const changeAdmin = account => {
    const nextIsAdmin = account.role !== 'admin';
    if (!window.confirm(`${nextIsAdmin ? 'Grant administrator access to' : 'Remove administrator access from'} ${account.email || account.id}?`)) return;
    void perform('set_admin', { user_id: account.id, is_admin: nextIsAdmin }, 'Account role updated.');
  };
  const changeSuspension = account => {
    const suspended = !(account.banned_until && Date.parse(account.banned_until) > Date.now());
    const verb = suspended ? 'Suspend' : 'Reactivate';
    if (!window.confirm(`${verb} ${account.email || account.id}? ${suspended ? 'They will be unable to sign in or continue using protected aquarium data.' : 'They will be able to sign in again.'}`)) return;
    void perform('set_user_suspended', { user_id: account.id, suspended }, `Account ${suspended ? 'suspended' : 'reactivated'}.`);
  };
  const editContent = row => setContentForm({ ...row, is_published: row.is_published && !row.is_archived });
  const saveContent = event => {
    event.preventDefault();
    void perform('save_content', contentForm, 'Explore reference content saved.').then(saved => { if (saved) setContentForm(emptyContent); });
  };
  const editAnnouncement = row => setAnnouncementForm({ ...row, publish_at: toLocalInput(row.publish_at), expires_at: toLocalInput(row.expires_at) });
  const saveAnnouncement = event => {
    event.preventDefault();
    const fields = { ...announcementForm, publish_at: localToIso(announcementForm.publish_at), expires_at: localToIso(announcementForm.expires_at) };
    void perform('save_announcement', fields, 'Announcement saved.').then(saved => { if (saved) { setAnnouncementForm(emptyAnnouncement); setPreviewAnnouncement(false); } });
  };
  const exportReport = () => {
    if (!reportMetrics) return;
    const rows = [['Metric', 'Value'], ...Object.entries(reportMetrics).filter(([key]) => key !== 'generated_at')];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'aquasense-platform-report.csv'; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell admin-shell" data-theme="dark">
      {mobileNavOpen && <button className="sidebar-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <aside className={`sidebar admin-sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand"><div className="brand-mark"><img src="/images/aquasense-logo.png" alt="" /></div><div><div className="brand-name">AquaSense</div><div className="brand-caption">ADMIN</div></div></div>
          <div className="nav-label">PLATFORM</div>
          <nav className="side-nav" aria-label="Admin pages">{pages.map(({ name, icon: Icon }) => <button className={`nav-item ${page === name ? 'active' : ''}`} key={name} aria-current={page === name ? 'page' : undefined} onClick={() => navigateAdmin(name)}><Icon size={17}/><span>{name}</span></button>)}</nav>
        </div>
        <div className="sidebar-bottom"><div className="profile-row"><div className="profile-avatar">{(user.email || 'A').slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.user_metadata?.full_name || user.email}</strong><span>Administrator</span></div><button className="signout-button" onClick={onSignOut} aria-label="Sign out"><LogOut size={16}/></button></div></div>
      </aside>

      <main className="main-content admin-main">
        <header className="topbar admin-topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={18}/></button><strong>Admin</strong><span className="admin-breadcrumb-divider">/</span><span>{page}</span></div><div className="topbar-actions"><button className="icon-button" onClick={() => void refresh()} aria-label="Refresh current page" title="Refresh"><RefreshCw size={16}/></button></div></header>
        <div className="page-content admin-content">
          <section className="admin-page-heading"><div><p className="admin-eyebrow">AQUASENSE ADMIN</p><h1>{page}</h1><p>{descriptions[page]}</p></div></section>
          {error && <div className="notice connection-error" role="alert"><AlertTriangle size={17}/><div><strong>Could not complete request</strong><span>{error}</span></div><button className="secondary-button" onClick={() => void refresh()}>Retry</button></div>}
          {success && <div className="notice admin-success" role="status"><Check size={17}/><div>{success}</div></div>}

          {loading ? <div className="module-empty">Loading {page.toLowerCase()}…</div> : <>
            {page === 'Overview' && <>
              <div className="admin-stat-grid">{[['Registered users', reportMetrics?.total_users], ['Aquariums', counts.aquariums], ['Unassigned aquariums', counts.unassigned], ['Registered devices', reportMetrics?.registered_devices]].map(([label, value]) => <Stat key={label} label={label} value={value}/>)}</div>
              <AdminTable title="Recently added aquariums" columns={['Name', 'ID', 'Owner', 'Created']} rows={aquariums.slice(0, 8).map(row => [row.name || 'Unnamed aquarium', row.id, row.owner_id ? 'Assigned' : 'Unassigned', formatDate(row.created_at, settings.platform_timezone)])}/>
              <p className="admin-help-text">The overview reports registered records. Device readings and user activity are available in the user dashboard and audit history respectively.</p>
            </>}

            {(page === 'Users' || page === 'Roles & Access') && <section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>{page === 'Users' ? 'User directory' : 'Account access'}</h2><p>{page === 'Users' ? 'Review registered accounts and their current status.' : 'Roles come from the protected administrator allowlist; status comes from Supabase Auth.'}</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={loading}>Refresh</button></div>
              <div className="admin-filter-row"><label className="admin-search"><Search size={15}/><input aria-label="Search accounts" placeholder="Search email, name, or account ID" value={search} onChange={event => setSearch(event.target.value)}/></label><label>Role<select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="all">All roles</option><option value="user">User</option><option value="admin">Administrator</option></select></label><label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label></div>
              {filteredUsers.length ? <div className="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Last sign in</th>{page === 'Roles & Access' && <th>Actions</th>}</tr></thead><tbody>{filteredUsers.map(account => { const suspended = account.banned_until && Date.parse(account.banned_until) > Date.now(); const self = account.id === user.id; return <tr key={account.id}><td className="admin-email-cell">{account.email || account.id}{account.name && <small className="admin-subline">{account.name}</small>}</td><td><span className={`admin-role-badge ${account.role === 'admin' ? 'is-admin' : ''}`}>{account.role === 'admin' ? 'Administrator' : 'User'}</span></td><td>{suspended ? 'Suspended' : 'Active'}</td><td>{formatDate(account.created_at, settings.platform_timezone)}</td><td>{formatDate(account.last_sign_in_at, settings.platform_timezone)}</td><td className={`admin-action-cell ${page === 'Users' ? 'directory-only' : ''}`}><button className="secondary-button" disabled={busyAction || self} onClick={() => changeAdmin(account)}>{account.role === 'admin' ? 'Remove admin' : 'Make admin'}</button><button className="secondary-button" title={account.role === 'admin' && !suspended ? 'Remove administrator access before suspending' : undefined} disabled={busyAction || self || (account.role === 'admin' && !suspended)} onClick={() => changeSuspension(account)}>{suspended ? 'Reactivate' : 'Suspend'}</button></td></tr>; })}</tbody></table></div> : <div className="module-empty">No accounts match those filters.</div>}
              <p className="admin-help-text">Suspending an account blocks new sign-ins and protected data requests. Self role changes and self suspension are blocked; administrator accounts must first be demoted before suspension.</p>
            </section>}

            {page === 'Aquariums' && <><div className="admin-stat-grid"><Stat label="Registered aquariums" value={counts.aquariums}/><Stat label="Owner not assigned" value={counts.unassigned}/></div><AdminTable title="Aquarium records" columns={['Name', 'ID', 'Owner', 'Created']} rows={visibleRows(aquariums).map(row => [row.name || 'Unnamed aquarium', row.id, row.owner_id ? 'Assigned' : 'Unassigned', formatDate(row.created_at, settings.platform_timezone)])}/><p className="admin-help-text">Ownership assignment remains a verified database operation. This page does not guess or transfer aquarium ownership.</p></>}

            {page === 'Audit Logs' && <section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Administrative history</h2><p>Only completed or failed trusted backend actions are recorded. Results are bounded to 100 records.</p></div><button className="secondary-button" onClick={() => void refresh()}>Refresh logs</button></div><div className="admin-filter-row"><label>Action<input value={auditActionFilter} onChange={event => setAuditActionFilter(event.target.value)} placeholder="e.g. role_change"/></label><label>Entity<input value={auditEntityFilter} onChange={event => setAuditEntityFilter(event.target.value)} placeholder="e.g. user"/></label><label>Actor UUID<input value={auditActorFilter} onChange={event => setAuditActorFilter(event.target.value)} placeholder="Filter actor ID"/></label><label>From<input type="date" value={auditFrom} onChange={event => setAuditFrom(event.target.value)}/></label><label>To<input type="date" value={auditTo} onChange={event => setAuditTo(event.target.value)}/></label><button className="secondary-button" onClick={() => void refresh()}>Apply filters</button></div>{auditRows.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor ID</th><th>Action</th><th>Entity</th><th>Record</th><th>Outcome</th><th>Details</th></tr></thead><tbody>{visibleRows(auditRows).map(row => <tr key={row.id}><td>{formatDate(row.created_at, settings.platform_timezone)}</td><td>{row.actor_id || 'Deleted account'}</td><td>{row.action}</td><td>{row.entity_type}</td><td>{row.entity_id || '—'}</td><td>{row.outcome}</td><td><details><summary>Details</summary><pre>{JSON.stringify(row.metadata, null, 2)}</pre></details></td></tr>)}</tbody></table></div> : <div className="module-empty">No audit events match these filters.</div>}</section>}

            {page === 'System Operations' && <><section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Device registry activity</h2><p>Last request and accepted reading times are read from Supabase records.</p></div><button className="secondary-button" onClick={() => void refresh()}>Refresh diagnostics</button></div>{operationData.devices.length ? <AdminTable title="Registered devices" columns={['Device', 'Aquarium', 'Status', 'Last request', 'Last accepted reading']} rows={operationData.devices.map(device => [device.device_id, device.aquarium_id, device.is_active ? 'Enabled' : 'Disabled', formatDate(device.last_request_at, settings.platform_timezone), formatDate(device.last_reading_at, settings.platform_timezone)])}/> : <div className="module-empty">No registered devices were returned.</div>}</section><section className="panel admin-table-panel"><h2>Recent ingestion outcomes</h2><label className="admin-search operation-search"><Search size={15}/><input aria-label="Filter ingestion events" placeholder="Filter device, aquarium, event, or status" value={operationFilter} onChange={event => setOperationFilter(event.target.value)}/></label>{filteredOperations.length ? <AdminTable title="Recent events" columns={['Time', 'Device', 'Aquarium', 'Event', 'Outcome']} rows={visibleRows(filteredOperations).map(event => [formatDate(event.created_at, settings.platform_timezone), event.device_id || '—', event.aquarium_id || '—', event.event_code, event.outcome])}/> : <div className="module-empty">No ingestion diagnostic events are recorded yet.</div>}<p className="admin-help-text">Only requests with a valid registered device credential are recorded. Invalid credentials are intentionally not persisted to avoid storing attacker controlled traffic. Device metrics are limited to records collected by this application.</p></section></>}

            {page === 'Content Management' && <div className="admin-two-column"><section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Explore reference library</h2><p>These passages power AquaSense Explore retrieval.</p></div><button className="secondary-button" onClick={() => { setContentForm(emptyContent); setPreviewContent(false); }}>New entry</button></div><div className="admin-filter-row"><label className="admin-search"><Search size={15}/><input placeholder="Search content" value={search} onChange={event => setSearch(event.target.value)}/></label><label>Category<select value={contentCategoryFilter} onChange={event => setContentCategoryFilter(event.target.value)}><option value="all">All</option><option value="fish">Fish</option><option value="water_quality">Water quality</option><option value="care">Care</option><option value="learning">Learning</option></select></label><label>Status<select value={contentStatusFilter} onChange={event => setContentStatusFilter(event.target.value)}><option value="all">All</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option></select></label></div>{filteredContent.length ? <div className="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{visibleRows(filteredContent).map(row => <tr key={row.id}><td>{row.title}<small className="admin-subline">{row.source_title}</small></td><td>{row.category.replace('_', ' ')}</td><td>{row.is_archived ? 'Archived' : row.is_published ? 'Published' : 'Draft'}</td><td>{formatDate(row.updated_at, settings.platform_timezone)}</td><td className="admin-action-cell"><button className="secondary-button" onClick={() => { editContent(row); setPreviewContent(false); }}>Edit</button>{!row.is_archived && <button className="secondary-button" onClick={() => void perform('set_content_state', { id: row.id, is_published: !row.is_published, is_archived: false }, row.is_published ? 'Content unpublished.' : 'Content published.')}>{row.is_published ? 'Unpublish' : 'Publish'}</button>}<button className="secondary-button" onClick={() => window.confirm(`Archive “${row.title}”?`) && void perform('set_content_state', { id: row.id, is_published: false, is_archived: true }, 'Content archived.')}>Archive</button></td></tr>)}</tbody></table></div> : <div className="module-empty">No Explore content matches those filters.</div>}</section>
              <section className="panel admin-table-panel"><h2>{contentForm.id ? 'Edit reference entry' : 'Create reference entry'}</h2>{previewContent ? <article className="admin-preview"><h3>{contentForm.title || 'Untitled entry'}</h3><p>{contentForm.category.replace('_', ' ')} · {contentForm.source_title || 'No source'}</p><div>{contentForm.content || 'Content preview will appear here.'}</div>{contentForm.source_url && <a href={contentForm.source_url} target="_blank" rel="noreferrer">Open source</a>}</article> : <form className="admin-form" onSubmit={saveContent}><label>Title<input required maxLength="200" value={contentForm.title} onChange={event => setContentForm({ ...contentForm, title: event.target.value })}/></label><label>Category<select value={contentForm.category} onChange={event => setContentForm({ ...contentForm, category: event.target.value })}><option value="fish">Fish</option><option value="water_quality">Water quality</option><option value="care">Care</option><option value="learning">Learning</option></select></label><label>Content<textarea required minLength="20" maxLength="12000" rows="7" value={contentForm.content} onChange={event => setContentForm({ ...contentForm, content: event.target.value })}/></label><label>Source title<input required maxLength="200" value={contentForm.source_title} onChange={event => setContentForm({ ...contentForm, source_title: event.target.value })}/></label><label>Source URL (optional)<input type="url" value={contentForm.source_url || ''} onChange={event => setContentForm({ ...contentForm, source_url: event.target.value })}/></label><label className="admin-checkbox"><input type="checkbox" checked={contentForm.is_published} onChange={event => setContentForm({ ...contentForm, is_published: event.target.checked })}/> Publish after saving</label><div className="admin-form-actions"><button className="secondary-button" type="button" onClick={() => setPreviewContent(true)}>Preview</button><button className="primary-button" type="submit" disabled={busyAction}><Save size={15}/> Save entry</button><button className="secondary-button" type="button" onClick={() => setContentForm(emptyContent)}>Clear</button></div></form>}{previewContent && <button className="secondary-button" onClick={() => setPreviewContent(false)}>Back to edit</button>}</section></div>}

            {page === 'Announcements' && <div className="admin-two-column"><section className="panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Platform announcements</h2><p>Published notices appear for signed-in users on their dashboard.</p></div><button className="secondary-button" onClick={() => { setAnnouncementForm({ ...emptyAnnouncement, category: settings.default_announcement_category }); setPreviewAnnouncement(false); }}>New announcement</button></div><div className="admin-filter-row"><label className="admin-search"><Search size={15}/><input placeholder="Search announcements" value={search} onChange={event => setSearch(event.target.value)}/></label><label>Status<select value={announcementStatusFilter} onChange={event => setAnnouncementStatusFilter(event.target.value)}><option value="all">All</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label></div>{filteredAnnouncements.length ? <div className="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Publish</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{visibleRows(filteredAnnouncements).map(row => <tr key={row.id}><td>{row.title}</td><td>{row.category}</td><td>{row.status}</td><td>{formatDate(row.publish_at, settings.platform_timezone)}</td><td>{formatDate(row.expires_at, settings.platform_timezone)}</td><td className="admin-action-cell"><button className="secondary-button" onClick={() => { editAnnouncement(row); setPreviewAnnouncement(false); }}>Edit</button>{row.status !== 'archived' && <button className="secondary-button" onClick={() => window.confirm(`Archive “${row.title}”?`) && void perform('save_announcement', { ...row, status: 'archived', publish_at: row.publish_at, expires_at: row.expires_at }, 'Announcement archived.')}>Archive</button>}</td></tr>)}</tbody></table></div> : <div className="module-empty">No announcements match those filters.</div>}</section>
              <section className="panel admin-table-panel"><h2>{announcementForm.id ? 'Edit announcement' : 'Create announcement'}</h2>{previewAnnouncement ? <article className="announcement-preview"><span>{announcementForm.category}</span><h3>{announcementForm.title || 'Untitled announcement'}</h3><p>{announcementForm.message || 'Announcement preview will appear here.'}</p></article> : <form className="admin-form" onSubmit={saveAnnouncement}><label>Title<input required maxLength="160" value={announcementForm.title} onChange={event => setAnnouncementForm({ ...announcementForm, title: event.target.value })}/></label><label>Message<textarea required maxLength="5000" rows="5" value={announcementForm.message} onChange={event => setAnnouncementForm({ ...announcementForm, message: event.target.value })}/></label><label>Category<select value={announcementForm.category} onChange={event => setAnnouncementForm({ ...announcementForm, category: event.target.value })}><option value="general">General</option><option value="maintenance">Maintenance</option><option value="feature">Feature</option><option value="important">Important</option></select></label><label>Status<select value={announcementForm.status} onChange={event => setAnnouncementForm({ ...announcementForm, status: event.target.value })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label><label>Publish date (optional)<input type="datetime-local" value={announcementForm.publish_at} onChange={event => setAnnouncementForm({ ...announcementForm, publish_at: event.target.value })}/></label><label>Expiration date (optional)<input type="datetime-local" value={announcementForm.expires_at} onChange={event => setAnnouncementForm({ ...announcementForm, expires_at: event.target.value })}/></label><div className="admin-form-actions"><button className="secondary-button" type="button" onClick={() => setPreviewAnnouncement(true)}>Preview</button><button className="primary-button" type="submit" disabled={busyAction}><Save size={15}/> Save announcement</button></div></form>}{previewAnnouncement && <button className="secondary-button" onClick={() => setPreviewAnnouncement(false)}>Back to edit</button>}</section></div>}

            {page === 'Platform Reports' && <section className="admin-report-page"><div className="admin-panel-heading"><div><p>Counts come from Supabase Auth and application records. Select a registration window from 7 to 365 days.</p><small>Generated {formatDate(reportMetrics?.generated_at, settings.platform_timezone)}</small></div><div className="admin-form-actions"><label>Registration window<select value={reportDays} onChange={event => setReportDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option></select></label><button className="secondary-button" onClick={() => void refresh()}>Refresh report</button><button className="secondary-button" onClick={exportReport} disabled={!reportMetrics}><Download size={15}/> Export CSV</button></div></div><div className="admin-stat-grid">{[['Registered users', reportMetrics?.total_users], [`New registrations (${reportDays} days)`, reportMetrics?.new_users_in_window], ['Registered aquariums', reportMetrics?.total_aquariums], ['Registered ESP32 devices', reportMetrics?.registered_devices], ['Published Explore entries', reportMetrics?.published_content], ['Draft Explore entries', reportMetrics?.draft_content], ['Recorded admin actions', reportMetrics?.admin_actions]].map(([label, value]) => <Stat key={label} label={label} value={value}/>)}</div><p className="admin-help-text">The project does not record reliable daily active-user telemetry. This report does not label sign-ins or account totals as “active users.” Ingestion failures are shown in System Operations only for events collected after the diagnostics migration is deployed.</p></section>}

            {page === 'System Settings' && <section className="panel admin-table-panel admin-settings-panel"><div><h2>Platform preferences</h2><p>These settings are validated and persisted by the administrator Edge Function.</p></div><form className="admin-form" onSubmit={event => { event.preventDefault(); void perform('save_platform_settings', settings, 'Platform preferences saved.'); }}><label>Default announcement category<select value={settings.default_announcement_category} onChange={event => setSettings({ ...settings, default_announcement_category: event.target.value })}><option value="general">General</option><option value="maintenance">Maintenance</option><option value="feature">Feature</option><option value="important">Important</option></select><small>Selected when starting a new announcement.</small></label><label>Administrative display timezone<select value={settings.platform_timezone} onChange={event => setSettings({ ...settings, platform_timezone: event.target.value })}>{['UTC', 'Asia/Manila', 'Asia/Singapore', 'America/Los_Angeles', 'America/New_York', 'Europe/London'].map(zone => <option key={zone}>{zone}</option>)}</select><small>Used for dates displayed in the admin console.</small></label><button className="primary-button" disabled={busyAction}><Save size={15}/> Save settings</button></form></section>}
          </>}
          {!loading && activeListLength > 25 && <nav className="admin-pagination" aria-label={`${page} results pages`}><span>{(tablePage - 1) * 25 + 1}–{Math.min(tablePage * 25, activeListLength)} of {activeListLength}</span><button className="secondary-button" disabled={tablePage <= 1} onClick={() => setTablePage(value => Math.max(1, value - 1))}>Previous</button><span>Page {tablePage} of {activePageCount}</span><button className="secondary-button" disabled={tablePage >= activePageCount} onClick={() => setTablePage(value => Math.min(activePageCount, value + 1))}>Next</button></nav>}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }) { return <article className="panel admin-stat"><span>{label}</span><strong>{value ?? '—'}</strong></article>; }
function formatDate(value, timeZone = 'UTC') { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { timeZone }); }
function toLocalInput(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function localToIso(value) { return value ? new Date(value).toISOString() : null; }

function AdminTable({ title, columns, rows }) {
  return <section className="panel admin-table-panel"><h2>{title}</h2>{rows.length ? <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell ?? '—'}</td>)}</tr>)}</tbody></table></div> : <div className="module-empty">No records available.</div>}</section>;
}
