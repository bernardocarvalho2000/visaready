// VisaReady Pack UI. All trip processing is local; the only network call is license validation.
(function () {
  const P = window.VisaPack;
  const $ = (s, el = document) => el.querySelector(s);
  const form = $("#trip"), legsEl = $("#legs"), tpl = $("#legTpl");
  const STATE_KEY = "vrp_form", LICENSE_KEY = "vrp_license";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: keep working without saving */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const today = () => { const n = new Date(); return new Date(n - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  // shortcut: client-side gate, bypassable by a technical user; move unlock to a server/worker if abuse appears
  async function validateLicense(key) {
    const res = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ license_key: key }),
    });
    const data = await res.json().catch(() => ({}));
    return { valid: data.valid === true, error: data.error };
  }
  const unlocked = () => !!store.get(LICENSE_KEY);

  // ---- form <-> state ----
  const opts = (list) => list.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#applyTo").insertAdjacentHTML("beforeend", opts(P.SCHENGEN));

  function addLeg(v = {}) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const sel = $('[data-f="country"]', node);
    sel.innerHTML = `<option value="">Select…</option>${opts(P.SCHENGEN)}<option value="Other">Other (outside Schengen)</option>`;
    for (const el of node.querySelectorAll("[data-f]")) if (v[el.dataset.f] != null) el.value = v[el.dataset.f];
    $(".rm", node).addEventListener("click", () => { node.remove(); update(); });
    legsEl.append(node);
  }

  function readRaw() {
    const fields = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === "radio") { if (el.checked) fields[el.name] = el.value; }
      else fields[el.name] = el.type === "checkbox" ? el.checked : el.value;
    }
    const legs = [...legsEl.children].map((row) => {
      const o = {};
      for (const el of row.querySelectorAll("[data-f]")) o[el.dataset.f] = el.value;
      return o;
    });
    return { fields, legs };
  }

  function restore(raw) {
    for (const [k, v] of Object.entries(raw.fields || {})) {
      const els = form.elements[k];
      if (!els) continue;
      if (els instanceof RadioNodeList) for (const r of els) r.checked = r.value === v;
      else if (els.type === "checkbox") els.checked = !!v;
      else els.value = v;
    }
    (raw.legs && raw.legs.length ? raw.legs : [{}]).forEach(addLeg);
  }

  function toTrip({ fields: f, legs }) {
    const t = { ...f };
    delete t.funding;
    if (f.funding === "sponsor") delete t.funds; else delete t.sponsor;
    for (const k of Object.keys(t)) if (t[k] === "" || t[k] === false) delete t[k];
    t.purpose = f.purpose || "tourism";
    t.legs = legs
      .filter((l) => Object.values(l).some(Boolean))
      .map((l) => {
        const o = { city: l.city.trim(), country: l.country === "Other" ? l.otherCountry.trim() : l.country, arrive: l.arrive, depart: l.depart };
        if (l.stay.trim()) o.stay = l.stay.trim();
        if (l.plan.trim()) o.plan = l.plan.trim();
        return o;
      });
    return t;
  }

  // ---- rendering ----
  function renderCheck(r, t) {
    const items = r.issues.map((i) => `<li class="${i.level}"><span class="lvl">${i.level === "error" ? "Fix" : "Check"}</span> ${esc(i.msg)}</li>`).join("");
    let html = "";
    if (r.main) {
      html += `<dl class="facts">
        <div><dt>Main destination</dt><dd>${esc(r.main)}</dd></div>
        <div><dt>Apply to</dt><dd>Consulate of ${esc(r.main)}${t.consulateCity ? ", " + esc(t.consulateCity) : ""}</dd></div>
        <div><dt>Trip length</dt><dd>${r.days} days (${fmt(r.start)} to ${fmt(r.end)})</dd></div>
      </dl>`;
    }
    html += r.issues.length ? `<ul class="issues">${items}</ul>` : `<p class="ok">No inconsistencies found in what you entered.</p>`;
    $("#checkBody").innerHTML = html;
  }

  // Locked preview scrambles letters so the hidden part can't be copied; it is still blurred visually.
  const scramble = (s) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + 7) % 26) + 97));
  const OPEN_BLOCKS = 6; // sender, date, addressee, subject, greeting, first body paragraph

  function renderDocs(t, r, isOpen) {
    const letterBody = $("#letterBody"), itinBody = $("#itinBody");
    if (!r.main) {
      const msg = `<p class="muted">Complete at least one stay with city, country and dates to see a preview.</p>`;
      letterBody.innerHTML = itinBody.innerHTML = msg;
      return;
    }
    const lt = { ...t, name: t.name || "[Your full name]", nationality: t.nationality || "[nationality]", passport: t.passport || "[passport number]" };
    const blocks = P.letter(lt, today()).split("\n\n").map((b) => `<p>${esc(b)}</p>`);
    letterBody.innerHTML = isOpen ? blocks.join("")
      : blocks.slice(0, OPEN_BLOCKS).join("") +
        `<div class="blurred" aria-hidden="true">${P.letter(lt, today()).split("\n\n").slice(OPEN_BLOCKS).map((b) => `<p>${esc(scramble(b))}</p>`).join("")}</div>
         <p class="lock-msg">The rest of the letter is included in the full pack.</p>`;

    const rows = P.itinerary(t);
    const shown = isOpen ? rows : rows.slice(0, 2);
    itinBody.innerHTML = `<div class="table-scroll" tabindex="0" role="region" aria-label="Itinerary table"><table>
      <thead><tr><th scope="col">Day</th><th scope="col">Date</th><th scope="col">City</th><th scope="col">Accommodation</th><th scope="col">Plan</th></tr></thead>
      <tbody>${shown.map((x, i) => `<tr><td>${i + 1}</td><td>${fmt(x.date)}</td><td>${esc(x.city)}, ${esc(x.country)}</td><td>${esc(x.stay)}</td><td>${esc(x.note)}</td></tr>`).join("")}</tbody>
    </table></div>${isOpen ? "" : `<p class="lock-msg">${rows.length - 2} more day${rows.length - 2 === 1 ? "" : "s"} in the full pack.</p>`}`;
  }

  function update() {
    const raw = readRaw();
    store.set(STATE_KEY, JSON.stringify(raw));
    for (const row of legsEl.children) {
      $(".other", row).hidden = $('[data-f="country"]', row).value !== "Other";
      $(".leg-title", row).textContent = $('[data-f="city"]', row).value || "New city";
    }
    for (const el of form.querySelectorAll("[data-funding]")) el.hidden = el.dataset.funding !== raw.fields.funding;
    const t = toTrip(raw), r = P.checkTrip(t, today()), isOpen = unlocked();
    renderCheck(r, t);
    renderDocs(t, r, isOpen);
    document.body.classList.toggle("is-unlocked", isOpen);
    $("#unlock").hidden = isOpen;
    $("#unlocked").hidden = !isOpen;
  }

  // ---- events ----
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  $("#addLeg").addEventListener("click", () => { addLeg(); update(); legsEl.lastElementChild.querySelector("input").focus(); });
  $("#clearForm").addEventListener("click", () => {
    if (!confirm("Clear everything you entered?")) return;
    store.del(STATE_KEY); form.reset(); legsEl.innerHTML = ""; addLeg(); update();
  });
  $("#forget").addEventListener("click", () => { store.del(LICENSE_KEY); update(); });

  $("#licenseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = $("#licenseKey").value.trim(), msg = $("#licenseMsg");
    if (!key) return;
    msg.textContent = "Checking…";
    try {
      const { valid, error } = await validateLicense(key);
      if (!valid) { msg.textContent = error ? `Key not accepted: ${error}` : "This key is not valid."; return; }
      store.set(LICENSE_KEY, key);
      msg.textContent = "";
      update();
      $("#letter-h").focus();
    } catch {
      msg.textContent = "Couldn't reach the license server. Check your connection and try again.";
    }
  });

  for (const b of document.querySelectorAll("[data-print]")) {
    b.addEventListener("click", () => { document.body.dataset.print = b.dataset.print; window.print(); });
  }
  window.addEventListener("afterprint", () => delete document.body.dataset.print);

  $("#letter-h").tabIndex = -1;
  let saved = null;
  try { saved = JSON.parse(store.get(STATE_KEY) || "null"); } catch { /* corrupt state: start fresh */ }
  restore(saved || {});
  update();
})();
