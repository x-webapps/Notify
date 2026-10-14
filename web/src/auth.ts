import { supabase } from "./supabase";

export type AuthState =
  | { status: "signed-out"; notice?: string }
  | { status: "admin"; email: string };

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Resolves the current session and checks the admin allow-list (enforced again by RLS). */
export async function resolveAuth(): Promise<AuthState> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return { status: "signed-out", notice: `Sign-in failed: ${error.message}` };
  const user = data.session?.user;
  if (!user?.email) return { status: "signed-out" };

  const email = user.email.toLowerCase();
  const verified = user.user_metadata?.email_verified === true;
  // Non-admins get zero rows because every policy requires is_admin().
  const { data: row } = await supabase.from("admins").select("email").eq("email", email).maybeSingle();
  if (!verified || !row) {
    await supabase.auth.signOut();
    return { status: "signed-out", notice: `Not authorized: ${email} is not on the admin list.` };
  }
  return { status: "admin", email };
}
