// scripts/check_supabase.js
// Simple script to query Supabase REST and RPC using NEXT_PUBLIC envs in .env.local
const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean).filter(l => !l.trim().startsWith('//'));
  const env = {};
  for (const l of lines) {
    const m = l.match(/^\s*([^=]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function run() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('.env.local not found');
    process.exit(2);
  }
  const env = loadEnv(envPath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
    process.exit(2);
  }
  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  };

  try {
    console.log('Fetching sample user_profiles...');
    const resp = await fetch(url + '/rest/v1/user_profiles?select=id,user_name,email,status&limit=5', { headers });
    const users = await resp.json();
    console.log('user_profiles result:', JSON.stringify(users, null, 2));

    if (Array.isArray(users) && users.length > 0) {
      const uname = users[0].user_name;
      console.log('\nTesting RPC: get_email_by_username with', uname);
      const r1 = await fetch(url + '/rpc/get_email_by_username', { method: 'POST', headers, body: JSON.stringify({ p_username: uname }) });
      const j1 = await r1.text();
      console.log('get_email_by_username raw:', j1);

      console.log('\nTesting RPC: check_username_exists with', uname);
      const r2 = await fetch(url + '/rpc/check_username_exists', { method: 'POST', headers, body: JSON.stringify({ p_username: uname }) });
      const j2 = await r2.text();
      console.log('check_username_exists raw:', j2);
    } else {
      console.log('No user_profiles rows found to test RPCs');
    }
  } catch (err) {
    console.error('Error during requests:', err);
    process.exit(1);
  }
}

run();
