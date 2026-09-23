/** True in the browser tester build (`npm run build:tester`), false in the Android app. */
export const IS_TESTER = import.meta.env.VITE_TESTER === '1';
