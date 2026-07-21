# Exercise Library Attribution

`exercises.json` and `images/` in this directory are derived from
[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset).

- Exercise data (names, body parts, targets, equipment, instructions) is MIT-licensed.
- Thumbnail images are © Gym visual — https://gymvisual.com/ — redistributed at
  180×180 with permission. Attribution is shown in the in-app library picker
  (`components/training/ExerciseLibraryPicker.tsx`); keep it intact if this
  directory is regenerated.

Regenerate with the transform in this repo's history (trims the upstream
`data/exercises.json` to `{id, name, body_part, target, equipment,
app_muscle_group, instructions: {en, es}, image}` and maps body_part/target to
GymTrack's coarse muscle-group taxonomy) if the upstream dataset updates.
