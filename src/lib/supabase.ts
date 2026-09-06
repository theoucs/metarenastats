import { createClient } from "@supabase/supabase-js";

// Client admin, utilisé uniquement côté serveur (route handlers).
// La service_role key contourne les policies RLS — ne jamais l'exposer au client.
export const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;
