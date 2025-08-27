// src/pages/api/update-and-deploy.js
import { createClient } from '@supabase/supabase-js';

/** 
 * POST body JSON:
 * { action: "add"|"edit"|"delete", property: { id, title, price, address, image, description } }
 * Header: Authorization: Bearer <access_token_from_client>
 */

export const POST = async ({ request }) => {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized - missing token' }), { status: 401 });
    }

    // ENV (server-only)
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const VERCEL_HOOK = process.env.VERCEL_DEPLOY_HOOK || '';
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase());

    if (!SUPABASE_URL || !SUPABASE_ANON || !SUPABASE_SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), { status: 500 });
    }

    // 1) Verify token: create a client (anon) and validate JWT on server
    const supabaseForAuth = createClient(SUPABASE_URL, SUPABASE_ANON);
    const { data: userData, error: userError } = await supabaseForAuth.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
    }

    const userEmail = (userData.user.email || '').toLowerCase();
    if (!ADMIN_EMAILS.includes(userEmail)) {
      return new Response(JSON.stringify({ error: 'Forbidden - not an admin' }), { status: 403 });
    }

    // 2) Create admin client (service_role) to read/write Storage
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

    const BUCKET = 'properties';
    const FILE = 'properties.json';

    // 3) Download current file (if exists)
    const { data: downloadData, error: downloadError } = await supabaseAdmin.storage.from(BUCKET).download(FILE);
    let props = [];
    if (downloadError && downloadError.status !== 404) {
      return new Response(JSON.stringify({ error: 'Failed to read properties.json: ' + downloadError.message }), { status: 500 });
    }
    if (downloadData) {
      const txt = await downloadData.text();
      props = txt ? JSON.parse(txt) : [];
    }

    // 4) Apply change
    const { action, property } = body;
    if (!action || !property) return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });

    if (action === 'add') {
      props.push(property);
    } else if (action === 'edit') {
      props = props.map(p => String(p.id) === String(property.id) ? property : p);
    } else if (action === 'delete') {
      props = props.filter(p => String(p.id) !== String(property.id));
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
    }

    // 5) Upload back (upsert)
    const blob = new Blob([JSON.stringify(props, null, 2)], { type: 'application/json' });
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(FILE, blob, { upsert: true });
    if (uploadError) {
      return new Response(JSON.stringify({ error: 'Upload failed: ' + uploadError.message }), { status: 500 });
    }

    // 6) Trigger Vercel Deploy Hook (if הוגדר)
    if (VERCEL_HOOK) {
      try {
        await fetch(VERCEL_HOOK, { method: 'POST' });
      } catch (e) {
        // לא קריטי — נתנו הודעה ב־log
        console.warn('Vercel hook failed', e);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 });
  }
};
