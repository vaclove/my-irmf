-- Create table for storing GoOut API tokens
-- Access tokens are valid for 24 hours
-- Refresh tokens are valid for 60 days

CREATE TABLE goout_tokens (
  id SERIAL PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  refresh_expires_at TIMESTAMP NOT NULL
);

-- Insert initial tokens provided by user
INSERT INTO goout_tokens (access_token, refresh_token, expires_at, refresh_expires_at)
VALUES (
  'eyJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3NTkxODE1NTMsInN1YiI6IjEyODQyODUifQ.lISVTMXNugLF0gGWoTN3mzF6CVi3f83BTKU9fUhbv9AeaLbEUfhjx5YAEu7ZbyT2mL7A32ZYDru2iG70UFxYjQ',
  'eyJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3NTkxODE1NTMsInN1YiI6IjEyODQyODUifQ.oyUiKdaMHmNT69vEy4vT902U55jsghF0M2Z1dlHKk9xaUAkmtTNi2u5fh7UjUqPSEnKsJDuvXDp0gTcDDuOeeg',
  CURRENT_TIMESTAMP + INTERVAL '24 hours',
  CURRENT_TIMESTAMP + INTERVAL '60 days'
);

-- We only need one row for the tokens, so we'll enforce that with a check
-- In the future, we can add more sophisticated logic if needed
CREATE UNIQUE INDEX goout_tokens_singleton ON goout_tokens ((TRUE));