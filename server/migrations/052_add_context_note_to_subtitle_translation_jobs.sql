-- Migration: user-provided context note for subtitle translation jobs
-- Adds context_note, an optional free-text note entered when starting a
-- translation (tykani/vykani between characters, character genders,
-- terminology, ...). It is injected into the translation prompts, reused by
-- retries, and prefills the start dialog for the movie's next translation.

ALTER TABLE subtitle_translation_jobs
  ADD COLUMN IF NOT EXISTS context_note TEXT;
