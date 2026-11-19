# Clause table (independent oracle)

Each row is one enumerated case encoded as one branch in `index.ts`. `cite` is `file:line` where the clause (or case) text starts. `fragment` is copied verbatim from that line of the `.txt` (broken PDF spacing kept) so a test can grep it. Boundary words: ตั้งแต่ = at least (>=), ไม่เกิน = not exceeding (<=), เกิน / มากกว่า = exceeding (>), น้อยกว่า = less than (<), ไม่ถึง = not reaching (<), ไม่น้อยกว่า = not less than (>=).

Distances are from the PLOT EDGE inward. `g` = gap (land between plot edge and road/canal boundary), `w` = road or canal width. A setback measured from a road centreline `c` becomes `max(0, c - w/2 - g)`; one measured from the road/canal boundary `s` becomes `max(0, s - g)`.

## Definitions (classify)

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| D-HR-33 | mr33.txt:14 | `ตงั แต่ 23.00 เมตรขนึ ไป` | High-rise (อาคารสูง): occupiable building with height >= 23.00 m, ground to roof deck. | ตั้งแต่ = >= | none |
| D-HR-ORD | bma-ordinance-2544.txt:282 | `“อาคารสงู ” หมายความว่า` | High-rise: height >= 23 m, ground to roof deck. | ตั้งแต่ = >= | Same as MR33. |
| D-XL-33 | mr33.txt:17 | `“อาคารขนาดใหญ่พเิ ศษ”` | Extra-large: total floor area of all floors OR any single floor >= 10,000 m2. | ตั้งแต่ = >= | none |
| D-XL-ORD | bma-ordinance-2544.txt:249 | `“อาคารขนาดใหญ่พเิ ศษ”` | Extra-large: total floor area of all floors >= 10,000 m2 (no single-floor limb). | ตั้งแต่ = >= | Narrower than MR33 only in wording; a single floor >= 10,000 implies total >= 10,000. |
| D-LG-55 | mr55-update.txt:55 | `“อาคารขนาดใหญ”` | Large: total OR any single floor > 2,000 m2; or height >= 15.00 m and total OR any floor > 1,000 m2 (and <= 2,000). | เกิน = >, ตั้งแต่ = >= | none |
| D-LG-ORD | bma-ordinance-2544.txt:244 | `“อาคารขนาดใหญ่”` | Large: total > 2,000 m2; or height >= 15 m and total > 1,000 m2. | เกิน = >, ตั้งแต่ = >= | Equivalent in practice to MR55. |
| D-COM-55 | mr55-update.txt:36 | `“อาคารพาณชิ ย”` | Commercial building: used for commerce, business services, or industry with machines < 5 hp. Office and hotel = commercial. | น้อยกว่า 5 = < | Is a rental apartment "business service"? Read as residential (not commercial). |
| D-COM-55-20M | mr55-update.txt:37 | `ใหหมายความรวมถงึ อาคาร` | Also any other building <= 20 m from a road/public way that MAY be used commercially. | ไม่เกิน = <= | Needs road distance and use potential: not assessable in `classify` (d = NaN). |
| D-COM-ORD | bma-ordinance-2544.txt:260 | `“อาคารพาณิชย”์` | Commercial: commerce, business service, or industry with machines <= 5 hp (no 20 m limb). | ไม่เกิน = <= | Differs from MR55 (no 20 m extension; <= vs <). |
| D-PUB-55 | mr55-update.txt:40 | `“อาคารสาธารณะ”` | Public building: assembly for government, politics, education, religion, social, recreation or commerce, e.g. hotel. Hotel = public; office = not. | n/a | Office is not listed; read as not public. |
| D-PUB-ORD | bma-ordinance-2544.txt:274 | `“อาคารสาธารณะ”` | Same list; hotel is public. | n/a | Same. |
| D-RES-55 | mr55-update.txt:19 | `“อาคารอยูอาศัย”` | Dwelling: normally lived in day and night, permanently or temporarily. Condo/apartment = dwelling. | n/a | A hotel is "temporary" living; read as NOT a dwelling (it is listed as a public building). |
| D-RES-ORD | bma-ordinance-2544.txt:289 | `“อาคารอย่อู าศยั ”` | Same as MR55. | n/a | Same. |
| D-MULTI-55 | mr55-update.txt:53 | `“อาคารอยอู าศยั รวม”` | Multi-family dwelling: separate units per family. Condo/apartment. | n/a | none |
| D-MULTI-ORD | bma-ordinance-2544.txt:292 | `“อาคารอยู่อาศยั รวม”` | Multi-family dwelling incl. dormitories. Condo/apartment. | n/a | none |

## Road distance (requiredRoadDistance)

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| R-55-41-P1 | mr55-update.txt:404 | `ความกวา งนอ ยกวา 6 เมต` | Any building near a public road with w < 6 m: building line >= 3 m from road centreline. d = 3 - w/2 - g. | น้อยกว่า = < | none |
| R-55-41-1 | mr55-update.txt:410 | `มีความกวางนอยกวา 10 เม` | Building > 2 storeys or > 8 m, commercial, public (art 41 para 2 list): w < 10: >= 6 m from centreline. d = 6 - w/2 - g. | น้อยกว่า = <; เกิน = > | Height for "เกิน 8 เมตร" read as `heightM`. |
| R-55-41-2 | mr55-update.txt:413 | `แตไ มเกนิ 20 เมตร` | Same buildings, 10 <= w <= 20: >= w/10 from road boundary. d = w/10 - g. | ตั้งแต่ 10 = >=, ไม่เกิน 20 = <= | none |
| R-55-41-3 | mr55-update.txt:416 | `มคี วามกวางเกนิ 20 เมตร` | Same buildings, w > 20: >= 2 m from road boundary. d = 2 - g. | เกิน = > | none |
| R-ORD-50-P1 | bma-ordinance-2544.txt:713 | `คี วามกวา้ งน้อยกว่า 6 เม` | Any building, w < 6: >= 3 m from centreline (fence <= 2 m excepted). | น้อยกว่า = < | none |
| R-ORD-50-1 | bma-ordinance-2544.txt:721 | `คี วามกวา้ งน้อยกวา่ 10` | Building > 2 storeys or > 8 m, LARGE building, commercial, public, etc., EXCEPT dwelling <= 3 storeys OR <= 10 m AND area <= 1,000 m2: w < 10: >= 6 m from centreline. | น้อยกว่า = <; ไม่เกิน = <= | Adds "large building" vs MR55 and an exemption MR55 lacks. "<= 3 storeys หรือ <= 10 m" read literally as OR. |
| R-ORD-50-2 | bma-ordinance-2544.txt:724 | `แตไ่ มเ่ กนิ 20 เมตร` | Same buildings, 10 <= w <= 20: >= w/10 from boundary. | >=, <= | Same as above. |
| R-ORD-50-3 | bma-ordinance-2544.txt:727 | `กวา้ งเกนิ 20 เมตร` | Same buildings, w > 20: >= 2 m from boundary. | เกิน = > | Same as above. |
| R-55-44 | mr55-update.txt:434 | `ไมเ กินสองเทาของระยะราบ` | Height at any point <= 2 x horizontal distance from that point to the OPPOSITE boundary of the nearest public road. For a floor top at h: d = h/2 - g - w. | ไม่เกิน = <= | "Height of a point" read as the floor's `topM`; road level assumed = ground level (para 2 allows either). |
| R-ORD-49 | bma-ordinance-2544.txt:703 | `ไม่เกนิ 2 เท่าของระยะราบ` | Same rule in the ordinance ("แนวถนนด้านตรงข้าม"). d = h/2 - g - w. | ไม่เกิน = <= | Ordinance height is measured from road level (def. 7); same result on flat ground. |
| R-33-4 | mr33.txt:80 | `สว่ นทเี ป็นขอบเขตนอกสดุ` | High-rise or extra-large: outermost edge (above or below ground, not foundations) >= 6.00 m from another owner's land or a public road. Road: d = 6 - g. Private: d = 6. | ไม่น้อยกว่า = >= | Whether a public canal is "another's land" (see C-33-4). |
| R-ORD-52-6A | bma-ordinance-2544.txt:753 | `(6) อาคารพาณิชย์` | Commercial, public, > 2 storeys or > 8 m (except dwelling <= 3 storeys not on a public way): front open space >= 6 m wide, length >= 1/6 of perimeter, linked by a >= 6 m internal road to the public way. | เกิน = >, ไม่น้อยกว่า = >= | Not a setback from a fixed line (length depends on perimeter; may wrap to a side): d = NaN, not assessable. |
| R-ORD-52-6B | bma-ordinance-2544.txt:756 | `ถา้ สงู เกนิ 3 ชนั` | As above but > 3 storeys: >= 12 m wide. | เกิน = > | Same: d = NaN. |
| R-ORD-53 | bma-ordinance-2544.txt:770 | `ตามขอ้ 52(3) และ 52(6)` | Building on a public way is exempt from 52(6) if its frontage side is > 1/8 of perimeter and <= 20 m from the public way. | มากกว่า = >, ไม่เกิน = <= | A MAXIMUM distance, cannot be expressed as a minimum: d = NaN. |
| R-2556-40-1 | mr2556.txt:3162 | `ริมถนนตามรายช่ือถนน` | Land in open-space zone ล.2 on a listed road: >= 2 m planting strip from the right-of-way line. | ไม่น้อยกว่า = >= | Needs the open-space map and road list: d = NaN. |

## Private boundary distance (requiredPrivateDistance), walls with openings/balconies

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| P-55-50-1 | mr55-update.txt:516 | `ความสงู ไมเ กนิ 9 เมตร` | Building height <= 9 m: wall/balcony with openings >= 2 m from boundary. | ไม่เกิน = <= | Building height (not floor height). |
| P-55-50-2 | mr55-update.txt:517 | `แตไมถ ึง 23 เมตร` | 9 < height < 23 m: >= 3 m. No case for >= 23 m (high-rise falls to MR33 art 4). | เกิน 9 = >, ไม่ถึง 23 = < | none |
| P-ORD-54-1 | bma-ordinance-2544.txt:776 | `อาคารดา้ นชดิ ทดี นิ` | Openings on storey 2 and below OR at height <= 9 m: >= 2 m from private land boundary. | ลงมา = <=, ไม่เกิน = <= | Per floor: storey read as `level` (1 = ground), height as floor `topM`. A floor can match both cases; both readings returned, max wins. |
| P-ORD-54-2 | bma-ordinance-2544.txt:777 | `ชนั 3 ขนึ ไปหรอื` | Storey 3 and above OR height > 9 m: >= 3 m. | ขึ้นไป = >=, เกิน = > | Same. |
| P-33-4 | mr33.txt:80 | `สว่ นทเี ป็นขอบเขตนอกสดุ` | (Same clause as R-33-4.) High-rise or extra-large: >= 6.00 m from another owner's land. | >= | none |

## Canal / public water distance (requiredCanalDistance)

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| C-55-42-1 | mr55-update.txt:419 | `แมน ้ํา คู คลอง ลําราง` | Public water (river, ditch, canal...) w < 10 m: building line >= 3 m from its boundary. d = 3 - g. | น้อยกว่า = < | none |
| C-55-42-2 | mr55-update.txt:421 | `ตัง้ แต 10 เมตรข้ึนไป` | w >= 10 m: >= 6 m. d = 6 - g. | ตั้งแต่ = >= | none |
| C-55-42-P2 | mr55-update.txt:424 | `บึง ทะเลสาบ หรอื ทะเล` | Large water body (swamp, lake, sea): >= 12 m. | ไม่น้อยกว่า = >= | Input is a canal, cannot tell it is a large body: d = NaN. |
| C-2556-40-2A | mr2556.txt:3167 | `คี วามกวา้ งนอ้ ยกว่า ๑๐` | Land in zone ล.3 on public water w < 10 m: >= 3 m planting strip parallel to the bank. | น้อยกว่า = < | Needs the open-space map: d = NaN. |
| C-2556-40-2B | mr2556.txt:3168 | `แต่ถ้าแหล่งนํ้า` | ล.3, w >= 10 m: >= 6 m. | ตั้งแต่ = >= | Needs the map: d = NaN. |
| C-33-4 | mr33.txt:80 | `สว่ นทเี ป็นขอบเขตนอกสดุ` | (Same clause as R-33-4.) High-rise or extra-large: >= 6.00 m from "another's land"; public canal land read as land of another (the state). d = 6 - g. | >= | Judgement call: canal = another's land. |

## Clear space around the building (requiredClearSpace)

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| K-ORD-55-1 | bma-ordinance-2544.txt:780 | `คี วามสงู ไม่เกนิ 15 เมตร` | Height <= 15 m: open space all round >= 1 m (houses <= 300 m2 excepted; never our uses). | ไม่เกิน = <= | Not shareable with another building's space. |
| K-ORD-55-2 | bma-ordinance-2544.txt:783 | `คี วามสงู เกนิ 15 เมตร` | Height > 15 m: open space all round >= 2 m. | เกิน = > | none |
| K-33-3 | mr33.txt:71 | `ผวิ การจราจรกว้าง` | High-rise or extra-large: uncovered road with traffic surface >= 6.00 m all round the building for fire trucks. d = 6. | ไม่น้อยกว่า = >= | Whether a public road can serve part of the ring is not assessable; counted as 6 m clear all round. |
| K-ORD-52-7 | bma-ordinance-2544.txt:762 | `(7) อาคารพาณชิ ย์` | Commercial, industrial, public buildings: uncovered rear walkway >= 2 m. | ไม่น้อยกว่า = >= | Rear side only and which edge is "rear" is unknown: d = NaN. |

## Open space (requiredOpenSpace), m2

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| O-55-33-1 | mr55-update.txt:313 | `30 ใน 100 สว นของ` | Dwelling / multi-family dwelling: open space >= 30% of the LARGEST FLOOR area. | ไม่น้อยกว่า = >= | Base differs from ordinance (floor vs land). |
| O-55-33-2 | mr55-update.txt:316 | `ตกึ แถว อาคารพาณิชย` | Commercial, public, other non-dwelling: >= 10% of the largest floor (30% if also a dwelling). | >= | none |
| O-ORD-52-1 | bma-ordinance-2544.txt:736 | `30 ใน 100 ส่วนของ` | Dwelling: >= 30% of LAND area. | >= | Base differs from MR55. |
| O-ORD-52-2 | bma-ordinance-2544.txt:737 | `ตกึ แถว อาคารพาณิชย์` | Commercial, public, other non-dwelling: >= 10% of land area. | >= | none |
| O-33-6-1 | mr33.txt:92 | `รอ้ ยละ 30 ของพนื ทดี นิ` | High-rise / extra-large dwelling: >= 30% of plot area. | >= | none |
| O-33-6-2 | mr33.txt:93 | `อาคารพาณิชย์ โรงงาน` | High-rise / extra-large non-dwelling: >= 10% of plot area. | >= | none |
| O-2556-16-2 | mr2556.txt:1483 | `ร้อยละส่จี ดุ ห้า` | Zone ย.9: open space >= 4.5% of total floor area (uses the zone OSR argument), and never below the building-control minimum (handled by `max`). | ไม่น้อยกว่า = >= | The 50% permeable planting share of the open space is not an open-space minimum; not encoded. |

## Floor-area caps (gfaCaps), m2

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| F-2556-16-1 | mr2556.txt:1480 | `พ้ืนที่ดินไม่เกิน ๗ : ๑` | Zone ย.9: FAR <= 7:1 (the zone FAR argument is used; note if it differs from 7). | ไม่เกิน = <= | none |
| F-33-5 | mr33.txt:84 | `ต้องมคี ่าสูงสุดของ` | High-rise / extra-large: FAR of all buildings on the plot <= 10:1. | ไม่เกิน = <= | `gfaCaps` has no height input: listed with a note that it binds only high-rise/extra-large. |
| F-33-2-1 | mr33.txt:60 | `ไม่เกนิ 30,000` | Derived from G-33-2-1: without a 12 m frontage on a >= 10 m road the building may not be extra-large, so total floor area < 10,000 (exclusive). | ตั้งแต่ 10,000 = XL | Cap value 10,000 is exclusive (note). |
| F-33-2-2 | mr33.txt:64 | `มากกว่า 30,000` | Derived from G-33-2-2: without a 12 m frontage on a >= 18 m road, floor area <= 30,000. | ไม่เกิน = <= | none |
| F-2556-16-10 | mr2556.txt:1425 | `สํานักงานท่ีมีพ้ืนท่ี` | Office with operating area > 10,000 m2 banned unless on a >= 16 m road or within 500 m of a station: cap 10,000 (inclusive). | เกิน = > | Operating area (พื้นที่ประกอบการ) read as total floor area. |
| F-2556-57 | mr2556.txt:3362 | `ตามข้อ ๕๑ ถึงข้อ ๕๖` | FAR bonuses of arts 51-56 together <= +20%. | ไม่เกิน = <= | Need bonus provisions: value NaN, not in `min`. |

## Gates (gates): d = 1 permits/satisfied, 0 blocks, NaN not assessable

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| G-33-2-1 | mr33.txt:60 | `ไม่เกนิ 30,000` | High-rise / extra-large with floor area <= 30,000: one side of the land >= 12.00 m abutting a public road with right-of-way >= 10.00 m. | ไม่เกิน = <=, ไม่น้อยกว่า = >= | "Abutting" (ติด) read as gapM = 0. Separate frontage pieces on the same road are not summed. |
| G-33-2-1C | mr33.txt:62 | `จนไปเชอื มต่อกบั ถนน` | ...that road runs continuously to another public road with right-of-way >= 10.00 m. | >= | Needs road network: d = NaN. |
| G-33-2-2 | mr33.txt:64 | `มากกว่า 30,000` | Floor area > 30,000: side >= 12.00 m abutting a road with right-of-way >= 18.00 m. | มากกว่า = > | Same as G-33-2-1. |
| G-33-2-2C | mr33.txt:66 | `ไม่น้อยกว่า 18.00 เมตร` | ...continuous to another public road >= 18.00 m. | >= | d = NaN. |
| G-33-2-3 | mr33.txt:68 | `ทดี นิ ดา้ นทตี ดิ ถนน` | The road-side land strip must be >= 12.00 m wide continuously up to the building site and kept clear for fire trucks. | >= | Plot shape unknown: d = NaN. |
| G-2556-16-BAN | mr2556.txt:1393 | `ทีด่ นิ ประเภทนี้ หา้ ม` | Zone ย.9 ban list. Multi-unit residential (condo/apartment) is not in the list: permitted. | n/a | none |
| G-2556-16-8 | mr2556.txt:1412 | `ห้องพักเกิน ๘๐ ห้อง` | Hotel with > 80 rooms banned unless on a public road with right-of-way >= 12 m or within 500 m of a station. | เกิน = >, ไม่น้อยกว่า = >= | Rooms from `hotelRooms`; missing -> d = NaN. |
| G-2556-16-10 | mr2556.txt:1425 | `สํานักงานท่ีมีพ้ืนท่ี` | Office with operating area > 10,000 m2 banned unless on a road with right-of-way >= 16 m or within 500 m of a station. | เกิน = >, ไม่น้อยกว่า = >= | Operating area read as `gfaM2`. |
| G-2556-36-2 | mr2556.txt:3102 | `เขตทางไม่น้อยกว่า ๑๒ เมตร` | "On a >= 12 m road" means: a plot side >= 12 m abutting an access public road with right-of-way >= 12 m, continuous to another public road (one end >= 12 m, other >= 8 m), plot within 200 m of that road edge. | ไม่น้อยกว่า = >=, ไม่เกิน = <= | Abutting read as gapM = 0 (then 200 m holds). Connection part not assessable (extra NaN reading). |
| G-2556-36-3 | mr2556.txt:3108 | `เขตทางไม่น้อยกว่า ๑๖ เมตร` | ">= 16 m road": side >= 16 m abutting a road >= 16 m, continuous to another road (>= 16 / >= 12), within 300 m. | >=, <= | Same. |
| G-2556-37 | mr2556.txt:3126 | `ภู่ ายในระยะ ๕๐๐ เมตร` | "Within 500 m of a station" measured from the station platform boundary: taken from the `nearStation` argument. | ภายใน = <= | none |
| G-2556-ERR-36 | mr2556.txt:3442 | `ขอ้ ๓๖ วรรคหนงึ่` | Erratum: art 36 also covers roads named in the plan's road list, not only the width classes. | n/a | Road list not available: d = NaN when a ban would otherwise apply. |

## Wider-road relief (reliefEligible): d = 1 eligible, 0 not, NaN not assessable

| id | cite | fragment | reading | boundary | ambiguity |
|---|---|---|---|---|---|
| E-55-45 | mr55-update.txt:447 | `ขนาดไมเทากันขนาบอยู` | One building flanked by two public roads of unequal width, roads <= 60 m apart and building width along the wider road <= 60 m: height judged against the opposite boundary of the WIDER road. | ไม่เกิน = <= | "Flanked" read as two distinct, non-corner roads. |
| E-55-46 | mr55-update.txt:452 | `อยูที่มุมถนนสาธารณะ` | Building at the corner of two unequal public roads: judged against the wider road; building length along the narrower road must be <= 60 m. | ไม่เกิน = <= | The 60 m length is phrased as a duty; read as a condition of the relief. |
| E-ORD-49-2 | bma-ordinance-2544.txt:706 | `ห่างไม่เกนิ 100 เมตร` | Building on or <= 100 m from a public road >= 80 m wide with an access >= 12 m wide to it: height from the widest road. | ไม่เกิน = <=, ไม่น้อยกว่า = >= | Distance and access width not in `facts`: wide >= 80 -> NaN, else 0. |
| E-ORD-49-1 | bma-ordinance-2544.txt:703 | `ไม่เกนิ 2 เท่าของระยะราบ` | The ordinance's own height rule has no flanked/corner relief like MR55 arts 45-46; an ordinance-only reading gives no relief (d = 0). | n/a | Texts differ: both returned; `eligible` follows MR55 (see README). |

## Not encoded (outside the four Use types or not distance/area rules)

- mr55-update.txt:456 art 46 para 2 (row houses: 15 m along narrower road), mr55 arts 34-39 and ordinance arts 47, 48, 52(3)-(5), 57-59 (row houses, warehouses, factories), mr55 art 48 (buildings on the same owner's land).
- mr55-update.txt:519 art 50 para 2 (blank walls closer than 2/3 m): the brief says assume walls with openings.
- mr2556.txt:3120 art 36 para 2 (planned road lines of roads ก/ข count as right-of-way lines for setbacks): needs the transport plan.
