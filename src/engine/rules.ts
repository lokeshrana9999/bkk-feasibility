// Frozen, cited rule table. One row per clause. Thai quotes are taken from the
// texts in sources/ (mr2556.txt, bma-ordinance-2544.txt, mr55-update.txt, mr33.txt);
// the ordinance / MR texts are PDF extractions with broken Thai spacing, so the
// quotes here are normalised (spacing and dropped tone marks restored), not
// re-worded. Where the ordinance and a ministerial regulation differ, the
// engine applies the stricter one (assumptions.md A3).

import { straightSideLength } from './measure.js';
import type { BuildingType, Chain, DistancePart } from './types.js';

export type RuleKind = 'limit' | 'distance' | 'gate' | 'relief' | 'not-assessed';

export interface RuleDef {
  id: string;
  source: string; // document
  article: string;
  quoteTh: string;
  text: string; // English paraphrase
  kind: RuleKind;
}

const ZONING = 'Bangkok Comprehensive Plan MR B.E. 2556 (Royal Gazette 130/41 ก)';
const ORD = 'Bangkok Building Control Ordinance B.E. 2544';
const MR55 = 'Ministerial Regulation 55 (B.E. 2543)';
const MR33 = 'Ministerial Regulation 33 (B.E. 2535, as amended by MR 50)';

const rows: RuleDef[] = [
  {
    id: 'Z16-FAR', source: ZONING, article: 'art. 16 para. 3 (1)', kind: 'limit',
    quoteTh: 'มีอัตราส่วนพื้นที่อาคารรวมต่อพื้นที่ดินไม่เกิน ๗ : ๑',
    text: 'Total floor area of all floors of all buildings <= FAR x plot area. FAR is read per zone polygon (ย.๙-๔ is 6 in the city data).',
  },
  {
    id: 'Z16-OSR', source: ZONING, article: 'art. 16 para. 3 (2)', kind: 'limit',
    quoteTh: 'มีอัตราส่วนของที่ว่างต่อพื้นที่อาคารรวมไม่น้อยกว่าร้อยละสี่จุดห้า แต่อัตราส่วนของที่ว่างต้องไม่ต่ำกว่าเกณฑ์ขั้นต่ำของที่ว่างอันปราศจากสิ่งปกคลุมตามกฎหมายว่าด้วยการควบคุมอาคาร',
    text: 'Open space (uncovered plot area) >= OSR% of total floor area, and never below the Building Control Act minimum.',
  },
  {
    id: 'Z16-PERM', source: ZONING, article: 'art. 16 para. 3 (2)', kind: 'not-assessed',
    quoteTh: 'ให้มีพื้นที่น้ำซึมผ่านได้เพื่อปลูกต้นไม้ไม่น้อยกว่าร้อยละห้าสิบของพื้นที่ว่าง',
    text: 'At least 50% of the open space must be permeable planting. Not assessed: the engine has no landscape data.',
  },
  {
    id: 'Z16-HOTEL', source: ZONING, article: 'art. 16 para. 2 (8)', kind: 'gate',
    quoteTh: 'โรงแรมตามกฎหมายว่าด้วยโรงแรมที่มีจำนวนห้องพักเกิน ๘๐ ห้อง เว้นแต่ที่ตั้งอยู่ริมถนนสาธารณะที่มีขนาดเขตทางไม่น้อยกว่า ๑๒ เมตร หรือตั้งอยู่ภายในระยะ ๕๐๐ เมตร จากบริเวณโดยรอบสถานีรถไฟฟ้าขนส่งมวลชน',
    text: 'Hotels over 80 rooms need a road of >= 12 m or a station within 500 m. Rooms are estimated from GFA (written call: 50 m2 GFA per room).',
  },
  {
    id: 'Z16-OFFICE', source: ZONING, article: 'art. 16 para. 2 (10)', kind: 'gate',
    quoteTh: 'สำนักงานที่มีพื้นที่ประกอบการเกิน ๑๐,๐๐๐ ตารางเมตร เว้นแต่ที่ตั้งอยู่ริมถนนสาธารณะที่มีขนาดเขตทางไม่น้อยกว่า ๑๖ เมตร หรือตั้งอยู่ภายในระยะ ๕๐๐ เมตร จากบริเวณโดยรอบสถานีรถไฟฟ้าขนส่งมวลชน',
    text: 'Offices over 10,000 m2 need a road of >= 16 m or a station within 500 m. Business area is taken as the whole GFA (stricter).',
  },
  {
    id: 'ORD52-OPEN', source: ORD, article: 'art. 52 (1)-(2)', kind: 'limit',
    quoteTh: '(1) อาคารอยู่อาศัยต้องมีที่ว่างไม่น้อยกว่า 30 ใน 100 ส่วนของพื้นที่ที่ดิน (2) ... อาคารอื่นซึ่งไม่ได้ใช้เป็นที่อยู่อาศัย ต้องมีที่ว่างไม่น้อยกว่า 10 ใน 100 ส่วนของพื้นที่ที่ดิน',
    text: 'Open space >= 30% of the plot for dwellings (condo, apartment); 10% for other buildings (office; hotel treated as non-dwelling, written call).',
  },
  {
    id: 'MR33-6', source: MR33, article: 'art. 6', kind: 'limit',
    quoteTh: '(1) อาคารที่อยู่อาศัยต้องมีที่ว่างไม่น้อยกว่าร้อยละ 30 ของพื้นที่ดินที่ใช้เป็นที่ตั้งอาคาร (2) ... อาคารอื่นที่ไม่ได้ใช้เป็นที่อยู่อาศัย ต้องมีที่ว่างไม่น้อยกว่าร้อยละ 10',
    text: 'High-rise / extra-large buildings: the same 30% / 10% of plot open space.',
  },
  {
    id: 'MR55-33', source: MR55, article: 'art. 33', kind: 'limit',
    quoteTh: '(1) อาคารอยู่อาศัย และอาคารอยู่อาศัยรวม ต้องมีที่ว่างไม่น้อยกว่า 30 ใน 100 ส่วนของพื้นที่ชั้นใดชั้นหนึ่งที่มากที่สุดของอาคาร',
    text: 'Open space >= 30% (dwelling) or 10% (other) of the largest floor.',
  },
  {
    id: 'ORD50-ROAD', source: `${ORD} / ${MR55}`, article: 'ord. art. 50; MR 55 art. 41', kind: 'distance',
    quoteTh: '(1) ถ้าถนนสาธารณะนั้นมีความกว้างน้อยกว่า 10 เมตร ให้ร่นแนวอาคารห่างจากกึ่งกลางถนนสาธารณะอย่างน้อย 6 เมตร (2) ถ้าถนนสาธารณะนั้นมีความกว้างตั้งแต่ 10 เมตรขึ้นไป แต่ไม่เกิน 20 เมตร ให้ร่นแนวอาคารห่างจากเขตถนนสาธารณะอย่างน้อย 1 ใน 10 ของความกว้างของถนนสาธารณะ (3) ถ้าถนนสาธารณะนั้นมีความกว้างเกิน 20 เมตรขึ้นไป ให้ร่นแนวอาคารห่างจากเขตถนนสาธารณะอย่างน้อย 2 เมตร',
    text: 'Buildings > 2 storeys or > 8 m, large buildings (> 2,000 m2, or >= 15 m and > 1,000 m2), and commercial or public buildings at any height (offices: art. 5(106); hotels: art. 5(109)): road W < 10 m: 6 m from the centreline; 10-20 m: W/10 from the road line; > 20 m: 2 m. Measured from the plot edge: minus the edge gap.',
  },
  {
    id: 'ORD49-2X', source: `${ORD} / ${MR55}`, article: 'ord. art. 49; MR 55 art. 44', kind: 'distance',
    quoteTh: 'ความสูงของอาคารไม่ว่าจากจุดหนึ่งจุดใด ต้องไม่เกินสองเท่าของระยะราบ วัดจากจุดนั้นไปตั้งฉากกับแนวเขตด้านตรงข้ามของถนนสาธารณะที่อยู่ใกล้อาคารนั้นที่สุด',
    text: 'Height at any point <= 2 x horizontal distance to the far side of the road, so each floor top z needs z/2 - W - gap from the plot edge. Applied to every road (stricter than nearest only). Measured to the roof slab; parapet allowance 0.',
  },
  {
    id: 'MR55-46', source: MR55, article: 'arts. 45-46', kind: 'relief',
    quoteTh: 'อาคารหลังเดียวกันซึ่งอยู่ที่มุมถนนสาธารณะสองสายขนาดไม่เท่ากัน ความสูงของอาคาร ณ จุดใดต้องไม่เกินสองเท่าของระยะราบที่ใกล้ที่สุดจากจุดนั้นไปตั้งฉากกับแนวเขตถนนสาธารณะด้านตรงข้ามของสายที่กว้างกว่า และความยาวของอาคารตามแนวถนนสาธารณะที่แคบกว่าต้องไม่เกิน 60 เมตร',
    text: 'Corner plot, or two unequal roads <= 60 m apart: the 2x rule uses the wider road. Written call: the narrower road\'s 2x cut is lifted only within 60 m of the wider road; its plain setback stays.',
  },
  {
    id: 'MR55-50-PRIV', source: `${MR55} / ${ORD}`, article: 'MR 55 art. 50; ord. art. 54', kind: 'distance',
    quoteTh: '(1) อาคารที่มีความสูงไม่เกิน 9 เมตร ผนังหรือระเบียงต้องอยู่ห่างเขตที่ดินไม่น้อยกว่า 2 เมตร (2) อาคารที่มีความสูงเกิน 9 เมตร แต่ไม่ถึง 23 เมตร ผนังหรือระเบียงต้องอยู่ห่างเขตที่ดินไม่น้อยกว่า 3 เมตร',
    text: 'Walls with openings, the larger of two readings: MR 55 art. 50 by building height (2 m up to 9 m, 3 m above, whole building) and ord. art. 54 by floor (3 m from floor 3 up or above 9 m, even in a building under 9 m).',
  },
  {
    id: 'ORD55-CLEAR', source: ORD, article: 'art. 55', kind: 'distance',
    quoteTh: 'อาคารที่มีความสูงไม่เกิน 15 เมตร ต้องมีที่ว่างโดยรอบอาคารไม่น้อยกว่า 1 เมตร ... อาคารที่มีความสูงเกิน 15 เมตร ต้องมีที่ว่างโดยรอบอาคารไม่น้อยกว่า 2 เมตร',
    text: 'Clear space around the building: 1 m if <= 15 m tall, 2 m if taller; applied to every plot edge.',
  },
  {
    id: 'MR55-42-CANAL', source: MR55, article: 'art. 42', kind: 'distance',
    quoteTh: 'ถ้าแหล่งน้ำสาธารณะนั้นมีความกว้างน้อยกว่า 10 เมตร ต้องร่นแนวอาคารให้ห่างจากเขตแหล่งน้ำสาธารณะนั้นไม่น้อยกว่า 3 เมตร แต่ถ้าแหล่งน้ำสาธารณะนั้นมีความกว้างตั้งแต่ 10 เมตรขึ้นไป ต้องร่นแนวอาคารให้ห่างจากเขตแหล่งน้ำสาธารณะนั้นไม่น้อยกว่า 6 เมตร',
    text: 'Canal under 10 m wide: 3 m; 10 m or wider: 6 m (minus the edge gap).',
  },
  {
    id: 'MR33-1', source: MR33, article: 'art. 1 (definitions)', kind: 'gate',
    quoteTh: '“อาคารสูง” หมายความว่า อาคารที่บุคคลอาจเข้าอยู่หรือเข้าใช้สอยได้โดยมีความสูงตั้งแต่ 23.00 เมตรขึ้นไป ... วัดจากระดับพื้นดินที่ก่อสร้างถึงพื้นดาดฟ้า; “อาคารขนาดใหญ่พิเศษ” ... พื้นที่รวมกันทุกชั้นหรือชั้นหนึ่งชั้นใดในหลังเดียวกันตั้งแต่ 10,000 ตารางเมตรขึ้นไป',
    text: 'High-rise = roof deck >= 23 m; extra-large = >= 10,000 m2 in one building. Either one triggers MR 33. Low regime = below both.',
  },
  {
    id: 'MR33-2', source: MR33, article: 'art. 2', kind: 'gate',
    quoteTh: 'ต้องมีด้านหนึ่งด้านใดของที่ดินนั้นยาวไม่น้อยกว่า 12.00 เมตร ติดถนนสาธารณะที่มีเขตทางกว้างไม่น้อยกว่า 10.00 เมตร ... สำหรับที่ดินที่ใช้เป็นที่ตั้งของอาคารสูงหรืออาคารขนาดใหญ่พิเศษที่มีพื้นที่อาคารรวมกันทุกชั้นมากกว่า 30,000 ตารางเมตร ... ติดถนนสาธารณะที่มีเขตทางกว้างไม่น้อยกว่า 18.00 เมตร',
    text: 'High-rise / extra-large needs >= 12 m of contiguous frontage on a public road >= 10 m wide; over 30,000 m2 the road must be >= 18 m.',
  },
  {
    id: 'MR33-2-LINK', source: MR33, article: 'art. 2', kind: 'not-assessed',
    quoteTh: 'ยาวต่อเนื่องกันโดยตลอดจนไปเชื่อมต่อกับถนนสาธารณะอื่นที่มีเขตทางกว้างไม่น้อยกว่า 10.00 เมตร',
    text: 'That road must stay >= 10 m wide all the way to another such road. Not assessed: needs the road network.',
  },
  {
    id: 'MR33-3', source: MR33, article: 'art. 3', kind: 'not-assessed',
    quoteTh: 'อาคารสูงหรืออาคารขนาดใหญ่พิเศษต้องจัดให้มีถนนที่มีผิวการจราจรกว้างไม่น้อยกว่า 6.00 เมตร ที่ปราศจากสิ่งปกคลุมโดยรอบอาคาร',
    text: '6 m fire-engine lane around a high-rise / extra-large building. Not modelled (it may sit inside the setbacks); shown as not assessed.',
  },
  {
    id: 'MR33-4', source: MR33, article: 'art. 4', kind: 'distance',
    quoteTh: 'ส่วนที่เป็นขอบเขตนอกสุดของอาคารสูงหรืออาคารขนาดใหญ่พิเศษไม่ว่าจะอยู่ในระดับเหนือพื้นดินหรือต่ำกว่าระดับพื้นดิน ต้องห่างจากเขตที่ดินของผู้อื่นหรือถนนสาธารณะไม่น้อยกว่า 6.00 เมตร',
    text: 'High-rise / extra-large: every part of the building, podium included, >= 6 m from other owners\' land and public roads. Canal edges also get 6 m (written call).',
  },
  {
    id: 'MR33-5', source: MR33, article: 'art. 5', kind: 'limit',
    quoteTh: 'ต้องมีค่าสูงสุดของอัตราส่วนพื้นที่อาคารรวมกันทุกชั้นของอาคารทุกหลังต่อพื้นที่ดินที่ใช้เป็นที่ตั้งอาคารไม่เกิน 10 ต่อ 1',
    text: 'FAR <= 10 for high-rise / extra-large. Moot where the zone FAR is lower.',
  },
  {
    id: 'ORD52-6-FRONT', source: ORD, article: 'arts. 52 (6), 53', kind: 'not-assessed',
    quoteTh: 'อาคารตามวรรคหนึ่งถ้าสูงเกิน 3 ชั้น ให้มีที่ว่างกว้างไม่น้อยกว่า 12 เมตร ... ต้องมีพื้นที่ต่อเนื่องกันยาวไม่น้อยกว่า 1 ใน 6 ของความยาวเส้นรอบรูปภายนอกอาคาร',
    text: 'Buildings over 3 storeys need a 12 m front open space along 1/6 of the perimeter, linked by a 6 m internal road (waived under art. 53). Not assessed: depends on site layout.',
  },
  {
    id: 'ORD52-6-FRONT6', source: ORD, article: 'arts. 52 (6) para. 1, 53', kind: 'not-assessed',
    quoteTh: 'อาคารพาณิชย์ โรงงานอุตสาหกรรม คลังสินค้า อาคารสาธารณะ อาคารสูงเกิน 2 ชั้น หรือสูงเกิน 8 เมตร ยกเว้นอาคารอยู่อาศัยสูงไม่เกิน 3 ชั้น ที่ไม่อยู่ริมทางสาธารณะ ให้มีที่ว่างด้านหน้ากว้างไม่น้อยกว่า 6 เมตร',
    text: 'Commercial and public buildings (offices, hotels) and buildings over 2 storeys or 8 m, up to 3 storeys, need a 6 m front open space along 1/6 of the perimeter (dwellings of up to 3 storeys not on a public way are exempt; art. 53 may waive it). Not assessed: depends on site layout.',
  },
  {
    id: 'ORD52-7-REAR', source: ORD, article: 'art. 52 (7)', kind: 'not-assessed',
    quoteTh: 'อาคารพาณิชย์ โรงงานอุตสาหกรรม และอาคารสาธารณะ จะต้องมีที่ว่างโดยปราศจากสิ่งปกคลุมเป็นทางเดินหลังอาคารได้ถึงกัน กว้างไม่น้อยกว่า 2 เมตร',
    text: 'Commercial and public buildings (offices, hotels) need an uncovered rear walkway at least 2 m wide. Not assessed: which side is the rear depends on site layout.',
  },
];

export const RULES: Readonly<Record<string, RuleDef>> = Object.freeze(
  Object.fromEntries(rows.map((r) => [r.id, Object.freeze(r)])),
);
export const RULE_ORDER: readonly string[] = Object.freeze(rows.map((r) => r.id));

// ---------------------------------------------------------------------------
// Parameters (written calls, editable through the input where noted)

export interface TypeParams {
  label: string;
  dwelling: boolean;
  floorH: { ground: number; typical: number };
  /** Design generators: largest tower floor plate and slab depth. */
  towerPlateMax: number;
  slabDepth: number;
  podiumFloors: number;
}

export const TYPE_PARAMS: Readonly<Record<BuildingType, TypeParams>> = Object.freeze({
  condo: { label: 'Condominium', dwelling: true, floorH: { ground: 4.5, typical: 3.0 }, towerPlateMax: 900, slabDepth: 18, podiumFloors: 3 },
  apartment: { label: 'Apartment', dwelling: true, floorH: { ground: 4.5, typical: 3.0 }, towerPlateMax: 900, slabDepth: 18, podiumFloors: 3 },
  office: { label: 'Office', dwelling: false, floorH: { ground: 4.5, typical: 3.8 }, towerPlateMax: 1500, slabDepth: 22, podiumFloors: 3 },
  hotel: { label: 'Hotel', dwelling: false, floorH: { ground: 4.5, typical: 3.0 }, towerPlateMax: 1000, slabDepth: 18, podiumFloors: 3 },
});

export const PARAMS = Object.freeze({
  highRiseHeight: 23, // m, MR 33 art. 1
  extraLargeGfa: 10_000, // m2, MR 33 art. 1
  lowRegimeGfaCap: 9_999, // "below 10,000 m2"
  highGateWidth: 10, // m, MR 33 art. 2
  highGateFrontage: 12, // m
  bigGateWidth: 18, // m
  bigGateGfa: 30_000, // m2
  highSetback: 6, // m, MR 33 art. 4
  officeGateGfa: 10_000,
  officeGateWidth: 16,
  hotelGateRooms: 80,
  hotelGateWidth: 12,
  hotelGfaPerRoom: 50, // m2 GFA per room, written call
  reliefReach: 60, // m, MR 55 arts. 45-46
  // Two road chains meeting at a turn smaller than this are one road changing width, not a corner.
  cornerTurnDeg: 30,
  // A road edge counts as frontage (MR 33 art. 2, zoning art. 16 "on the road") only if the
  // plot abuts it (ติด): any gap is someone's land, so only float noise is tolerated. Was 0.5 m
  // (a map-noise call); oracle disagreement D1: the engine follows the oracle's gap = 0 reading.
  frontageGapTol: 0.001, // m, float noise only
  // Frontage length is one straight side ("ด้านหนึ่งด้านใด", D5): edges whose directions stay
  // within this many degrees of each other, after dropping vertices within sideNoise of the line
  // through their neighbours (digitising noise; the same 0.1 m as LIMITS.simplifyTol).
  sideTurnDeg: 5, // degrees, written call
  sideNoise: 0.1, // m
  maxFloors: 60,
  minPlateArea: 40, // m2, smaller parts are dropped
  slivers: 1.5, // m, opening width
  arcTol: 0.01, // m, round-join chord tolerance: chords sit up to this far inside the true arc
  // Every setback buffer is cut this much wider than the law, so arc chords (10 mm) and
  // integer-millimetre rounding (measured up to ~2.6 mm; budget 5 mm) can never bring a plate closer than the legal distance.
  safety: 0.015, // m
  checkTol: 1e-6, // m, float noise only: the checker passes no distance that measures short (0.5 mm short fails)
  geomTol: 0.002, // m, containment (inside plot / inside the floor below): boolean output can move a vertex ~1-2 mm
  parapet: 0, // m
});

export const LIMITS = Object.freeze({
  maxRawVertices: 5000,
  maxVertices: 500,
  simplifyTol: 0.1,
  minArea: 1,
  maxArea: 200_000,
  minWidth: 1,
  maxWidth: 100,
  maxGap: 50,
});

// ---------------------------------------------------------------------------
// Distance formulas, shared by the envelope (which cuts with them) and the
// checker (which measures against them with its own geometry).

/** ORD50-ROAD: distance from the plot edge for buildings > 2 storeys or > 8 m. */
export function roadSetback(W: number, gap: number): number {
  let fromRoadLine: number;
  if (W < 10) fromRoadLine = 6 - W / 2; // 6 m from the centreline
  else if (W <= 20) fromRoadLine = W / 10;
  else fromRoadLine = 2;
  return Math.max(0, fromRoadLine - gap);
}

/** ORD50 para. 1: any building on a road under 6 m: 3 m from the centreline. */
export function narrowRoadSetback(W: number, gap: number): number {
  return W < 6 ? Math.max(0, 3 - W / 2 - gap) : 0;
}

/** ORD49-2X: distance needed from the plot edge for a floor whose top is at z. */
export function twoXDistance(z: number, W: number, gap: number): number {
  return (z + PARAMS.parapet) / 2 - W - gap;
}

/**
 * ORD50-ROAD applies (ord. art. 50 para. 2, MR 55 art. 41 para. 2) to buildings over
 * 2 storeys or 8 m, large buildings (ord. art. 5(101): > 2,000 m2, or >= 15 m and
 * > 1,000 m2), commercial buildings (5(106), trade or business services: offices) and
 * public buildings (5(109), which names hotels), at any height. The ordinance's
 * small-dwelling exemption is not in MR 55, so it is not applied.
 * `withinRoad20`: some part of the building is within 20 m of a public road. MR 55 also calls
 * commercial "any other building within 20 m of a road or public way which may be used
 * commercially" (`mr55-update.txt:36-37`); whether a declared dwelling "may be used" so cannot
 * be assessed, so the stricter reading is applied: it is commercial (oracle disagreement D10).
 */
export function roadSetbackApplies(b: { floors: number; height: number; gfa: number; dwelling: boolean; withinRoad20?: boolean }): boolean {
  return b.floors > 2 || b.height > 8 || !b.dwelling || b.gfa > 2000 || (b.height >= 15 && b.gfa > 1000) || b.withinRoad20 === true;
}

/**
 * MR55-50-PRIV, the larger of two readings: MR 55 art. 50 by building height (2 m up
 * to 9 m, 3 m above) and ord. art. 54 by floor (2 m for floors 1-2 up to 9 m, 3 m from
 * floor 3 or above 9 m). A 3-storey building under 9 m needs 3 m on floor 3.
 */
export function privateSetback(buildingH: number, level = 1, z = 0): number {
  const mr55 = buildingH <= 9 ? 2 : 3;
  const ord54 = level >= 3 || z > 9 ? 3 : 2;
  return Math.max(mr55, ord54);
}

/** Zoning art. 16 "ตั้งอยู่ริมถนน" (located on the road): a road chain that touches the plot. */
export function touchesPlot(c: Chain): boolean {
  return c.role === 'road' && c.gap <= PARAMS.frontageGapTol;
}

const sideCache = new WeakMap<Chain, number>();

/**
 * Frontage length of a road chain: its longest straight side (oracle disagreement D5). A chain
 * that bends by PARAMS.sideTurnDeg or more, or follows a curve, is several sides, and only one
 * of them counts ("ด้านหนึ่งด้านใดของที่ดิน", one side of the land, MR 33 art. 2, zoning art. 36).
 */
export function frontageLength(c: Chain): number {
  let L = sideCache.get(c);
  if (L === undefined) {
    L = straightSideLength(c.points, PARAMS.sideTurnDeg, PARAMS.sideNoise);
    sideCache.set(c, L);
  }
  return L;
}

/**
 * Zoning art. 16 road exceptions read with art. 36 (2)-(3) (`mr2556.txt:3102`, `3108`): the
 * plot must have a side at least as long as the road class (12 m on a >= 12 m road, 16 m on a
 * >= 16 m road) abutting that road. Road width alone is not enough (oracle disagreement D3).
 */
export function zoningRoadFrontage(c: Chain, roadClass: number): boolean {
  return touchesPlot(c) && (c.width ?? 0) >= roadClass && frontageLength(c) >= roadClass - 0.001;
}

/** MR 33 art. 2 frontage: a touching road chain with a straight side of at least 12 m (1 mm float tolerance). */
export function isGateFrontage(c: Chain): boolean {
  return touchesPlot(c) && frontageLength(c) >= PARAMS.highGateFrontage - 0.001;
}

export function clearAround(buildingH: number): number {
  return buildingH <= 15 ? 1 : 2;
}

export function canalSetback(C: number, gap: number): number {
  return Math.max(0, (C < 10 ? 3 : 6) - gap);
}

export interface DistanceCtx {
  /** Floor being placed (1-based) and its top. */
  level: number;
  z: number;
  /** Final building height (bands of arts. 50, 54, 55). */
  buildingH: number;
  /** ORD50-ROAD applies (roadSetbackApplies; the envelope always passes true). */
  art50: boolean;
  /** Building is high-rise or extra-large (MR 33 applies). */
  high: boolean;
}

/**
 * Required distance from a chain, split into the part that is lifted by the
 * wider-road relief (2x) and the part that always applies (base).
 */
export function chainDistance(c: Chain, ctx: DistanceCtx): { base: number; twoX: number; parts: DistancePart[] } {
  const parts: DistancePart[] = [];
  parts.push({ rule: 'ORD55-CLEAR', d: clearAround(ctx.buildingH) });
  let twoX = 0;
  if (c.role === 'road') {
    const W = c.width ?? 0;
    parts.push({ rule: 'ORD50-ROAD', d: ctx.art50 ? roadSetback(W, c.gap) : narrowRoadSetback(W, c.gap) });
    twoX = Math.max(0, twoXDistance(ctx.z, W, c.gap));
  } else if (c.role === 'private') {
    if (!ctx.high) parts.push({ rule: 'MR55-50-PRIV', d: privateSetback(ctx.buildingH, ctx.level, ctx.z) });
  } else {
    parts.push({ rule: 'MR55-42-CANAL', d: canalSetback(c.width ?? 0, c.gap) });
  }
  // a gap strip owned by someone else (oracle disagreement D12, oracle README call 11): the plot
  // edge is then another owner's land boundary, so walls with openings keep the private distance
  if (c.role !== 'private' && c.gapOwner === 'private' && !ctx.high) {
    parts.push({ rule: 'MR55-50-PRIV', d: privateSetback(ctx.buildingH, ctx.level, ctx.z) });
  }
  if (ctx.high) parts.push({ rule: 'MR33-4', d: PARAMS.highSetback });
  const base = Math.max(...parts.map((p) => p.d));
  if (c.role === 'road') parts.push({ rule: 'ORD49-2X', d: twoX });
  return { base, twoX, parts };
}

/** Floor tops for a given floor-to-floor setting: z1 of level k (1-based). */
export function floorTop(k: number, h: { ground: number; typical: number }): number {
  return h.ground + (k - 1) * h.typical;
}
