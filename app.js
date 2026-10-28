(function () {
  "use strict";
  const CFG = Object.assign({ car: "Hyundai i10 · 2018", tankLiters: 40, drivers: [] }, window.FUEL_CONFIG || {});
  const $ = (id) => document.getElementById(id);
  const nf = (n, d = 0) => Number(n).toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem("fuel." + k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem("fuel." + k) : localStorage.setItem("fuel." + k, v); } catch (e) {} },
  };

  let entries = [];               // sorted by odometer
  let pin = store.get("pin");
  let driver = store.get("driver") || "";
  let chartKind = "month";
  let pendingDelete = null;
  let here = null;                // {lat, lon} once the person taps "Use my location"

  $("carLabel").textContent = $("carLabel2").textContent = CFG.car;

  // ---------------- API ----------------
  async function api(fn, args) {
    const key = CFG.supabaseAnonKey;
    const headers = { apikey: key, "Content-Type": "application/json" };
    if (!key.startsWith("sb_")) headers.Authorization = "Bearer " + key;   // legacy JWT anon key
    let res;
    try {
      res = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, { method: "POST", headers, body: JSON.stringify(Object.assign({ p_pin: pin }, args)) });
    } catch (e) { throw { code: "offline" }; }
    if (!res.ok) { let m = ""; try { m = (await res.json()).message; } catch (e) {} throw { code: "server", message: m || res.status }; }
    const j = await res.json();
    if (!j || !j.ok) throw { code: (j && j.error) || "server" };
    return j.data;
  }
  const errText = (e) => ({
    wrong_pin: "That PIN isn't right.",
    locked: "Too many wrong PINs. Wait 15 minutes and try again.",
    no_pin_set: "No PIN has been set in the database yet. Run the set_pin step from the README.",
    offline: "No connection. Check your internet and try again.",
  }[e && e.code] || "Something went wrong on the server" + (e && e.message ? ": " + e.message : "."));

  function toEntry(r) {
    return { id: r.id, date: r.filled_on, odometer: +r.odometer_km, liters: +r.liters, cost: +r.cost_eur, full: r.full_tank !== false,
      station: r.station || "", driver: r.driver || "", lat: r.lat, lon: r.lon };
  }
  function setEntries(rows) {
    entries = rows.map(toEntry).sort((a, b) => a.odometer - b.odometer);
    store.set("cache", JSON.stringify(rows));
  }

  // ---------------- gates ----------------
  function show(which) {
    $("setupGate").hidden = which !== "setup";
    $("pinGate").hidden = which !== "pin";
    $("app").hidden = which !== "app";
  }
  function renderDriverChips(container, onPick) {
    container.innerHTML = "";
    CFG.drivers.forEach((name) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = name;
      b.setAttribute("aria-pressed", String(name === driver));
      b.addEventListener("click", () => { driver = name; store.set("driver", name); renderDriverChips(container, onPick); onPick && onPick(); });
      container.appendChild(b);
    });
  }

  $("pinGate").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const val = $("pinInput").value;
    if (!val) return pinHint("Enter the PIN.", true);
    if (CFG.drivers.length && !driver) return pinHint("Pick who's using this phone.", true);
    $("pinBtn").disabled = true; pinHint("Checking…");
    pin = val;
    try {
      setEntries(await api("fuel_list", {}));
      store.set("pin", pin); $("pinInput").value = ""; pinHint("");
      openApp();
    } catch (e) { pin = null; pinHint(errText(e), true); }
    finally { $("pinBtn").disabled = false; }
  });
  function pinHint(m, err) { $("pinHint").textContent = m; $("pinHint").classList.toggle("err", !!err); }

  function openApp() {
    show("app");
    $("asDriver").textContent = driver ? "as " + driver : "";
    render();
    refresh();
  }

  // ---------------- sync ----------------
  let refreshing = false;
  async function refresh() {
    if (refreshing || !pin) return;
    refreshing = true;
    try {
      setEntries(await api("fuel_list", {}));
      sync(true, "Synced · " + entries.length + " fill-up" + (entries.length === 1 ? "" : "s"));
      render();
    } catch (e) {
      if (e.code === "wrong_pin") { lock(); pinHint("The PIN was changed. Enter the new one.", true); }
      else sync(false, e.code === "offline" ? "Offline · showing last synced data" : "Sync failed · " + errText(e));
    } finally { refreshing = false; }
  }
  function sync(ok, text) { $("syncDot").className = "dot " + (ok ? "on" : "off"); $("syncText").textContent = text; }
  setInterval(() => { if (document.visibilityState === "visible" && !$("app").hidden) refresh(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !$("app").hidden) refresh(); });
  window.addEventListener("online", refresh);

  function lock() { pin = null; store.set("pin", null); renderDriverChips($("pinDrivers")); show("pin"); }

  // ---------------- numbers ----------------
  function legs(list) {
    const out = [];
    for (let i = 1; i < list.length; i++) {
      const km = list[i].odometer - list[i - 1].odometer;
      if (km <= 0) continue;
      out.push({ date: list[i].date, km, eff: list[i].full && list[i - 1].full ? (list[i].liters / km) * 100 : null });
    }
    return out;
  }
  function monthly(list) {
    const m = {};
    legs(list).forEach((l) => { const k = l.date.slice(0, 7); m[k] = (m[k] || 0) + l.km; });
    const keys = Object.keys(m).sort();
    if (!keys.length) return [];
    const out = []; let [y, mo] = keys[0].split("-").map(Number); const last = keys[keys.length - 1];
    for (let guard = 0; guard < 600; guard++) {
      const k = y + "-" + String(mo).padStart(2, "0");
      out.push({ k, km: m[k] || 0 });
      if (k === last) break;
      if (++mo > 12) { mo = 1; y++; }
    }
    return out.slice(-12);
  }
  function km(a, b) { // haversine distance in km
    const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // example data until there are 2 real fill-ups
  const EXAMPLE = (() => {
    const out = []; let odo = 81200; const d = new Date(); d.setMonth(d.getMonth() - 6); d.setDate(3);
    for (let i = 0; i < 14; i++) {
      const dist = 360 + Math.round(Math.sin(i) * 90 + (i % 3) * 40);
      odo += dist; d.setDate(d.getDate() + 13);
      const l = +(dist * (0.05 + (i % 4) * 0.002)).toFixed(2), p = 1.94 + Math.sin(i / 2) * 0.07;
      out.push({ date: d.toISOString().slice(0, 10), odometer: odo, liters: l, cost: +(l * p).toFixed(2), full: true });
    }
    return out;
  })();

  // ---------------- render ----------------
  function render() {
    const real = entries.length >= 2;
    $("exampleNote").hidden = real;
    const last = entries[entries.length - 1];
    $("odo").innerHTML = String(last ? last.odometer : 0).padStart(6, "0").split("").map((c) => "<span>" + c + "</span>").join("") + '<span class="unit">km</span>';

    const eff = legs(entries).filter((l) => l.eff != null);
    if (eff.length) {
      const tk = eff.reduce((a, l) => a + l.km, 0), tl = eff.reduce((a, l) => a + (l.eff * l.km) / 100, 0), avg = (tl / tk) * 100;
      $("sAvg").textContent = nf(avg, 1); $("sAvg2").textContent = "L/100 km · 1 op " + nf(100 / avg, 1);
    } else { $("sAvg").textContent = "–"; $("sAvg2").textContent = "L/100 km"; }
    const tm = monthly(entries).find((m) => m.k === today().slice(0, 7));
    $("sMonth").textContent = tm ? nf(tm.km) : entries.length ? "0" : "–";
    const L = entries.reduce((a, e) => a + e.liters, 0), C = entries.reduce((a, e) => a + e.cost, 0);
    $("sPrice").textContent = L ? nf(C / L, 3) : "–";

    $("stationList").innerHTML = [...new Set(entries.map((e) => e.station).filter(Boolean))].map((s) => '<option value="' + esc(s) + '">').join("");
    renderChart(real ? entries : EXAMPLE);
    renderStations();
    renderHistory();
  }

  function renderChart(list) {
    const W = 420, H = 230, P = { l: 50, r: 10, t: 20, b: 28 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
    const md = (s) => s.slice(8) + "/" + s.slice(5, 7);
    let pts = [], labels = [], bars = false, yFmt = (v) => nf(v);
    if (chartKind === "month") { const m = monthly(list); pts = m.map((x) => x.km); labels = m.map((x) => new Date(x.k + "-15").toLocaleString("en-GB", { month: "short" })); bars = true; }
    if (chartKind === "odo") { pts = list.map((e) => e.odometer); labels = list.map((e) => md(e.date)); yFmt = (v) => nf(v / 1000, 1) + "k"; }
    if (chartKind === "eff") { const l = legs(list).filter((x) => x.eff != null); pts = l.map((x) => x.eff); labels = l.map((x) => md(x.date)); yFmt = (v) => nf(v, 1); }
    if (chartKind === "price") { pts = list.map((e) => e.cost / e.liters); labels = list.map((e) => md(e.date)); yFmt = (v) => nf(v, 2); }
    if (pts.length < (bars ? 1 : 2)) { $("chart").innerHTML = '<p class="empty">Not enough fill-ups yet for this chart.</p>'; return; }

    let lo = bars ? 0 : Math.min(...pts), hi = Math.max(...pts);
    if (bars) hi = hi * 1.12 || 1; else { const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1; lo -= pad; hi += pad; }
    const y = (v) => P.t + ih - ((v - lo) / (hi - lo)) * ih;
    const step = iw / (bars ? pts.length : pts.length - 1);
    const x = (i) => P.l + (bars ? step * i + step / 2 : step * i);
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" style="display:block" role="img" aria-label="Chart">';
    for (let g = 0; g <= 4; g++) {
      const v = lo + ((hi - lo) * g) / 4, yy = y(v);
      s += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--line)" stroke-width="1"/>';
      s += '<text x="' + (P.l - 6) + '" y="' + (yy + 3) + '" text-anchor="end">' + yFmt(v) + "</text>";
    }
    const every = Math.ceil(labels.length / (bars ? 12 : 5));
    labels.forEach((t, i) => { if (i % every === 0 || i === labels.length - 1) s += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + t + "</text>"; });
    if (bars) {
      const bw = Math.min(36, step * 0.62);
      pts.forEach((v, i) => {
        const yy = y(v);
        s += '<rect x="' + (x(i) - bw / 2) + '" y="' + yy + '" width="' + bw + '" height="' + (P.t + ih - yy) + '" rx="3" fill="' + (i === pts.length - 1 ? "var(--accent)" : "var(--chart)") + '"/>';
        if (v > 0) s += '<text x="' + x(i) + '" y="' + (yy - 4) + '" text-anchor="middle" style="fill:var(--ink)">' + nf(v) + "</text>";
      });
    } else {
      const line = pts.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join("");
      s += '<path d="' + line + "L" + x(pts.length - 1) + "," + (P.t + ih) + "L" + x(0) + "," + (P.t + ih) + 'Z" fill="var(--chart-soft)"/>';
      s += '<path d="' + line + '" fill="none" stroke="var(--chart)" stroke-width="2" stroke-linejoin="round"/>';
      const li = pts.length - 1;
      s += '<circle cx="' + x(li) + '" cy="' + y(pts[li]) + '" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>';
      s += '<text x="' + Math.min(x(li), W - P.r - 4) + '" y="' + (y(pts[li]) - 10) + '" text-anchor="end" style="fill:var(--ink)">' + yFmt(pts[li]) + "</text>";
    }
    $("chart").innerHTML = s + "</svg>";
  }

  function renderStations() {
    const by = {};
    entries.forEach((e) => {
      if (!e.station) return;
      const k = e.station.trim().toLowerCase();
      const s = by[k] || (by[k] = { name: e.station.trim(), visits: 0, last: null, lat: null, lon: null });
      s.visits++;
      if (!s.last || e.date >= s.last.date) s.last = e;
      if (e.lat != null && e.lon != null) { s.lat = e.lat; s.lon = e.lon; }
    });
    let list = Object.values(by).map((s) => Object.assign(s, { price: s.last.cost / s.last.liters, dist: here && s.lat != null ? km(here, s) : null }));
    if (here) list = list.filter((s) => s.dist == null || s.dist <= 25);
    list.sort((a, b) => a.price - b.price);
    const ul = $("stations");
    if (!list.length) { ul.innerHTML = '<li><span class="empty">' + (entries.some((e) => e.station) ? "None of your stations are within 25 km." : "No stations yet. Add the station name when you log a fill-up.") + "</span></li>"; return; }
    ul.innerHTML = list.slice(0, 6).map((s, i) => {
      const when = new Date(s.last.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const dist = s.dist != null ? nf(s.dist, s.dist < 10 ? 1 : 0) + " km away · " : "";
      return '<li class="' + (i === 0 ? "best" : "") + '"><span class="name">' + esc(s.name) + (i === 0 ? '<span class="badge">cheapest</span>' : "") + '</span><span class="price">€ ' + nf(s.price, 3) + '</span><span class="sub">' + dist + s.visits + " visit" + (s.visits === 1 ? "" : "s") + '</span><span class="sub" style="text-align:right">paid ' + when + "</span></li>";
    }).join("");
  }

  function renderHistory() {
    const t = $("hist");
    if (!entries.length) { t.innerHTML = '<tr><td class="meta" style="padding-top:8px">No fill-ups yet. Log the current odometer reading at your next stop; distance and consumption start from the second entry.</td></tr>'; return; }
    let h = '<tr><th>Date</th><th class="r">Odometer</th><th class="r">Litres</th><th class="r">€/L</th><th class="r">L/100</th></tr>';
    entries.map((e, i) => {
      const prev = entries[i - 1], dist = prev ? e.odometer - prev.odometer : null;
      return { e, dist, eff: dist > 0 && e.full && prev.full ? nf((e.liters / dist) * 100, 1) : "–" };
    }).reverse().forEach(({ e, dist, eff }) => {
      const meta = [dist ? "+" + nf(dist) + " km" : "first entry", "€ " + nf(e.cost, 2), e.station, e.driver, e.full ? "" : "partial fill"].filter(Boolean).join(" · ");
      const btns = pendingDelete === e.id
        ? '<button class="link danger" data-del="' + e.id + '">Delete</button><button class="link" data-cancel="1">Keep</button>'
        : '<button class="link" data-ask="' + e.id + '">Remove</button>';
      h += '<tr class="main"><td>' + e.date.slice(8) + "-" + e.date.slice(5, 7) + "-" + e.date.slice(2, 4) + '</td><td class="r">' + nf(e.odometer) + '</td><td class="r">' + nf(e.liters, 2) + '</td><td class="r">' + nf(e.cost / e.liters, 3) + '</td><td class="r">' + eff + "</td></tr>" +
        '<tr><td colspan="5" class="meta"><div class="row" style="gap:6px"><span>' + esc(meta) + "</span><span>" + btns + "</span></div></td></tr>";
    });
    t.innerHTML = h;
  }

  // ---------------- interactions ----------------
  $("fDate").value = today();
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    chartKind = b.dataset.c;
    document.querySelectorAll(".tab").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
    render();
  }));
  const updatePerL = () => { const l = parseFloat($("fLit").value), c = parseFloat($("fCost").value); $("perL").textContent = l > 0 && c > 0 ? "€ " + nf(c / l, 3) + " / L" : ""; };
  $("fLit").addEventListener("input", updatePerL); $("fCost").addEventListener("input", updatePerL);
  $("fLoc").checked = store.get("saveLoc") === "1";
  $("fLoc").addEventListener("change", () => store.set("saveLoc", $("fLoc").checked ? "1" : "0"));
  const hint = (m, err) => { $("hint").textContent = m; $("hint").classList.toggle("err", !!err); };

  function getPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5) }), () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    });
  }

  $("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const rec = { date: $("fDate").value, odometer: Math.round(+$("fOdo").value), liters: +$("fLit").value, cost: +$("fCost").value, full: $("fFull").checked, station: $("fStation").value.trim() };
    if (!rec.date || !(rec.odometer > 0) || !(rec.liters > 0) || !(rec.cost > 0)) return hint("Fill in date, odometer, litres and total paid.", true);
    if (rec.liters > CFG.tankLiters + 5) return hint("That's more than the tank holds (about " + CFG.tankLiters + " L). Check the litres.", true);
    const before = entries.filter((e) => e.date <= rec.date).pop();
    const after = entries.find((e) => e.date > rec.date);
    if (before && rec.odometer <= before.odometer) return hint("The odometer must be higher than " + nf(before.odometer) + " km (" + before.date + ").", true);
    if (after && rec.odometer >= after.odometer) return hint("The odometer must be lower than " + nf(after.odometer) + " km (" + after.date + ").", true);
    $("saveBtn").disabled = true;
    try {
      let pos = null;
      if ($("fLoc").checked) { hint("Getting location…"); pos = await getPosition(); }
      hint("Saving…");
      await api("fuel_add", { p_filled_on: rec.date, p_odometer_km: rec.odometer, p_liters: rec.liters, p_cost_eur: rec.cost, p_full_tank: rec.full,
        p_station: rec.station || null, p_driver: driver || null, p_lat: pos && pos.lat, p_lon: pos && pos.lon });
      hint("Saved. " + (before ? "+" + nf(rec.odometer - before.odometer) + " km since the last fill-up." : "First entry logged.") + ($("fLoc").checked && !pos ? " (Location wasn't available.)" : ""));
      ["fOdo", "fLit", "fCost", "fStation"].forEach((id) => ($(id).value = ""));
      $("fFull").checked = true; $("fDate").value = today(); updatePerL();
      await refresh();
    } catch (e) { hint(errText(e), true); }
    finally { $("saveBtn").disabled = false; }
  });

  $("hist").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.ask) { pendingDelete = b.dataset.ask; renderHistory(); }
    else if (b.dataset.cancel) { pendingDelete = null; renderHistory(); }
    else if (b.dataset.del) {
      b.disabled = true;
      try { await api("fuel_delete", { p_id: b.dataset.del }); pendingDelete = null; await refresh(); }
      catch (e) { hint(errText(e), true); pendingDelete = null; renderHistory(); }
    }
  });

  $("locBtn").addEventListener("click", async () => {
    $("locBtn").disabled = true; $("locBtn").textContent = "Locating…";
    const p = await getPosition();
    $("locBtn").disabled = false;
    if (!p) { $("locBtn").textContent = "Use my location"; $("nearIntro").textContent = "Location isn't available. Allow location for this site in your phone's settings and try again."; return; }
    here = p; $("locBtn").textContent = "Update location";
    $("nearIntro").textContent = "Your stations within 25 km, ranked by the last price you paid there. For today's pump prices, use the links below.";
    $("mapsLink").href = "https://www.google.com/maps/search/tankstation/@" + p.lat + "," + p.lon + ",14z";
    renderStations();
  });

  $("csvBtn").addEventListener("click", () => {
    const rows = [["date", "odometer_km", "liters", "cost_eur", "eur_per_liter", "full_tank", "station", "driver", "lat", "lon"]]
      .concat(entries.map((e) => [e.date, e.odometer, e.liters, e.cost, (e.cost / e.liters).toFixed(3), e.full, e.station, e.driver, e.lat ?? "", e.lon ?? ""]));
    const csv = rows.map((r) => r.map((v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "i10-fuel-log-" + today() + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  });
  $("switchBtn").addEventListener("click", () => {
    if (!CFG.drivers.length) return;
    const i = CFG.drivers.indexOf(driver);
    driver = CFG.drivers[(i + 1) % CFG.drivers.length]; store.set("driver", driver);
    $("asDriver").textContent = "as " + driver;
  });
  $("lockBtn").addEventListener("click", lock);
  if (!CFG.drivers.length) $("switchBtn").hidden = true;

  // ---------------- start ----------------
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) { show("setup"); }
  else if (!pin) { renderDriverChips($("pinDrivers")); show("pin"); }
  else {
    try { const c = JSON.parse(store.get("cache") || "[]"); if (Array.isArray(c)) setEntries(c); } catch (e) {}
    openApp();
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
