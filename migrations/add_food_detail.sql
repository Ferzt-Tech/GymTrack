-- Extended nutrition detail for foods (sugars, fiber, saturated fat, sodium,
-- vitamins/minerals, Nutri-Score, NOVA, brand, category, serving info).
--
-- Stored as a single jsonb column per table, mirroring the `drops jsonb`
-- pattern on workout_sets: one column, no future migration needed to add more
-- nutrients, and the local-first sync/backup pipeline carries it through
-- generically (executeLocalOp / MockQueryBuilder / backupToCloud all spread
-- arbitrary columns).
--
-- ⚠️ APPLY THIS BEFORE shipping the client that writes `detail`. backupToCloud
-- and flushQueue upload every local column and do NOT strip unknown ones for
-- these two tables, so PostgREST would reject the ENTIRE upsert over a missing
-- column — breaking cloud sync/backup wholesale until this runs. (Guest mode
-- never syncs, so it is unaffected.)
--
-- Shape of `detail` (all numeric nutrient values in GRAMS, per-100g on
-- saved_foods and per-serving on food_logs):
--   {
--     "brand": "Optimum Nutrition", "category": "Supplements", "code": "748927024074",
--     "servingSize": "1 scoop (30 g)", "servingGrams": 30,
--     "sugars_g": 2, "fiber_g": 0.5, "satFat_g": 0.5, "sodium_g": 0.05, "salt_g": 0.12,
--     "micros": { "vitamin-c": 0.012, "calcium": 0.12, "iron": 0.002 },
--     "nutriScore": "a", "novaGroup": 4, "source": "off"
--   }

alter table food_logs  add column if not exists detail jsonb;
alter table saved_foods add column if not exists detail jsonb;
