// Everything lives in app.json; this only adds what must not be committed to Git.
//
// Google Maps on Android needs an API key built into the app (iPhone uses Apple Maps and needs
// none). The key comes from the GOOGLE_MAPS_ANDROID_API_KEY environment variable - set in EAS for
// builds (eas env:set), never written in a committed file. Without it the maps plugin is left
// out, so iPhone builds and local work carry on unchanged.
module.exports = ({ config }) => {
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  if (!androidGoogleMapsApiKey) return config;

  return {
    ...config,
    plugins: [...(config.plugins ?? []), ['react-native-maps', { androidGoogleMapsApiKey }]],
  };
};
