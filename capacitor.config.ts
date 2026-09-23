import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.outboxenter.earshot',
  appName: 'Earshot',
  webDir: 'dist',
  android: { allowMixedContent: false, backgroundColor: '#17111F' },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#17111F', showSpinner: false },
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover', style: 'DARK' },
  },
};

export default config;
