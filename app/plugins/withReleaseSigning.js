// Signs release builds with the key from the ANDROID_KEYSTORE_* environment
// variables (set by the build workflow from repository secrets). Without them
// the build falls back to Expo's debug key, like ezbookkeeping-android does.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// where-is release signing';

const block = `
${MARKER}
android {
    signingConfigs {
        whereisRelease {
            def keystorePath = System.getenv('ANDROID_KEYSTORE_PATH')
            if (keystorePath) {
                storeFile file(keystorePath)
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }
    }
    buildTypes {
        release {
            if (System.getenv('ANDROID_KEYSTORE_PATH')) {
                signingConfig signingConfigs.whereisRelease
            }
        }
    }
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += block;
    }
    return cfg;
  });
};
