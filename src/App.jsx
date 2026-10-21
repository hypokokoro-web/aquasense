import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, CheckCircle2, CircleHelp, Copy, ThumbsUp, ThumbsDown, Share2, Volume2, Pause, Square,
  Clock3, Droplets, LayoutDashboard, Menu, MoreHorizontal, RefreshCw, Sparkles, Send,
  ShieldCheck, Thermometer, Waves, Wifi, WifiOff, Cpu, Database, LogOut, LoaderCircle,
  CalendarDays, FileSpreadsheet, FileText, BellRing, Search, Eye, Download, Sun, Moon, Fish,
  BookOpen, CalendarCheck2, ChevronLeft, ChevronRight, Check, Trash2, RotateCcw
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { aquasenseAssistantUrl, isSupabaseConfigured, supabase, supabasePublishableKey } from './lib/supabase';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import { aquaSenseRemarkPlugins, aquaSenseRehypePlugins, prepareMarkdownMath, safeMarkdownUrl } from './lib/aquaSenseMarkdown';
import loadExcelJS from './lib/loadExcelJS';
import { collectPagedReadings, createCsv, prepareExportRecords, resolveHistoryBounds, summarizeExportRecords } from './lib/sensorExports';
import './styles.css';
import AdminDashboard from './AdminDashboard';
import { canAccessAdminRoute, canOfferSocialLogin, hasPasswordAuthMethod, resolveAquaSenseRole, SOCIAL_LOGIN_PROVIDERS } from './lib/authorization';
import { callAquaSenseAdmin } from './lib/adminApi';
import { maskEmailAddress, resendSignupOtp, SIGNUP_OTP_PATTERN, verifySignupOtp } from './lib/emailOtp';

const demoNow = Date.now();
const demoReadings = Array.from({ length: 48 }, (_, i) => ({
  id: `demo-${i}`,
  temperature: Number((25.8 + Math.sin(i / 3.4) * 0.45 + Math.cos(i / 4.2) * 0.15).toFixed(2)),
  ph_level: Number((7.2 + Math.sin(i / 3.8) * 0.18 + Math.cos(i / 3.1) * 0.05).toFixed(2)),
  source: 'simulation',
  created_at: new Date(demoNow - (47 - i) * 30 * 60 * 1000).toISOString()
}));

const DEFAULT_LIMITS = { temp_min: 22, temp_max: 28, ph_min: 6.5, ph_max: 7.8, device_timeout_seconds: 300 };
const MODULE_ROUTES = {
  Overview: 'dashboard',
  'Sensor Readings': 'sensor-history',
  'Device Status': 'device-settings',
  Alerts: 'alerts',
  Explore: 'explore',
  'Fish Encyclopedia': 'fish-encyclopedia',
  Reports: 'reports',
  'Care Planner': 'care-planner',
};
const moduleFromLocation = () => {
  const slug = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return Object.entries(MODULE_ROUTES).find(([, route]) => route === slug)?.[0] || 'Overview';
};
const FISH_GUIDE = [
  { name: 'Goldfish', scientific: 'Carassius auratus', group: 'Coldwater', size: '20–30 cm (varies by type)', tank: 'At least 150 L for one fancy goldfish; larger for common types', temperature: '18–24 °C', ph: '6.5–7.5', temperament: 'Peaceful; do not mix with tropical fish', diet: 'Omnivore: quality pellets, vegetables, and occasional protein', note: 'Produces substantial waste and needs strong filtration and generous swimming space.' },
  { name: 'Betta', scientific: 'Betta splendens', group: 'Tropical', size: '5–7 cm', tank: 'At least 19 L for one adult', temperature: '25–28 °C', ph: '6.5–7.5', temperament: 'Males are territorial; tankmates need careful selection', diet: 'Carnivore: betta pellets and suitable frozen foods', note: 'Provide a heated, filtered tank with gentle flow and access to the surface.' },
  { name: 'Guppy', scientific: 'Poecilia reticulata', group: 'Tropical community', size: '3–6 cm', tank: 'At least 40 L for a small group', temperature: '22–28 °C', ph: '7.0–8.0', temperament: 'Peaceful and social; breeds readily', diet: 'Omnivore: small quality flakes or pellets with varied supplements', note: 'Keep a group and plan for frequent fry if males and females share a tank.' },
  { name: 'Neon tetra', scientific: 'Paracheirodon innesi', group: 'Tropical shoaling', size: '3–4 cm', tank: 'At least 60 L for a shoal', temperature: '22–26 °C', ph: '5.5–7.5', temperament: 'Peaceful; keep in a shoal of six or more', diet: 'Omnivore: fine foods sized for a small fish', note: 'Use a mature, stable aquarium and avoid housing with large predatory fish.' },
  { name: 'Bronze cory', scientific: 'Corydoras aeneus', group: 'Tropical shoaling', size: '5–7 cm', tank: 'At least 75 L for a group', temperature: '22–28 °C', ph: '6.0–7.5', temperament: 'Peaceful bottom-dweller; keep with its own kind', diet: 'Omnivore: sinking foods and varied frozen or prepared foods', note: 'Use smooth substrate and keep a group; it still needs targeted feeding.' },
  { name: 'Zebra danio', scientific: 'Danio rerio', group: 'Active community', size: '4–5 cm', tank: 'At least 75 L for an active shoal', temperature: '18–25 °C', ph: '6.5–7.5', temperament: 'Peaceful but fast; keep in a group of six or more', diet: 'Omnivore: small prepared foods with varied supplements', note: 'Needs open swimming space and may outcompete slower fish at feeding time.' },
  { name: 'Platy', scientific: 'Xiphophorus maculatus', group: 'Livebearer', size: '5-7 cm', tank: 'At least 60 L for a small group', temperature: '20-26 C', ph: '7.0-8.2', temperament: 'Peaceful; keep with calm community fish', diet: 'Omnivore: flakes or micro pellets with vegetable matter', note: 'Hardy, active fish that breed readily. Plan for fry or keep a single-sex group.' },
  { name: 'Molly', scientific: 'Poecilia sphenops', group: 'Livebearer', size: '6-10 cm', tank: 'At least 75 L for a small group', temperature: '24-28 C', ph: '7.5-8.5', temperament: 'Generally peaceful; give room to swim', diet: 'Omnivore with a strong plant component', note: 'Prefers mineral-rich, alkaline water. Avoid sudden changes and overcrowding.' },
  { name: 'Swordtail', scientific: 'Xiphophorus hellerii', group: 'Livebearer', size: '8-12 cm', tank: 'At least 90 L for a group', temperature: '22-28 C', ph: '7.0-8.4', temperament: 'Active; males may chase one another', diet: 'Omnivore: quality flakes, pellets, and vegetable foods', note: 'Provide a covered tank and open swimming space; this species can jump.' },
  { name: 'Harlequin rasbora', scientific: 'Trigonostigma heteromorpha', group: 'Tropical shoaling', size: '4-5 cm', tank: 'At least 60 L for a shoal of eight or more', temperature: '22-28 C', ph: '5.5-7.5', temperament: 'Peaceful shoaling fish', diet: 'Omnivore: small flakes, micro pellets, and tiny frozen foods', note: 'Keep in a group with plants and calm tankmates.' },
  { name: 'Cherry barb', scientific: 'Puntius titteya', group: 'Tropical community', size: '4-5 cm', tank: 'At least 60 L for a group', temperature: '22-27 C', ph: '6.0-7.5', temperament: 'Peaceful; keep a group with more females than males', diet: 'Omnivore: small prepared foods and occasional frozen foods', note: 'A gentle barb that benefits from planted cover and a calm community.' },
  { name: 'Honey gourami', scientific: 'Trichogaster chuna', group: 'Labyrinth fish', size: '5-6 cm', tank: 'At least 40 L for a pair or small group', temperature: '24-28 C', ph: '6.0-7.5', temperament: 'Peaceful and easily intimidated', diet: 'Omnivore: small pellets, flakes, and frozen foods', note: 'Likes calm, planted aquariums and access to the water surface.' },
  { name: 'Angelfish', scientific: 'Pterophyllum scalare', group: 'Cichlid', size: 'Up to 15 cm body length; taller with fins', tank: 'At least 200 L for a compatible adult group', temperature: '26-30 C', ph: '6.0-7.5', temperament: 'Can become territorial; may eat very small fish', diet: 'Omnivore: quality cichlid pellets and varied frozen foods', note: 'Choose a tall aquarium and avoid tiny tankmates.' },
  { name: 'Discus', scientific: 'Symphysodon aequifasciatus', group: 'South American cichlid', size: 'Up to 20 cm', tank: 'At least 250 L for a group of adults', temperature: '28-30 C', ph: '6.0-7.5', temperament: 'Generally peaceful; keep in a group', diet: 'Omnivore: varied quality pellets and frozen foods', note: 'Needs warm, clean, stable water and careful attention to water quality.' },
  { name: 'Bristlenose pleco', scientific: 'Ancistrus cirrhosus', group: 'Armored catfish', size: '10-15 cm', tank: 'At least 75 L for one adult', temperature: '23-27 C', ph: '6.0-7.5', temperament: 'Usually peaceful; may be territorial with its own kind', diet: 'Omnivore: algae wafers and vegetables; provide driftwood', note: 'Aquarium algae alone is not enough; provide supplemental food and hiding places.' },
  { name: 'Kuhli loach', scientific: 'Pangio kuhlii', group: 'Bottom-dwelling loach', size: '8-10 cm', tank: 'At least 75 L for a group of six or more', temperature: '24-28 C', ph: '5.5-7.0', temperament: 'Peaceful, shy, and nocturnal', diet: 'Omnivore: small sinking pellets and frozen foods', note: 'Use soft substrate, a secure lid, and plenty of hiding places.' },
  { name: 'Otocinclus catfish', scientific: 'Otocinclus vittatus', group: 'Dwarf catfish', size: '3-5 cm', tank: 'At least 60 L in a mature, established aquarium', temperature: '22-26 C', ph: '6.0-7.5', temperament: 'Peaceful shoaling fish; keep in a group', diet: 'Algae and biofilm, supplemented with suitable algae foods', note: 'Sensitive to transport and immature tanks; ensure food is available before adding.' },
  { name: 'Clown loach', scientific: 'Chromobotia macracanthus', group: 'Large shoaling loach', size: 'Can exceed 25 cm', tank: 'Very large aquarium; plan for 450 L or more as adults', temperature: '25-30 C', ph: '6.0-7.5', temperament: 'Social and active; keep in a group', diet: 'Omnivore: sinking foods, vegetables, and frozen foods', note: 'Grows large and lives for many years; unsuitable for small community tanks.' },
  { name: 'Oscar', scientific: 'Astronotus ocellatus', group: 'Large cichlid', size: '25-35 cm', tank: 'At least 280 L for one adult, with powerful filtration', temperature: '24-28 C', ph: '6.0-8.0', temperament: 'Predatory and territorial; choose tankmates carefully', diet: 'Omnivore: formulated cichlid pellets and appropriate frozen foods', note: 'Produces heavy waste and rearranges its environment; use robust decor.' },
  { name: 'Clownfish', scientific: 'Amphiprion ocellaris', group: 'Marine reef fish', size: '7-11 cm', tank: 'At least 75 L for a pair in a cycled marine aquarium', temperature: '24-27 C', ph: '8.0-8.4', temperament: 'Can defend a territory, especially around a host', diet: 'Omnivore: marine pellets and varied frozen foods', note: 'Requires stable saltwater conditions; freshwater care ranges do not apply.' },
  { name: 'Royal gramma', scientific: 'Gramma loreto', group: 'Marine reef fish', size: '7-8 cm', tank: 'At least 75 L in a mature marine aquarium', temperature: '24-27 C', ph: '8.1-8.4', temperament: 'Generally peaceful but territorial around its cave', diet: 'Carnivore: small marine pellets and frozen meaty foods', note: 'Provide caves and a tightly fitted lid; it may jump when startled.' },
  { name: 'Yellow tang', scientific: 'Zebrasoma flavescens', group: 'Marine surgeonfish', size: 'Up to 20 cm', tank: 'At least 380 L with long, open swimming space', temperature: '24-27 C', ph: '8.1-8.4', temperament: 'May be territorial toward other tangs', diet: 'Herbivore: marine algae and seaweed-based foods', note: 'Needs a large, mature marine system and frequent access to algae.' },
];
const fmtTime = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const validDate = value => value && !Number.isNaN(new Date(value).getTime());
const toLocalDateTime = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const dateForFilename = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const triggerFileDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const markdownComponents = {
  table: ({ node, children, ...props }) => <div className="chat-markdown-table-wrap"><table {...props}>{children}</table></div>,
  img: ({ alt }) => <span className="chat-markdown-image-alt">[Image: {alt || 'Aquarium Resource'}]</span>,
  pre: ({ children }) => {
    const code = React.Children.toArray(children).find(child => React.isValidElement(child) && child.type === 'code');
    const language = code?.props?.className?.match(/language-([\w-]+)/)?.[1];
    return <div className="chat-code-block">{language && <div className="chat-code-language">{language}</div>}<pre>{children}</pre></div>;
  },
};

const createExploreMessageId = () => globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createExploreChat = () => ({ id: createExploreMessageId(), title: 'New chat', updatedAt: new Date().toISOString(), messages: [{ id: 'aqua-welcome', role: 'assistant', content: 'Greetings! I am **AquaSense AI**. How can I help optimize your water chemistry, heating schedules, or fish care today?' }] });
const copyTextToClipboard = async text => {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand?.('copy');
  field.remove();
  if (!copied) throw new Error('Clipboard access is unavailable.');
};

function StatusPill({ children, tone = 'good' }) {
  return <span className={`status-pill ${tone}`}><span className="status-dot" />{children}</span>;
}

function ModernChartTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const point = payload.find(item => item?.payload?.created_at)?.payload;
  const value = payload.find(item => Number.isFinite(Number(item?.value)))?.value;
  if (!point || value == null) return null;
  return (
    <div className="chart-tooltip">
      <span>{new Date(point.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <strong>{Number(value).toFixed(2)} {unit}</strong>
      <small>Source: {point.source || 'telemetry'}</small>
    </div>
  );
}

function TrendChartCard({ title, subtitle, value, unit, dataKey, data, color, gradientId, icon: Icon, iconColor }) {
  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title-row">
            <h2>{title}</h2>
          </div>
          <p>{subtitle}</p>
        </div>
        <span className="chart-icon"><Icon size={18} style={iconColor ? { color: iconColor } : undefined} /></span>
      </div>
      <div className="chart-area">
        {data.length ? <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis
              type="number"
              dataKey="timestamp"
              domain={['dataMin', 'dataMax']}
              tickFormatter={t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              tickCount={5}
            />
            <Tooltip content={<ModernChartTooltip unit={unit} />} />
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, fill: color }} />
          </AreaChart>
        </ResponsiveContainer> : (
          <div className="chart-empty"><Waves size={20} /><span>Waiting for sensor readings. The chart will populate when data arrives.</span></div>
        )}
      </div>
    </section>
  );
}

function AuthLoadingScreen({ title = 'Signing in securely', detail = 'Verifying account access' }) {
  return (
    <div className="auth-loading-screen" role="status" aria-live="polite">
      <div className="auth-loading-scene" aria-hidden="true">
        <Fish className="loading-fish" size={54} strokeWidth={1.4} />
        <i className="loading-ripple" />
        <i className="loading-bubble loading-bubble-one" />
        <i className="loading-bubble loading-bubble-two" />
      </div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function makeComputedAlerts(latest, limits, deviceOnline) {
  const alerts = [];
  if (latest) {
    const t = Number(latest.temperature), p = Number(latest.ph_level);
    if (t < limits.temp_min || t > limits.temp_max) {
      alerts.push({
        id: `temp-${latest.id}`,
        alert_type: 'temperature',
        severity: 'medium',
        message: `Water temperature is ${t.toFixed(1)}°C, outside configured limits (${limits.temp_min}–${limits.temp_max}°C).`,
        created_at: latest.created_at
      });
    }
    if (p < limits.ph_min || p > limits.ph_max) {
      alerts.push({
        id: `ph-${latest.id}`,
        alert_type: 'ph',
        severity: 'medium',
        message: `pH is ${p.toFixed(2)}, outside safe threshold (${limits.ph_min}–${limits.ph_max}).`,
        created_at: latest.created_at
      });
    }
  }
  if (deviceOnline === false) {
    alerts.push({
      id: 'device-offline',
      alert_type: 'device_offline',
      severity: 'critical',
      message: 'ESP32 telemetry interrupted. No heartbeat received within the threshold window.',
      created_at: new Date().toISOString()
    });
  }
  return alerts;
}

function isAdminPortalRoute(pathname = window.location.pathname, hash = window.location.hash) {
  return pathname === '/admin' || pathname.startsWith('/admin/') || hash === '#/admin' || hash.startsWith('#/admin/');
}

function LoginPage({ onLogin, onAuthAttempt, adminPortal = false, initialError = '' }) {
  const [loginFishFact] = useState(() => FISH_GUIDE[Math.floor(Math.random() * FISH_GUIDE.length)]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [registering, setRegistering] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  const verificationRequest = useRef(false);

  useEffect(() => {
    const handlePageShow = event => {
      if (!event.persisted) return;
      setBusy(false);
      setError('');
      void supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setResendSeconds(seconds => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds > 0]);

  const handleSubmit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    onAuthAttempt?.(true);
    const startedAt = Date.now();
    let authenticatedUser = null;
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        setError('Email or password is incorrect.');
      } else {
        const { data: admin, error: adminError } = await supabase.from('aquasense_admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
        if (adminError) {
          await supabase.auth.signOut();
          setError('Could not verify your account role. Please try again.');
        } else {
          const aquasenseRole = resolveAquaSenseRole(admin, null);
          const hasExpectedRole = adminPortal ? aquasenseRole === 'admin' : aquasenseRole === 'user';
          if (!hasExpectedRole) {
            await supabase.auth.signOut();
            setError(adminPortal
              ? 'This account is not an administrator. Use the user sign-in page.'
              : 'This is an administrator account. Use the administrator sign-in page.');
          } else if (adminPortal && !hasPasswordAuthMethod(data.session?.access_token)) {
            await supabase.auth.signOut();
            setError('Administrator sign-in requires your email and password.');
          } else authenticatedUser = { ...data.user, aquasenseRole };
        }
      }
    } catch (err) {
      setError(err?.message || 'Sign-in failed.');
    }
    await new Promise(resolve => window.setTimeout(resolve, Math.max(0, 3000 - (Date.now() - startedAt))));
    onAuthAttempt?.(false);
    if (authenticatedUser) onLogin(authenticatedUser);
    else setBusy(false);
  };

  const completeRegularSignup = async (user, session) => {
    const { data: membership, error: membershipError } = await supabase
      .from('aquasense_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipError) {
      await supabase.auth.signOut({ scope: 'local' });
      setError('Could not verify your account role. Please sign in again.');
      return;
    }
    const aquasenseRole = resolveAquaSenseRole(membership, null);
    if (aquasenseRole !== 'user' || (adminPortal && !hasPasswordAuthMethod(session?.access_token))) {
      await supabase.auth.signOut({ scope: 'local' });
      setError('Administrator accounts must use the administrator sign-in page.');
      return;
    }
    onLogin({ ...user, aquasenseRole });
  };

  const submitRegistration = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const signupEmail = email.trim();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: signupEmail,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (signUpError) throw signUpError;
      if (data.session && data.user) {
        await completeRegularSignup(data.user, data.session);
      } else if (data.user) {
        setVerificationEmail(signupEmail);
        setOtp('');
        setResendSeconds(60);
        setError('');
      } else {
        setError('A verification request could not be started. Check the email address and try again.');
      }
    } catch (err) {
      setError(err?.message || 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitSignupOtp = async event => {
    event.preventDefault();
    const token = otp.trim();
    if (!SIGNUP_OTP_PATTERN.test(token)) {
      setError('Enter the 6–12 digit code from your email.');
      return;
    }
    if (verificationRequest.current) return;
    verificationRequest.current = true;
    setBusy(true); setError('');
    try {
      const { data, error: verifyError } = await verifySignupOtp(supabase, verificationEmail, token);
      if (verifyError) throw verifyError;
      if (data.user && data.session) {
        await completeRegularSignup(data.user, data.session);
      } else {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (sessionData.session?.user) {
          await completeRegularSignup(sessionData.session.user, sessionData.session);
        } else {
          setVerificationEmail('');
          setRegistering(false);
          setOtp('');
          setError('Email verified. Sign in with your email and password to continue.');
        }
      }
    } catch (err) {
      setError(err?.message || 'The code could not be verified. Request a new code and try again.');
    } finally {
      verificationRequest.current = false;
      setBusy(false);
    }
  };

  const resendSignupCode = async () => {
    if (!verificationEmail || resendSeconds > 0 || verificationRequest.current) return;
    verificationRequest.current = true;
    setBusy(true); setError('');
    try {
      const { error: resendError } = await resendSignupOtp(supabase, verificationEmail);
      if (resendError) throw resendError;
      setOtp('');
      setResendSeconds(60);
      setError('A new verification code was requested. Check your inbox and spam folder.');
    } catch (err) {
      setError(err?.message || 'Could not resend the verification code. Please try again later.');
    } finally {
      verificationRequest.current = false;
      setBusy(false);
    }
  };

  const startSocialSignIn = async provider => {
    if (!canOfferSocialLogin(adminPortal, registering) || !SOCIAL_LOGIN_PROVIDERS.includes(provider)) return;
    setBusy(true);
    setError('');
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError) {
      setError(oauthError?.message || `Could not start ${provider} sign-in.`);
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen auth-screen-split">
      <div className="auth-ocean-scene" aria-hidden="true">
        <i className="auth-bubble auth-bubble-one" />
        <i className="auth-bubble auth-bubble-two" />
        <i className="auth-bubble auth-bubble-three" />
        <i className="auth-bubble auth-bubble-four" />
        <i className="auth-bubble auth-bubble-five" />
        <i className="auth-bubble auth-bubble-six" />
      </div>
      {busy && <AuthLoadingScreen />}
      <div className="auth-split-layout">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark"><img src="/images/aquasense-logo.png" alt="" aria-hidden="true" /></div>
          <div><strong>AquaSense</strong><small>AQUARIUM INTELLIGENCE</small></div>
        </div>
        {adminPortal && <div className="login-portal-label">ADMINISTRATOR PORTAL</div>}
        <h1>{verificationEmail ? 'Verify your email' : registering ? 'Create your account' : adminPortal ? 'Administrator sign in' : 'Welcome back'}</h1>
        <p className="auth-description">{verificationEmail ? 'Enter the numeric verification code sent to your email to finish creating your AquaSense account.' : registering ? 'Create an account to monitor your aquarium.' : adminPortal ? 'Sign in to manage AquaSense accounts and platform data.' : 'Sign in to view and manage your aquarium.'}</p>
        {!verificationEmail && canOfferSocialLogin(adminPortal, registering) && isSupabaseConfigured && (
          <div className="social-login-options" aria-label="Social sign-in options">
            <button type="button" className="social-login-button" onClick={() => void startSocialSignIn('google')} disabled={busy}>
              <GoogleMark /> <span>Continue with Google</span>
            </button>
            <button type="button" className="social-login-button" onClick={() => void startSocialSignIn('facebook')} disabled={busy}>
              <FacebookMark /> <span>Continue with Facebook</span>
            </button>
          </div>
        )}
        {!verificationEmail && canOfferSocialLogin(adminPortal, registering) && isSupabaseConfigured && (
          <div className="auth-divider" role="separator" aria-label="or"><span>or</span></div>
        )}
        {!isSupabaseConfigured ? (
          <div className="auth-error" role="alert">Supabase not configured in .env.local</div>
        ) : (
          verificationEmail ? <div className="signup-verification">
            <p className="verification-destination">Verification code sent to <strong>{maskEmailAddress(verificationEmail)}</strong></p>
            <form onSubmit={submitSignupOtp}>
              <label htmlFor="signup-otp">Email verification code</label>
              <input id="signup-otp" type="text" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="Enter your code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} aria-describedby="signup-otp-help" required />
              <small id="signup-otp-help">Enter the 6–12 digit code from your signup email.</small>
              {error && <div className="auth-error" role="status">{error}</div>}
              <button className="auth-submit" type="submit" disabled={busy || !SIGNUP_OTP_PATTERN.test(otp.trim())}>
                <span>{busy ? 'Verifying...' : 'Verify email'}</span>
                <Fish className="auth-submit-fish" size={16} aria-hidden="true" />
              </button>
            </form>
            <button type="button" className="auth-switch" onClick={() => void resendSignupCode()} disabled={busy || resendSeconds > 0}>
              {busy ? 'Please wait...' : resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : 'Resend verification code'}
            </button>
            <button type="button" className="auth-switch" disabled={busy} onClick={() => { setVerificationEmail(''); setOtp(''); setError(''); setRegistering(true); }}>Return to signup</button>
          </div> : <form onSubmit={registering ? submitRegistration : handleSubmit}>
            <label htmlFor="login-email">Email Address</label>
            <input id="login-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="username" required />
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" autoComplete={registering ? 'new-password' : 'current-password'} required />
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>
              <span className="auth-crab" aria-hidden="true">
                <svg viewBox="0 0 72 56" role="presentation">
                  <path className="crab-limbs" d="M20 34 9 29 4 21m48 13 11-5 5-8M23 39l-9 5-5 7m40-12 9 5 5 7M29 41l-4 8m18-8 4 8M19 19l-5-7m44 7 5-7" />
                  <path className="crab-claws" d="M3 20c-3-4-2-8 2-9 4-1 7 2 7 6l-4 5zm66 0c3-4 2-8-2-9-4-1-7 2-7 6l4 5z" />
                  <path className="crab-shell" d="M17 31c1-10 8-16 19-16s18 6 19 16c-4 7-11 10-19 10s-15-3-19-10z" />
                  <path className="crab-eyestalks" d="M27 18v-5m18 5v-5" />
                  <circle cx="27" cy="11" r="2.4" fill="#f5fffc" />
                  <circle cx="45" cy="11" r="2.4" fill="#f5fffc" />
                  <circle cx="27" cy="11" r="1" fill="#123b4b" />
                  <circle cx="45" cy="11" r="1" fill="#123b4b" />
                </svg>
              </span>
              <span>{busy ? 'Please wait...' : registering ? 'Create account' : 'Sign in'}</span>
              <Fish className="auth-submit-fish" size={16} aria-hidden="true" />
            </button>
          </form>
        )}
        {!adminPortal && !verificationEmail && <button type="button" className="auth-switch" onClick={() => { setRegistering(value => !value); setError(''); }}>{registering ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}</button>}
        {adminPortal && <p className="auth-footnote"><ShieldCheck size={14} /> Administrator access is verified securely</p>}
        {adminPortal && <a className="login-portal-switch" href="#/login">Go to user sign in</a>}
      </section>
      <aside className="auth-promo" aria-label="AquaSense aquarium monitoring">
        <div className="auth-promo-content">
          <span className="auth-promo-kicker">FISH FACT / {loginFishFact.group.toUpperCase()}</span>
          <h2><span className="auth-promo-title-intro">Meet the</span><br /><span>{loginFishFact.name}</span></h2>
          <p>{loginFishFact.note}</p>
        </div>
        <span className="auth-promo-caption"><span>SCIENTIFIC NAME</span><em>{loginFishFact.scientific}</em></span>
      </aside>
      </div>
    </main>
  );
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="social-provider-mark"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3A12 12 0 1 1 32 15.1l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5Z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 32 15.1l5.7-5.7A20 20 0 0 0 6.3 14.7Z"/><path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.2A12 12 0 0 1 12.9 29l-6.5 5A20 20 0 0 0 24 44Z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.6l6.2 5.2A20 20 0 0 0 44 24c0-1.2-.1-2.4-.4-3.5Z"/></svg>;
}

function FacebookMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="social-provider-mark"><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.875 11.85v-8.38H7.08V12h3.045V9.356c0-3.006 1.792-4.668 4.532-4.668 1.312 0 2.686.234 2.686.234v2.953h-1.513c-1.49 0-1.955.925-1.955 1.874V12h3.328l-.532 3.47h-2.796v8.38A12.002 12.002 0 0 0 24 12Z"/><path fill="#FFF" d="m16.67 15.47.532-3.47h-3.328V9.749c0-.95.465-1.874 1.955-1.874h1.513V4.922s-1.374-.234-2.686-.234c-2.74 0-4.532 1.662-4.532 4.668V12H7.08v3.47h3.045v8.38a12.1 12.1 0 0 0 3.75 0v-8.38h2.795Z"/></svg>;
}

export default function App() {
  const [auth, setAuth] = useState({ ready: false, user: null });
  const [locationHash, setLocationHash] = useState(() => window.location.hash);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [appInstalled, setAppInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
  const logoutInProgress = useRef(false);
  const loginAttemptPending = useRef(false);

  useEffect(() => {
    const syncHash = () => setLocationHash(window.location.hash);
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  useEffect(() => {
    if (auth.user?.aquasenseRole === 'admin' && !isAdminPortalRoute(window.location.pathname, locationHash)) {
      window.location.hash = '#/admin';
    }
  }, [auth.user?.id, auth.user?.aquasenseRole, locationHash]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const captureInstallPrompt = event => { event.preventDefault(); setInstallPrompt(event); };
    const markInstalled = () => { setAppInstalled(true); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    window.addEventListener('appinstalled', markInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) {
      const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      window.alert(isAppleMobile
        ? 'To add AquaSense to your Home Screen, open this page in Safari, tap Share, then choose Add to Home Screen.'
        : 'Open your browser menu and choose Install AquaSense or Add to Home Screen.');
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === 'accepted') setInstallPrompt(null);
  };

  useEffect(() => {
    if (!isSupabaseConfigured) { setAuth({ ready: true, user: null }); return; }
    let active = true;
    let verification = 0;
    const verifySession = async session => {
      const request = ++verification;
      const user = session?.user;
      if (!user) {
        if (active && request === verification) {
          setAuth(current => ({ ready: true, user: null, loginError: current.loginError || '' }));
        }
        return;
      }
      const { data, error } = await supabase.from('aquasense_admins').select('user_id').eq('user_id', user.id).maybeSingle();
      if (!active || request !== verification) return;
      if (error) {
        setAuth({ ready: true, user: null });
        setTimeout(() => supabase.auth.signOut(), 0);
        return;
      }
      const aquasenseRole = resolveAquaSenseRole(data, null);
      if (aquasenseRole === 'admin' && !hasPasswordAuthMethod(session?.access_token)) {
        const loginError = 'Administrator accounts must use the administrator sign-in page with email and password.';
        setAuth({ ready: true, user: null, loginError });
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }
      setAuth({ ready: true, user: { ...user, aquasenseRole } });
    };

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'SIGNED_IN' && loginAttemptPending.current) return;
      if (_event === 'SIGNED_OUT' && logoutInProgress.current) return;
      setTimeout(() => verifySession(session), 0);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) { setAuth({ ready: true, user: null }); return; }
      verifySession(data.session);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const handleSignOut = async () => {
    if (logoutInProgress.current) return;
    logoutInProgress.current = true;
    setAuth(current => ({ ...current, signingOut: true }));
    const startedAt = Date.now();
    try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
    await new Promise(resolve => window.setTimeout(resolve, Math.max(0, 3000 - (Date.now() - startedAt))));
    logoutInProgress.current = false;
    setAuth({ ready: true, user: null, signingOut: false });
  };

  useEffect(() => {
    if (!auth.user) return;
    // Keep the first browser Back action inside this document so it can clear
    // the local Supabase session before the user returns to the previous page.
    if (!window.history.state?.aquasenseAuthGuard) {
      window.history.pushState({ ...(window.history.state || {}), aquasenseAuthGuard: true, moduleName: moduleFromLocation() }, '', window.location.href);
    }
    const handleBackNavigation = () => {
      setAuth({ ready: true, user: null });
      const isAdminPath = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
      const appPath = isAdminPath ? '/' : window.location.pathname;
      window.history.replaceState(null, '', `${appPath}${window.location.search}#/login`);
      setLocationHash('#/login');
      void supabase.auth.signOut({ scope: 'local' });
    };
    window.addEventListener('popstate', handleBackNavigation);
    return () => window.removeEventListener('popstate', handleBackNavigation);
  }, [auth.user?.id]);

  if (!auth.ready) return <main className="auth-screen"><AuthLoadingScreen title="Checking your session" detail="Restoring your secure session" /></main>;
  const adminRoute = isAdminPortalRoute(window.location.pathname, locationHash);
  if (!auth.user) return <LoginPage adminPortal={adminRoute} initialError={auth.loginError || ''} onLoginAttempt={pending => { loginAttemptPending.current = pending; }} onLogin={user => setAuth({ ready: true, user })} />;
  if (auth.user.aquasenseRole === 'admin' && !adminRoute) {
    return <main className="auth-screen"><AuthLoadingScreen title="Opening administrator console" detail="Taking you to the administrator portal" /></main>;
  }
  if (adminRoute && !canAccessAdminRoute(auth.user.aquasenseRole)) return <AccessDenied />;

  return <>
    {adminRoute
      ? <AdminDashboard user={auth.user} onSignOut={handleSignOut} />
      : <Dashboard user={auth.user} onSignOut={handleSignOut} appInstalled={appInstalled} onInstallApp={handleInstallApp} />}
    {auth.signingOut && <AuthLoadingScreen title="Signing out securely" detail="Closing your administrator session–" />}
  </>;
}

function AccessDenied() {
  return <main className="auth-screen"><section className="auth-card"><h1>Access denied</h1><p className="auth-description">Administrator access is required for this page.</p><a className="auth-submit admin-denied-link" href="#/dashboard">Return to your dashboard</a></section></main>;
}

function Dashboard({ user, onSignOut, appInstalled, onInstallApp }) {
  const [announcements, setAnnouncements] = useState([]);
  useEffect(() => {
    let active = true;
    const loadAnnouncements = async () => {
      if (!isSupabaseConfigured) return;
      try {
        const result = await callAquaSenseAdmin('list_announcements');
        if (active) setAnnouncements(Array.isArray(result.announcements) ? result.announcements.slice(0, 3) : []);
      } catch { if (active) setAnnouncements([]); }
    };
    void loadAnnouncements();
    const interval = window.setInterval(loadAnnouncements, 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [user.id]);
  const adminDisplayName = [
    user?.user_metadata?.full_name,
    user?.user_metadata?.name,
    user?.user_metadata?.display_name
  ].find(value => typeof value === 'string' && value.trim())?.trim()
    || user?.email?.split('@')[0]
    || 'Administrator';
  const adminInitials = adminDisplayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('aquasense-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth > 820);
  useEffect(() => {
    const syncSidebarForViewport = () => setSidebarCollapsed(window.innerWidth > 820);
    window.addEventListener('resize', syncSidebarForViewport);
    return () => window.removeEventListener('resize', syncSidebarForViewport);
  }, []);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [renameChatId, setRenameChatId] = useState(null);
  const [renameChatDraft, setRenameChatDraft] = useState('');
  const renameChatInputRef = useRef(null);
  const [deleteChatTarget, setDeleteChatTarget] = useState(null);
  useEffect(() => {
    if (!showSignOutConfirm) return;
    const closeOnEscape = event => {
      if (event.key === 'Escape') setShowSignOutConfirm(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showSignOutConfirm]);
  useEffect(() => {
    if (!renameChatId) return;
    renameChatInputRef.current?.focus();
    const closeOnEscape = event => { if (event.key === 'Escape') setRenameChatId(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [renameChatId]);
  useEffect(() => {
    if (!deleteChatTarget) return;
    const closeOnEscape = event => { if (event.key === 'Escape') setDeleteChatTarget(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteChatTarget]);
  const [readings, setReadings] = useState(isSupabaseConfigured ? [] : demoReadings);
  const [historyReadings, setHistoryReadings] = useState(isSupabaseConfigured ? [] : demoReadings);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [exportingFormat, setExportingFormat] = useState(null);
  const [aquariumName, setAquariumName] = useState('Home Aquarium');
  const [aquariumId, setAquariumId] = useState(null);
  const readingsRequestInFlight = useRef(false);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [connectionError, setConnectionError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [range, setRange] = useState('24H');
  const [customStart, setCustomStart] = useState(() => toLocalDateTime(new Date(Date.now() - 86400000)));
  const [customEnd, setCustomEnd] = useState(() => toLocalDateTime(new Date()));
  const [activeNav, setActiveNav] = useState(moduleFromLocation);
  const [fahrenheit, setFahrenheit] = useState(false);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [settingsForm, setSettingsForm] = useState(DEFAULT_LIMITS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());

  // AquaSense AI chat states
  const chatStorageKey = `aquasense-ai-chats-${user?.id || 'demo'}`;
  const [exploreChats, setExploreChats] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(chatStorageKey)); if (Array.isArray(saved) && saved.length) return saved; } catch {}
    return [createExploreChat()];
  });
  const [activeExploreChatId, setActiveExploreChatId] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(chatStorageKey)); if (Array.isArray(saved) && saved.length) return saved[0].id; } catch {}
    return null;
  });
  const [chatSearch, setChatSearch] = useState('');
  const exploreMessages = exploreChats.find(chat => chat.id === activeExploreChatId)?.messages || exploreChats[0]?.messages || [];
  const updateExploreMessages = updater => setExploreChats(chats => chats.map(chat => chat.id === activeExploreChatId ? { ...chat, messages: typeof updater === 'function' ? updater(chat.messages) : updater, updatedAt: new Date().toISOString() } : chat));
  const [exploreInput, setExploreInput] = useState('');
  const [exploreBusy, setExploreBusy] = useState(false);
  const exploreMessagesEndRef = useRef(null);
  useEffect(() => {
    if (!activeExploreChatId && exploreChats[0]) setActiveExploreChatId(exploreChats[0].id);
  }, [activeExploreChatId, exploreChats]);
  useEffect(() => { try { localStorage.setItem(chatStorageKey, JSON.stringify(exploreChats)); } catch {} }, [chatStorageKey, exploreChats]);
  const alertSyncKey = useRef('');
  const notifiedAlertTypes = useRef(null);
  const [savedAlerts, setSavedAlerts] = useState([]);
  const [notificationPermission, setNotificationPermission] = useState(() => 'Notification' in window ? Notification.permission : 'unsupported');
  const [alertFilter, setAlertFilter] = useState('active');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [taskRows, setTaskRows] = useState([]);
  const [taskHistory, setTaskHistory] = useState(false);
  const [selectedTaskDate, setSelectedTaskDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [taskMonth, setTaskMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [taskForm, setTaskForm] = useState({ title: '', task_type: 'feeding', due_at: toLocalDateTime(new Date(Date.now() + 3600000)), recurrence: 'none', notes: '' });
  const [reportRows, setReportRows] = useState([]);
  const [reportPeriod, setReportPeriod] = useState('monthly');
  const [reportFilter, setReportFilter] = useState('latest');
  const [reportBusy, setReportBusy] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [moduleBusy, setModuleBusy] = useState(false);
  const [moduleError, setModuleError] = useState('');
  const [fishSearch, setFishSearch] = useState('');
  const [selectedFish, setSelectedFish] = useState(null);

  const navigateToModule = useCallback(name => {
    const route = MODULE_ROUTES[name];
    if (!route) return;
    const target = `#/${route}`;
    if (window.location.hash !== target) {
      window.history.pushState({ ...(window.history.state || {}), aquasenseAuthGuard: true, moduleName: name }, '', target);
    }
    setActiveNav(name);
    setMobileNavOpen(false);
  }, []);

  useEffect(() => {
    const syncModuleFromHistory = event => {
      const next = event.state?.moduleName || moduleFromLocation();
      if (MODULE_ROUTES[next]) setActiveNav(next);
    };
    window.addEventListener('popstate', syncModuleFromHistory);
    window.addEventListener('hashchange', syncModuleFromHistory);
    return () => {
      window.removeEventListener('popstate', syncModuleFromHistory);
      window.removeEventListener('hashchange', syncModuleFromHistory);
    };
  }, []);

  useEffect(() => {
    if (activeNav === 'Explore') {
      exploreMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [activeNav, exploreMessages, exploreBusy]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try { localStorage.setItem('aquasense-theme', theme); } catch {}
  }, [theme]);

  const fetchReadings = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setReadings(demoReadings); setLastUpdated(new Date().toISOString());
      return;
    }
    // A slow Supabase request must not overlap the next poll or a manual refresh.
    if (readingsRequestInFlight.current) return;
    readingsRequestInFlight.current = true;
    setLoading(true); setConnectionError('');
    try {
      let aquariumQuery = supabase.from('aquariums').select('id, name').order('created_at', { ascending: true }).limit(1);
      if (user?.aquasenseRole === 'admin') aquariumQuery = aquariumQuery.eq('owner_id', user.id);
      const { data: tank, error: tankError } = await aquariumQuery.maybeSingle();
      if (tankError) throw tankError;
      if (!tank) {
        setAquariumId(null); setReadings([]); setHistoryReadings([]);
        setConnectionError('No aquarium is accessible to this account. Ask an administrator to assign your account as owner of the aquarium registered to this ESP32. Existing aquariums are not automatically assigned to an account.');
        return;
      }
      setAquariumId(tank.id); setAquariumName(tank.name || 'Home Aquarium');
      const [settingsResult, readingsResult] = await Promise.all([
        supabase.from('aquarium_settings').select('temp_min, temp_max, ph_min, ph_max, device_timeout_seconds').eq('aquarium_id', tank.id).maybeSingle(),
        supabase.from('sensor_readings').select('id, aquarium_id, temperature, ph_level, source, device_id, created_at').eq('aquarium_id', tank.id).order('created_at', { ascending: false }).limit(100),
      ]);
      if (readingsResult.error) throw readingsResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (settingsResult.data) {
        setLimits(settingsResult.data);
        setSettingsForm(settingsResult.data);
      }
      const nextReadings = (readingsResult.data || []).filter(row => validDate(row.created_at)).reverse();
      setReadings(nextReadings);
      setHistoryReadings(nextReadings);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setConnectionError(err?.message || 'Could not load data.');
    } finally {
      readingsRequestInFlight.current = false;
      setLoading(false);
    }
  }, [user?.id, user?.aquasenseRole]);

  useEffect(() => {
    fetchReadings();
    if (!isSupabaseConfigured) return undefined;

    // Keep the dashboard and sensor history current as the ESP32 writes new rows.
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchReadings();
    }, 15000);
    return () => window.clearInterval(refreshTimer);
  }, [fetchReadings]);

  const latest = readings.length ? readings[readings.length - 1] : null;
  const deviceTimeout = Number(limits.device_timeout_seconds || 300);
  const lastDeviceSeen = readings.filter(r => r.source === 'esp32').at(-1)?.created_at || null;
  const deviceAgeSeconds = lastDeviceSeen ? Math.max(0, (clockNow - new Date(lastDeviceSeen).getTime()) / 1000) : Infinity;
  const deviceOnline = isSupabaseConfigured && aquariumId ? (Number.isFinite(deviceAgeSeconds) && deviceAgeSeconds <= deviceTimeout) : null;
  const activeAlerts = useMemo(() => makeComputedAlerts(latest, limits, deviceOnline), [latest, limits, deviceOnline]);

  useEffect(() => {
    if (!aquariumId || loading) return;
    const activeTypes = new Set(activeAlerts.map(alert => alert.alert_type));
    if (notifiedAlertTypes.current === null) {
      notifiedAlertTypes.current = activeTypes;
      return;
    }
    const newAlerts = activeAlerts.filter(alert => !notifiedAlertTypes.current.has(alert.alert_type));
    notifiedAlertTypes.current = activeTypes;
    if (!newAlerts.length || !('Notification' in window) || Notification.permission !== 'granted') return;

    const sendNotifications = async () => {
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null;
      newAlerts.forEach(alert => {
        const title = `${alert.alert_type.replaceAll('_', ' ')} alert`;
        const options = { body: alert.message, icon: '/images/aquasense-pwa.svg', badge: '/images/aquasense-pwa.svg', tag: `aquasense-${alert.alert_type}`, data: { url: '/#/alerts' } };
        if (registration) registration.showNotification(title, options);
        else {
          const notification = new Notification(title, options);
          notification.onclick = () => { window.focus(); navigateToModule('Alerts'); notification.close(); };
        }
      });
    };
    void sendNotifications().catch(() => {});
  }, [activeAlerts, aquariumId, loading, navigateToModule]);

  const measurement = val => (val == null || !Number.isFinite(Number(val)) ? null : Number(val));
  const rawTemp = latest ? measurement(latest.temperature) : null;
  const rawPh = latest ? measurement(latest.ph_level) : null;
  const displayTemp = rawTemp == null ? '–' : fahrenheit ? (rawTemp * 9 / 5 + 32).toFixed(1) : rawTemp.toFixed(1);
  const tempUnit = fahrenheit ? '°F' : '°C';

  const chartData = useMemo(() => {
    return (isSupabaseConfigured ? historyReadings : demoReadings).map(row => ({
      ...row,
      timestamp: new Date(row.created_at).getTime(),
      temperature: measurement(row.temperature),
      ph_level: measurement(row.ph_level)
    }));
  }, [historyReadings]);

  const alertBadgeCount = savedAlerts.length
    ? savedAlerts.filter(alert => alert.status === 'active' && alert.severity === 'critical').length
    : activeAlerts.filter(alert => alert.severity === 'critical').length;

  const enableNotifications = async () => {
    if (!('Notification' in window)) { setNotificationPermission('unsupported'); return; }
    if (Notification.permission !== 'default') { setNotificationPermission(Notification.permission); return; }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };
  const navItems = [
    { name: 'Overview', label: 'Dashboard', icon: LayoutDashboard },
    { name: 'Sensor Readings', label: 'Sensor History', icon: Activity },
    { name: 'Device Status', label: 'Device & Settings', icon: Cpu },
    { name: 'Alerts', label: 'Alerts', icon: Bell, badge: alertBadgeCount },
    { name: 'Explore', label: 'AquaSense AI', icon: Sparkles },
    { name: 'Fish Encyclopedia', label: 'Fish Encyclopedia', icon: BookOpen },
    { name: 'Reports', label: 'Reports', icon: FileSpreadsheet },
    { name: 'Care Planner', label: 'Care Planner', icon: CalendarCheck2 }
  ];

  const refreshSavedAlerts = useCallback(async () => {
    if (!isSupabaseConfigured || !aquariumId) return;
    const { data, error } = await supabase.from('aquarium_alerts').select('*').eq('aquarium_id', aquariumId).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    setSavedAlerts(data || []);
  }, [aquariumId]);

  const loadModuleData = useCallback(async () => {
    if (!['Alerts', 'Reports', 'Care Planner'].includes(activeNav)) return;
    if (!isSupabaseConfigured || !aquariumId) {
      setModuleError('Connect Supabase and select an aquarium to use this module.');
      return;
    }
    setModuleBusy(true);
    setModuleError('');
    try {
      if (activeNav === 'Alerts') await refreshSavedAlerts();
      if (activeNav === 'Care Planner') {
        const { data, error } = await supabase.from('aquarium_care_tasks').select('*').eq('aquarium_id', aquariumId).order('due_at', { ascending: true }).limit(1000);
        if (error) throw error;
        setTaskRows(data || []);
      }
      if (activeNav === 'Reports') {
        const { data, error } = await supabase.from('aquarium_health_reports').select('*').eq('aquarium_id', aquariumId).order('created_at', { ascending: false }).limit(200);
        if (error) throw error;
        setReportRows(data || []);
      }
    } catch (error) {
      setModuleError(error?.message || `Could not load ${activeNav.toLowerCase()} data.`);
    } finally {
      setModuleBusy(false);
    }
  }, [activeNav, aquariumId, refreshSavedAlerts]);

  useEffect(() => { loadModuleData(); }, [loadModuleData]);

  useEffect(() => {
    if (!isSupabaseConfigured || !aquariumId || !readings.length) return;
    const events = [];
    for (const reading of readings) {
      const temperature = Number(reading.temperature);
      const ph = Number(reading.ph_level);
      if (temperature < limits.temp_min || temperature > limits.temp_max) {
        events.push({ aquarium_id: aquariumId, fingerprint: `temperature:${reading.id}`, alert_type: 'temperature', severity: 'warning', message: `Temperature ${temperature.toFixed(1)} °C is outside the configured ${limits.temp_min}–${limits.temp_max} °C range.`, source_reading_id: reading.id, first_seen_at: reading.created_at, last_seen_at: reading.created_at, created_at: reading.created_at });
      }
      if (ph < limits.ph_min || ph > limits.ph_max) {
        events.push({ aquarium_id: aquariumId, fingerprint: `ph:${reading.id}`, alert_type: 'ph', severity: 'warning', message: `pH ${ph.toFixed(2)} is outside the configured ${limits.ph_min}–${limits.ph_max} range.`, source_reading_id: reading.id, first_seen_at: reading.created_at, last_seen_at: reading.created_at, created_at: reading.created_at });
      }
    }
    if (deviceOnline === false) {
      events.push({ aquarium_id: aquariumId, fingerprint: `device-offline:${lastDeviceSeen || 'no-heartbeat'}`, alert_type: 'device_offline', severity: 'critical', message: 'No ESP32 heartbeat has arrived within the configured timeout.', first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
    }
    const syncKey = `${events.map(event => event.fingerprint).sort().join('|')}|device-state:${deviceOnline}`;
    if (syncKey === alertSyncKey.current) return;
    alertSyncKey.current = syncKey;
    (async () => {
      try {
        if (events.length) {
          const { error } = await supabase.from('aquarium_alerts').upsert(events, { onConflict: 'aquarium_id,fingerprint', ignoreDuplicates: true });
          if (error) throw error;
        }
        if (deviceOnline === true) {
          const { error } = await supabase.from('aquarium_alerts').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('aquarium_id', aquariumId).eq('alert_type', 'device_offline').neq('status', 'resolved');
          if (error) throw error;
        }
        if (activeNav === 'Alerts') await refreshSavedAlerts();
      } catch (error) {
        alertSyncKey.current = '';
        setModuleError(error?.message || 'Could not record anomaly history. Apply the AquaSense modules database migration first.');
      }
    })();
  }, [aquariumId, readings, limits, deviceOnline, lastDeviceSeen, activeNav, refreshSavedAlerts]);

  const updateAlertStatus = async (alertId, status) => {
    setModuleError('');
    const now = new Date().toISOString();
    const patch = status === 'acknowledged' ? { status, acknowledged_at: now } : status === 'resolved' ? { status, resolved_at: now } : { status, acknowledged_at: null, resolved_at: null };
    const { error } = await supabase.from('aquarium_alerts').update(patch).eq('id', alertId).eq('aquarium_id', aquariumId);
    if (error) { setModuleError(error.message); return; }
    await refreshSavedAlerts();
  };

  const createCareTask = async event => {
    event.preventDefault();
    if (!taskForm.title.trim() || !aquariumId) return;
    setModuleError('');
    const payload = { ...taskForm, title: taskForm.title.trim(), due_at: new Date(taskForm.due_at).toISOString(), aquarium_id: aquariumId, created_by: user.id };
    const { data, error } = await supabase.from('aquarium_care_tasks').insert(payload).select().single();
    if (error) { setModuleError(error.message); return; }
    setTaskRows(rows => [...rows, data].sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at)));
    setTaskForm(form => ({ ...form, title: '', notes: '' }));
  };

  const changeCareTaskStatus = async (task, status) => {
    setModuleError('');
    const { error } = await supabase.from('aquarium_care_tasks').update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', task.id).eq('aquarium_id', aquariumId);
    if (error) { setModuleError(error.message); return; }
    if (status === 'completed' && task.recurrence !== 'none') {
      const nextDue = new Date(task.due_at);
      if (task.recurrence === 'daily') nextDue.setDate(nextDue.getDate() + 1);
      if (task.recurrence === 'weekly') nextDue.setDate(nextDue.getDate() + 7);
      if (task.recurrence === 'monthly') nextDue.setMonth(nextDue.getMonth() + 1);
      const { error: nextError } = await supabase.from('aquarium_care_tasks').insert({ aquarium_id: aquariumId, created_by: user.id, title: task.title, notes: task.notes, task_type: task.task_type, recurrence: task.recurrence, due_at: nextDue.toISOString() });
      if (nextError) setModuleError(`Task completed, but the next reminder could not be scheduled: ${nextError.message}`);
    }
    await loadModuleData();
  };

  const deleteCareTask = async taskId => {
    const { error } = await supabase.from('aquarium_care_tasks').delete().eq('id', taskId).eq('aquarium_id', aquariumId);
    if (error) { setModuleError(error.message); return; }
    setTaskRows(rows => rows.filter(task => task.id !== taskId));
  };

  const generateHealthReport = async () => {
    if (!aquariumId) return;
    setReportBusy(true);
    setModuleError('');
    try {
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd);
      const reportPeriodLabels = { hourly: 'Last hour', daily: 'Last day', weekly: 'Last week', monthly: 'Last month', yearly: 'Last year' };
      if (reportPeriod === 'hourly') periodStart.setHours(periodStart.getHours() - 1);
      else if (reportPeriod === 'daily') periodStart.setDate(periodStart.getDate() - 1);
      else if (reportPeriod === 'weekly') periodStart.setDate(periodStart.getDate() - 7);
      else if (reportPeriod === 'monthly') periodStart.setMonth(periodStart.getMonth() - 1);
      else if (reportPeriod === 'yearly') periodStart.setFullYear(periodStart.getFullYear() - 1);
      const { data, error } = await supabase.from('sensor_readings').select('id, aquarium_id, temperature, ph_level, source, created_at').eq('aquarium_id', aquariumId).gte('created_at', periodStart.toISOString()).lte('created_at', periodEnd.toISOString()).order('created_at', { ascending: true }).limit(10000);
      if (error) throw error;
      const records = prepareExportRecords(data || []);
      const summary = summarizeExportRecords(records);
      const reportData = { aquarium: aquariumName, period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(), generated_at: new Date().toISOString(), summary, readings: records, current_alerts: activeAlerts.map(({ alert_type, severity, message, created_at }) => ({ alert_type, severity, message, created_at })) };
      const { data: report, error: saveError } = await supabase.from('aquarium_health_reports').insert({ aquarium_id: aquariumId, title: `${reportPeriodLabels[reportPeriod]} Aquarium Health Report`, period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(), reading_count: records.length, report_data: reportData, created_by: user.id }).select().single();
      if (saveError) throw saveError;
      setReportRows(rows => [report, ...rows]);
      setSelectedReport(report);
    } catch (error) {
      setModuleError(error?.message || 'Could not generate the report. Apply the AquaSense modules database migration first.');
    } finally {
      setReportBusy(false);
    }
  };

  const downloadHealthReport = async (report, format = 'csv') => {
    try {
      const data = report.report_data || {};
      const summary = data.summary || {};
      const readings = prepareExportRecords(data.readings || []);
      const alerts = data.current_alerts || [];
      const rows = [
        ['AquaSense Health Report', report.title],
        ['Aquarium', data.aquarium || aquariumName],
        ['Period start', report.period_start],
        ['Period end', report.period_end],
        ['Generated at', data.generated_at || report.created_at],
        [],
        ['Summary'],
        ['Reading count', report.reading_count],
        ['Temperature minimum (°C)', summary.temperature?.min ?? ''],
        ['Temperature average (°C)', summary.temperature?.avg ?? ''],
        ['Temperature maximum (°C)', summary.temperature?.max ?? ''],
        ['pH minimum', summary.ph?.min ?? ''],
        ['pH average', summary.ph?.avg ?? ''],
        ['pH maximum', summary.ph?.max ?? ''],
        [],
        ['Sensor readings'],
        ['Reading ID', 'Aquarium ID', 'Recorded at', 'Temperature (°C)', 'pH level', 'Source'],
        ...readings.map(row => [row.id, row.aquarium_id, row.created_at, row.temperature ?? '', row.ph_level ?? '', row.source]),
        [],
        ['Current alerts'],
        ['Type', 'Severity', 'Message', 'Recorded at'],
        ...alerts.map(alert => [alert.alert_type, alert.severity, alert.message, alert.created_at || ''])
      ];
      const filename = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (format === 'xlsx') {
        const ExcelJS = await loadExcelJS();
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'AquaSense';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('Health report');
        rows.forEach(row => sheet.addRow(row));
        sheet.columns = [{ width: 30 }, { width: 24 }, { width: 26 }, { width: 22 }, { width: 18 }, { width: 18 }];
        sheet.getRow(1).font = { bold: true, size: 14 };
        for (const row of sheet.getRows(1, sheet.rowCount) || []) {
          if (row.values?.length === 2 && typeof row.values[1] === 'undefined') row.font = { bold: true };
        }
        const buffer = await workbook.xlsx.writeBuffer();
        triggerFileDownload(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
      } else {
        const protect = value => /^[\t\r\n ]*[=+@-]/.test(String(value ?? '')) ? `'${value}` : value;
        const content = `\uFEFF${rows.map(row => row.map(value => `"${String(protect(value) ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
        triggerFileDownload(new Blob([content], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
      }
    } catch (error) {
      setModuleError(error?.message || `Could not download the ${format.toUpperCase()} report.`);
    }
  };

  const deleteHealthReport = async reportId => {
    const deletedAt = new Date().toISOString();
    const { data, error } = await supabase.from('aquarium_health_reports').update({ deleted_at: deletedAt }).eq('id', reportId).eq('aquarium_id', aquariumId).select().single();
    if (error) { setModuleError(error.message); return; }
    setReportRows(rows => rows.map(report => report.id === reportId ? data : report));
    setSelectedReport(report => report?.id === reportId ? data : report);
  };

  const restoreHealthReport = async reportId => {
    const { data, error } = await supabase.from('aquarium_health_reports').update({ deleted_at: null }).eq('id', reportId).eq('aquarium_id', aquariumId).select().single();
    if (error) { setModuleError(error.message); return; }
    setReportRows(rows => rows.map(report => report.id === reportId ? data : report));
    setSelectedReport(data);
  };

  const monthDays = new Date(taskMonth.getFullYear(), taskMonth.getMonth() + 1, 0).getDate();
  const monthOffset = new Date(taskMonth.getFullYear(), taskMonth.getMonth(), 1).getDay();
  const careCalendarCells = [...Array(monthOffset).fill(null), ...Array.from({ length: monthDays }, (_, index) => index + 1)];
  const monthTasks = taskRows.filter(task => {
    const due = new Date(task.due_at);
    return due.getFullYear() === taskMonth.getFullYear() && due.getMonth() === taskMonth.getMonth();
  });
  const visibleCareTasks = taskRows
    .filter(task => taskHistory ? task.status !== 'pending' : task.status === 'pending')
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const visibleFish = FISH_GUIDE.filter(fish => `${fish.name} ${fish.scientific} ${fish.group}`.toLowerCase().includes(fishSearch.trim().toLowerCase()));
  const visibleAlerts = savedAlerts.filter(alert => (alertFilter === 'all' || alert.status === alertFilter) && (severityFilter === 'all' || alert.severity === severityFilter));
  const visibleReports = reportRows.filter(report => reportFilter === 'deleted' ? Boolean(report.deleted_at) : !report.deleted_at).slice(0, reportFilter === 'latest' ? 5 : undefined);

  const saveSettings = async event => {
    event.preventDefault();
    setSettingsMessage('');
    const next = {
      temp_min: Number(settingsForm.temp_min), temp_max: Number(settingsForm.temp_max),
      ph_min: Number(settingsForm.ph_min), ph_max: Number(settingsForm.ph_max),
      device_timeout_seconds: Number(settingsForm.device_timeout_seconds)
    };
    if (next.temp_min >= next.temp_max || next.ph_min >= next.ph_max) {
      setSettingsMessage('Each minimum must be lower than its maximum.');
      return;
    }
    if (next.device_timeout_seconds < 30) {
      setSettingsMessage('Device timeout must be at least 30 seconds.');
      return;
    }
    setSettingsSaving(true);
    try {
      if (isSupabaseConfigured) {
        if (!aquariumId) throw new Error('No aquarium is available to save settings.');
        const { error } = await supabase.from('aquarium_settings').upsert(
          { aquarium_id: aquariumId, ...next, updated_at: new Date().toISOString() },
          { onConflict: 'aquarium_id' }
        );
        if (error) throw error;
      }
      setLimits(next);
      setSettingsForm(next);
      setSettingsMessage(isSupabaseConfigured ? 'Settings saved.' : 'Settings updated for this demo session.');
    } catch (error) {
      setSettingsMessage(error?.message || 'Could not save settings.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const sendExploreMessage = async event => {
    event.preventDefault();
    const message = exploreInput.trim();
    if (!message || exploreBusy) return;

    const history = exploreMessages
      .filter(item => item.id !== 'aqua-welcome' && (item.role === 'user' || item.role === 'assistant'))
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));
    setExploreInput('');
    updateExploreMessages(items => [...items, { id: createExploreMessageId(), role: 'user', content: message }]);
    setExploreChats(chats => chats.map(chat => chat.id === activeExploreChatId ? { ...chat, title: chat.title === 'New chat' ? message.slice(0, 48) : chat.title, updatedAt: new Date().toISOString() } : chat));
    setExploreBusy(true);

    try {
      if (!isSupabaseConfigured || !supabase || !aquasenseAssistantUrl || !supabasePublishableKey) {
        throw new Error('AquaSense AI needs a configured Supabase project.');
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Your session has expired. Please sign in again.');

      const response = await fetch(aquasenseAssistantUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabasePublishableKey,
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          message,
          history,
          ...(aquariumId ? { aquarium_id: String(aquariumId) } : {})
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `AquaSense AI request failed (HTTP ${response.status}).`);
      if (typeof result.answer !== 'string' || !result.answer.trim()) {
        throw new Error('AquaSense AI returned an empty answer. Please try again.');
      }
      updateExploreMessages(items => [...items, { id: createExploreMessageId(), role: 'assistant', content: result.answer.trim(), sources: Array.isArray(result.sources) ? result.sources : [] }]);
    } catch (error) {
      updateExploreMessages(items => [...items, {
        id: createExploreMessageId(),
        role: 'assistant',
        content: `I couldn't get a response: ${error?.message || 'Please try again.'}`
      }]);
    } finally {
      setExploreBusy(false);
    }
  };

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${activeNav === 'Explore' ? 'explore-mode' : ''}`} data-theme={theme}>
      {mobileNavOpen && <div className="sidebar-scrim" onClick={() => setMobileNavOpen(false)} />}

      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-mark"><img src="/images/aquasense-logo.png" alt="" aria-hidden="true" /></div>
            <div>
              <div className="brand-name">AquaSense</div>
              <div className="brand-caption">AQUARIUM INTELLIGENCE</div>
            </div>
          </div>

          <div className="nav-label">MONITORING</div>
          <nav className="side-nav">
            {navItems.map(({ name, label, icon: Icon, badge }) => (
              <button
                key={name}
                onClick={() => navigateToModule(name)}
                className={`nav-item ${activeNav === name ? 'active' : ''}`}
              >
                <Icon size={18} />
                <span>{label}</span>
                {badge > 0 && <span className="nav-count">{badge}</span>}
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="profile-row">
            <div className="profile-avatar" aria-hidden="true">{adminInitials}</div>
            <div className="profile-copy">
              <strong>{adminDisplayName}</strong>
              <span>{user?.email || 'Administrator'}</span>
            </div>
            <button className="signout-button" onClick={() => setShowSignOutConfirm(true)} title="Sign out" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
          <nav className="sidebar-legal-links" aria-label="Legal and account information">
            <a href="/privacy.html" target="_blank" rel="noreferrer" title="Privacy policy">
              <ShieldCheck size={15} /><span>Privacy policy</span>
            </a>
            <a href="/terms.html" target="_blank" rel="noreferrer" title="Terms of Service">
              <FileText size={15} /><span>Terms of Service</span>
            </a>
            <a href="/data-deletion.html" target="_blank" rel="noreferrer" title="Data deletion instructions">
              <Trash2 size={15} /><span>Data deletion</span>
            </a>
          </nav>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="mobile-menu icon-button" onClick={() => setMobileNavOpen(true)}><Menu size={18} /></button>
            <span>AquaSense</span>
            <span>/</span>
            <strong>{activeNav}</strong>
          </div>

          <div className="topbar-actions">
            <button className="icon-button" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle theme">
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {!appInstalled && <button className="icon-button" onClick={onInstallApp} title="Install AquaSense" aria-label="Install AquaSense"><Download size={16} /></button>}
            <button
              className="icon-button"
              onClick={enableNotifications}
              disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported' || notificationPermission === 'denied'}
              title={notificationPermission === 'granted' ? 'Browser notifications enabled' : notificationPermission === 'denied' ? 'Notifications are blocked in browser settings' : notificationPermission === 'unsupported' ? 'Browser notifications are not supported' : 'Enable browser notifications'}
              aria-label={notificationPermission === 'granted' ? 'Browser notifications enabled' : 'Enable browser notifications'}
            ><BellRing size={16} /></button>

            <button className="icon-button notification-button" onClick={() => navigateToModule('Alerts')}>
              <Bell size={17} />
              {alertBadgeCount > 0 && <span className="nav-count">{alertBadgeCount}</span>}
            </button>
          </div>
        </header>

        <div className="page-content">
          {announcements.map(announcement => <article className={`notice platform-announcement announcement-${announcement.category}`} key={announcement.id}>
            <Bell size={17} aria-hidden="true" />
            <div><strong>{announcement.title}</strong><span>{announcement.message}</span></div>
            <span className="announcement-category">{announcement.category.replaceAll('_', ' ')}</span>
          </article>)}
          {!['Fish Encyclopedia', 'Explore', 'Alerts', 'Reports', 'Care Planner'].includes(activeNav) && (
            <section className="welcome-row">
              <button className="refresh-button" onClick={fetchReadings} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'spin' : ''} />
                {loading ? 'Syncing...' : 'Sync Data'}
              </button>
            </section>
          )}

          {!isSupabaseConfigured && (
            <div className="notice demo-notice">
              <Activity size={18} />
              <div>Running in demonstration mode with simulated telemetry. Connect Supabase to stream physical sensor readings.</div>
              <span className="notice-tag">PREVIEW</span>
            </div>
          )}

          {isSupabaseConfigured && connectionError && (
            <div className="notice connection-error" role="alert">
              <AlertTriangle size={17} />
              <div><strong>Could not load aquarium readings</strong><span>{connectionError}</span></div>
              <button className="secondary-button" onClick={fetchReadings} disabled={loading}>Retry</button>
            </div>
          )}

          {isSupabaseConfigured && !loading && !connectionError && aquariumId && readings.length === 0 && (
            <div className="notice" role="status">
              <Activity size={17} />
              <div>No sensor readings were returned for aquarium {aquariumId}. Confirm this is the aquarium assigned to the ESP32 device.</div>
              <button className="secondary-button" onClick={fetchReadings} disabled={loading}>Refresh</button>
            </div>
          )}

          {moduleError && ['Alerts', 'Reports', 'Care Planner'].includes(activeNav) && (
            <div className="notice connection-error" role="alert"><AlertTriangle size={17} /><div>{moduleError}</div></div>
          )}

          {activeNav === 'Overview' && (
            <>
              <section className="overview-summary">
                <article className="summary-tile">
                  <span className="summary-title"><Thermometer size={16} /> TEMPERATURE <i aria-hidden="true">🐠</i></span>
                  <strong>{displayTemp}<small>{tempUnit}</small></strong>
                  <StatusPill tone={rawTemp >= limits.temp_min && rawTemp <= limits.temp_max ? 'good' : 'warning'}>
                    {rawTemp >= limits.temp_min && rawTemp <= limits.temp_max ? 'Optimal' : 'Check'}
                  </StatusPill>
                </article>

                <article className="summary-tile">
                  <span className="summary-title"><Droplets size={16} /> PH LEVEL <i aria-hidden="true">🐟</i></span>
                  <strong>{rawPh != null ? rawPh.toFixed(2) : '–'}<small>pH</small></strong>
                  <StatusPill tone={rawPh >= limits.ph_min && rawPh <= limits.ph_max ? 'good' : 'warning'}>
                    {rawPh >= limits.ph_min && rawPh <= limits.ph_max ? 'Balanced' : 'Imbalance'}
                  </StatusPill>
                </article>

                <article className="summary-tile">
                  <span className="summary-title"><Wifi size={16} /> DEVICE <i aria-hidden="true">🐡</i></span>
                  <strong className="summary-word">{deviceOnline ? 'Online' : 'Standby'}</strong>
                  <StatusPill tone={!isSupabaseConfigured || deviceOnline ? 'good' : 'neutral'}>
                    {!isSupabaseConfigured ? 'Demo Stream' : deviceOnline ? 'Connected' : loading ? 'Checking...' : 'No heartbeat'}
                  </StatusPill>
                </article>

                <article className="summary-tile">
                  <span className="summary-title"><Clock3 size={16} /> LAST READING <i aria-hidden="true">🦈</i></span>
                  <strong className="summary-word">{latest ? fmtTime(latest.created_at) : 'No Data'}</strong>
                  <StatusPill tone="neutral">DS18B20 & pH</StatusPill>
                </article>
              </section>

              <section className="telemetry-grid">
                <article className="sensor-card">
                  <div className="sensor-card-glow" />
                  <div className="sensor-card-header">
                    <div className="sensor-heading">
                      <div className="sensor-icon"><Thermometer size={20} /></div>
                      <div>
                        <h3>Water Temperature</h3>
                        <p>Continuous Probe Sensor · DS18B20</p>
                      </div>
                    </div>
                    <div className="unit-toggle">
                      <button className={!fahrenheit ? 'selected' : ''} onClick={() => setFahrenheit(false)}>°C</button>
                      <button className={fahrenheit ? 'selected' : ''} onClick={() => setFahrenheit(true)}>°F</button>
                    </div>
                  </div>

                  <div className="sensor-value-row">
                    <div className="sensor-value">{displayTemp}<span>{tempUnit}</span></div>
                    <StatusPill tone={rawTemp >= limits.temp_min && rawTemp <= limits.temp_max ? 'good' : 'warning'}>
                      {rawTemp >= limits.temp_min && rawTemp <= limits.temp_max ? 'In Safe Range' : 'Out of Bounds'}
                    </StatusPill>
                  </div>

                  <div className="range-block">
                    <div className="range-labels">
                      <span>Min {limits.temp_min}°</span>
                      <strong>Configured Safety Threshold</strong>
                      <span>Max {limits.temp_max}°</span>
                    </div>
                    <div className="range-track">
                      <div className="range-safe" />
                      <span className="range-marker" style={{ left: `${rawTemp == null ? 50 : Math.max(5, Math.min(95, (rawTemp - 18) / 16 * 100))}%` }} />
                    </div>
                    <div className="range-caption">
                      <span>General Community Spec</span>
                      <span>{rawTemp ? `${rawTemp.toFixed(1)} °C Live` : 'Awaiting data'}</span>
                    </div>
                  </div>
                </article>

                <article className="sensor-card">
                  <div className="sensor-card-glow blue-glow" />
                  <div className="sensor-card-header">
                    <div className="sensor-heading">
                      <div className="sensor-icon blue-icon"><Droplets size={20} /></div>
                      <div>
                        <h3>pH Index (Acidity)</h3>
                        <p>Analog Galvanic Sensor Probe</p>
                      </div>
                    </div>
                  </div>

                  <div className="sensor-value-row">
                    <div className="sensor-value">{rawPh != null ? rawPh.toFixed(2) : '–'}<span>pH</span></div>
                    <StatusPill tone={rawPh >= limits.ph_min && rawPh <= limits.ph_max ? 'good' : 'warning'}>
                      {rawPh >= limits.ph_min && rawPh <= limits.ph_max ? 'In Safe Range' : 'Imbalance'}
                    </StatusPill>
                  </div>

                  <div className="ph-scale">
                    <div className="ph-scale-top">
                      <span>Acidic (0)</span>
                      <span>Neutral (7)</span>
                      <span>Alkaline (14)</span>
                    </div>
                    <div className="ph-gradient">
                      <span style={{ left: `${rawPh == null ? 50 : Math.max(5, Math.min(95, (rawPh / 14) * 100))}%` }} />
                    </div>
                    <div className="range-caption">
                      <span>Target: pH {limits.ph_min} – {limits.ph_max}</span>
                      <span>{rawPh != null ? `${rawPh.toFixed(2)} Recorded` : 'No reading'}</span>
                    </div>
                  </div>
                </article>
              </section>

              <section className="charts-grid">
                <TrendChartCard
                  title="Water Temperature History"
                  subtitle="Recorded continuous telemetry (°C)"
                  value={displayTemp}
                  unit={tempUnit}
                  dataKey="temperature"
                  data={chartData}
                  color="#06b6d4"
                  gradientId="tempHistoryGrad"
                  icon={Thermometer}
                  iconColor="#93c5fd"
                />
                <TrendChartCard
                  title="pH History"
                  subtitle="Recorded acidity / alkalinity trends"
                  value={rawPh != null ? rawPh.toFixed(2) : null}
                  unit="pH"
                  dataKey="ph_level"
                  data={chartData}
                  color="#10b981"
                  gradientId="phHistoryGrad"
                  icon={Droplets}
                />
              </section>
            </>
          )}

          {activeNav === 'Device Status' && (
            <div className="device-settings-page">
              <section className="device-widget-grid" aria-label="Device overview">
                <article className="panel device-widget">
                  <span className="device-widget-icon"><Wifi size={18} /></span>
                  <span className="device-widget-label">CONNECTION</span>
                  <strong>{!isSupabaseConfigured ? 'Demo mode' : deviceOnline ? 'Online' : loading ? 'Checking...' : 'Offline'}</strong>
                  <StatusPill tone={!isSupabaseConfigured ? 'neutral' : deviceOnline ? 'good' : 'warning'}>
                    {!isSupabaseConfigured ? 'Simulated telemetry' : deviceOnline ? 'ESP32 connected' : 'No recent heartbeat'}
                  </StatusPill>
                </article>
                <article className="panel device-widget">
                  <span className="device-widget-icon"><Clock3 size={18} /></span>
                  <span className="device-widget-label">LAST HEARTBEAT</span>
                  <strong>{lastDeviceSeen ? fmtDateTime(lastDeviceSeen) : 'No heartbeat yet'}</strong>
                  <span className="device-widget-detail">{lastDeviceSeen ? `${Math.floor(deviceAgeSeconds / 60)} min ago – timeout ${deviceTimeout}s` : 'Waiting for an ESP32 reading'}</span>
                </article>
                <article className="panel device-widget">
                  <span className="device-widget-icon"><Cpu size={18} /></span>
                  <span className="device-widget-label">DEVICE ID</span>
                  <strong className="device-id-value">{readings.filter(row => row.source === 'esp32' && row.device_id).at(-1)?.device_id || 'Not reported'}</strong>
                  <span className="device-widget-detail">Source: {lastDeviceSeen ? 'ESP32' : latest?.source || 'No readings'}</span>
                </article>
              </section>

              <section className="panel device-settings-panel">
                <div className="panel-header">
                  <div><h2>Aquarium settings</h2><p>Set safe water ranges and the device heartbeat timeout for {aquariumName}.</p></div>
                  <Database size={19} />
                </div>
                <form className="device-settings-form" onSubmit={saveSettings}>
                  <div className="settings-field-group">
                    <div className="settings-group-heading"><Thermometer size={16} /><strong>Temperature range</strong><span>°C</span></div>
                    <label>Minimum temperature<input name="temp_min" type="number" min="-5" max="60" step="0.1" required value={settingsForm.temp_min} onChange={event => setSettingsForm(form => ({ ...form, temp_min: event.target.value }))} /></label>
                    <label>Maximum temperature<input name="temp_max" type="number" min="-5" max="60" step="0.1" required value={settingsForm.temp_max} onChange={event => setSettingsForm(form => ({ ...form, temp_max: event.target.value }))} /></label>
                  </div>
                  <div className="settings-field-group">
                    <div className="settings-group-heading"><Droplets size={16} /><strong>pH range</strong><span>pH</span></div>
                    <label>Minimum pH<input name="ph_min" type="number" min="0" max="14" step="0.1" required value={settingsForm.ph_min} onChange={event => setSettingsForm(form => ({ ...form, ph_min: event.target.value }))} /></label>
                    <label>Maximum pH<input name="ph_max" type="number" min="0" max="14" step="0.1" required value={settingsForm.ph_max} onChange={event => setSettingsForm(form => ({ ...form, ph_max: event.target.value }))} /></label>
                  </div>
                  <div className="settings-field-group settings-timeout-group">
                    <div className="settings-group-heading"><Clock3 size={16} /><strong>Device timeout</strong><span>seconds</span></div>
                    <label>Mark device offline after<input name="device_timeout_seconds" type="number" min="30" step="1" required value={settingsForm.device_timeout_seconds ?? 300} onChange={event => setSettingsForm(form => ({ ...form, device_timeout_seconds: event.target.value }))} /></label>
                    <p>Minimum 30 seconds. Used to detect a missed ESP32 heartbeat.</p>
                  </div>
                  <div className="settings-form-footer">
                    <span role="status" className={settingsMessage && /saved|updated/i.test(settingsMessage) ? 'settings-message success' : 'settings-message'}>{settingsMessage || (isSupabaseConfigured ? 'Changes apply to alerts and device status.' : 'Demo mode keeps changes for this session.')}</span>
                    <button className="refresh-button settings-save-button" type="submit" disabled={settingsSaving || (isSupabaseConfigured && !aquariumId)}>
                      {settingsSaving ? <LoaderCircle size={15} className="spin" /> : <CheckCircle2 size={15} />}
                      {settingsSaving ? 'Saving...' : 'Save settings'}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {activeNav === 'Sensor Readings' && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Telemetry Measurement Logs</h2>
                  <p>All recorded telemetry readings from hardware probes.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>TIMESTAMP</th>
                      <th>TEMPERATURE</th>
                      <th>PH LEVEL</th>
                      <th>SOURCE</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...readings].reverse().slice(0, 15).map(r => {
                      const t = measurement(r.temperature);
                      const p = measurement(r.ph_level);
                      const ok = t >= limits.temp_min && t <= limits.temp_max && p >= limits.ph_min && p <= limits.ph_max;
                      return (
                        <tr key={r.id}>
                          <td><span className="time-cell"><Clock3 size={13} /> {fmtDateTime(r.created_at)}</span></td>
                          <td>{t != null ? `${t.toFixed(1)} °C` : '–'}</td>
                          <td>{p != null ? p.toFixed(2) : '–'}</td>
                          <td><span className="source-chip">{r.source || 'telemetry'}</span></td>
                          <td><StatusPill tone={ok ? 'good' : 'warning'}>{ok ? 'Normal' : 'Out of range'}</StatusPill></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeNav === 'Alerts' && (
            <section className="module-page">
              <div className="module-toolbar"><div className="module-controls"><select value={alertFilter} onChange={event => setAlertFilter(event.target.value)} aria-label="Filter alert status"><option value="active">Active</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="all">All history</option></select><select value={severityFilter} onChange={event => setSeverityFilter(event.target.value)} aria-label="Filter severity"><option value="all">All severity</option><option value="critical">Critical</option><option value="warning">Warning</option></select><button className="secondary-button" onClick={loadModuleData} disabled={moduleBusy}><RefreshCw size={15} className={moduleBusy ? 'spin' : ''}/> Refresh alerts</button></div><button className="refresh-button" onClick={fetchReadings} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} />{loading ? 'Syncing...' : 'Sync Data'}</button></div>
              {moduleBusy && <div className="module-loading"><LoaderCircle className="spin" size={18}/> Loading alert history...</div>}
              <div className="alert-list module-alert-list">
                {visibleAlerts.length === 0 ? <div className="module-empty"><CheckCircle2 size={24}/><strong>{savedAlerts.length ? 'No alerts match these filters' : 'No recorded anomalies'}</strong><span>New threshold and device events will appear here automatically.</span></div> : visibleAlerts.map(alert => <article key={alert.id} className={`alert-item alert-severity-${alert.severity}`}><div className="alert-item-icon"><AlertTriangle size={18}/></div><div className="alert-item-copy"><div className="alert-item-title"><strong>{alert.alert_type.replaceAll('_', ' ').toUpperCase()} – {alert.severity}</strong><span>{fmtDateTime(alert.last_seen_at || alert.created_at)}</span></div><p>{alert.message}</p><small>First seen {fmtDateTime(alert.first_seen_at || alert.created_at)}{alert.status !== 'active' ? ` – ${alert.status}` : ''}</small></div><div className="alert-actions">{alert.status === 'active' && <button className="secondary-button" onClick={() => updateAlertStatus(alert.id, 'acknowledged')}>Acknowledge</button>}{alert.status !== 'resolved' && <button className="primary-button" onClick={() => updateAlertStatus(alert.id, 'resolved')}><Check size={14}/> Resolve</button>}{alert.status === 'resolved' && <button className="secondary-button" onClick={() => updateAlertStatus(alert.id, 'active')}><RotateCcw size={14}/> Reopen</button>}</div></article>)}
              </div>
            </section>
          )}

          {activeNav === 'Explore' && (
            <section className="explore-chat">
              <aside className="chat-history">
                <div className="chat-history-head"><strong>Chats</strong><button className="secondary-button" onClick={() => { const chat = createExploreChat(); setExploreChats(chats => [chat, ...chats]); setActiveExploreChatId(chat.id); setExploreInput(''); }}><Sparkles size={14}/> New chat</button></div>
                <label className="chat-search"><Search size={14}/><input value={chatSearch} onChange={event => setChatSearch(event.target.value)} placeholder="Search chats" aria-label="Search chats"/></label>
                <div className="chat-history-list">{exploreChats.filter(chat => chat.title.toLowerCase().includes(chatSearch.toLowerCase())).map(chat => <div key={chat.id} className={`chat-history-item ${chat.id === activeExploreChatId ? 'active' : ''}`}><button className="chat-history-select" onClick={() => setActiveExploreChatId(chat.id)}><strong>{chat.title}</strong><span>{new Date(chat.updatedAt).toLocaleDateString()}</span></button><button className="icon-button" title="Rename chat" aria-label={`Rename ${chat.title}`} onClick={() => { setRenameChatId(chat.id); setRenameChatDraft(chat.title); }}><MoreHorizontal size={15}/></button><button className="icon-button" title="Delete chat" aria-label={`Delete ${chat.title}`} onClick={() => setDeleteChatTarget(chat)}><Trash2 size={14}/></button></div>)}</div>
              </aside>
              <div className="explore-chat-body">
                <div className="chat-intro">
                  <strong>AquaSense AI Assistant</strong>
                  <p>Ask anything about aquarium chemistry, cycling, or species care.</p>
                  <div className="chat-prompts">
                    {['What is the best pH for tropical fish?', 'How does temperature affect oxygen?'].map(prompt => (
                      <button key={prompt} onClick={() => setExploreInput(prompt)}>{prompt}</button>
                    ))}
                  </div>
                </div>
                <div className="chat-messages">
                  {exploreMessages.map(msg => (
                    <div key={msg.id} className={`chat-message ${msg.role}`}>
                      <span className="chat-message-label">{msg.role === 'assistant' ? 'AQUASENSE AI' : 'YOU'}</span>
                      <ReactMarkdown remarkPlugins={aquaSenseRemarkPlugins} rehypePlugins={aquaSenseRehypePlugins} components={markdownComponents}>
                        {msg.content}
                      </ReactMarkdown>
                      {msg.sources?.length > 0 && <div className="chat-sources"><strong>Sources</strong>{msg.sources.map((source, index) => <a key={`${source.citation}-${index}`} href={safeMarkdownUrl(source.url) || undefined} target="_blank" rel="noreferrer"><span>{source.citation}</span>{source.title}<small>{source.source}</small></a>)}</div>}
                      {msg.role === 'assistant' && msg.id !== 'aqua-welcome' && <button className="chat-copy" title="Copy response" onClick={() => copyTextToClipboard(msg.content).catch(() => {})}><Copy size={13}/> Copy</button>}
                    </div>
                  ))}
                  {exploreBusy && (
                    <div className="chat-message assistant chat-thinking" role="status" aria-live="polite">
                      <span className="chat-message-label">AQUASENSE AI</span>
                      <div className="chat-thinking-content"><span>AquaSense AI is thinking</span><span className="chat-thinking-dots" aria-hidden="true"><i /><i /><i /></span></div>
                    </div>
                  )}
                  <div ref={exploreMessagesEndRef} aria-hidden="true" />
                </div>
              </div>
              <form className="chat-composer" onSubmit={sendExploreMessage}>
                <input value={exploreInput} onChange={e => setExploreInput(e.target.value)} placeholder={exploreBusy ? 'AquaSense is thinking...' : 'Ask AquaSense AI a question...'} disabled={exploreBusy} />
                <button type="submit" disabled={exploreBusy || !exploreInput.trim()} aria-label={exploreBusy ? 'AquaSense is responding' : 'Send message'}>
                  {exploreBusy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
                </button>
              </form>

            </section>
          )}

          {activeNav === 'Fish Encyclopedia' && (
            <section className="module-page fish-encyclopedia-page">
              <div className="fish-guide-body">
                <div className="module-toolbar">
                  <label className="fish-search"><Search size={16}/><input value={fishSearch} onChange={event => setFishSearch(event.target.value)} placeholder="Search species or group"/></label>
                </div>
                {selectedFish ? (
                  <article className="fish-profile">
                    <button className="secondary-button" onClick={() => setSelectedFish(null)}><ChevronLeft size={15}/> All species</button>
                    <span className="fish-profile-icon"><Fish size={30}/></span>
                    <h2>{selectedFish.name}</h2><em>{selectedFish.scientific}</em><p>{selectedFish.note}</p>
                    <div className="fish-facts">{[['Type',selectedFish.group],['Adult size',selectedFish.size],['Tank guidance',selectedFish.tank],['Temperature',selectedFish.temperature],['pH range',selectedFish.ph],['Temperament',selectedFish.temperament],['Diet',selectedFish.diet]].map(([label,value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
                    <a className="fish-source-link" href={`https://www.fishbase.se/summary/${selectedFish.scientific.toLowerCase().replace(/\s+/g, '-')}.html`} target="_blank" rel="noreferrer">Species reference: FishBase <span aria-hidden="true">↗</span></a>
                  </article>
                ) : (
                  <div className="fish-guide-grid">{visibleFish.map(fish => <button className="fish-guide-card" key={fish.name} onClick={() => setSelectedFish(fish)}><span className="fish-guide-icon"><Fish size={22}/></span><strong>{fish.name}</strong><em>{fish.scientific}</em><span>{fish.group} - {fish.temperature}</span><small>View care profile -&gt;</small></button>)}{!visibleFish.length && <div className="module-empty">No species found.</div>}</div>
                )}
              </div>
            </section>
          )}
          {activeNav === 'Reports' && <section className="module-page">
            <div className="module-toolbar reports-module-toolbar"><div className="module-controls"><select value={reportPeriod} onChange={event => setReportPeriod(event.target.value)} aria-label="Report time range"><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select><button className="primary-button" onClick={generateHealthReport} disabled={reportBusy}><FileText size={15}/>{reportBusy ? 'Generating...' : 'Generate report'}</button></div><button className="refresh-button" onClick={fetchReadings} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""} />{loading ? "Syncing..." : "Sync Data"}</button></div>
            <div className="reports-layout">
              <div className="report-list">
                <div className="report-history-tabs" role="tablist" aria-label="Report history">
                  {[['latest', 'Latest'], ['all', 'All reports'], ['deleted', 'Deleted']].map(([filter, label]) => <button key={filter} role="tab" aria-selected={reportFilter === filter} className={reportFilter === filter ? 'active' : ''} onClick={() => setReportFilter(filter)}>{label}<span>{filter === 'deleted' ? reportRows.filter(report => report.deleted_at).length : filter === 'latest' ? Math.min(5, reportRows.filter(report => !report.deleted_at).length) : reportRows.filter(report => !report.deleted_at).length}</span></button>)}
                </div>
                {visibleReports.length ? visibleReports.map(report => <article className={`report-card ${selectedReport?.id === report.id ? 'selected' : ''}`} key={report.id} onClick={() => setSelectedReport(report)}><div><FileSpreadsheet size={18}/><strong>{report.title}</strong>{report.deleted_at && <span className="report-status deleted">Deleted</span>}</div><span>{fmtDateTime(report.created_at)} – {report.reading_count} readings</span><div className="report-card-actions"><button className="secondary-button" onClick={event => { event.stopPropagation(); downloadHealthReport(report); }}><Download size={14}/> Download CSV</button>{report.deleted_at ? <button className="secondary-button" onClick={event => { event.stopPropagation(); restoreHealthReport(report.id); }}><RotateCcw size={14}/> Restore</button> : <button className="icon-button" aria-label="Move report to deleted" title="Move to deleted" onClick={event => { event.stopPropagation(); deleteHealthReport(report.id); }}><Trash2 size={15}/></button>}</div></article>) : <div className="module-empty">{reportFilter === 'deleted' ? 'No deleted reports.' : 'No reports yet. Generate one to save a report here.'}</div>}
              </div>
              {selectedReport ? <article className="report-detail"><div className="module-toolbar"><div><h2>{selectedReport.title}</h2><p>{fmtDateTime(selectedReport.period_start)} – {fmtDateTime(selectedReport.period_end)}</p>{selectedReport.deleted_at && <span className="report-status deleted">Deleted {fmtDateTime(selectedReport.deleted_at)}</span>}</div><div className="report-card-actions"><button className="secondary-button" onClick={() => downloadHealthReport(selectedReport, 'csv')}><Download size={15}/> CSV</button><button className="secondary-button" onClick={() => downloadHealthReport(selectedReport, 'xlsx')}><Download size={15}/> XLSX</button></div></div><div className="report-summary-grid"><div><small>Readings</small><strong>{selectedReport.reading_count}</strong></div><div><small>Temperature avg.</small><strong>{selectedReport.report_data?.summary?.temperature?.avg == null ? '–' : Number(selectedReport.report_data.summary.temperature.avg).toFixed(1) + ' °C'}</strong></div><div><small>pH avg.</small><strong>{selectedReport.report_data?.summary?.ph?.avg == null ? '–' : Number(selectedReport.report_data.summary.ph.avg).toFixed(2)}</strong></div></div><div className="report-readings-preview"><h3>Sensor readings ({selectedReport.reading_count})</h3>{selectedReport.report_data?.readings?.length ? <div className="table-wrap"><table><thead><tr><th>Recorded at</th><th>Temperature</th><th>pH</th><th>Source</th></tr></thead><tbody>{selectedReport.report_data.readings.slice(0, 50).map((reading, index) => <tr key={reading.id || index}><td>{fmtDateTime(reading.created_at)}</td><td>{reading.temperature == null ? '–' : `${reading.temperature} °C`}</td><td>{reading.ph_level == null ? '–' : Number(reading.ph_level).toFixed(2)}</td><td>{reading.source || '—'}</td></tr>)}</tbody></table></div> : <p>No sensor readings were recorded during this period.</p>}</div></article> : <article className="report-detail report-detail-empty"><div className="module-empty"><FileSpreadsheet size={24}/><strong>No report selected</strong><span>Generate a report or select one from the list to view its details.</span></div></article>}
            </div>
          </section>}

          {activeNav === 'Care Planner' && <section className="module-page"><div className="module-toolbar care-planner-toolbar"><button className="secondary-button" onClick={() => setTaskHistory(value => !value)}>{taskHistory ? 'Show upcoming' : 'Task history'}</button><button className="refresh-button" onClick={fetchReadings} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} />{loading ? 'Syncing...' : 'Sync Data'}</button></div><div className="care-layout"><article className="care-calendar panel"><div className="calendar-heading"><button className="icon-button" aria-label="Previous month" onClick={() => setTaskMonth(date => new Date(date.getFullYear(), date.getMonth() - 1, 1))}><ChevronLeft size={17}/></button><h2>{taskMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2><button className="icon-button" aria-label="Next month" onClick={() => setTaskMonth(date => new Date(date.getFullYear(), date.getMonth() + 1, 1))}><ChevronRight size={17}/></button></div><div className="care-calendar-grid">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}{careCalendarCells.map((day,index) => { const date = day ? new Date(taskMonth.getFullYear(), taskMonth.getMonth(), day).toLocaleDateString('en-CA') : ''; const count = monthTasks.filter(task => new Date(task.due_at).getDate() === day).length; return day ? <button key={date} className={`care-calendar-day ${selectedTaskDate === date ? 'selected' : ''}`} onClick={() => setSelectedTaskDate(date)}>{day}{count > 0 && <i>{count}</i>}</button> : <span key={`empty-${index}`}/>; })}</div><div className="calendar-selected">Tasks on {new Date(`${selectedTaskDate}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}<div>{monthTasks.filter(task => new Date(task.due_at).toLocaleDateString('en-CA') === selectedTaskDate).map(task => <span key={task.id}>{task.title}</span>)}{!monthTasks.some(task => new Date(task.due_at).toLocaleDateString('en-CA') === selectedTaskDate) && <small>No tasks scheduled</small>}</div></div></article><div className="care-workspace"><form className="care-task-form panel" onSubmit={createCareTask}><h2>Add care reminder</h2><label>Task name<input required value={taskForm.title} onChange={event => setTaskForm(form => ({...form,title:event.target.value}))} placeholder="e.g. Feed the fish"/></label><div className="module-controls"><label>Type<select value={taskForm.task_type} onChange={event => setTaskForm(form => ({...form,task_type:event.target.value}))}><option value="feeding">Feeding</option><option value="maintenance">Water change / filter</option><option value="water_test">Water testing</option><option value="other">Other</option></select></label><label>Repeat<select value={taskForm.recurrence} onChange={event => setTaskForm(form => ({...form,recurrence:event.target.value}))}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label></div><label>Due date<input type="datetime-local" required value={taskForm.due_at} onChange={event => setTaskForm(form => ({...form,due_at:event.target.value}))}/></label><label>Notes<textarea rows="2" value={taskForm.notes} onChange={event => setTaskForm(form => ({...form,notes:event.target.value}))} placeholder="Optional details"/></label><button className="primary-button" type="submit"><CalendarCheck2 size={15}/> Add reminder</button></form><div className="care-task-list"><h2>{taskHistory ? 'Completed task history' : 'Upcoming care tasks'}</h2>{visibleCareTasks.length ? visibleCareTasks.map(task => <article className="care-task-card panel" key={task.id}><div className="care-task-icon"><CalendarDays size={17}/></div><div className="care-task-copy"><strong>{task.title}</strong><span>{task.task_type.replaceAll('_',' ')} – {fmtDateTime(task.due_at)} – {task.recurrence === 'none' ? 'One-time' : `Repeats ${task.recurrence}`}</span>{task.notes && <small>{task.notes}</small>}</div><div className="care-task-actions">{task.status === 'pending' && <><button className="secondary-button" onClick={() => changeCareTaskStatus(task,'completed')}><Check size={14}/> Done</button><button className="icon-button" title="Skip task" onClick={() => changeCareTaskStatus(task,'skipped')}><RotateCcw size={14}/></button></>}<button className="icon-button" title="Delete task" onClick={() => deleteCareTask(task.id)}><Trash2 size={14}/></button></div></article>) : <div className="module-empty">{taskHistory ? 'No completed or skipped tasks yet.' : 'No upcoming tasks. Add a reminder to get started.'}</div>}</div></div></div></section>}
        </div>
      </main>
      {showSignOutConfirm && (
        <div className="signout-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowSignOutConfirm(false); }}>
          <section className="signout-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="signout-confirm-title" aria-describedby="signout-confirm-description">
            <div className="signout-confirm-icon"><LogOut size={19} /></div>
            <h2 id="signout-confirm-title">Sign out?</h2>
            <p id="signout-confirm-description">Are you sure you want to sign out of AquaSense?</p>
            <div className="signout-confirm-actions">
              <button className="secondary-button" onClick={() => setShowSignOutConfirm(false)}>Cancel</button>
              <button className="signout-confirm-button" onClick={() => { setShowSignOutConfirm(false); onSignOut(); }}><LogOut size={15} /> Sign out</button>
            </div>
          </section>
        </div>
      )}
      {renameChatId && (
        <div className="signout-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setRenameChatId(null); }}>
          <section className="signout-confirm-dialog rename-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-chat-title" aria-describedby="rename-chat-description">
            <button type="button" className="rename-chat-close" aria-label="Close" onClick={() => setRenameChatId(null)}>×</button>
            <h2 id="rename-chat-title">Rename chat</h2>
            <p id="rename-chat-description">Give this conversation a name you’ll recognize later.</p>
            <form onSubmit={event => { event.preventDefault(); const title = renameChatDraft.trim(); if (!title) return; setExploreChats(chats => chats.map(chat => chat.id === renameChatId ? { ...chat, title, updatedAt: new Date().toISOString() } : chat)); setRenameChatId(null); }}>
              <label htmlFor="rename-chat-input">Chat name</label>
              <input ref={renameChatInputRef} id="rename-chat-input" value={renameChatDraft} maxLength={80} onChange={event => setRenameChatDraft(event.target.value)} placeholder="e.g. Water quality plan" />
              <div className="signout-confirm-actions"><button type="button" className="secondary-button" onClick={() => setRenameChatId(null)}>Cancel</button><button className="rename-chat-save" type="submit" disabled={!renameChatDraft.trim()}>Save name</button></div>
            </form>
          </section>
        </div>
      )}
      {deleteChatTarget && (
        <div className="signout-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDeleteChatTarget(null); }}>
          <section className="signout-confirm-dialog rename-chat-dialog delete-chat-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-chat-title" aria-describedby="delete-chat-description">
            <button type="button" className="rename-chat-close" aria-label="Close" onClick={() => setDeleteChatTarget(null)}>×</button>
            <h2 id="delete-chat-title">Delete chat?</h2>
            <p id="delete-chat-description">“{deleteChatTarget.title}” will be permanently removed from your chat history.</p>
            <div className="signout-confirm-actions"><button className="secondary-button" onClick={() => setDeleteChatTarget(null)}>Cancel</button><button className="delete-chat-confirm" onClick={() => { const deletingId = deleteChatTarget.id; setExploreChats(chats => { const remaining = chats.filter(chat => chat.id !== deletingId); if (!remaining.length) { const fresh = createExploreChat(); setActiveExploreChatId(fresh.id); return [fresh]; } if (activeExploreChatId === deletingId) setActiveExploreChatId(remaining[0].id); return remaining; }); setDeleteChatTarget(null); }}>Delete chat</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
