-- 001_extensions.sql
-- Core extensions only.
-- pgcrypto gives us gen_random_uuid() for primary keys.

create extension if not exists pgcrypto;