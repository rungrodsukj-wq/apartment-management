import { createClient, SupabaseClient } from '@supabase/supabase-js';

const isBrowser = typeof window !== 'undefined';

const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const prodKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const demoUrl = process.env.NEXT_PUBLIC_DEMO_SUPABASE_URL!;
const demoKey = process.env.NEXT_PUBLIC_DEMO_SUPABASE_ANON_KEY!;

let prodClient: SupabaseClient | null = null;
let demoClient: SupabaseClient | null = null;

function getActiveClient(): SupabaseClient {
  if (!isBrowser) {
    if (!prodClient) {
      prodClient = createClient(prodUrl, prodKey, {
        auth: {
          persistSession: false,
        },
      });
    }
    return prodClient;
  }

  const mode = localStorage.getItem('supabase_mode') || 'production';
  if (mode === 'demo') {
    if (!demoClient) {
      demoClient = createClient(demoUrl, demoKey, {
        auth: {
          persistSession: true,
          storage: window.sessionStorage,
        },
      });
    }
    return demoClient;
  } else {
    if (!prodClient) {
      prodClient = createClient(prodUrl, prodKey, {
        auth: {
          persistSession: true,
          storage: window.sessionStorage,
        },
      });
    }
    return prodClient;
  }
}

// Export a Proxy that forwards all operations to the active Supabase client instance
export const supabase = new Proxy({} as SupabaseClient, {
  get(target, prop, receiver) {
    const activeClient = getActiveClient();
    const value = Reflect.get(activeClient, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(activeClient);
    }
    return value;
  },
});