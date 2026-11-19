// Independent legal rule oracle for a Bangkok building envelope (zone ย.9).
// Written only from sources/*.txt. Every branch maps to one row of oracle/clauses.md.
// Units: metres, m2. Distances are measured from the PLOT EDGE inward.

export type Use = 'condo' | 'apartment' | 'office' | 'hotel'; // condo/apartment = residential multi-unit
export interface Reading { cite: string; d: number; note?: string } // cite like 'mr55-update.txt:434'
export interface Required { readings: Reading[]; max: number } // max = max of readings' d (0 if none)
export interface Building {
  use: Use;
  heightM: number; // ground to roof deck of the top floor
  storeys: number;
  gfaM2: number; // total floor area of all floors
  largestFloorM2: number;
}
export interface Frontage { widthM: number; lengthM: number; gapM: number; sameRoadAs?: string; name?: string }

// ---- citations (clauses.md id -> file:line) ----
const CITE = {
  D_HR_33: 'mr33.txt:14',
  D_HR_ORD: 'bma-ordinance-2544.txt:282',
  D_XL_33: 'mr33.txt:17',
  D_XL_ORD: 'bma-ordinance-2544.txt:249',
  D_LG_55: 'mr55-update.txt:55',
  D_LG_ORD: 'bma-ordinance-2544.txt:244',
  D_COM_55: 'mr55-update.txt:36',
  D_COM_55_20M: 'mr55-update.txt:37',
  D_COM_ORD: 'bma-ordinance-2544.txt:260',
  D_PUB_55: 'mr55-update.txt:40',
  D_PUB_ORD: 'bma-ordinance-2544.txt:274',
  D_RES_55: 'mr55-update.txt:19',
  D_RES_ORD: 'bma-ordinance-2544.txt:289',
  D_MULTI_55: 'mr55-update.txt:53',
  D_MULTI_ORD: 'bma-ordinance-2544.txt:292',

  R_55_41_P1: 'mr55-update.txt:404',
  R_55_41_1: 'mr55-update.txt:410',
  R_55_41_2: 'mr55-update.txt:413',
  R_55_41_3: 'mr55-update.txt:416',
  R_ORD_50_P1: 'bma-ordinance-2544.txt:713',
  R_ORD_50_1: 'bma-ordinance-2544.txt:721',
  R_ORD_50_2: 'bma-ordinance-2544.txt:724',
  R_ORD_50_3: 'bma-ordinance-2544.txt:727',
  R_55_44: 'mr55-update.txt:434',
  R_ORD_49: 'bma-ordinance-2544.txt:703',
  R_33_4: 'mr33.txt:80',
  R_ORD_52_6A: 'bma-ordinance-2544.txt:753',
  R_ORD_52_6B: 'bma-ordinance-2544.txt:756',
  R_ORD_53: 'bma-ordinance-2544.txt:770',
  R_2556_40_1: 'mr2556.txt:3162',

  P_55_50_1: 'mr55-update.txt:516',
  P_55_50_2: 'mr55-update.txt:517',
  P_ORD_54_1: 'bma-ordinance-2544.txt:776',
  P_ORD_54_2: 'bma-ordinance-2544.txt:777',

  C_55_42_1: 'mr55-update.txt:419',
  C_55_42_2: 'mr55-update.txt:421',
  C_55_42_P2: 'mr55-update.txt:424',
  C_2556_40_2A: 'mr2556.txt:3167',
  C_2556_40_2B: 'mr2556.txt:3168',

  K_ORD_55_1: 'bma-ordinance-2544.txt:780',
  K_ORD_55_2: 'bma-ordinance-2544.txt:783',
  K_33_3: 'mr33.txt:71',
  K_ORD_52_7: 'bma-ordinance-2544.txt:762',

  O_55_33_1: 'mr55-update.txt:313',
  O_55_33_2: 'mr55-update.txt:316',
  O_ORD_52_1: 'bma-ordinance-2544.txt:736',
  O_ORD_52_2: 'bma-ordinance-2544.txt:737',
  O_33_6_1: 'mr33.txt:92',
  O_33_6_2: 'mr33.txt:93',
  O_2556_16_2: 'mr2556.txt:1483',

  F_2556_16_1: 'mr2556.txt:1480',
  F_33_5: 'mr33.txt:84',
  F_33_2_1: 'mr33.txt:60',
  F_33_2_2: 'mr33.txt:64',
  F_2556_16_10: 'mr2556.txt:1425',
  F_2556_57: 'mr2556.txt:3362',

  G_33_2_1: 'mr33.txt:60',
  G_33_2_1C: 'mr33.txt:62',
  G_33_2_2: 'mr33.txt:64',
  G_33_2_2C: 'mr33.txt:66',
  G_33_2_3: 'mr33.txt:68',
  G_2556_16_BAN: 'mr2556.txt:1393',
  G_2556_16_8: 'mr2556.txt:1412',
  G_2556_16_10: 'mr2556.txt:1425',
  G_2556_36_2: 'mr2556.txt:3102',
  G_2556_36_3: 'mr2556.txt:3108',
  G_2556_37: 'mr2556.txt:3126',
  G_2556_ERR_36: 'mr2556.txt:3442',

  E_55_45: 'mr55-update.txt:447',
  E_55_46: 'mr55-update.txt:452',
  E_ORD_49_2: 'bma-ordinance-2544.txt:706',
  E_ORD_49_1: 'bma-ordinance-2544.txt:703',
} as const;

// ---- helpers ----
const pos = (x: number): number => (x > 0 ? x : 0);
const na = (cite: string, note: string): Reading => ({ cite, d: NaN, note: `not assessable: ${note}` });
const yes = (b: boolean): number => (b ? 1 : 0);

function required(readings: Reading[]): Required {
  let max = 0;
  for (const r of readings) if (Number.isFinite(r.d) && r.d > max) max = r.d;
  return { readings, max };
}
// setback measured from the road centreline c, converted to distance from the plot edge
const fromCentre = (c: number, w: number, gap: number): number => pos(c - w / 2 - gap);
// setback measured from the road/canal boundary s, converted to distance from the plot edge
const fromBoundary = (s: number, gap: number): number => pos(s - gap);

// ---- classify ----
export function classify(b: Building): {
  highRise: boolean; extraLarge: boolean; large: boolean;
  commercial: boolean; publicBuilding: boolean; dwelling: boolean; readings: Reading[];
} {
  const readings: Reading[] = [];

  // อาคารสูง: ตั้งแต่ 23.00 m (>=)
  const hr33 = b.heightM >= 23;
  readings.push({ cite: CITE.D_HR_33, d: yes(hr33), note: 'high-rise: height >= 23.00 m (MR33)' });
  const hrOrd = b.heightM >= 23;
  readings.push({ cite: CITE.D_HR_ORD, d: yes(hrOrd), note: 'high-rise: height >= 23 m (ordinance)' });

  // อาคารขนาดใหญ่พิเศษ: ตั้งแต่ 10,000 m2 (>=)
  const xl33 = b.gfaM2 >= 10000 || b.largestFloorM2 >= 10000;
  readings.push({ cite: CITE.D_XL_33, d: yes(xl33), note: 'extra-large: total or any floor >= 10,000 m2 (MR33)' });
  const xlOrd = b.gfaM2 >= 10000;
  readings.push({ cite: CITE.D_XL_ORD, d: yes(xlOrd), note: 'extra-large: total >= 10,000 m2 (ordinance)' });

  // อาคารขนาดใหญ่: เกิน 2,000; or ตั้งแต่ 15 m and เกิน 1,000
  const lg55 = b.gfaM2 > 2000 || b.largestFloorM2 > 2000 ||
    (b.heightM >= 15 && (b.gfaM2 > 1000 || b.largestFloorM2 > 1000));
  readings.push({ cite: CITE.D_LG_55, d: yes(lg55), note: 'large: total/any floor > 2,000, or height >= 15 and > 1,000 (MR55)' });
  const lgOrd = b.gfaM2 > 2000 || (b.heightM >= 15 && b.gfaM2 > 1000);
  readings.push({ cite: CITE.D_LG_ORD, d: yes(lgOrd), note: 'large: total > 2,000, or height >= 15 and total > 1,000 (ordinance)' });

  const isRes = b.use === 'condo' || b.use === 'apartment';
  const isCom = b.use === 'office' || b.use === 'hotel';

  readings.push({ cite: CITE.D_COM_55, d: yes(isCom), note: 'commercial building: commerce/business service (office, hotel) (MR55)' });
  if (!isCom) readings.push(na(CITE.D_COM_55_20M, 'MR55 also treats any building <= 20 m from a road that may be used commercially as commercial; needs road distance'));
  readings.push({ cite: CITE.D_COM_ORD, d: yes(isCom), note: 'commercial building (ordinance, no 20 m limb)' });

  const isPub = b.use === 'hotel';
  readings.push({ cite: CITE.D_PUB_55, d: yes(isPub), note: 'public building: hotel listed; office not listed (MR55)' });
  readings.push({ cite: CITE.D_PUB_ORD, d: yes(isPub), note: 'public building: hotel listed (ordinance)' });

  readings.push({ cite: CITE.D_RES_55, d: yes(isRes), note: 'dwelling; hotel read as not a dwelling (MR55)' });
  readings.push({ cite: CITE.D_RES_ORD, d: yes(isRes), note: 'dwelling (ordinance)' });
  readings.push({ cite: CITE.D_MULTI_55, d: yes(isRes), note: 'multi-family dwelling (MR55)' });
  readings.push({ cite: CITE.D_MULTI_ORD, d: yes(isRes), note: 'multi-family dwelling (ordinance)' });

  // Where the two texts' definitions differ, a class holds if either text puts the building in it.
  return {
    highRise: hr33 || hrOrd,
    extraLarge: xl33 || xlOrd,
    large: lg55 || lgOrd,
    commercial: isCom,
    publicBuilding: isPub,
    dwelling: isRes,
    readings,
  };
}

// ---- road distance ----
export function requiredRoadDistance(
  b: Building,
  road: { widthM: number; gapM: number },
  floor: { level: number; topM: number },
): Required {
  const c = classify(b);
  const w = road.widthM;
  const g = road.gapM;
  const r: Reading[] = [];

  // MR55 art 41 para 1: any building, w < 6 -> 3 m from centreline
  if (w < 6) r.push({ cite: CITE.R_55_41_P1, d: fromCentre(3, w, g), note: 'w < 6: >= 3 m from road centreline (MR55 41 para 1)' });

  // MR55 art 41 para 2: > 2 storeys or > 8 m, commercial, public
  const mr55p2 = b.storeys > 2 || b.heightM > 8 || c.commercial || c.publicBuilding;
  if (mr55p2 && w < 10) r.push({ cite: CITE.R_55_41_1, d: fromCentre(6, w, g), note: 'w < 10: >= 6 m from centreline (MR55 41(1))' });
  if (mr55p2 && w >= 10 && w <= 20) r.push({ cite: CITE.R_55_41_2, d: pos((w - 10 * g) / 10), note: '10 <= w <= 20: >= w/10 from road boundary (MR55 41(2))' });
  if (mr55p2 && w > 20) r.push({ cite: CITE.R_55_41_3, d: fromBoundary(2, g), note: 'w > 20: >= 2 m from road boundary (MR55 41(3))' });

  // Ordinance art 50 para 1: any building, w < 6 -> 3 m from centreline
  if (w < 6) r.push({ cite: CITE.R_ORD_50_P1, d: fromCentre(3, w, g), note: 'w < 6: >= 3 m from centreline (ordinance 50 para 1)' });

  // Ordinance art 50 para 2: adds large buildings; exempts dwellings <= 3 storeys OR <= 10 m AND area <= 1,000 m2
  const ordExempt = c.dwelling && (b.storeys <= 3 || b.heightM <= 10) && b.gfaM2 <= 1000;
  const ordP2 = (b.storeys > 2 || b.heightM > 8 || c.large || c.commercial || c.publicBuilding) && !ordExempt;
  if (ordP2 && w < 10) r.push({ cite: CITE.R_ORD_50_1, d: fromCentre(6, w, g), note: 'w < 10: >= 6 m from centreline (ordinance 50(1))' });
  if (ordP2 && w >= 10 && w <= 20) r.push({ cite: CITE.R_ORD_50_2, d: pos((w - 10 * g) / 10), note: '10 <= w <= 20: >= w/10 from boundary (ordinance 50(2))' });
  if (ordP2 && w > 20) r.push({ cite: CITE.R_ORD_50_3, d: fromBoundary(2, g), note: 'w > 20: >= 2 m from boundary (ordinance 50(3))' });

  // Height vs road: h <= 2 x (distance to opposite road boundary) -> d >= h/2 - g - w
  const hv = pos(floor.topM / 2 - g - w);
  r.push({ cite: CITE.R_55_44, d: hv, note: `height ${floor.topM} <= 2 x distance to opposite road boundary (MR55 44)` });
  r.push({ cite: CITE.R_ORD_49, d: hv, note: `height ${floor.topM} <= 2 x distance to opposite road line (ordinance 49 para 1)` });

  // MR33 art 4: high-rise / extra-large >= 6.00 m from a public road
  if (c.highRise || c.extraLarge) r.push({ cite: CITE.R_33_4, d: fromBoundary(6, g), note: 'high-rise/extra-large: outermost edge >= 6.00 m from public road (MR33 4)' });

  // Ordinance 52(6) front open space (not a fixed-line setback) and its art 53 exemption
  const ord526 = (c.commercial || c.publicBuilding || b.storeys > 2 || b.heightM > 8) &&
    !(c.dwelling && b.storeys <= 3 && g > 0);
  if (ord526) {
    if (b.storeys > 3) r.push(na(CITE.R_ORD_52_6B, 'front open space >= 12 m wide, length >= 1/6 of perimeter, linked by >= 6 m road (ordinance 52(6) para 2); position not fixed to the road line'));
    else r.push(na(CITE.R_ORD_52_6A, 'front open space >= 6 m wide, length >= 1/6 of perimeter (ordinance 52(6)); position not fixed to the road line'));
    r.push(na(CITE.R_ORD_53, 'exempt from 52(6) if frontage side > 1/8 of perimeter and <= 20 m from the public way (a maximum distance)'));
  }

  // MR2556 art 40(1) zone ล.2
  r.push(na(CITE.R_2556_40_1, `only in open-space zone ล.2 on listed roads: >= 2 m from right-of-way line (would be d=${fromBoundary(2, g)})`));

  return required(r);
}

// ---- private boundary distance (walls with openings/balconies) ----
export function requiredPrivateDistance(b: Building, floor: { level: number; topM: number }): Required {
  const c = classify(b);
  const r: Reading[] = [];

  // MR55 art 50 (by building height)
  if (b.heightM <= 9) r.push({ cite: CITE.P_55_50_1, d: 2, note: 'building height <= 9 m: >= 2 m (MR55 50(1))' });
  if (b.heightM > 9 && b.heightM < 23) r.push({ cite: CITE.P_55_50_2, d: 3, note: '9 < building height < 23 m: >= 3 m (MR55 50(2))' });

  // Ordinance art 54 (per floor); a floor may meet both cases
  if (floor.level <= 2 || floor.topM <= 9) r.push({ cite: CITE.P_ORD_54_1, d: 2, note: 'storey <= 2 or height <= 9 m: >= 2 m (ordinance 54)' });
  if (floor.level >= 3 || floor.topM > 9) r.push({ cite: CITE.P_ORD_54_2, d: 3, note: 'storey >= 3 or height > 9 m: >= 3 m (ordinance 54)' });

  // MR33 art 4
  if (c.highRise || c.extraLarge) r.push({ cite: CITE.R_33_4, d: 6, note: 'high-rise/extra-large: >= 6.00 m from another owner\'s land (MR33 4)' });

  return required(r);
}

// ---- canal / public water distance ----
export function requiredCanalDistance(b: Building, canal: { widthM: number; gapM: number }): Required {
  const c = classify(b);
  const w = canal.widthM;
  const g = canal.gapM;
  const r: Reading[] = [];

  if (w < 10) r.push({ cite: CITE.C_55_42_1, d: fromBoundary(3, g), note: 'public water w < 10: >= 3 m from its boundary (MR55 42)' });
  if (w >= 10) r.push({ cite: CITE.C_55_42_2, d: fromBoundary(6, g), note: 'public water w >= 10: >= 6 m from its boundary (MR55 42)' });
  r.push(na(CITE.C_55_42_P2, `large water body (swamp, lake, sea) needs >= 12 m (would be d=${fromBoundary(12, g)}); input is a canal`));

  if (w < 10) r.push(na(CITE.C_2556_40_2A, `only in open-space zone ล.3: >= 3 m planting strip (would be d=${fromBoundary(3, g)})`));
  if (w >= 10) r.push(na(CITE.C_2556_40_2B, `only in open-space zone ล.3: >= 6 m planting strip (would be d=${fromBoundary(6, g)})`));

  if (c.highRise || c.extraLarge) r.push({ cite: CITE.R_33_4, d: fromBoundary(6, g), note: 'high-rise/extra-large: >= 6.00 m; public canal land read as land of another (MR33 4)' });

  return required(r);
}

// ---- clear space all round ----
export function requiredClearSpace(b: Building): Required {
  const c = classify(b);
  const r: Reading[] = [];

  if (b.heightM <= 15) r.push({ cite: CITE.K_ORD_55_1, d: 1, note: 'height <= 15 m: >= 1 m open space all round (ordinance 55)' });
  if (b.heightM > 15) r.push({ cite: CITE.K_ORD_55_2, d: 2, note: 'height > 15 m: >= 2 m open space all round (ordinance 55)' });
  if (c.highRise || c.extraLarge) r.push({ cite: CITE.K_33_3, d: 6, note: 'high-rise/extra-large: uncovered fire-access road >= 6.00 m all round (MR33 3)' });
  if (c.commercial || c.publicBuilding) r.push(na(CITE.K_ORD_52_7, 'uncovered rear walkway >= 2 m (ordinance 52(7)); rear side only, which edge is rear is unknown'));

  return required(r);
}

// ---- open space (m2) ----
export function requiredOpenSpace(b: Building, plotAreaM2: number, zoneOsrPct: number): Required {
  const c = classify(b);
  const r: Reading[] = [];

  if (c.dwelling) r.push({ cite: CITE.O_55_33_1, d: (b.largestFloorM2 * 30) / 100, note: 'dwelling: >= 30% of largest floor (MR55 33(1))' });
  else r.push({ cite: CITE.O_55_33_2, d: (b.largestFloorM2 * 10) / 100, note: 'non-dwelling: >= 10% of largest floor (MR55 33(2))' });

  if (c.dwelling) r.push({ cite: CITE.O_ORD_52_1, d: (plotAreaM2 * 30) / 100, note: 'dwelling: >= 30% of land (ordinance 52(1))' });
  else r.push({ cite: CITE.O_ORD_52_2, d: (plotAreaM2 * 10) / 100, note: 'non-dwelling: >= 10% of land (ordinance 52(2))' });

  if (c.highRise || c.extraLarge) {
    if (c.dwelling) r.push({ cite: CITE.O_33_6_1, d: (plotAreaM2 * 30) / 100, note: 'high-rise/XL dwelling: >= 30% of plot (MR33 6(1))' });
    else r.push({ cite: CITE.O_33_6_2, d: (plotAreaM2 * 10) / 100, note: 'high-rise/XL non-dwelling: >= 10% of plot (MR33 6(2))' });
  }

  const osrNote = zoneOsrPct === 4.5 ? '' : ` (gazette ย.9 value is 4.5%; zone polygon gives ${zoneOsrPct}%)`;
  r.push({ cite: CITE.O_2556_16_2, d: (b.gfaM2 * zoneOsrPct) / 100, note: `zone OSR: >= ${zoneOsrPct}% of total floor area (MR2556 16(2))${osrNote}` });

  return required(r);
}

// ---- frontage tests ----
const abuts = (f: Frontage): boolean => f.gapM === 0;
// MR33 art 2: a side >= 12.00 m abutting a public road with right-of-way >= minW
const mr33Frontage = (fs: Frontage[], minW: number): boolean =>
  fs.some((f) => abuts(f) && f.lengthM >= 12 && f.widthM >= minW);
// MR2556 art 36(2)/(3): a side >= minW abutting a public road with right-of-way >= minW
const zoneRoad = (fs: Frontage[], minW: number): boolean =>
  fs.some((f) => abuts(f) && f.lengthM >= minW && f.widthM >= minW);

// ---- gates ----
export function gates(
  b: Building,
  frontages: Frontage[],
  nearStation: boolean,
  hotelRooms?: number,
): { ok: boolean; reasons: Reading[] } {
  const c = classify(b);
  const reasons: Reading[] = [];

  // MR33 art 2
  if (c.highRise || c.extraLarge) {
    if (b.gfaM2 <= 30000) {
      const ok = mr33Frontage(frontages, 10);
      reasons.push({ cite: CITE.G_33_2_1, d: yes(ok), note: `floor area <= 30,000: needs a side >= 12.00 m abutting a road >= 10.00 m: ${ok ? 'met' : 'not met'}` });
      reasons.push(na(CITE.G_33_2_1C, 'that road must run continuously to another public road >= 10.00 m (road network)'));
    } else {
      const ok = mr33Frontage(frontages, 18);
      reasons.push({ cite: CITE.G_33_2_2, d: yes(ok), note: `floor area > 30,000: needs a side >= 12.00 m abutting a road >= 18.00 m: ${ok ? 'met' : 'not met'}` });
      reasons.push(na(CITE.G_33_2_2C, 'that road must run continuously to another public road >= 18.00 m (road network)'));
    }
    reasons.push(na(CITE.G_33_2_3, 'road-side land >= 12.00 m wide continuously to the building site, clear for fire trucks (plot shape)'));
  } else {
    reasons.push({ cite: CITE.G_33_2_1, d: 1, note: 'not high-rise or extra-large: MR33 art 2 not triggered' });
  }

  // MR2556 art 16 (zone ย.9) bans
  if (b.use === 'condo' || b.use === 'apartment') {
    reasons.push({ cite: CITE.G_2556_16_BAN, d: 1, note: 'multi-unit residential is not in the ย.9 ban list' });
  }

  if (b.use === 'hotel') {
    if (hotelRooms === undefined) {
      reasons.push(na(CITE.G_2556_16_8, 'hotel room count not given; > 80 rooms is banned unless on a >= 12 m road or within 500 m of a station'));
    } else if (hotelRooms > 80) {
      const road = zoneRoad(frontages, 12);
      const ok = road || nearStation;
      reasons.push({ cite: CITE.G_2556_16_8, d: yes(ok), note: `hotel with ${hotelRooms} rooms (> 80): ${ok ? 'exception applies' : 'banned (no >= 12 m road, not within 500 m of a station)'}` });
      if (nearStation) reasons.push({ cite: CITE.G_2556_37, d: 1, note: 'within 500 m of a station platform (input)' });
      if (road) {
        reasons.push({ cite: CITE.G_2556_36_2, d: 1, note: 'a side >= 12 m abuts a public road with right-of-way >= 12 m' });
        if (!nearStation) reasons.push(na(CITE.G_2556_36_2, 'the access road must connect to other public roads (>= 12 m one end, >= 8 m the other) (road network)'));
      }
      if (!ok) reasons.push(na(CITE.G_2556_ERR_36, 'the plot may still qualify if its road is in the plan\'s named-road list (erratum to art 36)'));
    } else {
      reasons.push({ cite: CITE.G_2556_16_8, d: 1, note: `hotel with ${hotelRooms} rooms (<= 80): not banned` });
    }
  }

  if (b.use === 'office') {
    if (b.gfaM2 > 10000) {
      const road = zoneRoad(frontages, 16);
      const ok = road || nearStation;
      reasons.push({ cite: CITE.G_2556_16_10, d: yes(ok), note: `office operating area (read as floor area) ${b.gfaM2} > 10,000: ${ok ? 'exception applies' : 'banned (no >= 16 m road, not within 500 m of a station)'}` });
      if (nearStation) reasons.push({ cite: CITE.G_2556_37, d: 1, note: 'within 500 m of a station platform (input)' });
      if (road) {
        reasons.push({ cite: CITE.G_2556_36_3, d: 1, note: 'a side >= 16 m abuts a public road with right-of-way >= 16 m' });
        if (!nearStation) reasons.push(na(CITE.G_2556_36_3, 'the access road must connect to other public roads (>= 16 m one end, >= 12 m the other) (road network)'));
      }
      if (!ok) reasons.push(na(CITE.G_2556_ERR_36, 'the plot may still qualify if its road is in the plan\'s named-road list (erratum to art 36)'));
    } else {
      reasons.push({ cite: CITE.G_2556_16_10, d: 1, note: `office operating area ${b.gfaM2} <= 10,000: not banned` });
    }
  }

  return { ok: !reasons.some((x) => x.d === 0), reasons };
}

// ---- floor-area caps ----
export function gfaCaps(
  use: Use,
  plotAreaM2: number,
  zoneFar: number,
  frontages: Frontage[],
  nearStation: boolean,
): { caps: { cite: string; value: number; note?: string }[]; min: number } {
  const caps: { cite: string; value: number; note?: string }[] = [];

  const farNote = zoneFar === 7 ? 'zone FAR 7:1' : `zone polygon FAR ${zoneFar}:1 (gazette ย.9 value is 7:1)`;
  caps.push({ cite: CITE.F_2556_16_1, value: zoneFar * plotAreaM2, note: farNote });

  caps.push({ cite: CITE.F_33_5, value: 10 * plotAreaM2, note: 'FAR <= 10:1, binds only high-rise or extra-large buildings (MR33 5)' });

  if (!mr33Frontage(frontages, 10)) {
    caps.push({ cite: CITE.F_33_2_1, value: 10000, note: 'EXCLUSIVE (< 10,000): no side >= 12 m on a >= 10 m road, so the building may not be extra-large (nor high-rise) (MR33 2)' });
  } else if (!mr33Frontage(frontages, 18)) {
    caps.push({ cite: CITE.F_33_2_2, value: 30000, note: 'inclusive: no side >= 12 m on a >= 18 m road, so floor area <= 30,000 (MR33 2)' });
  }

  if (use === 'office' && !(nearStation || zoneRoad(frontages, 16))) {
    caps.push({ cite: CITE.F_2556_16_10, value: 10000, note: 'inclusive: office operating area (read as floor area) <= 10,000 without a >= 16 m road or station (MR2556 16(10))' });
  }

  caps.push({ cite: CITE.F_2556_57, value: NaN, note: `not assessable: FAR bonuses (arts 52-56) together at most +20% (would be ${zoneFar * plotAreaM2 * 1.2})` });

  let min = Infinity;
  for (const x of caps) if (Number.isFinite(x.value) && x.value < min) min = x.value;
  return { caps, min };
}

// ---- wider-road relief ----
export function reliefEligible(facts: {
  narrowWidthM: number; wideWidthM: number; sameRoad: boolean; corner: boolean; roadsApartM: number;
  buildingLengthAlongNarrowM?: number; buildingWidthAlongWideM?: number;
}): { eligible: boolean; reasons: Reading[] } {
  const reasons: Reading[] = [];
  const unequal = facts.narrowWidthM < facts.wideWidthM;
  const distinct = !facts.sameRoad && unequal;

  // MR55 art 45: flanked by two unequal roads <= 60 m apart, building width along wider road <= 60 m
  let e45: Reading;
  if (!distinct || facts.corner) {
    e45 = { cite: CITE.E_55_45, d: 0, note: 'needs two distinct unequal roads flanking the building (not a corner)' };
  } else if (facts.roadsApartM > 60) {
    e45 = { cite: CITE.E_55_45, d: 0, note: `roads ${facts.roadsApartM} m apart (> 60)` };
  } else if (facts.buildingWidthAlongWideM === undefined) {
    e45 = na(CITE.E_55_45, 'building width along the wider road not given (must be <= 60 m)');
  } else {
    const ok = facts.buildingWidthAlongWideM <= 60;
    e45 = { cite: CITE.E_55_45, d: yes(ok), note: `building width along wider road ${facts.buildingWidthAlongWideM} m (<= 60 required)` };
  }
  reasons.push(e45);

  // MR55 art 46: corner of two unequal roads, building length along narrower road <= 60 m
  let e46: Reading;
  if (!distinct || !facts.corner) {
    e46 = { cite: CITE.E_55_46, d: 0, note: 'needs a corner of two distinct unequal roads' };
  } else if (facts.buildingLengthAlongNarrowM === undefined) {
    e46 = na(CITE.E_55_46, 'building length along the narrower road not given (must be <= 60 m)');
  } else {
    const ok = facts.buildingLengthAlongNarrowM <= 60;
    e46 = { cite: CITE.E_55_46, d: yes(ok), note: `building length along narrower road ${facts.buildingLengthAlongNarrowM} m (<= 60 required)` };
  }
  reasons.push(e46);

  // Ordinance art 49 para 2: public road >= 80 m wide within 100 m, access >= 12 m
  const e492: Reading = facts.wideWidthM >= 80
    ? na(CITE.E_ORD_49_2, 'wider road >= 80 m; distance <= 100 m and access width >= 12 m not given')
    : { cite: CITE.E_ORD_49_2, d: 0, note: 'wider road < 80 m' };
  reasons.push(e492);

  // Ordinance art 49 para 1: no flanked/corner relief in the ordinance text
  reasons.push({ cite: CITE.E_ORD_49_1, d: 0, note: 'ordinance has no equivalent of MR55 arts 45-46; under an ordinance-only reading no flanked/corner relief' });

  const eligible = e45.d === 1 || e46.d === 1 || e492.d === 1;
  return { eligible, reasons };
}
