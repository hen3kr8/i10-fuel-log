# i10 Fuel Log

A small web app for logging fill-ups of the 2018 Hyundai i10. It works on both phones, and no one needs an account to use it.

- **App:** static files (`index.html`, `app.js`, `config.js`) hosted for free on GitHub Pages
- **Data:** a free Supabase (Postgres) database
- **Access:** one household PIN. Each phone remembers it after the first time.

Setup takes about 20 minutes, and you only do it once. Babette only needs the link and the PIN.

---

## 1. Create the database (Supabase)

1. Go to <https://supabase.com>, sign up (free) and click **New project**.
   - Name: `i10-fuel-log`. Region: a European one (e.g. *Central EU (Frankfurt)*). Choose and save a database password; the app doesn't use it.
2. When the project is ready, open **SQL Editor → New query**, paste the whole of `supabase/schema.sql` and click **Run**.
   You should see "Success. No rows returned".
3. Set the household PIN in a **new query** (use at least 6 characters; a short phrase is best):
   ```sql
   select private.set_pin('your own pin here');
   ```
   Run the same line again any time to change the PIN. Both phones will then ask for the new one.
4. Open **Project Settings → API Keys** (on older dashboards: **Settings → API**) and copy:
   - the **Project URL**, e.g. `https://abcdefghijkl.supabase.co` (also shown under **Data API**)
   - the **publishable** key (`sb_publishable_…`), or on older projects the **anon public** key (`eyJ…`)

   Never use the *secret* / *service_role* key in the app.

## 2. Fill in `config.js`

```js
window.FUEL_CONFIG = {
  supabaseUrl: "https://abcdefghijkl.supabase.co",
  supabaseAnonKey: "sb_publishable_…",
  car: "Hyundai i10 · 2018",
  tankLiters: 40,
  drivers: ["Hendri", "Babette"]
};
```

The publishable/anon key is meant to be public. On its own it can't read or change anything. Every read and write goes through database functions that check the PIN first.

## 3. Put it online (GitHub Pages)

1. On GitHub, create a new **public** repository, e.g. `i10-fuel-log`.
2. Click **Add file → Upload files** and drag in everything from this folder. Use **Commit changes**.
   - The browser upload may skip the hidden `.github` folder. If it does, use **Add file → Create new file**, type `.github/workflows/keepalive.yml` as the name, and paste in that file's contents.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, **main**, **/ (root)**, then **Save**.
4. After a minute the app is live at `https://<your-username>.github.io/i10-fuel-log/`.

(If you use git: `git init && git add . && git commit -m "Fuel log" && git push` to the new repo works just as well.)

## 4. Keep the free database awake

Supabase pauses free projects after about a week with little activity, and fill-ups are often two weeks apart. The included GitHub Action pings the database once a day:

1. In the repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `SUPABASE_URL`, with the same value as in `config.js`
   - `SUPABASE_KEY`, with the same value as in `config.js`
2. Open the **Actions** tab, select **Keep database awake** and click **Run workflow** once to check it turns green.

If the project does get paused, open it in the Supabase dashboard and click **Resume project**. The data is kept.

## 5. Install on both phones

1. Open the link and enter the PIN. Tap your name, so each fill-up shows who logged it.
2. Add it to the home screen:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*

Send Babette the link and the PIN; that's all she needs.

---

## Using it

- **Log a fill-up:** enter the odometer reading, litres, total paid and the station name. The app checks that the odometer reading goes up and that the litres fit in the tank.
- **Filled to full:** consumption (L/100 km and "1 op X") is only calculated between two full tanks. Untick it for a partial fill.
- **km per month:** the distance since the previous fill-up is counted in the month of the new fill-up.
- **Cheapest near you:** ranks the stations *you* have filled up at by the last price you paid there. Tick **Save station location** when logging to see distances, and tap **Use my location** to show only stations within 25 km. The two links open Google Maps and today's pump prices around you. There's no free official feed of Dutch pump prices, so the app doesn't fetch live prices itself.
- **Export CSV:** downloads all fill-ups.
- **Lock this phone:** forgets the PIN on that device.

## Querying with SQL

In Supabase's SQL Editor, for example:

```sql
-- consumption per leg between full tanks
select filled_on, odometer_km,
       odometer_km - lag(odometer_km) over w as km,
       round(liters / nullif(odometer_km - lag(odometer_km) over w, 0) * 100, 2) as l_per_100km,
       round(cost_eur / liters, 3) as eur_per_l, station, driver
from fillups
window w as (order by odometer_km)
order by odometer_km desc;
```

## Security, in short

- The table can't be read or written directly through the API (row-level security is on, with no grants).
- `fuel_list`, `fuel_add` and `fuel_delete` only work with the right PIN. The PIN is stored as a bcrypt hash.
- After 10 wrong PINs within 15 minutes, every PIN check is refused for 15 minutes.
- Anyone with the link *and* the PIN can see and change the log, so share both only with each other.

## Files

| File | What it is |
|---|---|
| `index.html` | layout and styles |
| `app.js` | app logic: sync, charts, stations, history |
| `config.js` | your Supabase URL and key, car and driver names |
| `sw.js`, `manifest.webmanifest`, `icons/` | home-screen install and offline start |
| `supabase/schema.sql` | database setup |
| `.github/workflows/keepalive.yml` | daily ping so the free database doesn't pause |
