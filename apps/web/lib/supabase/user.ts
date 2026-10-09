import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = (process.env.WEB_ORIGIN || new URL(request.url).origin)
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""));
  return Boolean(origin && allowed.includes(origin.replace(/\/$/, "")));
}
