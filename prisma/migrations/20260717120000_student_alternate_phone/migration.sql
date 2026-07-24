-- lifecycle-redesign (registration step): secondary/guardian contact number
-- captured when a lead-contact completes full registration. Nullable — existing
-- rows and quick-add contacts are unaffected.
ALTER TABLE "student_profiles" ADD COLUMN "alternate_phone" TEXT;
