import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser(request?: Request) {
  const supabase = await createClient();
  const bearer = request?.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(bearer || undefined);
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
