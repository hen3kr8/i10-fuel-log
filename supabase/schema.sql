-- i10 Fuel Log — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Then set your household PIN (see the last line).
--
-- How access works:
--   * The browser only has the public "anon" key, which on its own can read or write nothing.
--   * The fillups table is locked (RLS on, no policies, no grants).
--   * The app talks to three functions (fuel_list, fuel_add, fuel_delete) that check the PIN first.
--   * After 10 wrong PINs within 15 minutes, all PIN checks are refused for 15 minutes.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;          -- not exposed through the Supabase API
revoke all on schema private from public;

-- ---------- tables ----------
create table if not exists public.fillups (
  id           uuid primary key default gen_random_uuid(),
  filled_on    date          not null,
  odometer_km  integer       not null check (odometer_km > 0 and odometer_km < 2000000),
  liters       numeric(6,2)  not null check (liters > 0 and liters <= 60),
  cost_eur     numeric(7,2)  not null check (cost_eur > 0 and cost_eur < 1000),
  full_tank    boolean       not null default true,
  station      text          check (char_length(station) <= 120),
  driver       text          check (char_length(driver) <= 40),
  lat          double precision check (lat between -90 and 90),
  lon          double precision check (lon between -180 and 180),
  created_at   timestamptz   not null default now()
);
create index if not exists fillups_odometer_idx on public.fillups (odometer_km);

alter table public.fillups enable row level security;   -- no policies: direct API access is denied
revoke all on public.fillups from anon, authenticated;

create table if not exists private.app_pin (
  id        int primary key default 1 check (id = 1),
  pin_hash  text not null
);

create table if not exists private.pin_failures (
  at timestamptz not null default now()
);

-- ---------- helpers (private) ----------
create or replace function private.set_pin(p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_pin is null or char_length(p_pin) < 6 then
    raise exception 'Use a PIN or passphrase of at least 6 characters';
  end if;
  insert into private.app_pin (id, pin_hash)
  values (1, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set pin_hash = excluded.pin_hash;
  delete from private.pin_failures;
end $$;

-- returns null when OK, otherwise an error code ('locked' | 'wrong_pin' | 'no_pin_set')
create or replace function private.pin_error(p_pin text)
returns text language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  delete from private.pin_failures where at < now() - interval '1 day';
  if (select count(*) from private.pin_failures where at > now() - interval '15 minutes') >= 10 then
    return 'locked';
  end if;
  select pin_hash into h from private.app_pin where id = 1;
  if h is null then return 'no_pin_set'; end if;
  if p_pin is not null and extensions.crypt(p_pin, h) = h then return null; end if;
  insert into private.pin_failures default values;
  return 'wrong_pin';
end $$;

-- ---------- API (public, called by the app) ----------
create or replace function public.fuel_list(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text := private.pin_error(p_pin);
begin
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  return jsonb_build_object('ok', true, 'data', coalesce(
    (select jsonb_agg(to_jsonb(f) order by f.odometer_km) from public.fillups f), '[]'::jsonb));
end $$;

create or replace function public.fuel_add(
  p_pin text, p_filled_on date, p_odometer_km integer, p_liters numeric, p_cost_eur numeric,
  p_full_tank boolean default true, p_station text default null, p_driver text default null,
  p_lat double precision default null, p_lon double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text := private.pin_error(p_pin); r public.fillups;
begin
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  insert into public.fillups (filled_on, odometer_km, liters, cost_eur, full_tank, station, driver, lat, lon)
  values (p_filled_on, p_odometer_km, round(p_liters, 2), round(p_cost_eur, 2), coalesce(p_full_tank, true),
          nullif(trim(p_station), ''), nullif(trim(p_driver), ''), p_lat, p_lon)
  returning * into r;
  return jsonb_build_object('ok', true, 'data', to_jsonb(r));
end $$;

create or replace function public.fuel_delete(p_pin text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text := private.pin_error(p_pin);
begin
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  delete from public.fillups where id = p_id;
  return jsonb_build_object('ok', true, 'data', null);
end $$;

-- keep-alive: touches the database without revealing anything (used by the daily GitHub Action)
create or replace function public.fuel_ping()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'data', (select count(*) > -1 from public.fillups));
$$;

-- only the API functions are callable from the browser
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.fuel_list(text) from public;
revoke all on function public.fuel_add(text, date, integer, numeric, numeric, boolean, text, text, double precision, double precision) from public;
revoke all on function public.fuel_delete(text, uuid) from public;
grant execute on function public.fuel_list(text) to anon, authenticated;
grant execute on function public.fuel_add(text, date, integer, numeric, numeric, boolean, text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.fuel_delete(text, uuid) to anon, authenticated;
revoke all on function public.fuel_ping() from public;
grant execute on function public.fuel_ping() to anon, authenticated;

-- ---------- set your PIN ----------
-- Run this once on its own, with your own PIN (6+ characters; a short phrase is best):
-- select private.set_pin('change-me-please');
