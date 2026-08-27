-- Program.enrollment_payment_url: an external (Razorpay) payment-page link per program.
--
-- WHY
--   Staff want to sell a program through a Razorpay Payment Link they create in the
--   Razorpay dashboard, without the in-app checkout. When this is set AND
--   enrollment_enabled is true, every "Enroll Now" button on the public site opens this
--   link instead of /enroll/:slug. When it is NULL the in-app checkout is used as before,
--   so no existing program changes behaviour on deploy.
--
--   It rides on the existing enrollment_enabled toggle rather than adding a second one:
--   a link that is set while enrollment is closed is simply not shown (the public
--   projection nulls it out), so there is exactly one switch that opens or closes sales.
--
-- FORWARD-ONLY and re-runnable.
ALTER TABLE "programs"
  ADD COLUMN IF NOT EXISTS "enrollment_payment_url" TEXT;
