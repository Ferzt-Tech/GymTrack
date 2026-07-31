# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server (fastest for UI work)
npm run build        # Static export to /out (required for Capacitor)
npm run android      # Build + sync to Android (next build && npx cap sync android)
npm run ios          # Build + sync to iOS   (next build && npx cap sync ios)
```

No test suite is configured.

`npm run lint` runs ESLint 9 with the flat config in `eslint.config.mjs` (`eslint-config-next/core-web-vitals` + `/typescript`). Several noisy rules (`no-explicit-any`, the React-compiler `react-hooks/*` checks, `no-unescaped-entities`) are downgraded to warnings — keep the error count at zero; warnings are advisory.

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

**GymTrack** is a **local-first** fitness tracking PWA built with Next.js 16 (Turbopack, static export) + Capacitor for Android and iOS packaging. The web build outputs to `/out`, which Capacitor bundles as the WebView content for both platforms.

**Core principle: the app works 100% offline.** IndexedDB is the source of truth on-device; Supabase is an optional per-user cloud sync/backup layer. Guest mode (`Continue Offline` on the login page, userId `"guest-user"`) uses the app with no account at all — guest writes go to IndexedDB only and are never queued for the cloud.

### Routing

App Router with two route groups:
- `/login` — unauthenticated landing (email/password or guest mode)
- `/(dashboard)` — authenticated shell (`app/(dashboard)/layout.tsx`) containing `/home`, `/training`, `/nutrition`, `/stats`, `/settings`

The dashboard layout handles auth guarding, water reminder scheduling, online/offline sync status banner, native platform setup (status bar, back button), and the bottom navigation bar with a sliding glass pill animation.

### Data layer (local-first)

- **`lib/supabase.ts`** exports:
  - `supabaseOnline` — the raw `@supabase/supabase-js` client (auth, storage, direct queries in the flush/backup paths).
  - `supabase` — a **facade**: `supabase.from(table)` returns the real client (wrapped in a Proxy) only when `hasSession && navigator.onLine && REMOTE_TABLES.includes(table)`; otherwise it returns a `MockQueryBuilder` that runs the same query API against IndexedDB. The Proxy wrapper mirrors every successful remote **write** (insert/update/upsert/delete) into the matching IndexedDB table store so the local mirror stays current.
  - `onAuthStateChange` caches `auth:userId` and `auth:userEmail` in IndexedDB (cleared on sign-out unless guest).
  - When adding a table, add it to **both** `REMOTE_TABLES` (lib/supabase.ts) and `LOCAL_TABLES` (lib/offlineQueue.ts) plus a store in `lib/db.ts` — forgetting `REMOTE_TABLES` silently makes all "online" reads hit the local mock (this bug shipped once with `food_logs`).
  - `workout_sets` and `routine_exercises` have **no `user_id` column** remotely (ownership flows through session/folder). `TABLES_WITHOUT_USER_ID` in `lib/db.ts` stops the local mock/queue from stamping one onto their rows, and `backupToCloud` strips it from legacy rows — a stray `user_id` makes PostgREST reject the entire upsert ("could not find the 'user_id' column"), which once broke cloud backup wholesale.
- `lib/hooks/useProfile.ts` — fetches and updates the user's profile row; consumed widely across settings and the dashboard layout.
- All DB tables use RLS policies scoped to `auth.uid()`. **Schema lives in `migrations/`** (`schema.sql`, `add_routines.sql`, `add_nutrition.sql`, `changes.sql`, `add_food_detail.sql`, `add_admin_config.sql`, and **`reconcile_schema.sql`**). Tables: `profiles`, `daily_weight_logs`, `water_logs`, `food_logs`, `saved_foods`, `progress_photos`, `exercises`, `workout_folders`, `workout_sessions`, `workout_sets`, `routine_exercises`, `personal_records`. `app_settings` is a separate global-config table outside this per-user set — see Admin panel below.
- **`migrations/reconcile_schema.sql`** is the idempotent full-schema catch-all — `create table if not exists` for every table + `add column if not exists` for every incremental column + `drop policy if exists`/recreate. Run it in the Supabase SQL editor to bring a partially-migrated project up to the current schema. It exists because the incremental migrations were not all applied to the live project, and — more insidiously — **`workout_sets.drops` (jsonb) and `food_logs.updated_at` are written by the app but were in no base migration at all**; a column the app writes but that's missing remotely makes PostgREST reject the *entire* upsert for that table, silently breaking cloud sync/backup for it (`saved_foods` never syncing was the symptom that surfaced this). `personal_records` is intentionally omitted from reconcile (nothing writes it; `backupToCloud` skips empty tables).
- **Images are stored as base64 data-URLs in DB columns** (`progress_photos.storage_path`, `exercises.machine_photo_path`), compressed client-side via `compressImage()`. The Supabase Storage buckets are legacy; `getStorageUrl()` passes `data:`/`blob:` strings through untouched.
- `workout_sets` has a `drops jsonb` column (array of `{weight, reps}`) for unlimited dropset drops, plus a `weight_unit` column (`'kg'|'lbs'`) recording the unit used at log time. Legacy columns `weight_2/reps_2/weight_3/reps_3` are read-only backward compat; a set with `weight_unit: null` is legacy data interpreted as kg.
- `personal_records` exists in the schema but is currently unused — PR detection is computed client-side from session history in the training page.

### Offline / sync layer

- **`lib/db.ts`** — opens an IndexedDB database (`gymtrack` **v6**, `DB_VERSION`) via the `idb` library. Object stores:
  - `pendingOps` — queued write operations to replay when back online (auto-increment integer key)
  - `cache` — key/value store (page caches, `auth:userId`, `auth:userEmail`, `auth:nutrition_targets`, `auth:nutrition_inputs`, `sync:version`)
  - One store per data table (`profiles`, `daily_weight_logs`, `water_logs`, `food_logs`, `saved_foods`, `progress_photos`, `exercises`, `workout_folders`, `workout_sessions`, `workout_sets`, `routine_exercises`, `personal_records`) — the local mirror that `MockQueryBuilder` queries and `executeLocalOp` writes.
  - Two **local-only** stores (`LOCAL_ONLY_STORES`): `volume_feedback` and `recipes`. See "Local-only stores" below.
  - **Migrations are additive and version-independent.** `ensureStores(db)` creates whatever is missing and never drops or rewrites a store, so a device on *any* older version reaches the full set intact — add a store name to `DATA_STORES` and bump `DB_VERSION`, nothing else. `deleteObjectStore`/`deleteDatabase` are never acceptable here: that is the user's entire history.
  - **`getDb()` resolves `null` rather than rejecting** when IndexedDB is unusable. It first retries `openDB` *without a version* — the common failure is a `VersionError` from a device that already ran a newer build, and downgrading must mean "attach to the newer schema", not "wipe". Every call site already guards on a falsy `db`; keep it that way. `blocking`/`terminated` release the handle so another tab's upgrade can proceed and the next `getDb()` transparently reopens.
- **`lib/offlineQueue.ts`** — the public API over IndexedDB. (The queue lives here, not in a `lib/db/sync.ts`; `lib/db.ts` is the schema layer only.)
  - `enqueue(op)` — **executes the op locally first** (`executeLocalOp` writes to the table stores, generating UUIDs / filling `user_id` / cascading deletes), then adds it to `pendingOps` via `queueForSync` — but only for signed-in users; guest ops stay local-only. Three op types: `"upsert"`, `"save_workout"` (session + sets pair), `"delete"`. **If `executeLocalOp` throws, `queueForSync` never runs** — so a local-write bug is total data loss (nothing persisted *and* nothing queued for later sync), not just a failed sync. See offline pattern rule 6 (IndexedDB transaction lifetime) — violating it in the `save_workout` branch was the sole cause of "training doesn't log offline".
  - **Sync envelope.** Every queue row carries `opId` (idempotency key), `client_timestamp`, `sync_version` (monotonic per-device counter persisted at `cache:sync:version`), `attempts`, `nextAttemptAt`, `status` (`"pending" | "failed"`), `lastError`. ⚠️ **This metadata lives on the queue row, never inside `payload`** — that placement is the whole point. A `sync_version` column on the *rows* would need a migration on every table and PostgREST rejects an entire upsert over one unknown column, so on-row versioning would break cloud sync wholesale for anyone who hadn't migrated. On the envelope it costs zero remote schema change. Don't move it.
  - **Version locking / idempotence.** `supersedeKeyOf(op)` identifies the row an op writes. Two queued ops sharing a key are redundant: the older one's payload was already overwritten locally, and sending it risks landing *after* the newer one and undoing the user's last edit. `queueForSync` collapses same-kind pairs at enqueue time (this is what keeps repeated offline water/weight taps from growing the queue one op per tap — `executeLocalOp` always hands back the *merged* row, so the newest payload is the complete final state), and `flushQueue` drops the losers by `(sync_version, id)` before sending. `save_workout` has its **own key namespace** even though it targets `workout_sessions`: it also carries the session's sets, so letting a plain session upsert supersede it would silently drop every set. `save_workout`'s delete-then-insert of sets is what makes replaying it idempotent.
  - `flushQueue()` — serialised by a module-level in-flight promise (mount, the `online` event, `visibilitychange` and every `triggerSync()` can fire at once). Returns `{ synced, failed, deferred, superseded, parked }`; `useOnlineSync` reads only `synced`/`failed`, and ops still inside their backoff window count as `deferred`, not `failed`.
  - **Exponential backoff + poison-pill parking.** A failed op backs off `5s × 2^attempts` (capped at 5 min, full jitter) and is skipped until `nextAttemptAt`. After 8 attempts — or immediately on a *permanent* error (`PGRST204`/`PGRST205`/`42703`/`42P01`/`22P02`/`23502`, i.e. schema-shape failures that will never succeed) — it is parked as `status: "failed"`. Parked ops keep their data (it is already in IndexedDB) but stop retrying. Anything that could resolve itself — auth, network, `23503` FK violations where the parent hasn't synced yet — stays on normal backoff.
  - `getPendingCount()` — ops still on their way to the server. **Excludes parked ops on purpose**: they will not move on their own, so counting them would keep the sync banner spinning and permanently block the stats page's fetch (which skips Supabase when `getPendingCount() > 0`).
  - `getFailedCount()` / `getQueueStats()` / `retryFailedOps()` — parked-op introspection and revival (e.g. after a missing migration finally ran).
  - Flush order is ascending `(sync_version, id)`, which keeps parents ahead of children (a folder before its `routine_exercises`) and avoids self-inflicted FK violations. **Legacy rows written before the envelope existed normalize to `sync_version: 0`**, so they still flush first, ordered among themselves by insert key — `normalizeQueuedOp` does this on read with no rewrite pass, so an upgrade can never drop writes that were waiting to sync.
  - `getPendingUpsertsForTable(table)` / `getPendingDeletesForTable(table)` — pending op payloads for overlaying unsynced writes on top of fetched data. These **deliberately include parked ops**: their writes are already in IndexedDB and must keep showing in the UI whether or not the upload ever succeeds.
  - `getPendingSaveWorkouts()` — all pending `"save_workout"` ops; used by the training page overlay
  - `overlayUpserts(base, pending, key)` — merge helper for the overlay pattern
  - `getCached<T>(key)` / `setCache(key, data)` / `getCachedAt(key)` / `clearCache(key)` — the `cache` store

**Local-only stores (`volume_feedback`, `recipes`).** Both are device-local: not in `REMOTE_TABLES` / `LOCAL_TABLES` / `TABLES_BACKUP_ORDER`, never queued for sync, no migration required. This is deliberate, not an oversight — a table the client writes but the remote project lacks makes PostgREST reject the entire upsert and breaks cloud sync/backup wholesale (the `workout_sets.drops` / `food_logs.updated_at` failure documented above), so shipping a new *synced* table breaks every existing install until its owner runs a migration by hand. Both stores are included in `EXPORT_TABLES` (`lib/exportData.ts`) so the data is never trapped on one device. If either is ever promoted to a synced table, the migration must be applied in Supabase **before** the first client writes it.
- **`lib/hooks/useOnlineSync.tsx`** — React Context provider (not a plain hook). Wraps the dashboard in `app/(dashboard)/layout.tsx` as `<OnlineSyncProvider>`. Single `runSync()` with a mutex prevents concurrent flushes from mount, online event, and visibilitychange firing simultaneously.
  - Exposes `{ isOnline, syncState, refetchKey, triggerSync }` via `useOnlineSync()`
  - `refetchKey` increments only when `flushQueue()` returns `synced > 0` — if all ops fail, the refetch is suppressed so pages don't overwrite the optimistic cache with stale Supabase data
  - `triggerSync()` — fire-and-forget flush for components to call from their catch blocks immediately after `enqueue()`
  - Handles `window online/offline` + `document visibilitychange` (catches the mobile case where the JS thread was frozen while the device reconnected)
- All pages support offline: `/home`, `/training`, `/nutrition`, `/stats` follow cache-first load + pending-ops overlay; `/settings` works through `useProfile`.

**Pending-ops overlay pattern** — pages call `getPendingUpsertsForTable` / `getPendingDeletesForTable` / `getPendingSaveWorkouts` inside their `load()` success branch and merge the results on top of the fetched data before writing to cache and setting state. This ensures that navigating away and back never loses data that is still waiting in the queue to be synced. `app/(dashboard)/training/page.tsx` overlays every table it can write to — `exercises`, `workout_folders`, `routine_exercises` (via `getPendingUpsertsForTable`/`getPendingDeletesForTable`) and `workout_sessions`/`workout_sets` (via `getPendingSaveWorkouts`) — both on the cache-first render and again after a fresh online fetch, so a queued-but-unsynced edit to any of them survives a reload or a refetch.

**Offline pattern rules (MUST follow):**
1. Never use `if (!navigator.onLine)` as the sole offline check — always wrap Supabase calls in `try/catch` and fall back to cache/queue on any error. Cache is only written on successful fetch, never in the catch branch. Note: the bootstrap script in `app/layout.tsx` **deliberately overrides `navigator.onLine` to always return `true`** (WebView reporting is unreliable), so `!navigator.onLine` branches are effectively dead code — the app always attempts the network and relies on try/catch + timeouts.
2. Never call `supabase.auth.getSession()` directly — use `resolveUserId()` from `lib/auth-utils.ts` instead. `getSession()` can hang 30-75 seconds when the JWT is expired and Supabase tries to refresh it on WiFi-with-no-internet (TCP timeout), causing infinite loading states.
3. Wrap all Supabase data queries with `withTimeout()` from `lib/auth-utils.ts` — prevents the same TCP-hang from blocking data fetches indefinitely.
4. After every `enqueue()` call in a catch block (online save that failed and fell back to the queue), immediately call `triggerSync()` from `useOnlineSync()` — this retries the flush while the user is still on the page, before they navigate away and trigger a stale refetch.
5. **Always check `{ error }` on Supabase results and `throw error` inside the try block.** supabase-js does not throw on failure — it resolves with `{ error }` — so a bare `await supabase.from(...).delete()...` without an error check makes the catch/enqueue fallback dead code and silently loses the write.
6. **IndexedDB transaction lifetime — never `await` a *separate* transaction (e.g. `db.getAll(...)`) while a read-write transaction is open.** An idle read-write tx auto-commits during that `await`, and its store then throws `TransactionInactiveError` on the next `put`/`delete`. In `executeLocalOp` (and `MockQueryBuilder`) do all `db.getAll(...)` reads — and prepare the rows to write — **before** `db.transaction(store, "readwrite")`, then issue every `store.put`/`store.delete` **without awaiting each one** and `await tx.done` last. All three `executeLocalOp` branches (`upsert`/`delete`/`save_workout`) now follow this; the `save_workout` branch violated it (opened the `workout_sets` tx, then `await db.getAll("workout_sets")`), which wrote the session row but silently dropped every set — and per rule above (throw before `queueForSync`), never queued them either. That was the *entire* reason training didn't log offline.

**Training-specific: local-first-always writes (no "try online" step at all).** Every training write — `app/(dashboard)/training/page.tsx` (`deleteExercise`, `startSession`, `saveWorkout`, the exercise-rename cascade), `components/training/RoutineManager.tsx` (all 6 folder/routine-exercise writes), `WorkoutSession.tsx`, `ExerciseForm.tsx`, `ExerciseLibraryPicker.tsx` — skips the "try Supabase, catch → enqueue" shape above entirely and goes straight to `enqueue()` → update local state/UI → `triggerSync()`. This used to follow the same online-first shape as the rest of the app, but hand-copying it at ~15 call sites led to real bugs: `RoutineManager.tsx`'s six write functions had bare, un-`withTimeout()`-wrapped Supabase calls that could hang 30-75s on a connected-but-dead network before falling back, and a separate reload-on-reconnect effect there could silently overwrite an optimistic offline edit with stale server data. There is now no direct online call left in the UI thread for these tables — `flushQueue()` is the only code that talks to Supabase for them. `saveWorkout`'s `"save_workout"` op must include the session's *existing* sets (via `toSetPayload`, exported from `WorkoutSession.tsx`) alongside the newly logged ones, since a `"save_workout"` op replaces all sets for that session on flush — omitting existing sets would wipe them out. **Follow this same local-first-always shape for any new training write; the online-first shape above is still correct for non-training pages** (nutrition, home, settings).

**`lib/auth-utils.ts`** — the auth/timeout utilities:
- `resolveUserId()` — hits IndexedDB first (<5ms, zero network), falls back to `getSession()` with a 4s hard timeout. Writes userId to IndexedDB on success so future calls are always fast.
- `refreshAuthSession()` — forces a JWT refresh (5s timeout) before flushing the queue so RLS sees a valid `auth.uid()`.
- `withTimeout(promise, ms=8000)` — wraps any Supabase `PromiseLike` in a race against a timeout. Use on all `Promise.all([...supabase queries...])` blocks.

### Hooks

- `lib/hooks/useProfile.ts` — fetches/updates profile row
- `lib/hooks/useWaterReminder.ts` — 45-minute water reminder. On native (Android/iOS) uses `@capacitor/local-notifications`. On web falls back to the browser Notification API. Uses `setInterval` while the app is open (not a background scheduler). **Only the dashboard layout passes `profile`** — any other consumer that just needs `requestPermission` must pass `null`, otherwise a second reminder interval gets scheduled (double notifications).
- `lib/hooks/useOnlineSync.tsx` — see Offline / sync layer above. Import `OnlineSyncProvider` for layout wiring; import `useOnlineSync()` in any component that needs `{ isOnline, syncState, refetchKey, triggerSync }`.
- `lib/hooks/useDevMode.ts` — `{ isDev, devEmail, loading }`; see Developer mode below.

### Contexts

- `lib/context/ThemeContext.tsx` — `ThemeProvider` wrapping the app; exposes `useTheme()` for toggling light/dark
- `lib/context/NavContext.tsx` — `NavProvider` wrapping the dashboard; exposes `useNav()` with `{ navHidden, setNavHidden }`. Used to hide the bottom nav bar when the active workout view or a bottom sheet is open.
- `lib/context/LanguageContext.tsx` — `LanguageProvider` (root layout); `useLanguage()` for switching en/es, `useT()` returns the active translation object. Strings live in `lib/i18n/en.ts` and `lib/i18n/es.ts` — **every user-facing string must exist in both files**.

### Nutrition tracker

- `/nutrition` page — daily calorie/macro diary grouped by meal slot (breakfast/lunch/dinner/snack), ring gauge vs targets, a 7-day trend chart (`WeeklyTrendChart.tsx`), and a **Quick add section** — a 3-tab segmented browse (**recent** / **saved** / **search**) of `FoodRow` lists, all loaded local-first with a pending-ops overlay for `saved_foods`. Tapping any row opens `FoodDetailSheet` directly on the page with an in-sheet meal-slot picker (defaulted by time of day via `defaultMealByTime()`, local to the page) so it can be logged to any meal, portion-adjusted, or un-favorited via the ♥. **Every quick-add list is capped at `QUICK_ADD_LIMIT` (5)** — it's a shortcut, not a browser; the `recent` tab passes the limit explicitly to `getRecentFoodLogs(userId, 30, 5)` so the logger sheet keeps its own default of 8. The `saved` tab's **"Browse all N favorites →"** footer is the *only* entry to the `FavoritesView` subpage (the former always-visible favorites banner was removed as a duplicate of it), so it renders whenever any favorite exists — note this puts favorites behind the `targets` gate, i.e. unreachable until targets are set. The page **centralizes `navHidden`** for its overlays (a single effect keyed on `showFavorites`/`favDetail`/`activeMealSlot`/`editingLog`/`showCalculator`) because the favorites detail sheet stacks on top of the favorites subpage and each overlay toggles nav on its own — the parent effect runs last and asserts the correct final value so closing the top sheet doesn't reveal the nav bar under the still-open subpage. Data tables: `food_logs` (`migrations/add_nutrition.sql`) and `saved_foods` (`migrations/changes.sql`, per-100g macros). All writes go through `enqueue`.
- **Extended nutrition detail (`detail jsonb`)** — both `food_logs` and `saved_foods` carry an optional `detail jsonb` column (`migrations/add_food_detail.sql`, mirrors the `drops jsonb` pattern): extended macros (sugars/fiber/saturated-fat/sodium in grams), a `micros` map of vitamins/minerals (grams, keyed by OFF nutrient id), `nutriScore`/`novaGroup`, and brand/category/serving. Numeric fields are per-100g on `saved_foods`, per-serving on `food_logs`. Typed as `FoodDetail` in `types/index.ts`. The whole local-first pipeline (`executeLocalOp`/`MockQueryBuilder`/`backupToCloud`/`restoreFromCloud`) carries it through generically — **adding nutrient fields needs no db.ts/offlineQueue.ts/supabase.ts/backupService.ts changes**, only the migration + `FoodDetail` type + the OFF mapping + payload literals. ⚠️ **The `alter table … add column detail jsonb` must be applied in Supabase before a client writes it** — backup/flush upload every local column and don't strip unknowns for these tables, so a missing remote column makes PostgREST reject the entire upsert (breaks sync/backup wholesale; guests never sync so they're unaffected).
- `components/nutrition/FoodLoggerSheet.tsx` — bottom sheet with tabs: **manual** entry, **search** (Open Food Facts + barcode), **saved** (favorites), and **AI** (dev-only). Tapping a search result or a favorite opens the **detail sheet** rather than logging inline; favoriting/logging flow through it. The favorites/search rows are the shared `FoodRow`.
- `components/nutrition/FoodRow.tsx` — the tappable food row used by the quick-add lists and the logger's search/favorites tabs. **No food icon**: the leading slot is a monospace kcal readout (`.metric`) with a `basis` caption (`per 473 g`), because a guessed-from-the-name emoji is imprecise decoration where the compared number belongs. Props `{ name, brand, basis, kcal, tag, onClick }`.
- `components/nutrition/FoodDetailSheet.tsx` — the Apple-style food detail sheet (glass shell + `useNav` nav-hide, same as FoodLoggerSheet). Header (♥ favorite toggle + name + brand — no emoji tile), 4 macro tiles, a segmented Protein/Carbs/Fat calorie-% bar (`macroCaloriePercents` in `lib/nutrition.ts`), a **collapsed "Nutrition details" disclosure** (only shown when a food has extended data) revealing the sugar/fiber/sat-fat/sodium breakdown + vitamins/minerals with %DV bars + Nutri-Score (official-scale colors) & NOVA badges, then quantity/portion and an "Add to [meal]" CTA. Consumes a normalized per-100g `DetailFood` (the type lives in `types/index.ts` so `lib/savedFoods.ts` can build one without importing UI); scales macros + `detail` (`scaleDetail`) by the chosen portion on add. Reached from FoodLoggerSheet's search/favorites tabs (fixed meal) **and** the `/nutrition` quick-add section (via the optional `mealSelector` prop — a meal-slot picker rendered above the CTA when the food isn't tied to a preset meal). The macro tiles + segmented bar + extended-details rendering come from the shared `NutritionFacts.tsx`.
  - **Portion units** are `g | serving | package` (`PortionUnit`), built dynamically from what the food knows: `detail.servingGrams`, `detail.packageGrams`. The package unit is **suppressed when it's within 0.5 g of one serving** (single-serve cans list their serving size *as* the package, which would render two identical buttons). A self-labeling "Use whole package — 474 ml" shortcut sits under the picker.
  - **`onToggleFavorite(basisGrams)` is WYSIWYG**: the portion currently displayed becomes the saved favorite's basis, so "the whole 474 ml can with these macros" is one tap and needs no separate save dialog. A hint line states the grams the ♥ will use.
  - **Reopen precedence**: `food.preferredPortionG` (a favorite's saved basis, or the weight a recent log used) wins over `detail.servingGrams`, re-expressed in whichever unit matches it exactly so a package favorite reads "1 package" not "474 g"; only then `servingGrams` → 1 serving, then `defaultWeightG` in grams. Before this, `servingGrams` unconditionally won and `default_weight_g` was dead for any OFF product with a serving size.
- `components/nutrition/NutritionFacts.tsx` — shared presentational nutrition facts, one source of truth for both the detail sheet and the favorites subpage: `<MacroSummary>` (4 macro tiles + segmented Protein/Carbs/Fat calorie-% bar), `<NutritionFactsDetails detail carbs fats>` (sugar/fiber/sat-fat/sodium breakdown + vitamins/minerals %DV grid + Nutri-Score/NOVA, renders null when no extended data), plus `hasExtendedDetail()` and `fmtNutrient()` helpers.
- `components/nutrition/FavoritesView.tsx` — full-screen **Favorites subpage** (browse all saved foods + full nutrition anytime). NOT a route — an in-page overlay mirroring `ActiveWorkout` (`fixed inset-0 z-[60]` + `setNavHidden(true)` + its own back ✕), because a nested `/nutrition/favorites` route would break the strict `path === href` nav pill and the `basePath === "/nutrition"` header, and hardware back is blocked while `navHidden`. Search + category-filter chips + expandable cards (collapsed rows carry the same kcal readout as `FoodRow`, no emoji); expanding a card shows `<MacroSummary>` + `<NutritionFactsDetails>` **at the food's own saved basis**, with a `473 g | 100 g` toggle (rendered only when the basis isn't already 100 g) so a whole-package favorite can still be compared per-100g. **Add to diary** (reuses the page's `openFavDetail` → detail sheet stacks above) and **♥ Remove**. Older/manual favorites with no `detail` just show macros (no OFF backfill).
- `lib/savedFoods.ts` — the one source of truth for the favorites basis rule and the favorite↔detail-sheet conversions: `savedBasisGrams(fav)` (`default_weight_g`, falling back to 100 for legacy rows), `scaledFavorite(fav, basisG?)` (macros + `scaleDetail`'d extended detail at that basis), `toDetailFood(fav)`, `buildSavedFood(food, basisGrams, userId)`, `findSavedMatch(list, food)` (**barcode `detail.code` first, then exact name** — the same product saved under a locale-translated name used to read as un-favorited), `sortFavorites` (newest first). The ♥ toggle and the per-100g normalizer were hand-copied in both `/nutrition` and `FoodLoggerSheet`; they route through here now so the basis rule can't drift.
- **Whole-package vs per-100g favorites** — `saved_foods.calories_100g`/`protein_100g`/… stay **canonical per-100g whatever basis the user saved at**; `default_weight_g` alone records the chosen basis (473 for a whole can, 100 for a per-100g reference) and every display scales the canonical values to it. **This needs no migration** — both columns already exist, and `detail` only gains `packageGrams`/`packageLabel` *inside* the existing jsonb. Legacy rows are unaffected (their stored numbers never had a basis baked in); the only visible change is that a favorite whose `default_weight_g` was already a real serving now reads at that serving instead of at 100 g, which is the more useful reading. Do **not** bake a basis into the four numeric columns — `food_logs` writes, backup/restore, and `FavoritesView` all assume per-100g.
- `lib/openFoodFacts.ts` — the shared OFF client (`offSearchProducts`/`offProductByBarcode`/`mapOffProduct`/`parseServingGrams`/`hasNutritionData`, `OffItem` type), extracted from FoodLoggerSheet so the detail sheet reuses it. `mapOffProduct` builds the per-100g `FoodDetail` from the same `nutriments` object that was already fetched (the extended nutrients were previously discarded). Text search is Mexican-market-first then worldwide; barcode uses the world v2 endpoint.
  - **Quantity parsing** feeds the detail sheet's serving/package portions. `parseServingGrams` handles any free-text amount label via one `UNIT_TO_GRAMS` table (kg/g/gr/mg, l/dl/cl/ml — volume 1:1 with mass), longest-unit-first alternation so `ml` never reads as `l`, and a `\b` guard so the "l" in `"1 lata 473 ml"` isn't a litre. It returns null rather than guessing when no mass/volume unit is present (`"16 fl oz"`, `"6 pieces"`) — a wrong guess writes wrong macros into the diary. `quantityToGrams` handles OFF's *numeric* `serving_quantity`/`product_quantity` + their unit sibling, rejecting non-mass units because OFF also stores plain counts there.
  - **Serving:** `serving_quantity` (numeric, preferred) → regex on `serving_size`. **Package:** `product_quantity` (numeric) → regex on the `quantity` label. Both chains matter — the **Search-a-licious text-search API silently ignores `product_quantity`/`serving_quantity`** even when requested and returns only the `quantity` label, whereas the **barcode v2 endpoint returns all of them**. Without the label fallback, package portions would work on scans and be missing on searches.
- `lib/dailyValues.ts` — FDA `DAILY_VALUES` (in grams, unit-agnostic %DV), `percentDV()`, `formatNutrientAmount()` (g/mg/µg), and bilingual `NUTRIENT_LABELS`/`MICRO_KEYS` for the vitamins/minerals grid.
- **The nutrition UI is emoji-free by design.** `lib/foodIcons.ts` (`foodEmoji`) was deleted: a regex-guessed food emoji is both inaccurate and visually cheap in an instrument-panel design, so rows/headers carry data (the kcal readout) or nothing. Monochrome typographic glyphs (`♥ ♡ ◈ › ▲ ▼ × ⚙ ⚠`) are part of the Cryo Lab language and are fine; full-color emoji are not. Don't reintroduce them here.
- `components/nutrition/BarcodeScanner.tsx` — camera barcode reader via `html5-qrcode`.
- `components/nutrition/WeeklyTrendChart.tsx` — 7-day calorie bar chart (recharts) with a dashed reference line at the target; needs ≥2 days of data to render.
- **`lib/analytics/tdee.ts` — Adaptive TDEE.** `lib/nutrition.ts` *predicts* expenditure (BMR × a coarse activity multiplier); this *measures* it from what happened: `TDEE = mean intake − (trend weight change × 7700 kcal/kg ÷ days)`. Pure functions, fed entirely from IndexedDB, so it behaves identically offline and for guests.
  - `ewmaSeries()` — exponentially weighted moving average of daily scale weight, **decayed by the gap between weigh-ins rather than by array index**, so a missed week decays the old value by a week; index-based EWMA on irregular logs makes a stale weight look current. Same-day duplicates are averaged first. This is the smoother behind the displayed trend weight and the chart series.
  - ⚠️ **`fitTrendLine()` (least squares), not the EWMA endpoints, produces the rate.** An exponential filter lags: on a genuinely linear trend it settles a fixed distance behind the truth while its *first* value is seeded at the raw reading with no lag, so differencing the two ends systematically under-reads the real change. Measured against a synthetic 21-day, −0.45 kg/wk ground truth that shortfall was worth **~200 kcal/day of TDEE** — more than the effect the whole feature exists to detect. A regression slope has no such bias (noise raises its variance, reported as `fitQuality`/confidence, not its expectation). Don't "simplify" this back to `last.trendKg − first.trendKg`.
  - Unlogged days are **never counted as zero-calorie days** — mean intake is taken only over days that carry a food log, and `intakeCoverage` (which drives confidence) reports how sparse that is. Treating a gap as a fast is the single most common way an adaptive estimate goes wrong. Guards: ≥6 weigh-ins spanning ≥10 days, ≥8 intake days, TDEE inside 800–6000, window clamped to 14–30 days.
  - `recommendWeeklyAdjustment()` — compares the observed %BW/week against `GOAL_RATE_BANDS` (hypertrophy +0.25…+0.5, maintenance ±0.15, cut −1.0…−0.5). **Inside the band it returns `onTrack` and changes nothing** — chasing the midpoint weekly just adds noise to the next estimate. Outside it, the *rate gap* is converted through 7700 kcal/kg into a daily delta, capped at ±300 kcal/wk so the next window isn't unreadable. `macrosForCalories()` anchors protein (2.0 g/kg) and fat (0.8 g/kg, floor 0.6) to body mass and lets carbs absorb the swing — the same shape as `calculateNutrition`'s `sportsScience` split, so switching between the manual calculator and the adaptive engine doesn't reshuffle macros.
- `components/nutrition/AdaptiveTdeeCard.tsx` — surfaces the above on `/nutrition`; "Apply" writes the new targets to the `auth:nutrition_targets` cache key (same device-local store the calculator uses).
- **Recipes — `lib/recipes.ts` + `components/nutrition/RecipeManager.tsx`.** Solves raw→cooked: databases list meat raw and grains dry, people weigh food on the plate. The model is **macros are conserved through cooking, mass is not** — batch totals come from the RAW weights and RAW per-100g values, and only the divisor changes. `yieldFactor` is cooked g ÷ raw g, so it handles both directions (chicken 0.75, dry rice 2.8); `YIELD_PRESETS` ships the USDA table. A **measured** `cookedWeightG` always overrides the summed estimate — a scale beats a lookup table. `portionByCookedGrams` / `portionByServings` divide against that. `RecipeManager` is a full-screen overlay, not a route (same reason as `FavoritesView`: a nested route breaks the strict `path === href` nav pill and the `basePath === "/nutrition"` header, and hardware back is blocked while `navHidden`); it saves the recipe before logging a portion so a portion from an unsaved draft can't vanish, and logs through the normal `enqueue` → `food_logs` path. Recipes themselves are a local-only store.
- `components/settings/NutritionCalculator.tsx` — BMR/TDEE/macros calculator (Mifflin-St Jeor or Cunningham + US Navy body-fat helper, `lib/nutrition.ts`). Targets/inputs are saved to the IndexedDB `cache` (`auth:nutrition_targets` / `auth:nutrition_inputs`) — device-local, not synced to the cloud.
- `components/home/NutritionDisplay.tsx` — home-page summary card of today's intake vs targets.
- `lib/foodAi.ts` — `analyzeMealWithAI()` calls the Gemini API directly from the client (`NEXT_PUBLIC_GEMINI_API_KEY`) with an Open-Food-Facts-style JSON contract; a Supabase Edge Function proxy variant is sketched for production.

### Training analytics & tools

- `lib/oneRepMax.ts` — `e1RM(weight, reps)` = Epley/Brzycki average, null outside 1–12 reps. Used by the `/stats` "Strength progress" card (`components/stats/ExerciseProgress.tsx`, per-exercise e1RM + top-set chart over the 60-day window, warmup sets excluded).
- **`lib/analytics/volume.ts`** — RP volume auto-regulation. Owns the landmark constants (`MV 6 / MEV 10 / MAV_TOP 20 / MRV 22 / SCALE_MAX 26`) — `VolumeLandmarks.tsx` imports them rather than redeclaring, so the bar and the recommender can't drift. `SET_CHANGE_MATRIX[soreness][pump]` is the set progression table (soreness gates first: still sore means the previous dose is unpaid, and adding volume onto an unpaid debt ends a mesocycle early; within a recovered state a low pump means the session under-delivered and there is room to add). `recommendSets()` clamps **asymmetrically** — up to MRV (the landmark exists to stop you going past it), down only to MEV, *except* that still-sore at/above MRV returns a deload to MV, where going below MEV is the point. Feedback older than `FEEDBACK_STALE_DAYS` (14) is ignored and the landmarks alone drive the call. `buildVolumePlan()` maps the stats page's `weeklyMuscles` into per-muscle recommendations.
- **`lib/volumeFeedback.ts`** — the `volume_feedback` IndexedDB store (device-local, see "Local-only stores"). `saveVolumeFeedback()` prepares rows *before* opening the transaction and issues puts without awaiting each (offline pattern rule 6); re-rating the same muscle for the same session replaces the earlier row.
- `components/training/VolumeFeedbackPanel.tsx` — two 3-way questions (pump / soreness) per muscle group, rendered on `ActiveWorkout`'s completion screen in **both** standard and circuit mode. Targets are derived from the logged sets via `exercise_id → muscle_group` (falling back to a name match), warmups excluded; a session whose exercises carry no muscle group renders nothing. **Answering is optional and never blocks the save** — only fully-answered groups are stored (a half-filled row can't index the matrix, and guessing the missing axis would fabricate data), and `saveWorkout` wraps the write in try/catch so feedback can never fail a workout: the sets are the record, the ratings are commentary.
- `components/stats/VolumeLandmarks.tsx` — weekly sets per muscle vs the landmarks, plus the next microcycle's target from `buildVolumePlan` (a marker on the bar, not a fill, so it reads as a destination rather than volume already done). The stats page loads feedback with `getRecentVolumeFeedback` **before** the cache branch and before every early return, so guests and offline users get auto-regulation identically.
- `lib/plates.ts` — barbell plate math (`calcPlates`) + `warmupScheme` (bar×10 → 50%×5 → 70%×3 → 85%×1). UI: `components/training/PlateCalculator.tsx`, opened from the ⚖ button on weight inputs in `ActiveWorkout`.
- Rest timer end plays `playRestComplete()` (lib/sounds.ts) + haptics (Capacitor on native, `navigator.vibrate` on web).
- `lib/exportData.ts` — `exportAllAsJson()` (every IndexedDB table) and `exportWorkoutsAsCsv()` (sets joined with session dates); wired to the Settings "Data Export" card.
- **Exercise library** — `public/exercise-library/` bundles a trimmed, offline copy of the [exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) project (1,324 exercises: `exercises.json` + 180×180 thumbnail `images/`, ~13MB total, static assets so they work fully offline and get picked up by the SW's generic cache-first fallback on first load). `components/training/ExerciseLibraryPicker.tsx` is a search/filter browser over it, shown as a second option (`t.exerciseLibrary.title`) next to the manual "+ Add exercise" form on the Training → Exercises tab. Picking an entry converts its bundled thumbnail to a base64 `machine_photo_path` via the existing `compressImage()` helper and saves it through the same local-first `enqueue` path `ExerciseForm` uses — it becomes an ordinary `exercises` row, so sync/backup/restore need no changes. The dataset's fine-grained `body_part`/`target` taxonomy is mapped to the app's coarse `muscle_group` set (Chest/Back/Shoulders/Biceps/Triceps/Legs/Glutes/Core/Cardio/Other) in the bundled JSON's `app_muscle_group` field so stats features (BodyHeatmap, VolumeLandmarks) work on imported exercises. Media is © Gym visual, redistributed at 180×180 with attribution per `public/exercise-library/NOTICE.md`; the attribution line is shown in the picker UI itself.

### Developer mode & admin panel

- `lib/devMode.ts` — `DEV_EMAILS` allowlist (currently the owner's gmail; the **same email is hardcoded again** in `migrations/add_admin_config.sql`'s RLS policy and in `supabase/functions/admin-stats/index.ts`'s `ADMIN_EMAILS` — update all three if the allowlist ever grows). `isDevUser()` checks the account email cache-first (IndexedDB `auth:userEmail`) so it works offline after first sign-in; guest users are never dev. `isAiScannerEnabled()`/`setAiScannerEnabled()` persist a dev-local toggle in localStorage (`gymtrack:dev_ai_enabled`) — this is only the owner's own bundled-key access, unrelated to the global flag below.
- **`canUseAiScanner()` gating** (used by `FoodLoggerSheet`'s AI tab): the owner account is always eligible (their own saved key, or the dev toggle falling back to the bundled `NEXT_PUBLIC_GEMINI_API_KEY`). Everyone else is eligible only when **both** are true: they've added their own Gemini key in Settings (synced to `profiles.gemini_api_key`) **and** the admin has flipped the global switch on (`lib/appConfig.ts` `isAiScannerGloballyEnabled()`). The global flag alone never unlocks the bundled key for other users — that would run their AI calls on the owner's quota.
- Settings shows a Developer Mode card (en/es) only when `isDev` — dev email readout, the bundled-key toggle, and an **"Open Admin Panel →"** button.
- This allowlist check is a UI gate, not a security boundary on its own (static export ships `NEXT_PUBLIC_*` keys and the allowlist itself to every client) — real enforcement for privileged operations lives server-side (RLS policy / Edge Function checks), see below.

**Admin panel — `components/settings/AdminPanel.tsx`.** Full-screen overlay subpage (same "not a route" pattern as `FavoritesView` — `fixed inset-0 z-[60]` + `setNavHidden(true)` + its own back button), reachable only via the Developer Mode card's button. Two things live here:

1. **Global AI-scanner flag** — a toggle bound to `lib/appConfig.ts`'s `isAiScannerGloballyEnabled()` / `setAiScannerGloballyEnabled()`, backed by the `app_settings` table (`migrations/add_admin_config.sql`): a single row (`id = 1`), readable by **anyone** via RLS (`using (true)` — no sensitive data in it), writable only by the admin account via an `auth.jwt() ->> 'email'` check inside the RLS policy itself, not just the client-side allowlist. Cached in IndexedDB (`appConfig:aiScannerGlobalEnabled`) so a previously-fetched value survives offline; **defaults to `false`** when never fetched — fail closed, since this gates a cost/access control rather than a cosmetic setting. `app_settings` deliberately sits **outside** the standard per-user local-first pipeline (not in `REMOTE_TABLES` / `LOCAL_TABLES` / `db.ts` / `TABLES_BACKUP_ORDER`) — it's a global singleton the admin edits rarely and only while online, not per-user data needing offline queueing.
2. **Cross-user app stats** (total users, workout sessions/sets, food logs, saved foods, exercises, users with their own AI key, new users in 30d, activity in 7d) via `lib/appConfig.ts`'s `fetchAdminStats()`, which invokes the `admin-stats` Supabase Edge Function.

**`supabase/functions/admin-stats/index.ts`** is the **first and only server-side code in this project** — everything else is client-side static export (see Static export constraints below). It exists because RLS fundamentally cannot let a client see other users' rows no matter how the UI gates it: the function uses the **service-role key** (auto-injected as `SUPABASE_SERVICE_ROLE_KEY`, never shipped to any client) to bypass RLS, but first re-validates the caller's JWT server-side and checks their email against its own `ADMIN_EMAILS` constant — it returns 403 even if called directly by a non-admin account. Deployed via the Supabase MCP tools (or `supabase functions deploy`), independently of `npm run build`. The `supabase/` directory is **excluded from both the Next.js TypeScript build (`tsconfig.json` `exclude`) and ESLint (`eslint.config.mjs` `ignores`)** — it's Deno runtime code (`npm:`/`jsr:` specifiers, `Deno.serve`) and doesn't type-check under the Next.js project's `tsconfig`.

### Cloud backup / restore

- `lib/backupService.ts` — manual, user-triggered sync in Settings: `connectBackupAccount` / `signUpBackupAccount` (also migrates local guest/previous-account data to the new user id via `migrateLocalDataToUserId`), `backupToCloud()` (upserts every IndexedDB table store to Supabase), `restoreFromCloud()` (replaces local stores with cloud data, then clears page caches but **preserves `auth:*` keys**), `disconnectBackupAccount`.
- **`migrateLocalDataToUserId` takes the pre-auth local user id as a parameter — it must be snapshotted *before* calling `signInWithPassword`/`signUp`, never read from cache afterward.** The `onAuthStateChange` listener in `lib/supabase.ts` overwrites the `auth:userId` cache with the new account's id as part of the sign-in call itself (supabase-js's `signInWithPassword`/`signUp` `await` `_saveSession`/`_notifyAllSubscribers`, which runs every `onAuthStateChange` listener, *before* they return) — reading `auth:userId` from cache after the auth call always reads the already-overwritten new id and silently skips migrating the old (guest or previous-account) data.
- `backupToCloud()` also self-heals: before backing up, it re-stamps any local row still carrying the literal `"guest-user"` sentinel to the current session's user id, in addition to migrating a stale previous-real-account id if the cache still shows a mismatch. This recovers accounts that already connected before the fix above existed — without it, guest-era `exercises`/`workout_folders` rows stay excluded from backup forever (filtered out by the `"guest-user"` guard in `backupToCloud`'s sanitizer), while `routine_exercises`/`workout_sets` — which have no `user_id` column to filter on — still reference them, and the upsert fails with a foreign-key violation.
- When adding a table, also add it to `TABLES_BACKUP_ORDER` and (if it has `user_id`) to the migration list in `migrateLocalDataToUserId`.

### PWA / service worker

- `public/sw.js` — network-first for app-shell pages, cache-first for static assets, RSC-request redirect to exported `.txt` payloads. Bump the `CACHE` version string when changing caching behavior.
- **The SW registers in production builds only.** The `sw-register` script in `app/layout.tsx` inlines `IS_PROD` at build time; in dev it actively unregisters any SW and clears caches — a SW in dev serves stale Turbopack chunks (same URL, changed content) and replays old bundles with confusing errors. Never register the SW in dev.

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
- `WeightLogger.tsx` — log body weight for any date; writes offline via `enqueue`
- `WeightChart.tsx` — recharts line chart of recent weight history
- `WaterTracker.tsx` — tap-to-increment water intake; writes offline via `enqueue`
- `WaterHistorySheet.tsx` — bottom sheet showing water log history
- `PhotoGallery.tsx` — progress photos via `<input type="file">`, compressed to base64 and stored in the `progress_photos` row (not Storage); lightbox viewer; falls back to `enqueue` on failed insert
- `NutritionDisplay.tsx` — today's calories/macros vs targets summary card

**`components/training/`**
- `RoutineManager.tsx` — create/edit/delete workout folders and planned exercises (sets/reps/weight/rest/set-type) within them; all 6 writes are local-first (`enqueue` → local state → `triggerSync`), no direct Supabase calls
- `ExerciseForm.tsx` — form for adding an exercise definition (machine photo stored as base64); saves local-first via `enqueue`
- `ExerciseLibraryPicker.tsx` — search/filter browser over the bundled offline exercise dataset (see Training analytics & tools below); saves local-first via `enqueue`, same as `ExerciseForm.tsx`
- `ExerciseList.tsx` — searchable exercise picker
- `WorkoutSession.tsx` — per-session card: view/add/edit/delete exercise set groups; every write re-enqueues the *full* session state via `save_workout`, local-first (`toSetPayload`, exported, must include `weight_unit`/`rpe`/`notes` or data is corrupted on flush). `save`/`saveEdit`/`deleteExerciseFromSession` wrap the `enqueue` in `try/catch/finally` (surface `t.workoutSession.saveFailed`, always reset the `saving`/`updating` flag) so a local-write throw can't wedge the UI
- `ActiveWorkout.tsx` — guided workout overlay (rest timer, planned sets); hides the nav bar via `useNav()`
- `PRToast.tsx` — fixed bottom toast shown after saving a workout when a new weight PR is detected; plays `playPR()` and auto-dismisses after 5 s

**`components/nutrition/`** — see Nutrition tracker section above.

**`components/stats/`**
- `BodyHeatmap.tsx` — SVG muscle-group heatmap coloured by workout frequency
- `MuscleDistribution.tsx` — pie/bar breakdown of muscle groups trained
- `MonthlyReport.tsx` — monthly volume summary
- `TopExercises.tsx` — most-performed exercises ranked by set count
- `ExerciseProgress.tsx` — per-exercise e1RM + top-set chart over a 60-day window (see `lib/oneRepMax.ts` below)
- `VolumeLandmarks.tsx` — weekly sets per muscle vs RP hypertrophy landmarks
- `PersonalRecords.tsx` — list of current e1RM PRs per exercise, `isRecent` rows flagged with a `NEW` badge
- `RepRangeFocus.tsx` — training split across strength (1-5 reps) / hypertrophy (6-12) / endurance (13+) as a segmented bar + percentages
- `TrainingConsistency.tsx` — streak/this-week/weekly-avg tiles plus a 12-week session-count bar chart

**`components/ui/`**
- `CachedPill.tsx` / `OfflinePlaceholder.tsx` — offline-state indicators

### Theme system

Dual light/dark theme using CSS custom properties on `:root` / `html.dark`. Theme is persisted to `localStorage` and applied via `ThemeProvider` (`lib/context/ThemeContext.tsx`). A bootstrap script in `app/layout.tsx` reads the stored theme before hydration to prevent flash (and applies the `navigator.onLine` override). It is injected via `next/script strategy="beforeInteractive"` — **never render a raw `<script>` tag through JSX**: React 19 warns ("Encountered a script tag while rendering React component") and won't execute it on client renders.

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

All shared TypeScript types live in `types/index.ts`: `Profile` (includes `gemini_api_key?: string | null`, the user's own AI key), `DailyWeightLog`, `WaterLog`, `FoodLog`, `SavedFood`, `ProgressPhoto`, `Exercise`, `WorkoutFolder`, `WorkoutSession`, `WorkoutSet`, `RoutineExercise`, `LoggedSet`, `Drop`, `SetType`, `WeightUnit`, `DistanceUnit`, `AppSettings` (the `app_settings` row shape), `AdminStats` (the `admin-stats` Edge Function response shape), `PumpRating`/`SorenessRating`/`VolumeFeedback` (volume auto-regulation), `Recipe`/`RecipeIngredient`.

### Static export constraints

`next.config.js` sets `output: "export"`, which means:
- No server-side features (API routes, server actions, `getServerSideProps`)
- `next/image` optimization is disabled (`unoptimized: true`)
- All data fetching must be client-side
- **The one exception is `supabase/functions/admin-stats`** (see Developer mode & admin panel above) — it's Supabase-hosted Deno code, deployed independently of `npm run build`, not part of this Next.js app at all. Don't reach for another Edge Function as a shortcut around "no server-side features" without a genuinely RLS-unsolvable reason (cross-user reads); every other privileged operation in this app goes through RLS, not a function.

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
- AndroidManifest permissions: `INTERNET`, `POST_NOTIFICATIONS` (Android 13+ for water reminders), `CAMERA` (getUserMedia in the WebView for the barcode scanner)
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
