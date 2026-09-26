/*
 * The prototype's fictional sample data (src/app/platewatch.js and src/app/map.js), with the same IDs so
 * frontend links such as #profile-3 keep working. Every business, licence number and action here is invented.
 */

export const CATEGORIES = [
  { key: "kitchen", name: "Kitchen hygiene", expiryDays: 14 },
  { key: "storage", name: "Food storage", expiryDays: 14 },
  { key: "pest", name: "Pest control", expiryDays: 180 },
  { key: "personal", name: "Personal hygiene", expiryDays: 7 },
  { key: "clean", name: "Cleaning & sanitation", expiryDays: 14 },
  { key: "docs", name: "Documentation", expiryDays: 365 },
  { key: "ops", name: "Operational safety", expiryDays: 30 },
];

/* [id, category, text, weight, critical] */
export const REQUIREMENTS: [string, string, string, number, boolean][] = [
  ["k1", "kitchen", "Food preparation areas are clean", 2, false],
  ["k2", "kitchen", "Food-contact surfaces are cleaned and sanitised", 3, true],
  ["k3", "kitchen", "Floors, walls and ceilings are maintained", 1, false],
  ["k4", "kitchen", "Waste goes into covered bins, removed daily", 2, false],
  ["s1", "storage", "Raw and cooked food are stored separately", 3, true],
  ["s2", "storage", "Food containers are covered", 2, false],
  ["s3", "storage", "Chilled food is kept at 5°C or below", 3, true],
  ["s4", "storage", "Prepared food is labelled with date", 1, false],
  ["p1", "pest", "No visible pest activity in food areas", 3, true],
  ["p2", "pest", "Pest-control contract is in place", 2, false],
  ["p3", "pest", "Pest-control treatment records are available", 2, false],
  ["p4", "pest", "Drains and entry points are screened", 1, false],
  ["h1", "personal", "Handwash station with soap at the prep area", 3, true],
  ["h2", "personal", "Staff wear caps and aprons while cooking", 1, false],
  ["h3", "personal", "Food handlers have medical fitness certificates", 2, false],
  ["h4", "personal", "A FoSTaC-trained food safety supervisor is on staff", 2, false],
  ["c1", "clean", "A written cleaning schedule is followed", 1, false],
  ["c2", "clean", "Cleaning chemicals are stored away from food", 2, false],
  ["c3", "clean", "Equipment is sanitised daily", 2, false],
  ["c4", "clean", "Toilets and wash areas are maintained", 1, false],
  ["d1", "docs", "Valid FSSAI licence is displayed", 3, true],
  ["d2", "docs", "Water potability test report (under 6 months old)", 2, false],
  ["d3", "docs", "Cleaning logs are kept", 1, false],
  ["o1", "ops", "Cold-holding temperatures are logged", 2, false],
  ["o2", "ops", "Stock is checked for expiry dates", 2, false],
  ["o3", "ops", "Veg and non-veg prep are kept apart", 2, false],
  ["o4", "ops", "Supplier bills and records are kept", 1, false],
];

type Action = [string, "sus" | "rev" | "imp" | "ok", string];
export interface SampleRestaurant {
  id: number;
  name: string;
  area: string;
  city: string;
  category: string;
  licenceNumber: string;
  lastVerifiedOn: string;
  location: { lat: number; lng: number } | null;
  actions: Action[];
}

const ORIGINAL: [number, string, string, string, string, string, string, [number, number] | null, Action[]][] = [
  [1, "Harbour Lane Café", "Fort", "Mumbai", "Café", "11526998000101", "2026-09-22", [18.9339, 72.8353], [["2026-09-16", "sus", "Raw and cooked food stored together; blocked drainage near kitchen"]]],
  [2, "Shree Mithai Bhandar", "Malad West", "Mumbai", "Sweet shop", "11524011000233", "2026-09-22", [19.1868, 72.8479], [["2026-09-21", "sus", "Pest activity in storage room; expired raw material on premises"]]],
  [3, "Green Leaf Dhaba", "Hinjewadi", "Pune", "Dhaba", "11525017000418", "2026-09-20", [18.5916, 73.7385], [["2026-08-02", "imp", "Food handlers without medical certificates; no pest control records"], ["2026-09-21", "ok", "Compliance confirmed on re-inspection"]]],
  [4, "QuickCart Dark Store 14", "Andheri East", "Mumbai", "Dark store", "10025022000561", "2026-09-19", [19.1141, 72.8702], [["2026-08-14", "sus", "Rodent droppings in dry storage"], ["2026-09-10", "ok", "Licence restored after corrective action"]]],
  [5, "Spice Route Kitchen", "Thane West", "Thane", "Cloud kitchen", "11524033000702", "2026-09-21", [19.2179, 72.9771], [["2026-09-18", "imp", "No separation of veg and non-veg prep areas"]]],
  [6, "Royal Farsan Works", "Shil-Diva", "Thane", "Manufacturer", "11524099000815", "2026-09-18", [19.1604, 73.0402], [["2026-07-20", "imp", "Reused cooking oil beyond permitted limit"], ["2026-09-09", "rev", "Repeat violations; licence revoked"]]],
  [7, "Coastal Tiffin Centre", "Dadar West", "Mumbai", "Restaurant", "11526012000944", "2026-09-22", [19.0209, 72.8418], [["2026-09-20", "sus", "Stagnant water near cold storage; insect infestation"]]],
  [8, "Orange City Bakers", "Sitabuldi", "Nagpur", "Bakery", "11524055001027", "2026-08-15", [21.1463, 79.0876], [["2026-08-10", "imp", "Unlabelled ingredients; missing batch records"]]],
  [9, "Deccan Dosa House", "Kothrud", "Pune", "Restaurant", "11525019001133", "2026-09-21", [18.5072, 73.8071], [["2026-09-17", "sus", "Cockroach infestation in kitchen and prep area"]]],
  [10, "Marine Drive Grill", "Churchgate", "Mumbai", "Restaurant", "11526003001248", "2026-09-12", [18.9331, 72.8259], [["2026-06-11", "sus", "Improper refrigeration; spoiled stock found"], ["2026-07-02", "ok", "Licence restored after re-inspection"]]],
  [11, "Annapurna Dairy Products", "Mahape MIDC", "Navi Mumbai", "Manufacturer", "10024045001356", "2026-09-22", [19.1172, 73.0288], [["2026-09-19", "sus", "Suspected adulterants seized; samples sent for testing"]]],
  [12, "Temple Road Prasad Stall", "Shirdi", "Ahilyanagar", "Sweet shop", "21524088001471", "2026-08-30", null, [["2026-06-18", "rev", "Adulterated peda seized and destroyed"]]],
  [13, "Bandra Bao Co.", "Bandra West", "Mumbai", "Café", "11526027001589", "2026-09-22", [19.0601, 72.8291], [["2026-09-22", "imp", "Pest-control certificate expired; water test report missing"]]],
  [14, "Andheri Chaat Corner", "Andheri West", "Mumbai", "Restaurant", "11526031001694", "2026-09-21", [19.1361, 72.8302], [["2026-09-12", "imp", "Uncovered food on display; no handwash station"]]],
];

const EXTRA: [number, string, string, string, number, number][] = [
  [101, "Sunrise Idli Corner", "Colaba", "Restaurant", 18.9072, 72.8149],
  [102, "Tidewater Tiffins", "Lower Parel", "Cloud kitchen", 18.9957, 72.8302],
  [103, "Lotus Leaf Veg Kitchen", "Worli", "Restaurant", 19.017, 72.817],
  [104, "Neelkamal Bhojanalay", "Matunga", "Restaurant", 19.0275, 72.8566],
  [105, "Monsoon Momo House", "Sion", "Café", 19.0394, 72.8611],
  [106, "Saffron Street Kitchen", "Kurla", "Restaurant", 19.0721, 72.8839],
  [107, "Kesar Snacks & Sweets", "Chembur", "Sweet shop", 19.0527, 72.8998],
  [108, "Station Road Misal House", "Ghatkopar", "Restaurant", 19.0866, 72.9087],
  [109, "Lakeview Poha Point", "Powai", "Café", 19.1181, 72.9053],
  [110, "Marigold Thali House", "Vile Parle", "Restaurant", 19.0996, 72.8487],
  [111, "Sandbar Juice Junction", "Juhu", "Café", 19.1071, 72.8268],
  [112, "Little Lane Bakehouse", "Santacruz", "Bakery", 19.0815, 72.8405],
  [113, "Green Chilli Canteen", "Khar", "Restaurant", 19.0706, 72.8374],
  [114, "Mango Leaf Café", "Goregaon", "Café", 19.165, 72.8488],
  [115, "Rustic Roti Co.", "Borivali", "Restaurant", 19.2311, 72.8561],
  [116, "Hilltop Vada Pav Stall", "Mulund", "Restaurant", 19.1721, 72.9431],
  [117, "Copperpot Home Kitchen", "Versova", "Cloud kitchen", 19.1335, 72.8136],
  [118, "Clocktower Chai Stop", "Byculla", "Café", 18.9786, 72.8336],
  [119, "Old Mill Biryani Kitchen", "Grant Road", "Restaurant", 18.9635, 72.8156],
  [120, "Seaface Bun Maska Café", "Mahim", "Café", 19.0405, 72.8396],
];

export const RESTAURANTS: SampleRestaurant[] = [
  ...ORIGINAL.map(([id, name, area, city, category, licenceNumber, lastVerifiedOn, ll, actions]) => ({
    id, name, area, city, category, licenceNumber, lastVerifiedOn, location: ll ? { lat: ll[0], lng: ll[1] } : null, actions,
  })),
  ...EXTRA.map(([id, name, area, category, lat, lng]) => ({
    id, name, area, city: "Mumbai", category,
    licenceNumber: "115269" + String(40000000 + id * 37).slice(0, 8),
    lastVerifiedOn: "2026-09-22", location: { lat, lng }, actions: [] as Action[],
  })),
];
