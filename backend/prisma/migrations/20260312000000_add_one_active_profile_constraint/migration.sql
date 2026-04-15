-- Ensure at most one allocation profile can be active at a time.
-- PostgreSQL partial unique index: only rows where is_active = true are constrained.
CREATE UNIQUE INDEX allocation_profiles_one_active ON allocation_profiles (is_active) WHERE is_active = true;
