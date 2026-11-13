# Needs human review

Items the history-researcher agent could not fully support from sources it opened on
2026-11-13. Nothing here was deleted from the data files. See `history.md` and
`gazetteer.md` for the full logs.

## History cards

No card is wholly unsupported after the phase 0 pass. Open points:

| id | what still needs a human | what the agent searched |
|---|---|---|
| marta_cobb_1965 | (a) Confirm **what the 1965 question was**: the card says Cobb voters "decline to join the new regional transit authority", while the opened source (Southern Spaces, Hatfield 2013, note 5) says Cobb residents "voted against the system's expansion in 1965". Wikipedia (uncited) describes a June 1965 ratification vote in the five counties named in the 1965 MARTA Act, which would support "join"; a contemporary record (1965 MARTA Act text, AJC archive, or Georgia Secretary of State) is needed to settle the wording. Card body left unchanged pending that check. (b) The vote **margin** (Wikipedia says 43% yes, uncited). The card body does not state a margin. | Southern Spaces (Hatfield 2013, supports "voted no in 1965"); MARTA History & Vision page (no counties named); New Georgia Encyclopedia (silent on 1965); AJC 2024 (only "first asked in 1965"); Axios 2024 (403); Mass Transit 2024 (403). |
| marta_1971 | County **margins** for the card note (Wikipedia: DeKalb 52%, Fulton 51%, uncited). NGE and Hatfield both give only "four-to-one" against in Clayton/Gwinnett. | NGE; Southern Spaces; Wikipedia. |
| marta_clayton_2014 | Certified percentage (73–74% yes per CFTE / Mass Transit snippets). Official PDF `election-summary-11-4-2014.pdf` on claytoncountyga.gov was fetched as binary but not text-extracted. | AJC 2014-11-05 (supports "wide margin"); METRO Magazine 2014-11-11 ("overwhelmingly"). |
| marta_gwinnett_2019 | 2019 percentages (54.3–45.7 per Atlanta Business Chronicle via SaportaReport, seen in search only). The card note also asks for Cobb's latest vote: Mass Transit Magazine headline "GA: Cobb Transit Tax Defeated" (Nov 2024) seen in search, page returned 403. | AJC 2019-03-20 (supports "about 8 points"); AJC 2020-11-09; SaportaReport 2020-11-15; GPPF 2020-12-01. |
| highways_barriers | Page references in Bayor (1996) and Kruse (2005). The web sources (SGA 2023; AHC 2022; Segregation by Design) support the claims and quote Bayor's 1960 planning report and Kruse's 2019 NYT essay, but the books themselves were not opened. | Google/NYT: Kruse's NYT Magazine essay (14 Aug 2019) is paywalled; a Pulitzer Center PDF copy was fetched as binary only. |
| peyton_road_barricades | Page reference in Kruse (2005). AHC and the Ivan Allen Digital Collection fully support the card. | — |
| beltline_prices | Body was rewritten to match the paper (2011–15, all segments). Confirm the rewritten numbers against the DOI. The `note` says the Eastside Trail lies within the paper's Northeast segment — an agent inference from the paper's segment definition plus ABI's route description, labelled as context; confirm against the paper's Figure 2. Decide whether the look-ahead needs a different "last time" statistic (the paper does not give 2010–2020 tract stats). | Taylor & Francis full text (open access); The Conversation (2023); beltline.org Eastside Trail page. |

## Gazetteer

Six "approximate centroid" / bbox-centre coordinates differ from OSM place nodes by
20–170 m; proposed corrections are in `gazetteer.md`. Not changed in phase 0.

## Overlays

No overlay geometry exists yet; all shapes in `public/scenarios/network.json` are
Raphael's placeholders. Candidate datasets, sizes and licences are in `overlays.md`; the
manager must confirm with the user before any download. Licence flag: Mapping Inequality
polygons are CC BY-NC (non-commercial) — fine for a hackathon/demo, check before any
commercial use.
