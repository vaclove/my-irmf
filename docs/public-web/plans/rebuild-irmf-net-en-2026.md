# Rebuild irmf.net (EN) with the CZ site's 2026 structure & branding

## Context

irmf.cz just received the 2026 rebrand (lime `#BFDE54` accent, purple `#7A64D8` links, new hero,
new homepage). The English site **irmf.net** is a separate WordPress install on the same host
(`ssh irmf.net@alexa.fortion.net`, webroot `/data/www/domeny/irmf.net/www`) that still runs the
**2022 design** — orange/red `#df342c` branding, old homepage layout, old menu — although its
content dates were minimally maintained ("9. edition, October 22–25, 2026" is already correct).

Goal: make irmf.net mirror the CZ site's structure and graphics, translating content to English,
**without touching the movie-catalogue PHP templates** (`MoviesList.php`, `MoviesPage.php`,
`MoviesSchedule.php`, `MoviesPreview.php`, `_db.php`, `_lang.php` in the EN child theme) — they
query `https://my.irmf.cz/api/public/*` and a shared MySQL DB (`8108-roadmovie`) with
`$lang = 'en'` and already work bilingually.

## Verified facts (both sites inspected read-only)

- Same stack: WP 7.1, PHP 8.4, Elementor **3.16.3 on both** (JSON is version-compatible),
  parent theme grandconference 5.0.9, child `grandconference-child-en` vs `-cz`.
- Same post IDs for the key chrome (historical clone): header **#3367**, footer **#2444**,
  Elementor kit **#7**, contact **#2555**, movies #2642, movie #2551, schedule #3467.
  EN front page = **#2454** (CZ = #7493). EN custom-CSS post = **#1830**.
- CZ Home uses **only core Elementor widgets** (heading, text-editor, button, image, video).
  CZ header uses `grandconference-navigation-menu` (theme plugin, present on EN ✓).
  CZ footer uses `sina_countdown` — **Sina Extension is NOT installed on EN** → must install.
  `make-column-clickable-elementor` also missing on EN → install (CZ cards may use it; harmless if unused).
- EN is **missing font `IRMFont`** (has only Nudista; CZ has both). The whole CZ design is set in
  IRMFont → must port the `bsf_custom_fonts` post + font files from CZ uploads.
- EN theme mods are all `#df342c` (2022 red). EN has **no caching plugin** (simpler flushes; only
  Elementor CSS + browser cache matter). EN `.htaccess` has no live redirects (only commented-out
  2024 ones). EN also has the parent theme's `?ver=`-stripping problem and 360-day max-age.
- Accounts are CageFS-isolated — no direct file access between them. Transfer via
  `ssh cz 'tar cz …' | ssh en 'tar xz …'` piped through the local machine, or HTTPS download +
  `wp media import`.
- EN `wp-config.php` is 0666 (same issue as CZ had).

### Menu / page mapping (CZ → EN)

| CZ menu item | EN target |
|---|---|
| Festival ▾ (custom `#`) | Festival ▾ |
| O festivalu `/about/` | About `/about/` (#3185 ✓) |
| Průvodce `/pruvodce-festivalem/` | Festival guide `/festival-guide/` (#3888 ✓) |
| Partneři `/partneri/` | Partners `/partners/` (#2418 ✓) |
| Galerie ▾ 2018–2025 | Gallery 2018–2024 exist ✓; **Gallery 2025 missing** |
| Katalog filmů 2018–2025 `/movies/YYYY/` | same URLs, catalogue is bilingual ✓ |
| Oceněné filmy ▾ 2018–2025 | Awards 2018–2024 exist ✓; **Awards 2025 missing** |
| Podpořte nás `/podporte-nas/` | Donate `/donate/` (#3920 ✓) |
| Ztracené kino | **no EN page** → per user decision below |
| Press `/media/` | **no EN page** → per user decision below |
| Kontakty `/kontakt/` | Contact `/contact/` (#2555 ✓) |

Homepage/footer link remap: `/program/` → `/schedule/`, `/pruvodce-festivalem/` →
`/festival-guide/`, `/vstupenky/` → tickets decision below, `https://irmf.cz/podporte-nas/` →
`/donate/`, `https://irmf.cz/partneri/` → `/partners/`. Header language flag: CZ→EN currently
links to `https://irmf.net`; on EN it becomes a CZ flag linking to `https://irmf.cz`.

## User decisions (confirmed)

1. **Scope**: chrome + Home + Contact + **Gallery 2025 + Awards 2025** (translated from CZ).
   No EN Press page.
2. **Menu**: **omit Ztracené kino / Lost Cinema** from the EN menu; **Press links to
   `https://irmf.cz/media/`** (menu + footer).
3. **Tickets**: **mirror CZ** — EN `.htaccess` gets `Redirect 302 /tickets` →
   `https://goout.net/en/international-road-movie-festival-2025/szxybby/` (the /en/ variant of
   the same GoOut event; verify the URL resolves before wiring buttons to `/tickets`).
4. Aftermovie video: same YouTube embed as CZ (language-neutral).

## Implementation plan

Reuse the proven workflow from the CZ rebrand (documented in `IRMF-WEB-RUNBOOK.md`): local PHP
scripts → `scp` to `/data/www/domeny/irmf.net/tmp/` → `wp eval-file` with dry-run default and
explicit `apply`; guard every `_elementor_data` write with an `"elType"` count check; never
`global $args`; default `wp_json_encode` flags.

### Phase 0 — Backup EN
- `wp db export ~/backups/irmf-net-pre-2026-<date>.sql` + gzip + `gzip -t` + CREATE TABLE count.
- `tar czf ~/backups/child-theme-en-pre-2026.tar.gz` of `grandconference-child-en`.
- Copy of EN `.htaccess` and `functions.php`.

### Phase 1 — Foundation (branding infrastructure)
1. **Port IRMFont**: export CZ `bsf_custom_fonts` post #7526 (+ its postmeta with font-file URLs),
   copy the font files from CZ uploads → EN uploads (tar pipe), create the font post on EN with
   remapped URLs. Verify via custom-fonts plugin listing + a page render.
2. **Install missing plugins** on EN: `sina-extension-for-elementor` (pin 3.4.8 to match CZ),
   `make-column-clickable-elementor` (1.6.2). Source: wp.org via `wp plugin install --version=…`.
3. **Elementor kit #7**: copy CZ `_elementor_page_settings` (system/custom colours incl.
   "Limetka 2026" `#BFDE54`, greys, full typography block — IRMFont sizes/weights) onto EN kit.
4. **Theme mods** `theme_mods_grandconference-child-en`: set the full 2026 colour table from the
   runbook §5 (purple `#7A64D8` links/menu/hover states, lime footer-hover + session tab,
   `#332E2E` page titles) replacing all `#df342c` values.
5. **Custom CSS post #1830**: replace with CZ custom CSS (#6998) content — includes newsletter
   button, home card hover, contact-link colouring (mailto/tel/cdn-cgi selectors — EN is also
   behind Cloudflare), footer link hover.
6. **EN functions.php**: append (a) `irmf_restore_asset_versioning` cache-busting fix,
   (b) `irmf_countdown_total_days` override. **Keep the existing movie/movies rewrite rules
   untouched.** Note EN lacks the `/program/` rewrite — schedule page is `/schedule/`, leave as is.
7. Fix EN `wp-config.php` perms 0666 → 0640.

### Phase 2 — Media pipeline
Script that, given Elementor JSON exported from CZ: extracts all `irmf.cz/wp-content/uploads/...`
URLs, downloads each over HTTPS, `wp media import --porcelain` on EN, and returns a URL+ID remap
table (old URL→new URL, old id→new id). Applied to header/footer/home/contact JSON. ~20 images
(hero 2026, 13 partner logos, EU logos, flags, Instagram/merch card backgrounds, team photos ×4
if contact in scope).

### Phase 3 — Chrome (header, footer, menu)
1. **Header #3367**: replace EN `_elementor_data` with CZ header JSON; translate top-bar strings
   ("9. MEZINÁRODNÍ FILMOVÝ FESTIVAL ROAD MOVIE" → "9TH INTERNATIONAL ROAD MOVIE FILM FESTIVAL",
   "22. - 25. října 2026" → "22–25 OCTOBER 2026", "MOVING STATION, PLZEŇ" → "MOVING STATION,
   PILSEN"); language switcher → CZ flag image (import) linking `https://irmf.cz`.
2. **Menu**: rebuild EN menu term 46 ("Main Left Menu", locations `primary-menu,side-menu` —
   same as CZ) to mirror the CZ structure with English titles and EN links per the mapping table;
   items per user decisions 1–2. Use `wp menu item add-*` after clearing existing items
   (old menu preserved implicitly in the DB backup).
3. **Footer #2444**: replace with CZ footer JSON; translate all 29 headings ("Dní do festivalu" →
   "Days to the festival", "Sledujte nás" → "Follow us", "Newsletter" stays, "Partneři festivalu"
   → "Festival partners", sitemap column links per mapping, "Pořadatelem festivalu je:" →
   "The festival is organised by:", © line, EU-funding line → English); remap links + images;
   countdown target `2026-10-22 19:00` with `units:[{_id,unit:"day"}]` (both footer bugs from
   runbook §7 pre-empted). Newsletter: keep EN Mailchimp form (mc4wp is installed on EN —
   verify the form shortcode/ID on EN during implementation and keep the EN list).

### Phase 4 — Pages
1. **Homepage #2454**: replace `_elementor_data` + `_elementor_page_settings` with translated CZ
   Home 2025 JSON; remapped images (incl. 2026 hero, alt "Žij road movie — IRMF 2026" kept — it's
   the campaign name) and links; translated copy: hero H1 + date block, 3 CTA cards ("Programme
   will be published during October", "Ticket sales start in September", "Festival guide"),
   "Osmý ročník je za námi!" recap section → English, Instagram/merch cards. Aftermovie video
   embed unchanged. Keep page title "Home", update `_elementor_edit_mode`/version metas to match.
2. **Contact #2555** (if in scope): port CZ Kontakty — team grid with photos, roles in English
   (Artistic Director etc. are already English on CZ), purple contact links via Phase-1 CSS.
3. **Gallery 2025 (#8361 CZ) + Awards 2025 (#8459 CZ)**: create as new EN pages
   (`gallery-2025`, `awards-2025`), translate titles/copy, import images, add to the Gallery/Awards
   menu dropdowns. Gallery image count checked first — if it's a large gallery (>50 images),
   surface to the user before bulk-importing rather than silently copying hundreds of MB.
4. `wp elementor flush-css` + `clean_post_cache` after each write.

### Phase 5 — Tickets redirect (per decision 3)
If mirroring CZ: add `Redirect 302 /tickets → GoOut (EN)` to EN `.htaccess` and point buttons at
`/tickets`; else leave card copy without link.

### Phase 6 — Verify
- `curl` checks: no `#df342c` / old orange in rendered HTML+CSS of home/contact; `?ver=` present
  on assets; `--e-global-color-accent:#BFDE54` in EN kit CSS.
- Headless Chrome screenshots: home (desktop 1440 + mobile 414), contact, one catalogue page
  (`/movies/2025/`, `/schedule/`) to confirm the untouched catalogue still renders with new chrome.
- Countdown shows total days (62-ish), footer © 2018–2026.
- Click-path sanity: menu links resolve (no 404 on EN targets), language flags cross-link
  irmf.cz ↔ irmf.net.
- Update `IRMF-WEB-RUNBOOK.md` with an irmf.net section (access, IDs, differences: no cache
  plugin, own media IDs, catalogue templates frozen) — the user versions this file.

### Explicitly NOT touched
- EN `MoviesList.php`, `MoviesPage.php`, `MoviesSchedule.php`, `MoviesPreview.php`, `_db.php`,
  `_lang.php`, `schedule/` assets — the catalogue keeps its current (older) look per user
  instruction. Genre badge colours inside them stay as-is (separately owned).
- EN archival pages (Gallery/Awards 2018–2024, About, Donate, Festival guide, Partners,
  Submissions…) keep their content; they inherit the new header/footer/menu/global colours
  automatically. Any page that looks visually broken after the chrome swap gets flagged, not
  silently restyled.
- Plugin *updates* (Elementor 3.16→4.x etc.) — out of scope, stays on backlog.

## Risks / notes
- Elementor same-version JSON port is low-risk, and every write is dry-run-first + elType-count
  guarded; DB backup restores everything if a page comes out wrong.
- The EN kit/typography swap changes *all* EN pages' look (intended — that's the rebrand); the
  archival pages were built against the same parent theme so they degrade gracefully, same as CZ
  archival pages do.
- Sina Extension 3.4.8 install is additive; if wp.org no longer serves 3.4.8, fall back to
  tar-piping the plugin directory from CZ (identical codebase guarantee).
