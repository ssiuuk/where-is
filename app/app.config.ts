import type { ConfigContext, ExpoConfig } from 'expo/config';

// Set by the build workflow (see .github/workflows/android.yml).
const versionCode = Number(process.env.APP_VERSION_CODE || '1');
const versionName = process.env.APP_VERSION_NAME || '0.1.0';
// The server's public host name, e.g. whereis.example.com. When set, links on
// labels open the app directly instead of the browser (Android App Links).
const host = (process.env.WHEREIS_HOST || '').trim();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Where Is',
  slug: 'where-is',
  scheme: 'whereis',
  version: versionName,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.ssiuuk.whereis',
    supportsTablet: true,
    associatedDomains: host ? [`applinks:${host}`] : [],
  },
  android: {
    package: 'com.ssiuuk.whereis',
    versionCode,
    adaptiveIcon: {
      backgroundColor: '#1F6F5C',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    intentFilters: host
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [
              { scheme: 'https', host, pathPrefix: '/p/' },
              { scheme: 'https', host, pathPrefix: '/i/' },
            ],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : [],
  },
  web: {
    // a single-page app that the server hosts at https://<server>/
    output: 'single',
    bundler: 'metro',
    favicon: './assets/favicon.png',
    name: 'Where Is',
    themeColor: '#1F6F5C',
  },
  plugins: [
    'expo-router',
    ['expo-camera', { cameraPermission: 'Where Is uses the camera to scan labels and take photos of your things.' }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Where Is lets you pick a photo of an item.',
        cameraPermission: 'Where Is uses the camera to take photos of your things.',
      },
    ],
    ['react-native-nfc-manager', { nfcPermission: 'Where Is reads and writes the NFC stickers on your shelves and boxes.' }],
    'expo-web-browser',
    'expo-sharing',
    './plugins/withNfcTagLinks',
    './plugins/withReleaseSigning',
  ],
  experiments: {
    typedRoutes: false,
  },
});
