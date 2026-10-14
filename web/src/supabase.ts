import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError: string | null = !url || !anonKey
  ? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy web/.env.example to web/.env (local) or set the repo Actions variables (deploy)."
  : null;

// Only the public anon key is ever used here. Access is enforced by Row Level Security.
// PKCE keeps the OAuth result in ?code= (not in the #hash, which this app uses for routing).
export const supabase: SupabaseClient = createClient(url ?? "http://invalid.local", anonKey ?? "missing", {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});
