import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.');
}

// The screen preview (src/preview/) answers from sample data instead of this client while it is
// on. Only development builds and test builds with EXPO_PUBLIC_SCREEN_PREVIEW=true contain it:
// the condition is written out here (not imported) so a production build drops the require.
const preview =
  __DEV__ || process.env.EXPO_PUBLIC_SCREEN_PREVIEW === 'true'
    ? (require('../preview/previewClient') as typeof import('../preview/previewClient'))
    : null;
preview?.installPreviewNetworkGuard();

const client = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Implicit (not PKCE): the password-reset link is completed on a plain web page (see the
    // reset-password-page Edge Function), not back in this app, so there's no device-local PKCE
    // code_verifier available to complete an exchange. Implicit puts the tokens straight in the
    // link instead, which any page can use directly.
    flowType: 'implicit',
  },
});

export const supabase = preview ? preview.withPreview(client) : client;
