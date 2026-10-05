import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.outboxenter.earshot',
  appName: 'Earshot',
  webDir: 'dist',
  android: { allowMixedContent: false, backgroundColor: '#0F1411' },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0F1411', showSpinner: false },
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover', style: 'DARK' },
  },
};

export default config;
