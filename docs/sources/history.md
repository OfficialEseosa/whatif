# Source log — `src/data/history.json`

Phase 0 audit by the history-researcher agent, 2026-11-13. Every URL below was opened by
the agent on that date (WebFetch, or the desktop browser pane where the site is
JavaScript-rendered or bot-gated). "Agent-checked" is not "verified": `verified` stays
`false` on every card until a human teammate checks it against the source.

Status key: **supported** = the card's body is a fair paraphrase of the source;
**partially** = supported with a caveat noted; **unsupported** = see
`needs-review.md`.

Changes made to `history.json` in this pass are listed under each card and summarised at
the end.

---

## holc_1938 — HOLC redlining map of Atlanta — **supported**

Body: "Federal Home Owners' Loan Corporation appraisers grade Atlanta neighborhoods A–D.
Grade D areas are marked hazardous for lending."

Sources:

1. Rhodes, Jason. "Geographies of Privilege and Exclusion: The 1938 Home Owners Loan
   Corporation 'Residential Security Map' of Atlanta." *Atlanta Studies*, 7 Sept 2017.
   https://atlantastudies.org/2017/09/07/jason-rhodes-geographies-of-privilege-and-exclusion-the-1938-home-owners-loan-corporation-residential-security-map-of-atlanta/
   (DOI 10.18737/atls20170907). Accessed 2026-11-13 via browser pane (site is behind an
   Anubis bot check; plain fetch is refused).
   Supports: in 1938 the federal HOLC produced a "security map" of Atlanta that divided
   the city into 111 neighborhoods and graded each A to D by projected property-value
   trend; Black neighborhoods were "universally marked 'D'". Cites the original folder:
   NARA RG 195, box 82, College Park MD.
2. Mapping Inequality, University of Richmond Digital Scholarship Lab — "Download the
   Data" page, https://dsl.richmond.edu/panorama/redlining/data , and the Atlanta map
   page https://dsl.richmond.edu/panorama/redlining/map/GA/Atlanta . Accessed
   2026-11-13 via browser pane (site is a JS app; plain fetch returns only the title).
   Supports: the maps come from the National Archives "City Survey Files, 1935-1940";
   spatial data is offered as GeoJSON/GeoPackage under a CC BY-NC licence (see
   `overlays.md`). The Atlanta page itself shows the map but little prose.
3. Mitchell, Bruce and Juan Franco. "HOLC 'redlining' maps: The persistent structure of
   segregation and economic inequality." NCRC, 20 Mar 2018. https://ncrc.org/holc/
   Accessed 2026-11-13. Supports the grade labels: red / grade D = "Hazardous"; green =
   "Best"; the maps were made under the City Survey Program in the late 1930s; shows the
   1938 Atlanta map.

Body vs source: matches. "Hazardous" is the HOLC's own label for grade D (NCRC); the
A–D scheme and 1938 date are in Rhodes.

Change made: `source` now also names Rhodes (2017); `sourceUrl` points at the Atlanta
map page instead of the project root (both opened). No body change.

Suggested wording (optional): "In 1938 federal Home Owners' Loan Corporation appraisers
grade 111 Atlanta neighborhoods A–D; grade D ('hazardous') areas are the ones later
called redlined, and every Black neighborhood is graded D." (111 and "every Black
neighborhood ... D" are in Rhodes.)

---

## highways_barriers — Highways as racial barriers — **supported** (books not opened)

Body: "The Downtown Connector is built through Sweet Auburn, and I-20 is routed along a
line between white and Black neighborhoods."

Sources:

1. Smart Growth America. "Divided by Design — Atlanta's story." 2023.
   https://www.smartgrowthamerica.org/signature-reports/divided-by-design/atlantas-story/
   Accessed 2026-11-13. Supports both halves: a north–south expressway was proposed to
   curve east "directly through Sweet Auburn"; advocates got what became the Downtown
   Connector (I-75/85) shifted several blocks east, but the neighborhood "was still
   sliced in half" by an interstate viaduct. On I-20 it quotes Kevin Kruse (NYT Magazine,
   14 Aug 2019) that the road was deliberately plotted in the late 1950s and that Mayor
   Hartsfield called it the "boundary between the white and Negro communities". Also
   gives SGA's own estimate that I-20 displaced at least 7,500 people in 1960 (not used in
   the card).
2. Singh, Rachel. "Atlanta Streets: When Roads Become Walls." Atlanta History Center,
   10 Mar 2022. https://www.atlantahistorycenter.com/blog/atlanta-street-names-when-roads-become-walls/
   Accessed 2026-11-13. Supports the I-20 claim from a primary record: a 1960 Atlanta
   Bureau of Planning report said there was an "understanding" that the West Expressway
   route would be the boundary between white and Black communities.
3. Segregation by Design. "Atlanta: Freeways & Urban Renewal."
   https://www.segregationbydesign.com/atlanta/freeways-urban-renewal Accessed
   2026-11-13. Quotes Bayor's citation of the same 1960 report on Adamsville and says the
   Connector route still cut through Auburn Avenue after the protest that saved the
   Atlanta Life building. Secondary; useful as a pointer to Bayor's pages.

Not opened: Bayor, *Race and the Shaping of Twentieth-Century Atlanta* (UNC Press 1996)
and Kruse, *White Flight* (Princeton 2005). Both remain in `source` as the scholarly
basis; the human checker should confirm the page numbers (Bayor's highway chapter; Kruse's
NYT essay is derived from his book but is not the book).

Body vs source: matches. Note the Connector was moved east to spare part of Auburn
Avenue's commercial core; "built through Sweet Auburn" is still fair (SGA: "sliced in
half").

Change made: SGA added to `source`; `sourceUrl` added. No body change.

Suggested wording (optional): "The Downtown Connector (I-75/85) is pushed through Sweet
Auburn, and I-20 West is routed along what city planners in 1960 called the boundary
between white and Black neighborhoods."

---

## peyton_road_barricades — Peyton Road barricades — **supported**

Body: "The city puts up barricades on Peyton Road in southwest Atlanta to block Black
families from moving into a white neighborhood."

Sources:

1. Carlisle, Lois. "Atlanta's Berlin Wall." Atlanta History Center, 13 May 2021.
   https://www.atlantahistorycenter.com/blog/atlantas-berlin-wall/ Accessed 2026-11-13.
   Supports: on 17 Dec 1962 Mayor Ivan Allen Jr. ordered a wooden roadblock across Peyton
   Road in southwest Atlanta after Dr. Clinton Warner, a Black surgeon, bought a home in
   Cascade Heights; white protesters had demanded a "racial buffer"; a judge ordered it
   removed after 72 days and Allen had it demolished the same day.
2. Ivan Allen Jr. Digital Collection, Georgia Tech. "Ivan Allen Jr. Biography: Peyton
   Road Wall." https://ivanallen.iac.gatech.edu/biography/peyton-road-wall Accessed
   2026-11-13. Supports: 1962; Allen allowed the barrier "made of concrete and steel" to
   maintain a white neighborhood; ruled unconstitutional and torn down.

Not opened: Kruse, *White Flight* (kept in `source`; the Peyton Road episode is a
well-known section of that book — human to confirm pages).

Body vs source: matches (year 1962; southwest Atlanta; purpose). Removal was in March
1963, so "1962" as the label is fine for the erection.

Change made: AHC added to `source`; `sourceUrl` added. No body change.

Suggested wording (optional): "Mayor Ivan Allen Jr. has barricades put across Peyton Road
in southwest Atlanta to keep Black families out of white Cascade Heights; a court orders
them down 72 days later."

---

## urban_renewal — Urban renewal displacement — **supported**

Body: "Federal urban renewal projects clear neighborhoods near downtown and displace
thousands of families."

Sources:

1. Renewing Inequality, University of Richmond Digital Scholarship Lab — Atlanta, GA
   city view. https://dsl.richmond.edu/panorama/renewal/#view=0/0/1&viz=cartogram&city=atlantaGA
   Accessed 2026-11-13 via browser pane (JS app). Supports: "By the late 1960s, an
   estimated 4,077 families had been displaced by urban renewal projects in Atlanta, 89%
   of which were families of color." Lists projects with families displaced: Butler St
   (~1.2K), University Center (878), Rawson-Washington (640), Rockdale (392), Thomasville
   (330), Georgia Tech (164), Howard High School (58); later projects without displacement
   data include Bedford-Pine, Buttermilk Bottom, Georgia State (1962–71). Offers a per-city
   CSV download (`static/cityData/ga-atlanta.csv`).
2. Hurley, Joseph. "Reassessing Urban Renewal in Atlanta and Beyond: A Review of Renewing
   Inequality." *Atlanta Studies*, 7 Aug 2018.
   https://atlantastudies.org/2018/08/07/joe-hurley-reassessing-urban-renewal-in-atlanta-and-beyond-a-review-of-renewing-inequality/
   Accessed 2026-11-13 via browser pane. Supports: federal program ran 1949–1974; 89% of
   the 4,077 displaced Atlanta families were Black; the project map omits the Georgia
   State project that cleared 25 downtown acres and wrongly includes Transportation
   Plaza; 431 Atlanta businesses were displaced 1956–66 (Eric Hill Associates 1966).
   Notes that (as of 2018) the project did not offer data downloads for the GIS footprints.

Body vs source: matches. "Near downtown" fits Butler St, Rawson-Washington, Buttermilk
Bottom and Georgia State; "thousands" matches 4,077. Year label "1950s–70s" is
consistent with the federal program (1949–74) and Atlanta projects running to 1974.

Change made: `sourceUrl` now points at the Atlanta city view (the root URL only shows a
national cartogram); `source` says "(Atlanta, GA)". No body change.

Suggested wording (optional): "Federal urban renewal clears neighborhoods around downtown
— Butler Street, Rawson-Washington, Buttermilk Bottom — displacing an estimated 4,077
Atlanta families by the late 1960s, 89% of them families of color."

---

## marta_cobb_1965 — Cobb County votes against joining MARTA — **supported** (margin not verified)

Body: "Cobb County voters decline to join the new regional transit authority."

Sources:

1. Hatfield, Edward A. "A Well-Tied Knot: Atlanta's Mobility Crisis and the 2012 T-SPLOST
   Debate." *Southern Spaces* (Emory), 29 Apr 2013.
   https://southernspaces.org/2013/well-tied-knot-atlantas-mobility-crisis-and-2012-t-splost-debate/
   Accessed 2026-11-13. Supports: Cobb had been part of MARTA's early plans but "its
   residents voted against the system's expansion in 1965" (note 5).
2. Wikipedia, "History of Metropolitan Atlanta Rapid Transit Authority."
   https://en.wikipedia.org/wiki/History_of_Metropolitan_Atlanta_Rapid_Transit_Authority
   Accessed 2026-11-13. Says: June 1965, four of five counties approved MARTA's creation;
   "only 43 percent of voters approved MARTA in Cobb County". **No citation attached to
   that sentence** — treat the 43% as unverified.
3. MARTA, "History & Vision." https://www.itsmarta.com/marta-history-vision.aspx
   Accessed 2026-11-13. Mentions the 1965 MARTA Act and "a voter referendum" but names no
   counties. (The previous card source "MARTA history" presumably meant this page; it does
   not support the Cobb claim on its own.)
4. AJC, "With MARTA off the ballot, will two metro Atlanta counties finally vote to expand
   public transit?" 12 Oct 2024.
   https://ajc.com/news/atlanta-news/without-marta-suburban-transit-referendums-aim-to-defy-history/WWIG2ITV5ZCITMSJT6QNTEO3FM
   Accessed 2026-11-13. Supports only that suburbs "were first asked to support MARTA in
   1965".

Not reachable: Axios Atlanta 21 Feb 2024 (403). The New Georgia Encyclopedia MARTA entry
does not mention the 1965 vote at all.

Body vs source: matches (Cobb voted no in 1965). The card `note` asks to verify "the
margin"; the only margin found (43% yes) is uncited Wikipedia — left out of the body.

Change made: vague `source` ("MARTA history; news archives") replaced with Hatfield
(2013) and `sourceUrl` added. No body change.

Human to-do: find the June 1965 Cobb tally in a contemporary newspaper (AJC archive) or
the Georgia Secretary of State before citing a margin.

---

## marta_1968 — First MARTA funding referendum fails — **supported**

Body: "The first referendum to fund MARTA rail fails."

Sources:

1. Toon, John D. "Metropolitan Atlanta Rapid Transit Authority (MARTA)." *New Georgia
   Encyclopedia*, 20 Oct 2003, last edited 14 Apr 2021.
   https://www.georgiaencyclopedia.org/articles/business-economy/metropolitan-atlanta-rapid-transit-authority-marta/
   Accessed 2026-11-13. Supports: the 1968 measure (Atlanta, Fulton, DeKalb) "failed in
   all three jurisdictions" despite business support; "MARTA encountered stiffest
   opposition from Atlanta's Black community" over service inequality and board
   representation.
2. Hatfield 2013 (above): "MARTA first went before voters in 1968 when it was defeated in
   the city of Atlanta" and Fulton/DeKalb, "largely due to opposition from black voters".
3. Wikipedia (above): November 1968, 44.5% support — uncited; not used.

Body vs source: matches. "First" is fair: 1965 was the vote to create the authority, 1968
the first vote to fund construction (both sources frame it this way).

Change made: `source` and `sourceUrl` set to the New Georgia Encyclopedia entry. No body
change.

Suggested wording (optional): "A 1968 vote to fund MARTA's rail plan fails in Atlanta,
Fulton and DeKalb, with strong opposition from Black voters who say the plan does not
serve them."

---

## marta_1971 — Fulton and DeKalb vote yes; Clayton and Gwinnett vote no — **supported**

Body: "The 1971 referendum passes in Fulton and DeKalb and fails in Clayton and Gwinnett,
so the rail system is built in two counties."

Sources:

1. Toon, New Georgia Encyclopedia (above). Supports: the 1971 measure was on ballots in
   Clayton, DeKalb, Fulton and Gwinnett and the city of Atlanta; "voters in Atlanta,
   Fulton, and DeKalb approved the measure"; Clayton and Gwinnett "defeated the measure by
   a four-to-one margin"; rail construction (from 1975) was funded partly by "a 1 percent
   special sales tax collected in Fulton and DeKalb counties and the city of Atlanta".
2. Hatfield 2013 (above): approved in Atlanta, Fulton and DeKalb; defeated in Clayton and
   Gwinnett "by a four to one margin"; DeKalb and Fulton residents have paid "a penny
   sales tax" since the early 1970s.
3. Wikipedia (above): DeKalb 52%, Fulton 51%, Clayton 23%, Gwinnett 21% — uncited; not
   used.

Body vs source: matches. "Built in two counties" follows from the sales-tax geography in
both sources.

Change made: `source` and `sourceUrl` set to the New Georgia Encyclopedia entry. No body
change.

Human to-do: the Fulton/DeKalb margins (reported elsewhere as roughly 51–52% yes) need a
primary source before they go in the card `note`.

---

## marta_clayton_2014 — Clayton County joins MARTA — **supported**

Body: "Clayton County voters approve joining MARTA."

Sources:

1. Simmons, Andria. "Clayton voters embrace MARTA." *Atlanta Journal-Constitution*,
   5 Nov 2014. https://www.ajc.com/news/transportation/clayton-voters-embrace-marta/zw2QmL6FuxXhAehAOxAbHJ
   Accessed 2026-11-13. Supports: the measure passed "by a wide margin" on Tuesday
   (4 Nov 2014); sales tax rises from 7% to 8% in March; about $45 million/yr; half for
   bus service, half reserved for commuter rail or similar high-capacity service.
2. METRO Magazine, "Ga. county wins long fight for transit," 11 Nov 2014.
   https://www.metro-magazine.com/news/ga-county-wins-long-fight-for-transit Accessed
   2026-11-13. Supports: voters "overwhelmingly" voted to join MARTA and pay a one-cent
   sales tax.
3. Percentages seen only in search snippets (CFTE 74–26; Mass Transit 73–27); the Clayton
   County election summary PDF
   (https://claytoncountyga.gov/download/253/election-results/35201/election-summary-11-4-2014.pdf)
   was downloaded by the fetch tool but could not be text-extracted here. Human to read
   it for the certified count.

Body vs source: matches.

Change made: `source` and `sourceUrl` set to the AJC article. No body change.

---

## marta_gwinnett_2019 — Gwinnett votes no again — **supported**

Body: "Gwinnett County voters reject MARTA expansion in 2019 and a transit plan in 2020."

Sources:

1. Estep, Tyler. "MARTA in Gwinnett: Why the referendum failed." *AJC*, 20 Mar 2019.
   https://www.ajc.com/news/local-govt--politics/marta-gwinnett-why-the-referendum-failed/URnv59pplXA8Cnd9a23tCI
   Accessed 2026-11-13. Supports: 19 Mar 2019 special election; "the no votes took the
   election by about 8 points"; turnout ~91,000 (17% of registered voters); the question
   was a contract with MARTA plus a sales tax for transit expansion.
2. Kass, Arielle. "Gwinnett County transit vote fails; recount possible." *AJC*, 9 Nov
   2020. https://ajc.com/news/atlanta-news/gwinnett-county-transit-vote-fails-recount-possible/YEONKUUBMBHXHO565CO7IEFDFU
   Accessed 2026-11-13. Supports: voters rejected a $12.1 billion, penny-sales-tax transit
   plan "by just over 1,000 votes" out of nearly 400,000; the 2020 plan limited MARTA's
   role to a heavy-rail extension from Doraville to Jimmy Carter Boulevard, with the rest
   run by the county.
3. Pendered, David. "Gwinnett County transit: Voters objected to heavy rail, rejected
   referendum." SaportaReport, 15 Nov 2020.
   https://saportareport.com/gwinnett-county-transit-voters-objected-to-heavy-rail-rejected-referendum/sections/reports/david/
   Accessed 2026-11-13. Supports: failed by just over 1,000 of 398,041 votes; 1% sales tax
   for 30 years.
4. Emanuel, Dave. "Transportation Tuesday: Gwinnett Transit Referendum Postmortem."
   Georgia Public Policy Foundation, 1 Dec 2020 (opinion).
   https://www.georgiapolicy.org/news/transportation-tuesday-gwinnett-transit-referendum-postmortem/
   Accessed 2026-11-13. Gives the margin as 1,013 votes.

Not reachable: Washington Times/AP 20 Mar 2019 (403); CFTE election page (404). The
54.3%–45.7% figure for 2019 appears in an Atlanta Business Chronicle piece republished by
SaportaReport (seen in search results only, not opened).

Body vs source: matches. "A transit plan in 2020" is accurate: the 2020 question was a
county transit tax with MARTA building only the rail piece.

Change made: `source` names both AJC articles; `sourceUrl` is the 2019 article (contract
allows one URL). No body change.

Human to-do: the card `note` also asks about Cobb's latest transit vote; Cobb's
November 2024 transit sales tax was defeated (Mass Transit Magazine headline seen in
search, page not opened). Confirm before adding a card.

---

## beltline_prices — Beltline and rising home prices — **partially supported → body corrected**

Original body: "Home values near the Eastside Trail rise faster than elsewhere in the city
after it opens." Original `year`/`yearLabel`: 2012 / "2012–18".

Source:

1. Immergluck, Dan and Tharunya Balan. "Sustainable for whom? Green urban development,
   environmental gentrification, and the Atlanta Beltline." *Urban Geography* 39(4),
   2018, pp. 546–562; published online 4 Aug 2017. https://doi.org/10.1080/02723638.2017.1360041
   Full text read 2026-11-13 via browser pane at
   https://www.tandfonline.com/doi/full/10.1080/02723638.2017.1360041 (article is open
   access). Abstract: "From 2011 to 2015, depending on the segment of the Beltline,
   values rose between 17.9 percent and 26.6 percent more for homes within a half-mile of
   the Beltline than elsewhere." Hedonic results: premium 17.9% near the Northeast
   segment, 19.2% Southeast, 26.6% Southwest; the Northeast segment "runs north-northeast
   of I-75 and east of the connector down to I-20". The Eastside Trail construction began
   Oct 2010 and finished in late 2011. Median sale prices near all four segments rose
   "at a substantially faster pace" than elsewhere.
2. Immergluck, Dan. "Atlanta's BeltLine shows how urban parks can drive 'green
   gentrification'…" *The Conversation*, republished by Cobb County Courier 25 Jan 2023.
   https://cobbcountycourier.com/2023/01/atlantas-beltline-shows-how-urban-parks-can-drive-green-gentrification-if-cities-dont-think-about-affordable-housing-at-the-start/
   Accessed 2026-11-13. Author's own summary: for 2011–2015 "home prices near the
   BeltLine rose much faster than in areas farther from it"; links the same DOI.

3. Atlanta BeltLine Inc. "Eastside Trail | Things To Do on the Atlanta Beltline."
   https://beltline.org/places-to-go/eastside-trail/ Accessed 2026-11-13. Supports only
   the card `note` (context): the Eastside Trail "runs from the tip of Piedmont Park to
   Reynoldstown", is "the first finished section of the Atlanta Beltline in the old rail
   corridor", and passes Inman Park, Old Fourth Ward, Poncey-Highland and Virginia
   Highland.

Body vs source: the direction of the claim is supported, but (a) the paper's study window
is 2011–2015, not "2012–18"; (b) the paper measures all four segments within a half
mile, not the Eastside Trail specifically; (c) the paper does not claim the Eastside
Trail was the fastest-rising area.

Which statement comes from where:
- **From the paper (Immergluck & Balan 2018)**: the whole `body` — the 2011–2015 window,
  "within a half mile", the 17.9%–26.6% range, "depending on the segment". Also from the
  paper, but used only in this log: the per-segment premiums (NE 17.9%, SE 19.2%, SW
  26.6%); the Northeast segment definition ("north-northeast of I-75 and east of the
  connector down to I-20"); that Eastside Trail construction began Oct 2010 and finished
  late 2011; that initial trail/park activity "began on the east/northeast side".
- **From Atlanta BeltLine Inc. (source 3)**: in the `note` only — the Eastside Trail's
  route (Piedmont Park to Reynoldstown via Old Fourth Ward and Inman Park) and that it is
  the first finished section.
- **Agent inference, labelled as such in the `note`** ("Context, not a finding of the
  paper"): that the Eastside Trail lies within the paper's Northeast segment. This
  follows from the two sources above (the route is east of the Connector and north of
  I-20) but is not a sentence in either; a human should confirm against the paper's
  Figure 2 before relying on it.

Change made (source contradicts the card's period and specificity):
- `year` 2012 → 2011; `yearLabel` "2012–18" → "2011–15".
- `body` → "From 2011 to 2015, home values within a half mile of the Beltline rise 17.9%
  to 26.6% more than elsewhere in the city, depending on the segment." (Numbers are the
  paper's own. An earlier draft of this pass ended the body with "The Eastside Trail is
  in the Northeast segment."; QA #4 removed it from `body` because it is an inference,
  and it now lives in the `note`, worded as context.)
- `note` → prefixed with the Eastside Trail context sentence above (ABI source 3).
- `source` now carries the volume/issue/pages; `sourceUrl` = DOI.

Human to-do: if the look-ahead needs a 2010–2020 tract-level "last time" statistic, this
paper does not provide it; a separate source (e.g. ACS tract data) is needed.

---

## Summary of edits to `src/data/history.json` (2026-11-13)

| id | field(s) changed | why |
|---|---|---|
| holc_1938 | source (+Rhodes 2017), sourceUrl (Atlanta map page) | both pages opened and support the card |
| highways_barriers | source (+SGA 2023), sourceUrl added | SGA page supports both claims; books not opened |
| peyton_road_barricades | source (+AHC 2021), sourceUrl added | AHC blog supports the card |
| urban_renewal | source ("Atlanta, GA"), sourceUrl (Atlanta city view) | Atlanta view carries the displacement figures |
| marta_cobb_1965 | source → Hatfield 2013, sourceUrl added | old source string was not a citation |
| marta_1968 | source → NGE, sourceUrl added | as above |
| marta_1971 | source → NGE, sourceUrl added | as above |
| marta_clayton_2014 | source → AJC 2014-11-05, sourceUrl added | as above |
| marta_gwinnett_2019 | source → two AJC articles, sourceUrl (2019) added | as above |
| beltline_prices | year, yearLabel, body, note, source, sourceUrl | paper's period is 2011–15 and covers all segments; Eastside Trail context moved from body to note (QA #4) |

`verified` is `false` on all 10 cards. No ids were added, removed or renamed. No card
body was changed except `beltline_prices`.
