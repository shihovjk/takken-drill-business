import type { Backend } from "./types";

// Live (Supabase + Edge Functions) when the env vars are set, otherwise the offline demo
export async function loadBackend(): Promise<Backend> {
  if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY) {
    const { createLiveBackend } = await import("./liveBackend");
    return createLiveBackend(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
  }
  const { createDemoBackend } = await import("./demoBackend");
  return createDemoBackend();
}
