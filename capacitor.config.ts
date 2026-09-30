import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.outboxenter.earshot',
  appName: 'Earshot',
  webDir: 'dist',
  android: { allowMixedContent: false, backgroundColor: '#0B0F12' },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0B0F12', showSpinner: false },
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover', style: 'DARK' },
  },
};

export default config;
