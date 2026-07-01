# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server (fastest for UI work)
npm run build        # Static export to /out (required for Capacitor)
npm run lint         # ESLint
npm run android      # Build + sync to Android (next build && npx cap sync android)
npm run ios          # Build + sync to iOS   (next build && npx cap sync ios)
```

No test suite is configured.

## Cross-Platform Mandate

**GymTrack targets Android AND iOS simultaneously.** Every feature, fix, or new component must work correctly on both platforms. When adding any new capability, run through the platform checklist below before considering it done.

### Platform checklist for new features

- [ ] Works in Chrome desktop (dev server)
- [ ] Works in Safari (iPhone) — WKWebView engine
- [ ] Uses `isNative` / `isIOS` / `isAndroid` from `lib/platform.ts` to branch platform-specific code
- [ ] Does NOT use `window.Notification` directly — use the water reminder pattern (LocalNotifications on native, Web Notification on web)
- [ ] Does NOT use `navigator.vibrate` on iOS — use `@capacitor/haptics` via the `vibrate()` helper in dashboard layout
- [ ] If using any browser API that requires a user gesture on iOS (AudioContext, DeviceOrientation), reads the patterns below
- [ ] Safe area CSS applied where needed (`safe-area-header`, `safe-area-bottom-nav`, `safe-area-content` classes)

### Development workflow

1. **Develop in the browser** — `npm run dev`. Chrome DevTools with device emulation covers 90% of work.
2. **Test native features on a real device** — rebuild with `npm run android` or `npm run ios`, sync to IDE.
3. **iOS without a Mac** — open the dev server URL (`http://<local-ip>:3000`) in Safari on an iPhone and "Add to Home Screen". Same WKWebView engine as Capacitor.

### Platform detection

```typescript
import { isNative, isIOS, isAndroid, isWeb, platform } from "@/lib/platform";
// platform = "android" | "ios" | "web"
// isNative = true on android and ios
```

Never use `navigator.userAgent` for platform detection. `lib/platform.ts` uses `Capacitor.getPlatform()` which is reliable and set at build time.

## Architecture

**GymTrack** is a fitness tracking PWA built with Next.js 14 (static export) + Capacitor for Android and iOS packaging. The web build outputs to `/out`, which Capacitor bundles as the WebView content for both platforms.

### Routing

App Router with two route groups:
- `/login` — unauthenticated landing
- `/(dashboard)` — authenticated shell (`app/(dashboard)/layout.tsx`) containing `/home`, `/training`, `/stats`, `/settings`

The dashboard layout handles auth guarding, water reminder scheduling, online/offline sync status banner, native platform setup (status bar, back button), and the bottom navigation bar with a sliding glass pill animation.

### Data layer

- **Supabase** for auth, database, and file storage.
- `lib/supabase.ts` exports a single `createClientComponentClient()` instance used throughout — all data fetching happens client-side in hooks/components.
- `lib/hooks/useProfile.ts` — fetches and updates the user's profile row; consumed widely across settings and the dashboard layout.
- All DB tables use RLS policies scoped to `auth.uid()`. Schema is in `schema.sql`.
- Storage buckets: `progress-photos` and `exercise-photos` (paths scoped to `{userId}/{timestamp}.ext`).
- `workout_sets` has a `drops jsonb` column (array of `{weight, reps}` objects) for unlimited dropset drops. Legacy columns `weight_2/reps_2/weight_3/reps_3` are kept read-only for backward compat. Migration:
  ```sql
  alter table workout_sets add column drops jsonb default null;
  ```
- `personal_records` table stores the best weight per exercise per user. RLS scoped to `auth.uid()`. Schema:
  ```sql
  create table personal_records (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid references auth.users not null,
    exercise_name text not null,
    weight_kg     numeric not null,
    achieved_at   date not null,
    created_at    timestamptz default now()
  );
  alter table personal_records enable row level security;
  create policy "own records" on personal_records
    for all using (auth.uid() = user_id);
  ```

### Offline / sync layer

- **`lib/db.ts`** — opens an IndexedDB database (`gymtrack` v1) via the `idb` library. Two object stores:
  - `pendingOps` — queued write operations to replay when back online (auto-increment integer key)
  - `cache` — key/value store for caching last-fetched Supabase data so pages load offline
- **`lib/offlineQueue.ts`** — the public API over IndexedDB:
  - `enqueue(op)` — adds a `PendingOp` to `pendingOps`. Three op types: `"upsert"` (generic table upsert), `"save_workout"` (session + sets pair), `"delete"` (row deletion)
  - `flushQueue()` — replays all pending ops against Supabase, deletes each on success; returns `{ synced, failed }`
  - `getPendingCount()` — returns the number of ops still queued
  - `getPendingUpsertsForTable(table)` — returns the payloads of all pending `"upsert"` ops for a specific table. Used by pages to overlay unsynced writes on top of Supabase data so optimistic state is preserved across navigation.
  - `getPendingSaveWorkouts()` — returns all pending `"save_workout"` ops (as `{ sessionId, sessionPayload, sets }`). Used by the training page to overlay pending sessions on Supabase data.
  - `getCached<T>(key)` / `setCache(key, data)` — read/write to the `cache` store
- **`lib/hooks/useOnlineSync.tsx`** — React Context provider (not a plain hook). Wraps the dashboard in `app/(dashboard)/layout.tsx` as `<OnlineSyncProvider>`. Single `runSync()` with a mutex prevents concurrent flushes from mount, online event, and visibilitychange firing simultaneously.
  - Exposes `{ isOnline, syncState, refetchKey, triggerSync }` via `useOnlineSync()`
  - `refetchKey` increments only when `flushQueue()` returns `synced > 0` — if all ops fail, the refetch is suppressed so pages don't overwrite the optimistic cache with stale Supabase data
  - `triggerSync()` — fire-and-forget flush for components to call from their catch blocks immediately after `enqueue()`
  - Handles `window online/offline` + `document visibilitychange` (catches the mobile case where the JS thread was frozen while the device reconnected)
- Pages that support offline: `/home` (caches weight logs, water logs, photos, last session) and `/training` (caches exercises, sessions, folders; enqueues workout saves).

**Pending-ops overlay pattern** — both `/home` and `/training` pages call `getPendingUpsertsForTable` / `getPendingSaveWorkouts` inside their `load()` success branch and merge the results on top of the Supabase data before writing to cache and setting state. This ensures that navigating away and back never loses data that is still waiting in the queue to be synced.

**Offline pattern rules (MUST follow):**
1. Never use `if (!navigator.onLine)` as the sole offline check — `navigator.onLine` returns `true` on WiFi with no internet. Always wrap Supabase calls in `try/catch` and fall back to cache/queue on any error. Cache is only written on successful fetch, never in the catch branch.
2. Never call `supabase.auth.getSession()` directly — use `resolveUserId()` from `lib/auth-utils.ts` instead. `getSession()` can hang 30-75 seconds when the JWT is expired and Supabase tries to refresh it on WiFi-with-no-internet (TCP timeout), causing infinite loading states.
3. Wrap all Supabase data queries with `withTimeout()` from `lib/auth-utils.ts` — prevents the same TCP-hang from blocking data fetches indefinitely.
4. After every `enqueue()` call in a catch block (online save that failed and fell back to the queue), immediately call `triggerSync()` from `useOnlineSync()` — this retries the flush while the user is still on the page, before they navigate away and trigger a stale refetch.

**`lib/auth-utils.ts`** — the auth/timeout utilities:
- `resolveUserId()` — hits IndexedDB first (<5ms, zero network), falls back to `getSession()` with a 4s hard timeout. Writes userId to IndexedDB on success so future calls are always fast.
- `withTimeout(promise, ms=8000)` — wraps any Supabase `PromiseLike` in a race against a timeout. Use on all `Promise.all([...supabase queries...])` blocks.

### Hooks

- `lib/hooks/useProfile.ts` — fetches/updates profile row
- `lib/hooks/useWaterReminder.ts` — 45-minute water reminder. On native (Android/iOS) uses `@capacitor/local-notifications`. On web falls back to the browser Notification API. Uses `setInterval` while the app is open (not a background scheduler).
- `lib/hooks/useOnlineSync.tsx` — see Offline / sync layer above. Import `OnlineSyncProvider` for layout wiring; import `useOnlineSync()` in any component that needs `{ isOnline, syncState, refetchKey, triggerSync }`.

### Contexts

- `lib/context/ThemeContext.tsx` — `ThemeProvider` wrapping the app; exposes `useTheme()` for toggling light/dark
- `lib/context/NavContext.tsx` — `NavProvider` wrapping the dashboard; exposes `useNav()` with `{ navHidden, setNavHidden }`. Used to hide the bottom nav bar when the active workout view is open.

### Sound system

`lib/sounds.ts` — synthesises audio via the Web Audio API (no audio files). All sounds are fire-and-forget:
- `playNavTap()` — quick blip on nav tab tap
- `playPageTransition()` — soft sweep on route change
- `playSignOut()` — cascading power-down on logout
- `playBoot()` — ascending chime on dashboard first mount (silent on iOS until first tap unlocks AudioContext)
- `playPR()` — triumphant fanfare on new personal record
- `unlockAudio()` — call from a user-gesture handler to resume AudioContext on iOS. Already wired to the global pointerdown handler in dashboard layout.

**iOS audio rule:** AudioContext is suspended on iOS until a user gesture fires `unlockAudio()`. The dashboard layout's tap ripple pointerdown handler calls `unlockAudio()` on the first tap. `playBoot()` is intentionally silent on first launch — all sounds after the first tap work correctly.

### Components

**`components/home/`**
- `WeightLogger.tsx` — log today's body weight; writes offline via `enqueue`
- `WeightChart.tsx` — recharts line chart of recent weight history
- `WaterTracker.tsx` — tap-to-increment water intake; writes offline via `enqueue`
- `WaterHistorySheet.tsx` — bottom sheet showing water log history
- `PhotoGallery.tsx` — upload progress photos to Supabase Storage via `<input type="file">`; lightbox viewer

**`components/training/`**
- `RoutineManager.tsx` — create/edit/delete workout folders and exercises within them
- `ExerciseForm.tsx` — form for adding/editing an exercise definition
- `ExerciseList.tsx` — searchable exercise picker
- `WorkoutSession.tsx` — full active workout UI (sets, reps, weight, rest timer, finish)
- `ActiveWorkout.tsx` — wrapper that hides the nav bar via `useNav()` while a workout is in progress
- `PRToast.tsx` — fixed bottom toast shown after saving a workout when a new weight PR is detected; plays `playPR()` and auto-dismisses after 5 s

**`components/stats/`**
- `BodyHeatmap.tsx` — SVG muscle-group heatmap coloured by workout frequency
- `MuscleDistribution.tsx` — pie/bar breakdown of muscle groups trained
- `MonthlyReport.tsx` — monthly volume summary
- `TopExercises.tsx` — most-performed exercises ranked by set count

### Theme system

Dual light/dark theme using CSS custom properties on `:root` / `html.dark`. Theme is persisted to `localStorage` and applied via `ThemeProvider` (`lib/context/ThemeContext.tsx`). A blocking inline `<script>` in `app/layout.tsx` reads the stored theme before hydration to prevent flash.

All UI colors must use the CSS variables (`var(--bg)`, `var(--text)`, `var(--accent)`, etc.) — never hard-code hex values in components.

### Styling conventions

`app/globals.css` defines the full design system:

**Cards & surfaces**
- `.card` — solid surface card (`--card` bg, `--border`, `rounded-2xl p-4`). Use for dense lists and inline sub-items.
- `.card-sm` — smaller solid card (`rounded-xl p-3`). Used inside ActiveWorkout for data-entry set rows.
- `.card-glass` — frosted glass card (`backdrop-filter blur(24px)`, specular inset, science corner bracket). **Primary container for all page-level sections.**
- `.glass-sheet` — frosted glass background for slide-up bottom panels (e.g. WaterHistorySheet).

**Buttons**
- `.btn-primary` — inverted solid (text color bg). Reserved for low-emphasis or non-CTA uses.
- `.btn-aqua` — Apple Aqua gel button (cyan gradient + inset specular + glow). **Primary CTA across the app.**
- `.btn-ghost` — no bg, hover surface. For secondary/cancel actions.
- `.btn-outline` — transparent with border. For secondary options and dashed "add" actions.

**Colors & tokens**
- `--accent` / `--accent-faint` / `--accent-rgb` — cyan (`#22d3ee` / `#67e8f9` dark). Primary signal color.
- `--violet-rgb`, `--emerald-rgb` — RGB primitives for ambient orb colors.
- `--chart-1` (cyan) → `--chart-5` (rose) — chart color scale; `--chart-1` dark is `#67e8f9`.
- `--chart-4` (amber) used for rest/recovery data; `--chart-5` (rose) for intensity/warnings.

**Typography**
- `.metric` — `ui-monospace` tabular nums for all numeric displays (weights, times, set counts, chart axes).
- `.section-label` — 10px uppercase tracking label with accent left bar. Section headers inside cards.
- `.sector-readout` — monospace instrument-panel badge (cyan tinted, blurred, bordered). For muscle groups, PR labels, rank numbers.

**Animation**
- `.animate-spring-up` / `.animate-spring-scale` — spring physics entry animations (`cubic-bezier(0.34, 1.56, 0.64, 1)`).
- `.stagger-1` through `.stagger-6` — 60ms increment animation-delay helpers.
- `.animate-pulse-data` — 1.1s opacity pulse for live updating values.
- `.skeleton` — shimmer loading placeholder.

**Glass chrome (nav)**
- `.liquid-nav` / `.liquid-pill` / `.liquid-header` — specular glass panels for bottom nav and floating headers. Named `liquid-*`, not `glass-*`.

**Atmosphere layer**
- `.orb-1/2/3` — fixed drifting radial gradient orbs (cyan/violet/emerald). Gyroscope tilt via `--orb-tilt-x/y` CSS vars updated by JS.
- `.scanline` — 9s CRT sweep overlay.
- `.tap-ripple` — EM pulse ring animation on tap.
- `.logo-gem` — heartbeat-pulse icon with `gem-pulse` keyframe (~50 BPM resting athlete pace).

**iOS safe area classes** (in globals.css, require `viewport-fit=cover` in `<meta viewport>`)
- `.safe-area-header` — `margin-top: max(1rem, env(safe-area-inset-top) + 0.5rem)`. Applied to the floating glass header.
- `.safe-area-bottom-nav` — `bottom: max(1.25rem, env(safe-area-inset-bottom) + 0.5rem)`. Applied to the fixed bottom nav.
- `.safe-area-content` — `padding-bottom: calc(9rem + env(safe-area-inset-bottom))`. Applied to `<main>`.

**Rule: never hard-code hex values in components.** Always use CSS variables.

### Key types

All shared TypeScript types live in `types/index.ts`: `Profile`, `DailyWeightLog`, `WaterLog`, `ProgressPhoto`, `Exercise`, `WorkoutFolder`, `WorkoutSession`, `WorkoutSet`, `SetType`, `WeightUnit`, `DistanceUnit`.

### Static export constraints

`next.config.js` sets `output: "export"`, which means:
- No server-side features (API routes, server actions, `getServerSideProps`)
- `next/image` optimization is disabled (`unoptimized: true`)
- All data fetching must be client-side

### Android + iOS (Capacitor)

Config: `capacitor.config.ts`
- `appId: "com.ferzts.gymtrack"`, `webDir: "out"`
- `server.androidScheme: "https"`, `server.iosScheme: "https"`
- `ios.contentInset: "never"` — full-bleed WebView; safe areas handled via CSS `env()`
- `ios.backgroundColor: "#080808"` — prevents white flash during launch
- `plugins.Keyboard.resize: "body"` — keyboard resize behavior on both platforms

**Installed Capacitor plugins:**

| Package | Purpose |
|---|---|
| `@capacitor/android` | Android platform |
| `@capacitor/ios` | iOS platform |
| `@capacitor/status-bar` | Set status bar style (light icons on dark bg); Android also sets background color |
| `@capacitor/haptics` | Haptic feedback — replaces `navigator.vibrate` which is unsupported on iOS |
| `@capacitor/keyboard` | Keyboard resize behavior on both platforms |
| `@capacitor/app` | Android hardware back button; `App.exitApp()` |
| `@capacitor/local-notifications` | Water reminders on native — replaces Web Notifications API (not available in WKWebView) |

**Android specifics:**
- Target SDK 36, min SDK 24
- AndroidManifest permissions: `INTERNET`, `POST_NOTIFICATIONS` (Android 13+ for water reminders)
- After any code change: `npm run android` → open in Android Studio → run

**iOS specifics:**
- Requires macOS + Xcode to build. Run `npx cap add ios` once on a Mac to create `ios/` directory.
- After any code change on Mac: `npm run ios` → `npx cap open ios` → run in Xcode
- Info.plist required usage descriptions (add to `ios/App/App/Info.plist`):
  - `NSPhotoLibraryUsageDescription` — for progress photo uploads
  - `NSCameraUsageDescription` — for camera capture
  - `NSMotionUsageDescription` — for gyroscope orb tilt effect
- DeviceOrientationEvent requires permission on iOS 13+. The dashboard layout requests it on the first user tap (already implemented).
- WKWebView does NOT support: `window.Notification`, `navigator.vibrate`. Both are already handled via Capacitor plugins.

### iOS / Android platform-specific behaviour reference

| Feature | Android | iOS | Code location |
|---|---|---|---|
| Notifications | Web Notification API (WebView supports it) | `@capacitor/local-notifications` | `lib/hooks/useWaterReminder.ts` |
| Haptics | `navigator.vibrate` | `@capacitor/haptics` | `vibrate()` in `app/(dashboard)/layout.tsx` |
| Status bar | `StatusBar.setBackgroundColor` + light style | Light style only (no bg color) | dashboard layout useEffect |
| Back button | `@capacitor/app` backButton listener | Swipe gesture (system-handled, no code needed) | dashboard layout useEffect |
| Gyroscope | Works directly | Requires `DeviceOrientationEvent.requestPermission()` on iOS 13+ | dashboard layout useEffect |
| AudioContext | Autoplay allowed | Requires user gesture; `unlockAudio()` called on first pointerdown | `lib/sounds.ts` + dashboard layout |
| Safe areas | No notch (standard 24dp status bar) | Notch + home indicator; `env(safe-area-inset-*)` | `app/globals.css` safe-area classes |
| Camera/photos | `<input type="file">` works | `<input type="file">` works | `components/home/PhotoGallery.tsx` |
| IndexedDB | ✅ Full support | ✅ Full support (iOS 10+) | `lib/db.ts` |
| localStorage | ✅ | ✅ | theme, auth session |
| Web Audio API | ✅ | ✅ (after user gesture) | `lib/sounds.ts` |

---

## Design: "Cryo Lab" ✅ COMPLETE (2026-06-27)

**Codename: CRYO LAB** — Science-meets-gym minimalism with liquid glass depth and Apple Aqua/visionOS material language.

### Design philosophy

Three-way intersection: **Science** (monospace metrics, dot-grid, instrument panel labels, clinical whitespace) + **Gym** (spring animations, PR fanfare, heartbeat pulse, anatomy heatmap) + **Apple glass** (specular insets, backdrop-filter blur, Aqua gel buttons, iridescent rims).

### What was changed (2026-06-27)

**`globals.css` additions:**
- `.card-glass` — frosted glass card; now the primary container for all page-level sections
- `.btn-aqua` — Apple Aqua gel button; now the primary CTA across the entire app
- `.animate-pulse-data` — opacity pulse for live workout values
- `.glass-sheet` — frosted background for bottom-sheet panels
- `--accent-rgb`, `--violet-rgb`, `--emerald-rgb` — RGB primitives for `rgba()` composition
- `--chart-1` (cyan) through `--chart-5` (rose) — chart color scale

**Home:** WeightLogger (`card-glass`, 24px metric input, `btn-aqua`), WeightChart (cyan oscilloscope line, violet avg ref, glass tooltip), WaterTracker (accent-glowing segments), WaterHistorySheet (`glass-sheet` panel + `card-glass` stat cards), PhotoGallery (`card-glass`).

**Training:** WorkoutSession (`card-glass`, accent-faint inner panels, `btn-aqua`), PRToast (`card-glass` + accent glow + `sector-readout`, `animate-spring-scale`), ExerciseList (`card-glass`, `sector-readout` muscle badge), ExerciseForm (`card-glass`, `btn-aqua`), RoutineManager (`card-glass` folders, `btn-aqua` Start).

**Stats:** All 4 section cards → `card-glass`. BodyHeatmap → chart color scale (cyan/amber/rose). MuscleDistribution → cyan current / violet previous radar. MonthlyReport → accent-faint stat boxes, cyan bars, glass tooltip. TopExercises → `sector-readout` rank, accent metric set count, cyan gradient bar.

**Settings:** All 5 section cards → `card-glass`. Toggle → accent cyan with glow. SegmentPicker → accent cyan selected. Water goal buttons → accent selected. `btn-aqua` save. Creator card → `card-glass` with accent border + `sector-readout` title.

**Note:** `card-sm` in `ActiveWorkout.tsx` is intentionally kept flat (dense inline data-entry rows — glass would be too heavy there).
