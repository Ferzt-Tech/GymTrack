import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { ThemeProvider } from "@/lib/context/ThemeContext";
import { LanguageProvider } from "@/lib/context/LanguageContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ferzt-GymTrack",
  description: "My own app for body recomposition and hypertrophy tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GymTrack",
  },
};

export const viewport: Viewport = {
  themeColor: "#080808",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/icons/favicon-16.png" type="image/png" sizes="16x16" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Prevent flash of wrong theme + force navigator.onLine true (offline
            detection relies on try/catch fallbacks, not onLine — see CLAUDE.md).
            Injected via next/script beforeInteractive: a raw <script> rendered
            by React 19 triggers "Encountered a script tag while rendering" and
            is never executed on client-side renders. */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme')||'dark';if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}
try{Object.defineProperty(navigator,'onLine',{get:()=>true,configurable:true});}catch(e){}`,
          }}
        />
      </head>
      <body>
        <LanguageProvider>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </LanguageProvider>

        {/* PWA service worker registration — production only. In dev the SW's
            cache-first asset strategy serves stale Turbopack chunks (same URL,
            changed content), replaying old bundles and their errors. The dev
            branch actively unregisters any leftover SW and clears its caches. */}
        <Script id="sw-register" strategy="afterInteractive">
          {`
            var IS_PROD = ${JSON.stringify(process.env.NODE_ENV === "production")};
            if ('serviceWorker' in navigator) {
              if (IS_PROD) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js');
                });
              } else {
                navigator.serviceWorker.getRegistrations()
                  .then((regs) => regs.forEach((r) => r.unregister()))
                  .catch(() => {});
                if (window.caches && caches.keys) {
                  caches.keys()
                    .then((keys) => keys.forEach((k) => caches.delete(k)))
                    .catch(() => {});
                }
              }
            }
            window.addEventListener('beforeinstallprompt', (e) => {
              e.preventDefault();
              window.deferredPrompt = e;
              window.dispatchEvent(new Event('pwa-installable'));
            });
          `}
        </Script>
      </body>
    </html>
  );
}
