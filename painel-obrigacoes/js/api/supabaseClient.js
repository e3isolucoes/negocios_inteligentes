// Shim: re-export supabase client from the top-level module
// Some modules import 'js/api/supabaseClient.js' while the canonical file
// is at 'js/supabaseClient.js'. This lightweight shim keeps both paths working.
export { supabase, isSupabaseConfigured } from '../supabaseClient.js';
