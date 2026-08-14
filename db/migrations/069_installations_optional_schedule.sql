-- Allow onboarding jobs with no visit slot yet.
ALTER TABLE installations
  MODIFY scheduled_at DATETIME NULL;
