// node visa/site/pack.test.js
const assert = require("assert");
const P = require("./pack.js");
const base = {
  name: "Ana Example", nationality: "Brazilian", passport: "FX123456", purpose: "tourism", homeCountry: "Brazil",
  job: "a nurse", employer: "Hospital X", leave: true, insuranceCover: 30000,
  legs: [
    { city: "Paris", country: "France", arrive: "2027-04-10", depart: "2027-04-14", stay: "Hotel A" },
    { city: "Rome", country: "Italy", arrive: "2027-04-14", depart: "2027-04-20", stay: "Hotel B" },
  ],
};
const today = "2027-02-01";

let r = P.checkTrip(base, today);
assert.ok(r.ok, JSON.stringify(r.issues));
assert.strictEqual(r.main, "Italy");          // 6 nights > 4
assert.strictEqual(r.days, 11);               // 10 Apr..20 Apr inclusive
assert.strictEqual(P.itinerary(base).length, 11);

// tie → first entry
const tie = { ...base, legs: [{ ...base.legs[0] }, { ...base.legs[1], depart: "2027-04-18" }] };
assert.strictEqual(P.checkTrip(tie, today).main, "France");

// gap, overlap, wrong consulate, insurance, >90 days, flight mismatch
const gap = { ...base, legs: [base.legs[0], { ...base.legs[1], arrive: "2027-04-15" }] };
assert.ok(P.checkTrip(gap, today).issues.some((i) => /missing/.test(i.msg)));
const over = { ...base, legs: [base.legs[0], { ...base.legs[1], arrive: "2027-04-13" }] };
assert.ok(P.checkTrip(over, today).issues.some((i) => /overlap/.test(i.msg)));
assert.ok(!P.checkTrip({ ...base, applyTo: "France" }, today).ok);
assert.ok(!P.checkTrip({ ...base, insuranceCover: 20000 }, today).ok);
assert.ok(!P.checkTrip({ ...base, legs: [{ ...base.legs[0], depart: "2027-07-20" }] }, today).ok);
assert.ok(!P.checkTrip({ ...base, flightIn: "2027-04-09" }, today).ok);
assert.ok(P.checkTrip(base, "2027-04-01").issues.some((i) => /15 calendar days/.test(i.msg)));

const L = P.letter(base, today);
assert.ok(L.includes("Consulate of Italy") && L.includes("FX123456") && L.includes("11 days"));
assert.ok(!/undefined|null|NaN/.test(L), L);
console.log("All visa pack tests passed.");
