# Independent legal rule oracle
A second, independent reading of the Bangkok rules (zone ย.9 plan, BMA ordinance 2544, MR55, MR33) to cross-check the envelope engine. `index.ts` (no dependencies) returns every applicable clause as a `Reading` with its `file:line`; `clauses.md` is the clause table (74 rows, Thai fragments verified verbatim on the cited lines); `DISAGREEMENTS.md` is the triage log. Gates and relief use `d` = 1 permits, 0 blocks, NaN not assessable; NaN never enters `max`/`min`; where two texts differ both readings are returned.

Isolation: written only from `sources/*.txt` and the task brief. I did not open `src/`, `test/`, `scripts/`, the engine notes/plan/architecture/assumptions/brief/competitors files, side-session notes, or git history. Nothing outside `oracle/` was edited.

Judgement calls (ambiguous text):
1. Hotel = public + commercial, NOT a dwelling (open space 10%); rental apartment = residential, not business service; office = commercial, not public.
2. Two-text definitions (high-rise, extra-large, large, commercial) hold if either text says so.
3. "Abutting a road" (ติด) in MR33 art 2 / MR2556 art 36 = `gapM === 0`; frontage pieces on one road are not summed; road-network continuity is NaN.
4. Office "operating area" (พื้นที่ประกอบการ) = `gfaM2`.
5. Height-vs-road uses the floor's `topM`, road level = ground. Ordinance art 54 is per floor (`level` 1 = ground, height = `topM`); MR55 art 50 uses building height and has no case at >= 23 m.
6. Ordinance art 50 exemption "<= 3 storeys หรือ <= 10 m and <= 1,000 m2" read literally as (storeys OR height) AND area.
7. A public canal counts as "another's land" for MR33 art 4 (6 m for high-rise/XL); MR33 art 3 fire road counted as 6 m clear all round.
8. NaN (not assessable): ordinance 52(6) front space and 53 exemption, 52(7) rear walkway, zones ล.2/ล.3, large water bodies, FAR bonuses, MR33 art 2 para 3 strip.
9. MR33 FAR 10:1 is listed in `gfaCaps` though it binds only high-rise/XL (no height input); the no-frontage cap of 10,000 is exclusive (noted).
10. Relief: MR55 art 45 "flanked" = two distinct non-corner roads; art 46 "<= 60 m along the narrower road" is a condition; `eligible` follows MR55 and the ordinance's no-relief reading is returned as d = 0.
11. Gap land is subtracted from road/canal setbacks; if that land is private the caller must also apply `requiredPrivateDistance` at the plot edge. Clear space is not reduced by gaps.
