// Schengen visa pack: pure logic (browser + node). Uses only facts the applicant enters; never invents bookings.
(function (root) {
  const SCHENGEN = ["Austria", "Belgium", "Bulgaria", "Croatia", "Czechia", "Denmark", "Estonia", "Finland", "France",
    "Germany", "Greece", "Hungary", "Iceland", "Italy", "Latvia", "Liechtenstein", "Lithuania", "Luxembourg", "Malta",
    "Netherlands", "Norway", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden", "Switzerland"];
  const DAY = 86400000;
  const d = (s) => new Date(s + "T00:00:00Z");
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const nights = (a, b) => Math.round((d(b) - d(a)) / DAY);
  const fmt = (s) => d(s).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  // Main destination per Visa Code art. 5: longest stay; if equal, first entry.
  function mainDestination(legs) {
    const byCountry = new Map();
    for (const l of legs) byCountry.set(l.country, (byCountry.get(l.country) || 0) + nights(l.arrive, l.depart));
    let best = null, bestN = -1;
    for (const [c, n] of byCountry) if (n > bestN) { best = c; bestN = n; } // Map keeps first-entry order, so ties go to first entry
    return best;
  }

  function checkTrip(t, today) {
    const issues = []; // {level: "error"|"warn", msg}
    const add = (level, msg) => issues.push({ level, msg });
    const legs = t.legs || [];
    if (!legs.length) { add("error", "Add at least one stay (city, country and dates)."); return { issues, ok: false }; }
    legs.forEach((l, i) => {
      const n = `Stay ${i + 1} (${l.city || "?"})`;
      if (!l.city || !l.country || !l.arrive || !l.depart) add("error", `${n}: city, country and both dates are required.`);
      else if (nights(l.arrive, l.depart) < 0) add("error", `${n}: departure is before arrival.`);
      if (l.country && !SCHENGEN.includes(l.country)) add("warn", `${n}: ${l.country} is not in the Schengen area; days there don't count, but mention how you travel back into Schengen.`);
      if (!l.stay) add("warn", `${n}: no accommodation entered. Consulates expect proof of where you sleep every night.`);
    });
    if (issues.some((x) => x.level === "error")) return { issues, ok: false };
    const sorted = [...legs].sort((a, b) => d(a.arrive) - d(b.arrive));
    for (let i = 1; i < sorted.length; i++) {
      const gap = nights(sorted[i - 1].depart, sorted[i].arrive);
      if (gap > 0) add("error", `No accommodation between ${fmt(sorted[i - 1].depart)} and ${fmt(sorted[i].arrive)} (${gap} night${gap > 1 ? "s" : ""} missing).`);
      if (gap < 0) add("error", `Stays overlap: ${sorted[i - 1].city} and ${sorted[i].city} around ${fmt(sorted[i].arrive)}.`);
    }
    const start = sorted[0].arrive, end = sorted[sorted.length - 1].depart;
    const days = nights(start, end) + 1; // Schengen counts arrival and departure days
    if (days > 90) add("error", `Trip is ${days} days. A short-stay (Type C) visa allows at most 90 days in any 180-day period.`);
    if (t.flightIn && t.flightIn !== start) add("error", `Arrival flight date (${fmt(t.flightIn)}) doesn't match your first night (${fmt(start)}).`);
    if (t.flightOut && t.flightOut !== end) add("error", `Return flight date (${fmt(t.flightOut)}) doesn't match your last day (${fmt(end)}).`);
    if (t.insuranceFrom && t.insuranceTo && (t.insuranceFrom > start || t.insuranceTo < end))
      add("error", "Travel insurance must cover every day of the trip.");
    if (t.insuranceCover && Number(t.insuranceCover) < 30000) add("error", "Travel medical insurance must cover at least €30,000.");
    const main = mainDestination(sorted);
    if (t.applyTo && t.applyTo !== main) add("error", `You plan to apply to ${t.applyTo}, but your main destination (longest stay, or first entry if equal) is ${main}. Apply to ${main}'s consulate.`);
    if (today) {
      const lead = nights(today, start);
      if (lead < 15) add("warn", `You travel in ${lead} days. Apply at least 15 calendar days before departure; appointments are often booked weeks ahead.`);
      if (lead > 183) add("warn", "You can apply at most 6 months before travel. Wait before submitting.");
    }
    return { issues, ok: !issues.some((x) => x.level === "error"), main, start, end, days };
  }

  function itinerary(t) {
    const sorted = [...t.legs].sort((a, b) => d(a.arrive) - d(b.arrive));
    const rows = [];
    for (const l of sorted) {
      for (let x = d(l.arrive).getTime(); x < d(l.depart).getTime(); x += DAY) {
        const day = iso(x);
        const note = day === l.arrive ? (rows.length ? `Travel to ${l.city}` : `Arrival in ${l.city}${t.flightInNo ? ` (flight ${t.flightInNo})` : ""}`) : (l.plan || "");
        rows.push({ date: day, city: l.city, country: l.country, stay: l.stay || "", note });
      }
    }
    const last = sorted[sorted.length - 1];
    rows.push({ date: last.depart, city: last.city, country: last.country, stay: "-", note: `Departure${t.flightOutNo ? ` (flight ${t.flightOutNo})` : ""}` });
    return rows;
  }

  const PURPOSE = {
    tourism: "tourism",
    family: "visiting family or friends",
    business: "business",
    event: "attending an event",
  };

  function letter(t, today) {
    const c = checkTrip(t, today);
    const sorted = [...t.legs].sort((a, b) => d(a.arrive) - d(b.arrive));
    const route = sorted.map((l) => `${l.city}, ${l.country} (${fmt(l.arrive)} to ${fmt(l.depart)}, staying at ${l.stay || "accommodation to be confirmed"})`);
    const p = [];
    p.push(`${t.name}\n${t.address || ""}\n${t.email || ""}${t.phone ? " · " + t.phone : ""}`.trim());
    p.push(fmt(today));
    p.push(`To the Visa Section\nEmbassy / Consulate of ${c.main}${t.consulateCity ? "\n" + t.consulateCity : ""}`);
    p.push(`Subject: Application for a short-stay Schengen visa (Type C) for ${PURPOSE[t.purpose] || t.purpose}, ${fmt(c.start)} to ${fmt(c.end)}`);
    p.push("Dear Sir or Madam,");
    p.push(`I, ${t.name}, a ${t.nationality} citizen holding passport number ${t.passport}, respectfully apply for a short-stay Schengen visa to travel for ${PURPOSE[t.purpose] || t.purpose} from ${fmt(c.start)} to ${fmt(c.end)}, a total of ${c.days} days. ${c.main} is my main destination, where I will spend the longest part of my stay.`);
    if (t.purposeDetail) p.push(t.purposeDetail.trim());
    p.push(`My planned itinerary is:\n${route.map((r, i) => `${i + 1}. ${r}`).join("\n")}\nA day-by-day itinerary is enclosed.`);
    const fund = t.sponsor
      ? `My travel costs will be covered by ${t.sponsor}. Their sponsorship letter and proof of funds are enclosed.`
      : `I will cover all travel costs myself${t.funds ? `; my bank statements show available funds of ${t.funds}` : ""}.`;
    p.push(fund);
    if (t.job) p.push(`I am employed as ${t.job}${t.employer ? ` at ${t.employer}` : ""}${t.leave ? `, and my employer has approved my leave for these dates` : ""}. ${t.ties ? t.ties.trim() + " " : ""}I will return to ${t.homeCountry || "my country of residence"} on ${fmt(c.end)} to resume my obligations there.`);
    else if (t.ties) p.push(`${t.ties.trim()} I will return to ${t.homeCountry || "my country of residence"} on ${fmt(c.end)}.`);
    p.push(`I hold travel medical insurance${t.insurer ? ` from ${t.insurer}` : ""} covering the entire Schengen area for the whole trip${t.insuranceCover ? `, with coverage of €${Number(t.insuranceCover).toLocaleString("en-GB")}` : ""}.`);
    const docs = ["Completed and signed visa application form", "Passport and copies of previous visas", "Passport photographs", "Travel medical insurance certificate", "Round-trip flight reservation", "Accommodation bookings for every night", "Day-by-day itinerary", "Bank statements for the last 3 months"];
    if (t.job) docs.push("Employment letter and approved leave");
    if (t.sponsor) docs.push("Sponsorship letter and sponsor's proof of funds");
    p.push(`Enclosed documents:\n${docs.map((x) => "• " + x).join("\n")}`);
    p.push("Thank you for considering my application. I am happy to provide any further information.");
    p.push(`Yours faithfully,\n\n\n${t.name}`);
    return p.join("\n\n");
  }

  const api = { SCHENGEN, checkTrip, itinerary, letter, mainDestination, nights };
  if (typeof module !== "undefined") module.exports = api; else root.VisaPack = api;
})(this);
