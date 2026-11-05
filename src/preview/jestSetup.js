// Set up for the screen preview test (screens.test.tsx), before any app code loads.

// supabase.ts needs these to start; the test never reaches a server.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://preview-test.invalid';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'preview-test-key';

// Every request that would leave the phone ends up here, under the preview's own guard: the test
// checks it was never called.
globalThis.networkCalls = jest.fn(() => Promise.reject(new Error('network in a test')));
globalThis.fetch = globalThis.networkCalls;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The help screen reads whether the phone is online (expo-network's own test stand-in can't
// stop listening).
jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));

// The maps are native views: plain views stand in for them.
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const MapView = (props) => require('react').createElement(View, props);
  return { __esModule: true, default: MapView, Marker: View, Polyline: View };
});
