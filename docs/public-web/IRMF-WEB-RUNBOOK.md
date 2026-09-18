# IRMF.cz / IRMF.net — maintenance runbook

> **Scope: the public websites, not this application.** This runbook covers the two WordPress
> sites **irmf.cz** and **irmf.net** (hosting, Elementor content, theme, caches, annual rollover).
> It lives in the `my-irmf` repository only because the sites have no repository of their own —
> nothing in it applies to the my.irmf.cz internal system in the rest of this repo.
> Companion material sits next to it in `plans/`.

Operational notes for the International Road Movie Festival websites. Written 2026-08-21 while
doing the 2026 rebrand (9th edition, 22–25 October 2026, Moving Station, Plzeň).
Sections 1–10 cover the Czech site; **section 11 covers the English site irmf.net**.

Everything here was verified against the live site on that date. Where something is a
recommendation rather than a fact, it says so.

---

## 1. Access

```bash
ssh irmf.cz@alexa.fortion.net
```

| | |
|---|---|
| Webroot | `/data/www/domeny/irmf.cz/www` |
| Backups | `~/backups` (i.e. `/data/www/domeny/irmf.cz/backups`) |
| Scratch space | `/data/www/domeny/irmf.cz/tmp` — outside the webroot, safe for scripts |
| WP-CLI | `/usr/local/bin/wp` |
| WordPress | 7.1 |
| PHP | 8.4.21 |
| DB prefix | `wp_` |

**There is no code repository for this site and no staging environment.** The `irmf-web` git repo
contains only this document. Every change is made directly on live production. Back up first.

Key-based SSH works non-interactively, so scripted/automated changes are possible.

### Harmless noise
Every WP-CLI command prints:
```
PHP Warning:  Undefined array key "SERVER_NAME" in .../grandconference/lib/admin.lib.php on line 535
```
It is a theme bug triggered by the absence of `$_SERVER['SERVER_NAME']` on CLI. Ignore it, or
filter with `| grep -v "Warning:"`.

---

## 2. Always back up first

```bash
cd /data/www/domeny/irmf.cz/www
wp db export ~/backups/irmf-db-$(date +%F).sql
gzip ~/backups/irmf-db-$(date +%F).sql          # ~155 MB raw -> ~12 MB gzipped, 66 tables
tar czf ~/backups/child-theme-$(date +%F).tar.gz \
    -C wp-content/themes grandconference-child-cz
```

Verify before trusting it:
```bash
gzip -t ~/backups/irmf-db-YYYY-MM-DD.sql.gz          # archive intact
zcat ~/backups/irmf-db-YYYY-MM-DD.sql.gz | grep -c "CREATE TABLE"   # expect 66
```

Restore:
```bash
zcat ~/backups/irmf-db-YYYY-MM-DD.sql.gz | wp db import -
```

---

## 3. How to make changes safely

For anything beyond a one-liner, **write a PHP script locally, copy it up, run it with
`wp eval-file`.** Trying to inline SQL or PHP through `ssh '...'` hits nested-quoting problems —
notably `wp db query` will silently return nothing.

```bash
scp myscript.php irmf.cz@alexa.fortion.net:/data/www/domeny/irmf.cz/tmp/
ssh irmf.cz@alexa.fortion.net \
  'cd /data/www/domeny/irmf.cz/www && wp eval-file /data/www/domeny/irmf.cz/tmp/myscript.php'
```

Always give the script a **dry-run default** and require an explicit `apply` argument:

```php
<?php
// Do NOT write `global $args` — see gotcha below.
global $wpdb;
$APPLY = in_array( 'apply', (array) ( $args ?? array() ), true );
```
```bash
wp eval-file .../myscript.php          # dry run, prints what it would do
wp eval-file .../myscript.php apply    # actually writes
```

### Three gotchas that will waste your afternoon

1. **Never write `global $args` in an `eval-file` script.** WP-CLI passes its own local `$args`
   into the included file; a `global` declaration shadows it with an empty global, so `apply`
   never registers and the script silently stays in dry-run. This looked exactly like "the write
   didn't work".

2. **`wp eval-file` runs the file inside a function scope, so top-level variables are NOT
   globals.** A helper function doing `global $myvar` gets `null`. Use `define()` for constants,
   or a closure with `use (&$var)`. A collector function that did `global $found` silently
   discarded every result and printed an empty report.

3. **Editing `_elementor_data` safely.** It is JSON in `wp_postmeta`. Two workable approaches:
   - *Simple substitutions* (e.g. swapping one hex for another of the **same length**): raw
     `str_ireplace` on the meta value via `$wpdb->update`. Same-length is important — it also
     keeps PHP-serialized values valid.
   - *Structural edits*: `json_decode($raw, true)` → modify → `wp_json_encode($data)` →
     `$wpdb->update` → `clean_post_cache($pid)`. Use **default** encode flags; Elementor stores
     escaped slashes and `\uXXXX`, and other tooling string-matches on that.

   Either way, **guard the write**: count `"elType"` occurrences before and after and refuse to
   save if the number changed. This catches a botched round-trip before it destroys a page.

4. Post **revisions** also contain old values (there are ~1,100 stale hex hits in revisions).
   Leave them alone — they are history, and rewriting them is pointless risk.

---

## 4. Caches — and the trap that hides your changes

After any change:
```bash
cd /data/www/domeny/irmf.cz/www
wp elementor flush-css
wp eval 'do_action("wpfc_clear_all_cache", true);'   # WP Fastest Cache
wp transient delete --all                            # occasionally
```

### The `?ver=` trap (fixed — keep it fixed)

The parent theme registers `grandconference_remove_script_styles_version`, which strips the
`?ver=` query string from **every** script and stylesheet. The host serves static files with
`Cache-Control: max-age=31104000` (~360 days). Together that means: the CSS filename never
changes, browsers are told to keep it for a year, and **returning visitors never see colour or
layout changes** — while `curl` and a fresh browser show the change fine. This is a genuinely
confusing failure mode.

Fixed in the child theme's `functions.php`:
```php
function irmf_restore_asset_versioning() {
    remove_filter('script_loader_src', 'grandconference_remove_script_styles_version');
    remove_filter('style_loader_src',  'grandconference_remove_script_styles_version');
}
add_action('init', 'irmf_restore_asset_versioning');
```
It must run on `init`, **not** at top level — the parent's `functions.php` loads *after* the
child's, so a top-level `remove_filter` would run before the filter is even added.

Sanity check that it is still working:
```bash
curl -s https://irmf.cz/ | grep -oE 'post-7493\.css\?ver=[0-9]+'
```
If that prints nothing, the fix has been lost (e.g. theme overwritten) and asset changes will
stop propagating.

### Cloudflare
The site sits behind Cloudflare. HTML passes through (`cf-cache-status: DYNAMIC`), so there is
normally no CDN purge needed. **Email Address Obfuscation is ON**: every `mailto:` is rewritten
server-side to `/cdn-cgi/l/email-protection#…` with a `<span class="__cf_email__">`, and
Cloudflare's JS swaps the real address back in. Consequences:
- Email addresses do **not** appear in the raw HTML — don't panic when `grep mailto` finds nothing.
- CSS targeting `a[href^="mailto:"]` only matches *after* JS runs. Match
  `a[href^="/cdn-cgi/l/email-protection"]` as well.

---

## 5. Colour scheme — 2026

The 2026 palette, from the festival's graphic designer. The **lime replaced the 2025 yellow
`#F9EE60`**. Designer's standing note: *if the lime reads too harsh, fall back to the mint
`#A3C2B0`.*

| Hex | Name | Role | Contrast on white |
|---|---|---|---|
| `#BFDE54` | lime | **primary accent** — card backgrounds, footer hover, active tab | 1.52:1 — *background only, never text* |
| `#A3C2B0` | mint | sanctioned fallback for the lime | 1.93:1 |
| `#63A3D2` | light blue | hero typography | 2.73:1 |
| `#3B5E7A` | slate blue | hero lower band | 6.84:1 |
| `#A19C8C` | warm grey | | 2.75:1 |
| `#F0B5CF` | pink | | 1.72:1 |
| `#7A64D8` | purple | **links + all interactive states** | 4.52:1 ✅ AA |
| `#332E2E` | near-black | text / page titles | 13.37:1 ✅ AAA |

Body text is `#555555` (7.46:1 on white).

### Why purple for links
Of the whole palette, only `#7A64D8` and `#3B5E7A` clear WCAG AA (4.5:1) on white. The slate blue
is *nearly identical in lightness to the body grey* (1.09:1 against `#555555`), so inline links
inside a paragraph would be invisible without underlines. The purple is distinct from body text
(1.65:1) and passes AA. **The lime is unusable for text at 1.52:1** — don't let it be used for
links or small text.

If you ever want more contrast headroom than the purple's 4.52:1, a slightly darkened purple
(`#6A55C4`, ~5.6:1) is the same colour family but technically off-palette — a designer call.

### Where every colour actually lives

The accent (`#BFDE54`) is set in **10 places**. Change all of them together:

| # | Location | What |
|---|---|---|
| 1–5 | Page **#7493** `_elementor_data` | 5 column backgrounds (Program, Vstupenky, Průvodce, Instagram, Merch) |
| 6 | Footer **#2444** `_elementor_data` | social icon hover (`hover_primary_color`) |
| 7–8 | Elementor Kit **#7** `_elementor_page_settings` | `system_colors[accent]` + custom swatch `52bf8bd` (renamed "Zluta" → "Limetka 2026") |
| 9 | `theme_mods_grandconference-child-cz` | `tg_session_tab_active_bg_color` |
| 10 | Custom CSS post **#6998** | 2 rules (`.btn-submit-newsletter:hover`, `.home-action-boxes:hover .elementor-button`) |

Theme mods (option `theme_mods_grandconference-child-cz`):

| Setting | Value | Controls |
|---|---|---|
| `tg_link_color` | `#7A64D8` | content links |
| `tg_hover_link_color` | `#000000` | content link hover |
| `tg_menu_hover_font_color` | `#7A64D8` | main menu hover |
| `tg_menu_active_font_color` | `#7A64D8` | current menu item |
| `tg_submenu_hover_font_color` | `#7A64D8` | submenu hover |
| `tg_sidemenu_font_hover_color` | `#7A64D8` | mobile menu hover |
| `tg_sidebar_hover_link_color` | `#7A64D8` | sidebar link hover |
| `tg_footer_hover_link_color` | `#BFDE54` | copyright + social hover — footer is black, where lime is 13.79:1 and purple only ~4.2:1 |
| `tg_page_title_font_color` | `#332E2E` | theme page-caption title |
| `tg_session_tab_active_bg_color` | `#BFDE54` | active schedule day tab |
| `tg_frame_color` | `#df342c` | **dead setting** — no render usage anywhere in the theme |

### ⚠️ The parent-theme default-red trap

`grandconference` ships **`#FF2D55` as the `default`** for ~15 customizer settings. Any setting
the site never configured silently renders that pink-red. **A database scan will not find these**
— they exist only as PHP defaults in `wp-content/themes/grandconference/lib/customizer.lib.php`.

Eight were unset and actively painting red until 2026-08-21; they are now set explicitly (the
table above). When hunting stray colours, grep the **parent theme** for defaults, not just the
stored theme mods:

```bash
grep -rn "'default'  => '#FF2D55'" wp-content/themes/grandconference/lib/customizer.lib.php
```
The setting key is the nearest preceding `'settings'  => 'tg_xxx'` line (note: this theme uses a
`$controls[]` array, **not** `add_setting()`).

### Genre badge colours — deliberately NOT part of the brand palette

The film-genre badges are a separate semantic system, **owned separately — ask before touching.**
They are hardcoded in *three* places that override each other:

- `grandconference-child-cz/style.css` (`:root`)
- `MoviesList.php`, `MoviesSchedule.php` (inline `<style>`, these win on `/movies` and `/program`)
- `MoviesPage.php` (inline `<style>`, wins on `/movie`)

Current values in `MoviesList.php` / `MoviesSchedule.php`:
```
--movie-color-feature:       #574752
--movie-color-short:         #F9EE60   <- still the retired 2025 yellow
--movie-color-documentary:   #71832F
--movie-color-retrospective: #51A9A6
--movie-color-discussion:    #F3C09F
--movie-color-special:       #E73E3A
--movie-color-accompanying:  #D6CEE8
```

**The constraint if these are ever remapped:** badges are a coloured background with text on top.
Only three palette colours (`#3B5E7A`, `#332E2E`, `#7A64D8`) pass AA with *white* text, so a
7-genre mapping must set the text colour per genre. This mapping was worked out and verified —
all seven pass AA — but is **not applied**:

| Genre | Background | Text | Ratio |
|---|---|---|---|
| feature | `#3B5E7A` slate blue | white | 6.84:1 |
| documentary | `#A3C2B0` mint | `#332E2E` | 6.94:1 |
| short | `#BFDE54` lime | `#332E2E` | 8.78:1 |
| retrospective | `#63A3D2` light blue | `#332E2E` | 4.90:1 |
| discussion | `#F0B5CF` pink | `#332E2E` | 7.78:1 |
| special | `#7A64D8` purple | white | 4.52:1 |
| accompanying | `#A19C8C` warm grey | `#332E2E` | 4.87:1 |

---

## 6. Key content locations

| Thing | ID / path |
|---|---|
| Front page | page **7493** ("Home 2025" — title is stale, it *is* the current homepage) |
| Header | post **3367**, post_type `header` |
| Footer | post **2444**, post_type `footer` |
| Elementor global kit | post **7** |
| Customizer "Additional CSS" | post **6998** (post_type `custom_css`) |
| Kontakty | page **2555** |
| Média / press | page **3517** |
| Program (schedule) | page **3467** → `MoviesSchedule.php` |
| Movies list | page **2642** → `MoviesList.php` |
| Single movie | page **2551** → `MoviesPage.php` |
| 2026 hero image | attachment **8526**, `/uploads/2026/08/hero-banner-2026.jpg` (1200×980) |

Find things without guessing:
```bash
wp option get page_on_front
wp post list --post_type=page --fields=ID,post_name,post_title --format=table
wp post meta get 7 _elementor_page_settings --format=json     # global colours/fonts
```

### Hero image
Homepage hero is an Elementor **image widget** (id `a31c4f8`) in section `/0/1/0` of page 7493.
Replacing it = upload a new attachment, then repoint `settings.image.url` + `settings.image.id`.
Keep **1200×980** to avoid reflowing the layout. JPEG q90 lands ~170 KB; the source PNG was
424 KB, which would have been a needless LCP regression.

```bash
wp media import /path/to/hero.jpg --title="Hero banner 2027" --alt="…" --porcelain   # prints new ID
```

---

## 7. Footer countdown quirk

The "Dní do festivalu" counter is a **Sina Extension `sina_countdown`** widget, id `dc5f71d`, in
footer #2444. Its target date lives in `settings.countdown_time` (format `YYYY-MM-DD HH:MM`).

**Update this every year.** Currently `2026-10-22 19:00`.

Two bugs were found and fixed here; both will recur if the widget is rebuilt:

1. The `units` repeater held `[{"_id":"3daeb6c"}]` with **no `unit` key**, so the widget rendered
   `<div class="sina-cd-">` and the JS had nothing to fill. Valid values: `year`, `month`, `week`,
   `day`, `hour`, `minute`, `second`. It must be `[{"_id":"…","unit":"day"}]`.

2. Even then it showed `01` instead of `62`. Sina renders the day slot with jQuery Countdown's
   **`%n` = `daysToMonth`** — days left *after whole months are subtracted*. "2 months + 1 day"
   → `01`. Total days is `%D` / `offset.totalDays`.

   Since the plugin JS is minified (and a plugin update would revert an edit), the fix is an
   override in the child theme's `functions.php` (`irmf_countdown_total_days`). It re-binds a
   namespaced `update.countdown.irmf` handler on an interval, because **jQuery fires handlers in
   binding order and Sina binds during Elementor's frontend init — i.e. after DOM ready.** Binding
   once up front puts you *first* and Sina overwrites you; re-attaching moves you back to the end
   of the queue so you always run last.

Labels ("Days") only render when `text_state == 'yes'`; it is empty here, which is what the design
wants — the heading already says "Dní do festivalu".

---

## 8. Annual rollover checklist

Run this on **both sites** — every content item below exists twice (CZ id / EN id).

1. **Back up both sites** (§2, §11).
2. Countdown `countdown_time` in footer #2444 → new festival start (§7). Same ID on both sites.
3. Top bar dates + edition number in header #3367 ("9. MEZINÁRODNÍ… / 22. - 25. října 2026" and
   the EN equivalents).
4. Hero dates + edition on the homepage (CZ #7493 / EN #2454) and the hero banner image (§6).
5. Homepage CTA card copy — programme month, ticket-sales month (see **season timeline** below).
6. **Festival guide** (CZ #3947 / EN #3888): edition ordinal ("po deváté" / "ninth time"),
   festival dates, programme month, ticket-sales copy. This page rots silently — in 2026 the EN
   one was still advertising 2024.
7. Accent colour, if the palette changes — **all 10 locations** (§5) on CZ, kit+mods+CSS on EN.
8. Footer copyright year — 2 heading widgets in footer #2444 (`2ad40d0`, `8be4092`), both sites.
   Note the string contains U+2060 word joiners: `© 2018–⁠⁠⁠2026 IRMF, z.s.`
9. `.htaccess` ticket redirects → new GoOut event: CZ `/vstupenky` (cs URL), EN `/tickets`
   (en URL). Updated to the **2026** event `szyrtmy` on 2026-09-15.
10. New-season pages: CZ `galerie-<year>` + `ocenene-snimky-<year>`; EN `gallery-<year>` +
    `awards-<year>` (+ menu entries on both, EN menu term 54). Copy the page metas
    `page_header_type=Image`, `page_show_title=1` or the grey caption band appears (§11).
11. Team/contact list (Kontakty CZ #2555 / Contact EN #2555) and the PR contact on Média (#3517).
12. Flush caches, then verify in a **real browser**, not just curl (§4).

### Season timeline 2026 (canonical wording, agreed 2026-08-21)

| Fact | CZ wording | EN wording |
|---|---|---|
| Festival | 22.–25. října 2026, Moving Station, Plzeň | 22–25 October 2026, Moving Station, Pilsen |
| Ticket/accreditation sales | „Akreditace jsou v prodeji" | "Accreditations are now on sale" |
|   *(wording before the presale opened)* | „Prodej vstupenek bude zahájen v září" | "Ticket sales start in September" |
| Programme published | „Program bude uveřejněn v průběhu října" | "Programme will be published during October" |

Used consistently on: homepage cards, festival guide pages. If the timeline changes, update all
four pages (CZ #7493+#3947, EN #2454+#3888).

---

## 9. Known issues / backlog

| Priority | Issue |
|---|---|
| **High** | **Elementor 3.16.3 vs 4.2.3 current.** ~2 years of security advisories, several auth-bypass/RCE class. A 3→4 major upgrade needs testing, not a blind `wp plugin update`. Most other plugins are similarly stale. Applies to **both sites**. |
| ~~High~~ | ~~`wp-config.php` mode 0666~~ — **fixed 2026-08-21**, now 0640 on both sites. |
| ~~Medium~~ | ~~WordPress timezone unset~~ — **fixed 2026-08-21**: `timezone_string = Europe/Prague` on both sites. |
| ~~Medium~~ | ~~irmf.net never received the rebrand~~ — **rebuilt 2026-08-21** to the 2026 design, see §11. Access: `irmf.net@alexa.fortion.net` (same host, separate CageFS account). |
| ~~Low~~ | ~~Mobile horizontal overflow~~ — **fixed 2026-08-21**: header #3367 columns had `margin_mobile` 5px on top of 100/50/50% widths (both sites); zeroed. CDP-measured `scrollWidth == viewport` after the fix. NOTE: plain headless-Chrome screenshots without device emulation exaggerate mobile overflow — measure with `Emulation.setDeviceMetricsOverride` before believing them. |
| ~~Low~~ | ~~1.2 GB of old backups in the home dir~~ — **deleted 2026-08-21** (freed ~1.2 GB; disk was at 94%). Two small 2022 dumps remain (`db.sql`, `db-modified.sql`, 23 MB each) plus the current `~/backups/`. |
| Low | Aneta Sklenářová still listed under *Production* on Kontakty (she was replaced only as *PR*). The archived `/hleda-se-nemo/` event page still carries the old PR phone number. |
| Info | Two off-palette colours sit in live Elementor data but **never render**: a `#E83F3A` overlay on the homepage hero column (overlay type was never enabled, so no `background-color` is emitted) and `#EB5E1F` on three footer icons (overridden by `var(--e-global-color-secondary)` = black). Dead data — not worth the edit risk. |

---

## 10. Useful one-liners

```bash
# What colour is where? (live records only, skipping revisions)
wp db query "SELECT option_name FROM wp_options WHERE option_value LIKE '%BFDE54%'"

# Which pages use a given hex in Elementor?
wp db query "SELECT p.ID,p.post_title FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id
             WHERE pm.meta_key='_elementor_data' AND p.post_type<>'revision'
               AND pm.meta_value LIKE '%BFDE54%'"

# Confirm what visitors actually get
curl -s https://irmf.cz/ | grep -oE 'post-7493\.css\?ver=[0-9]+'
curl -s https://irmf.cz/wp-content/uploads/elementor/css/post-7.css | grep -o -- '--e-global-color-accent:[^;]*'

# Screenshot a page headless (macOS) — always verify colour changes visually
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --window-size=1440,900 --virtual-time-budget=15000 --screenshot=/tmp/out.png "https://irmf.cz/?nocache=1"
```

Do **not** use `?m=` as a cache-buster — `m` is a reserved WordPress query var (date archive) and
will return a 404 that looks like a broken site.

**Uploading phone photos:** iPhone JPEGs carry an EXIF orientation flag. If you rotate the pixels
yourself (sips/Preview) and the EXIF tag survives, `wp media import` applies the EXIF rotation
*again* — the upload gets a `-rotated` filename suffix and renders sideways. Either upload the
untouched original and let WordPress do the single rotation, or strip EXIF before uploading. A
`-rotated` suffix on a freshly imported file is the tell.

**Ztracené kino page** (CZ #6404), redesigned 2026-08-21: under the H1 a two-column row
(`zkrow01`) — intro text left (user-approved copy), lime Instagram CTA card right (homepage-card
recipe; swap for the concrete event announcement when one exists) — then the chronological list,
newest first, in a **zig-zag layout**: image and text columns alternate sides per event (flipped
events carry `reverse_order_mobile` so the photo stays on top on mobile), both columns vertically
centred. Each event = date eyebrow (div-heading, 15px/600/#555) → film title → venue → one-line
venue anecdote (16px/#555 text-editor). Photos are forced to a shared shape by page-scoped CSS in
the Customizer Additional CSS (`.elementor-6404 .elementor-widget-image img { aspect-ratio:3/2;
object-fit:cover; border-radius:10px }`) — so any reasonably sized photo works without manual
cropping. To add an event: clone the newest event section, bump the ids, flip the column order
relative to the current first event, and prefer **event photos over film stills**
(Drive = attachment 8536, Top Gun = 6754 hangar photo). No EN equivalent (menu decision: omitted).

---

## 11. irmf.net — the English site

Rebuilt 2026-08-21 to mirror the CZ 2026 design (structure, colours, fonts, chrome), with
content translated to English. Separate WordPress install, **same host, different account**:

```bash
ssh irmf.net@alexa.fortion.net
```

| | |
|---|---|
| Webroot | `/data/www/domeny/irmf.net/www` |
| Backups | `~/backups` (pre-2026 DB + theme + htaccess snapshots live here) |
| Scratch | `/data/www/domeny/irmf.net/tmp` |
| Stack | WP 7.1, PHP 8.4, Elementor 3.16.3, grandconference 5.0.9 + `grandconference-child-en` |
| Caching | **No caching plugin** (unlike CZ) — only `wp elementor flush-css` needed |
| Cloudflare | Yes, incl. Email Obfuscation (same as CZ) |

Accounts are CageFS-isolated — no direct file access between CZ and EN. Transfer files via
`ssh cz 'tar czf - …' | ssh en 'tar xzf -'` piped through your machine, or HTTPS + `wp media import`.

### Key IDs (EN)

| Thing | ID |
|---|---|
| Front page | page **2454** ("Home") |
| Header / Footer / Kit | **3367 / 2444 / 7** (same as CZ — historical clone) |
| Contact | **2555** |
| Gallery 2025 / Awards 2025 | **4589 / 4590** |
| Gallery posts (galleries CPT) | 4585–4588 ("2025 day 1–4"), meta `wpsimplegallery_gallery` |
| Custom CSS post | **1830** |
| Menu | term **54** "Main Menu 2026" (locations `primary-menu`+`side-menu`); old menu 46 kept unassigned for rollback |
| IRMFont | `bsf_custom_fonts` post **4498**, file `/uploads/2026/08/IRMFontX.ttf` |
| 2026 hero | attachment **4510** |
| Mailchimp form | id **92** (same id as CZ, but the EN site's own form) |

### EN-specific facts and traps

- **The catalogue templates are frozen** (user decision): `MoviesList.php`, `MoviesPage.php`,
  `MoviesSchedule.php`, `MoviesPreview.php`, `_db.php` (`$lang='en'`), `_lang.php` in the EN child
  theme keep their older look. They read `https://my.irmf.cz/api/public/*` + shared DB
  `8108-roadmovie` and are fully bilingual. The lone `#df342c` on `/schedule/` comes from this
  frozen template — it is expected.
- The header nav widget selects the menu **by slug** (`"nav_menu":"main-menu-2026"` in
  #3367 `_elementor_data`). Rebuilding the menu under a new name means repointing this setting.
- `wp_update_nav_menu_item()` **dies under WP-CLI** on this install ("The link you followed has
  expired." — a plugin hook calls `check_admin_referer()`). Create `nav_menu_item` posts directly
  with `wp_insert_post` + `_menu_item_*` metas + `wp_set_object_terms`.
- Font uploads: WP's MIME whitelist rejects `.ttf` via `wp media import`. Drop font files
  straight into `wp-content/uploads/...` (the `bsf_custom_fonts` post only needs a URL;
  `font_file` may be empty — CZ does the same).
- Both CZ fixes are ported into the EN child `functions.php`: `irmf_restore_asset_versioning`
  (the parent theme strips `?ver=` here too) and `irmf_countdown_total_days`.
  Plugins installed for parity: `sina-extension-for-elementor` 3.4.8,
  `make-column-clickable-elementor` 1.6.2.
- Tickets: `.htaccess` has `Redirect 302 /tickets → GoOut (EN)` — update the GoOut URL each year
  alongside the CZ one.
- Language flags cross-link the sites: CZ header 🇬🇧 → irmf.net, EN header 🇨🇿 → irmf.cz.
- Menu decisions (2026): *Ztracené kino* omitted from EN; *Press* links to `https://irmf.cz/media/`.
- When translating with blanket string replacement, beware substring re-matches — "Program" →
  "Programme" turned an already-translated "Programme sections" into "Programmeme sections".
  Sweep with `preg_replace('/Programme(?:me)+/','Programme',…)` if it ever reappears.

### Annual rollover — EN

The §8 checklist covers both sites; every step lists the EN id alongside the CZ one.

### Later same-day additions (2026-08-21)

- **Page-caption band**: theme pages hide the grey title band via postmeta
  `page_header_type = Image` + `page_show_title = 1`. Pages created from scratch lack these and
  show a big grey caption band — copy both metas when creating pages (fixed on gallery-2025,
  awards-2025, partners).
- **Partners** (#2418) ported from CZ: 21 new logo imports (4626–4646), the Czech EU banner
  swapped for the EN one already in the library (`bar.eng_.poz_.jpg`, id 3298).
- **Eventival is dead** — all `vp.eventival.com` links replaced with own-catalogue URLs:
  EN Awards 2023/2024 film links → `/movie/{uuid}/` (uuids resolved via
  `my.irmf.cz/api/public/movies?edition_id=…` — note: filtering needs `edition_id`, the
  `edition=` param is silently ignored; response is `{movies, pagination}`), EN Festival guide →
  `/schedule/`, CZ archival "Program 2023" → `/program/2023/`. Zero eventival references remain
  in live data on either site.

- **Festival guide dates** (CZ #3947 / EN #3888) refreshed to the 9th edition, 22–25 Oct 2026;
  "programme is already published" corrected to "will be published during October" (canonical
  season timeline in §8) and dead ticket-sale links (irmf.cz/vstupenky 2025 redirect,
  boomevents 2024) removed. These pages carry edition-specific copy — now item 6 of the §8
  rollover checklist.
- **Old 2022 title style**: 18 EN pages had H1 heading widgets with widget-level typography
  (Nudista 600 / 70px / shrink-wrapped so the column centres them). Stripped to bare
  `{title, header_size:h1}` so titles inherit the global kit like the reworked pages. If a page
  title ever renders centred/bold again, check the H1 widget for local typography overrides.
- EN `/about/` page (#3185) actually contains the *Festival status* content (H1 "Festival
  status") — slug/title/content mismatch inherited from the old site, left as-is.

### EN backlog

- Old-design archival pages (About, Donate, Festival guide, Partners, Submissions, galleries/awards
  ≤2024) inherited the new chrome + colours but keep their old per-page layouts.
- `wp-config.php` perms fixed to 0640 during the rebuild. WP timezone is UTC here as well.
- Same plugin-staleness backlog as CZ (Elementor 3.16.3 vs 4.x etc.).

### Backlog sweep 2026-08-21 (evening)

- **Timezone**: `Europe/Prague` set on both sites (was UTC). Post timestamps now local.
- **Mobile overflow**: root cause was header #3367 mobile column margins (5px on top of
  100/50/50 % widths). Fixed in both sites' header data. When checking mobile, use real device
  emulation (CDP `Emulation.setDeviceMetricsOverride`) — plain `--screenshot` at 414px renders
  desktop-ish layout and shows phantom overflow.
- **EN About (#3185)** rebuilt with the CZ layout (title / Mission+Vision two-col / team photo,
  attachment 4647) and correct "About" H1 — previously carried a "Festival status" heading.
  The old separate `festival-status` page (#558) still exists, unlinked.
- **EN Donate (#3920)** rebuilt with the CZ layout: translated engagement copy, the EN site's own
  PayPal button (`hosted_button_id=8PBR43DA9YEW4` — differs from CZ's button, kept deliberately),
  bank account + QR (attachment 4648).
- **`tg_frame_color` theme mod deleted** on CZ (dead setting, nothing renders it).
- **Old CZ home-dir backups deleted** (~1.2 GB freed; disk was at 94 %).

### Mobile polish 2026-08-22

- **Theme trap:** the parent theme forces `.elementor-section { padding-left/right: 0 !important }`
  under 767 px — any Elementor-level section side-padding silently loses on mobile. Counter with a
  higher-specificity `!important` rule in Additional CSS (see "IRMF mobile header edges" block,
  both sites). This is also why the header originally used the overflow-causing column margins.
- Header sections ceea0db/4672c3b: 15px side padding on mobile via that CSS block; logo and
  hamburger no longer touch the screen edge.
- **Newsletter card** (footer #2444, both sites): removed two zero-size leftover spacer widgets,
  added a context line (`nlline01` — CZ „Přihlas se k odběru a nic ti neuteče.", EN "Subscribe to
  our newsletter and do not miss a thing!"), form widget top margin −15px to balance the mc4wp
  form's internal paragraph margins, and `.btn-submit-newsletter` goes full-width under 767px
  ("IRMF newsletter mobile" CSS block). Verified mobile + desktop.

### Newsletter card + page-title clearance (2026-08-22, round 2)

- The mc4wp form widget in footer #2444 carried Elementor **custom width = 300px**
  (`_element_width: initial`) — the source of the lopsided right margin on phones and a 38px
  overflow past the card edge on tablets. Removed on both sites; the form now fills the card at
  every breakpoint. The form's **stored HTML** also wraps the submit button in a 300px div —
  fixed via `.mc4wp-form-fields .elementor-element { width:100% !important }` in the mobile CSS
  block, plus `border-radius: 8px` on the button so it pairs with the input instead of being a
  full-width pill.
- **Page-title clearance convention:** first sections need `padding_mobile top ≥ 80px` (and
  tablet 80) or the H1 tucks under the header — the crop shows as glyph tops sliced at a clean
  line. Kontakt/About use 80; Podpořte nás/Donate had 70/60 and cropped. Fixed to 80/80 on
  CZ #4071 and EN #3920. When creating new pages, copy the 100/80/80 padding from #2555.

### Mobile language switch + newsletter merge (2026-08-22, round 3)

- **Language switch in mobile menu** (desktop keeps the header flag): CZ menu 46 got "English" →
  irmf.net (item #8560), EN menu 54 got "Česky" → irmf.cz (item #4661). Both carry class
  `irmf-lang-mobile`, hidden ≥768px via CSS in both Additional CSS sheets. Text labels chosen
  over flag emoji (Windows rendering, screen readers).
- **Newsletter card merges into the footer on mobile** ("IRMF newsletter footer merge" CSS block,
  both sheets): radius 0 (must target `.elementor-element-populated` — Elementor renders column
  radius/background there, not on the column div) and the white gap removed (it was a 30px
  `margin-top` on the mobile sitemap section `0e42086`). Desktop keeps the floating rounded card.
- Reminder: the footer contains **separate desktop and mobile sitemap sections** (afb7002/5903620
  desktop, 0e42086/1dc0b46 mobile) — measure with device emulation to find which one renders.

### Card scrims, homepage H1 + SEO plugin (2026-08-22, round 4)

Backups: `irmf-cz-pre-seo-2026-08-22.sql.gz` / `irmf-net-pre-seo-2026-08-22.sql.gz` (~/backups).

- **Readability scrim on the Instagram/merch cards** (home CZ #7493 / EN #2454 — element IDs are
  identical on both sites): columns `e9d087c` (Instagram) and `5a1ee27` (merch) got a native
  Elementor background overlay — linear gradient `rgba(0,0,0,.65)` at top → transparent at 60%,
  180°. **Trap:** Elementor's overlay `background_overlay_opacity` defaults to 0.5 and multiplies
  the rgba values — set it to size 1 explicitly. Native overlay beats a CSS `::before` hack: it
  inherits the card radius and z-index for free. Script: `.context/wp/scrimseo.php`.
- **Homepage now has an H1** (it had none — hero title was H2): heading widget `1373666`
  `header_size` → `h1` on both homes. The widget carries its own typography (4rem, 7vw mobile,
  keys `typography_*`, not `title_typography_*`), **but the parent theme forces
  `h1.elementor-heading-title { font-size: 40px !important }`**, which shrank the title after the
  flip. Countered with the "IRMF hero H1 size" block in both Additional CSS sheets
  (higher-specificity `!important`, 4rem / 7vw under 768px). Same trap family as the mobile
  section-padding one.
- **The SEO Framework 5.1.4** (`autodescription`) installed + active on both sites. Before it,
  the sites emitted **zero** og:/twitter:/description tags — shares on FB/IG/WhatsApp were bare
  links. Config via `wp option patch update autodescription-site-settings <key> <value>`:
  `homepage_description` (CZ + EN texts), `homepage_tagline 0` (keeps the clean title),
  `homepage_social_image_url/_id` + site-wide fallback `social_image_fb_url/_id` → the 2026 hero
  (`hero-banner-2026.jpg`, attachment **CZ #8526 / EN #4510**). Per-page descriptions live in
  post meta **`_genesis_description`** (TSF reads the Genesis key) — set on CZ kontakt/průvodce/
  podpořte-nás/média/ztracené-kino and EN contact/festival-guide/donate/about via
  `.context/wp/metadesc.php`, because TSF's auto-description scrapes page text (on kontakt that
  was a list of emails and phone numbers). TSF also serves `/sitemap.xml` now.
- **EN mc4wp form #92 cleaned:** its stored HTML carried its own "Subscribe to our newsletter…"
  paragraph, which duplicated the `nlline01` context line added in round 1 — removed; the submit
  also lacked the `btn-submit-newsletter` class all the newsletter CSS targets — added. EN form
  HTML is now the minimal input + classed submit (CZ form still has its legacy 300px-div wrapper,
  neutralised by CSS).
- Verified live: og/description tags + H1 on both homes and /kontakt/, scrim gradients in
  computed styles, hero back at 4rem, EN mobile newsletter shows a single context line and
  full-width fields.

### Plugin update passes 1+2 (2026-08-22)

Backups: `irmf-cz-pre-plugins-2026-08-22.sql.gz` / `irmf-net-pre-plugins-2026-08-22.sql.gz`.

- **Updated (both sites unless noted):** contact-form-7 5.8→6.1.7, custom-fonts →2.1.17,
  flamingo →2.6.4, ga-google-analytics →20260810, mailchimp-for-wp 4.9.7→4.14.0,
  post-types-order →2.5, duplicate-post →4.7; CZ only: insert-headers-and-footers →2.3.8,
  wp-fastest-cache 1.1.9→1.5.1, mystickysidebar →1.4.1. Core is current on both.
- **Deleted:** CZ inactive plugins classic-editor, mystickymenu, notibar; unused default themes
  (kept twentytwentyfive as fallback, updated to 1.5).
- **CF7 is unused on both sites** — no page or Elementor layout references it, only the sample
  form. Deletion candidate (with flamingo) next round.
- **Found + fixed: EN newsletter was never connected to Mailchimp.** The `mc4wp` option (API key)
  did not exist on irmf.net — old mc4wp rendered the form anyway (submissions failed silently);
  **4.14 returns empty output for logged-out visitors when no API key is set**, which made the
  form vanish and exposed the problem. Copied the CZ `mc4wp` option to EN (same account); EN form
  92 already pointed at the shared list `578e569734` "International Road Movie Festival". API
  verified reachable from the EN server (get_lists shows the audience).
- **Still pending (pass 3, separate session):** Elementor 3.16.3→4.2.3 + sina-extension
  3.4.8→3.10.3, EN first, full render checklist. Wildcard: grandconference-elementor 1.2.2 theme
  widgets have no update and are untested against Elementor 4.
- Verified after updates, both sites: IRMFont loads, newsletter form renders with styled submit,
  countdown 60, GA tag present, H1 count 1, sites 200.

### GrandConference theme 5.0.9 → 5.3.7 (2026-08-22)

Source: user-supplied ThemeForest zip (`themeforest-93hoTYdv-grand-conference-…​.zip` — contains
the installable theme at zip root, no docs wrapper). File backups before replacing:
`theme-grandconference-5.0.9-{cz,en}.tar.gz` in ~/backups (theme + both companion plugins).

- Install: `wp theme install <zip> --force` (replaces the parent dir; child themes untouched,
  theme_mods are keyed to the child theme names so all colours survive).
- **Companion plugins must move in lockstep** — 5.3.7's TGMPA manifest
  (`lib/tgm.lib.php`) pins `grandconference-elementor` **1.4.3** and
  `grandconference-custom-post` **2.6.4**, with public zips on
  `https://themegoods-assets.b-cdn.net/<slug>/<slug>-v<ver>.zip` → installable via
  `wp plugin install <url> --force`, no purchase code needed (registration only gates demo
  import). Both updated on both sites.
- Pre-checked in the new source before installing: the `?ver=`-strip filters are unchanged
  (child `irmf_restore_asset_versioning` still applies), our CSS counter-rules (hero H1 size,
  mobile section padding, header edges) still win on specificity.
- Verified after update, both sites: home desktop render (hero 64px, cards, scrims), IRMFont,
  countdown 60, newsletter form, mobile slide-in menu incl. language items, movie catalogue
  (`/movies/2025/` CZ 249 / EN 313 movie nodes), all key pages HTTP 200. WPFC + Elementor CSS
  flushed.
- Envato Market plugin is installed but not connected to an Envato account, so theme updates
  never show up in WP — future theme updates arrive as ThemeForest zips like this one.

### Designer round: blue links, arrow centring, EN card parity (2026-08-24)

Backups: `irmf-{cz,net}-pre-blue-2026-08-24.sql.gz`.

- **Link colour `#7A64D8` → `#63A3D2`** (designer's call). Lives in **7 places per site** and a
  partial change looks fine on the homepage while leaving menus purple: 6 theme mods
  (`tg_link_color`, `tg_menu_hover_font_color`, `tg_menu_active_font_color`,
  `tg_submenu_hover_font_color`, `tg_sidemenu_font_hover_color`, `tg_sidebar_hover_link_color`)
  + the contact mail/tel rule in Additional CSS. `.context/wp/bluelinks.php` does all seven and
  aborts unless it finds exactly 6 mods. **Contrast: 2.73:1 on white — below WCAG AA 4.5:1**
  (the purple was 4.52:1). Flagged to the user; kept as an explicit design decision. Same-hue
  AA variants if ever revisited: `#559BCE` (3.01:1 large text) / `#337BB0` (4.56:1 body text).
- **Arrow glyph centring in the round buttons.** IRMFont's `→` sits entirely above the baseline
  (ink ascent 11.17px, descent ~0 at 20.8px), so the font's own ascent/descent (21/4) push the
  baseline low in the line box and the ink centre lands **2.9px = 0.14em below** the button's
  optical centre — measured identically on every arrow button, so it is a font-metric issue, not
  a per-widget padding mistake. Fixed site-wide with the "IRMF round button arrow centring"
  block: `.irmf-block-button .elementor-button-text { transform: translateY(-0.14em) }`. Em-based
  so it holds at any font size; `.elementor-button-text` is `display:block` inside a flex
  wrapper, so the transform applies and changes no layout box. Every arrow button carries
  `irmf-block-button` and no other button does — verified before choosing the selector.
  Residual offset after the fix: 0.01px.
- **EN home: dead arrows removed from lime cards 1+2** (`e5efde7`, `7cd3d22`). The Elementor JSON
  was *identical* to CZ — all three cards have a button widget, cards 1+2 with an empty link.
  CZ hides them with Elementor's responsive-visibility flags (`hide_desktop`/`hide_tablet`/
  `hide_mobile`), which EN was missing; mirrored rather than inventing a CSS rule. Card 3
  (guide) keeps its arrow. **When porting a section CZ→EN, responsive-visibility flags are easy
  to lose — they live in widget settings, not in the markup.**
- **EN merch photo** now the CZ 2026 hoodie shot: file copied CZ→EN through the local machine
  (CageFS blocks server-to-server), `wp media import` → EN attachment **4667**
  (`2026/08/merch-2026.jpeg`, 1280×853, no EXIF rotation re-applied), column `5a1ee27`
  background url+id swapped. All other background settings on that column already matched CZ.
- Verified live both sites: links `rgb(99,163,210)` on /media/ + /kontakt/, arrows centred,
  EN cards 1+2 arrow-free with card 3 intact, merch photo matching CZ.

### EN homepage recap copy → 2026 (2026-08-24)

- EN home #2454 was still running the **2025 retrospective** ("The eighth edition is a wrap!" /
  "…is over. From 16 to 19 October we screened…") while CZ #7493 had already been switched to
  forward-looking 2026 copy. Translated both widgets — heading `e7436d6`, body `364b2ba`
  (a heading widget with `header_size=p`) — reusing the EN wording already established on the
  cards and meta description: "Moving Station, Pilsen", "road movies from around the world",
  "guests and a side programme", tickets in September, programme during October.
  Script: `.context/wp/enrecap.php`.
- Checked the rest of the EN homepage widget-by-widget (`.context/wp/textdump.php` dumps every
  heading/text/button on a page) — everything else was already 2026-current — and searched all
  published EN Elementor pages for "eighth edition" / "16 to 19 October": **only the homepage**
  carried it.
- **Rollover note:** this recap section is the easiest thing to forget when the year turns,
  because it is the only homepage block written as prose. Add it to the season checklist:
  CZ #7493 + EN #2454, widgets `e7436d6` (heading) and `364b2ba` (body), on both sites together.

---

## 12. Accreditation presale went live (2026-09-15)

GoOut event for 2026 is **`szyrtmy`** (2025 was `szxybby`); the `/cs/` and `/en/` variants share
the slug, so EN is a clean mirror of CZ.

| | CZ | EN |
|---|---|---|
| `.htaccess` redirect | `/vstupenky` → `.../cs/international-road-movie-festival-2026/szyrtmy/` | `/tickets` → `.../en/.../szyrtmy/` |
| Homepage card 2 heading `8c3eab2` | „Kup si akreditaci" | "Buy your accreditation" |
| Homepage card 2 button `7cd3d22` | link `/vstupenky/` | link `/tickets` |
| Homepage card 2 column `f93430c` | `column_link` added | already had one → `/tickets` |
| Homepage intro `364b2ba` | „Akreditace jsou v prodeji, …" | "Accreditations are now on sale …" |
| Festival guide | #3947 `e2beaee` „Prodej akreditací byl zahájen." | #3888 `fd3a8f3` "Accreditation sales have started." |

**The homepage cards carry per-breakpoint visibility flags.** Cards with no destination have
their arrow button hidden via `hide_desktop`/`hide_tablet`/`hide_mobile` on the button widget —
that is how card 1 "Program" and (until now) card 2 were parked. Making a card live therefore
takes **three** edits, not two: heading text, `link` on the arrow button, `column_link` on the
column — **plus removing the three `hide_*` keys**, or the arrow silently never renders. Card 1
is still parked this way and needs the same treatment when the October programme lands.

**The hero button `a2c3495` ("Kup si vstupenky" / "Buy tickets", → `/vstupenky` / `/tickets`) is
hidden on all three breakpoints on both sites and does not render at all.** It was left that way
in this pass — unhiding it is a design call, and its copy still says *tickets* while the presale
sells *accreditations*.

Also removed in this pass, CZ only, at the user's request: the afterparty sentence („Afterparties
se konají v klubu MōōVEMENT …") from festival guide #3947 `78c62dc`. **The EN twin in #3888
`91e45ea` is still live** — "The official afterparties take place at the MōVEMENT club …" (note
EN spells it with one `ō`). Remove it too if the venue is genuinely gone.

All of it was done with throwaway `eval-file` scripts following the §3 pattern (dry run by
default, `apply` to write, abort if the `"elType"` count moves, refuse if the target text is not
exactly what was expected). Backups are on both hosts under `~/backups/*2026-09-15-presale*`
(full DB, `.htaccess`, and the pre-change `_elementor_data` of every page touched).

`wp fastest-cache clear` is **not** a valid WP-CLI command on CZ. The §4 one-liner
(`wp eval 'do_action("wpfc_clear_all_cache", true);'`) works when typed in a shell **on the
server**; wrapped inside an `ssh host '…'` string from your machine it dies on the nested quotes
(§3). Driving it remotely, put the one line in a file and `eval-file` it.

### Card row reordered + inert card dimmed (2026-09-15, later the same day)

Row order is now **Akreditace | Průvodce | Program** on both sites (was Program first). Rationale:
the only converting card was sitting in the middle while the leftmost, most-read slot — and the
first card in the mobile stack — held a card with no destination.

**The columns' margins belong to the slot, not to the card.** Left/right run `0/20`, `10/10`,
`20/0` (outer edges flush, inner gaps shared) and `margin_mobile` runs `top 0/20/40`,
`bottom 10/−20/−40` — hand-tuned stack spacing. The reorder therefore captured each slot's
geometry *before* moving anything and re-stamped it onto whatever card landed there, so the
row's geometry stayed pixel-identical. Never carry the margins along with the cards.

The inert Program card was full-strength lime `#BFDE54`, visually identical to the two real CTAs.
It was dropped to `#E5F2BB` (40% lime over white) — same hue, clearly recessive;
card-vs-page contrast 1.52:1 → 1.18:1 while the heading on it *gains* legibility 8.78:1 → 11.30:1.
(Superseded the same evening — see the newsletter entry below.)

**CZ and EN diverge on this card — dim applied to CZ only.** EN's `5db193f` carries
`column_link` → `/schedule/`, CZ's has none. Both `/program/` and `/schedule/` still render the
**2025** programme, so the EN card announces "Programme will be published during October" and
silently opens last year's schedule. The dim pass refused to touch any card carrying a
`column_link`, which is what caught this. Decide before the next pass: drop the EN link (sites
match, dim both) or point both cards at the 2026 programme once it exists.

### Third card became a newsletter capture (2026-09-15, final state)

The row is now three real CTAs, all full lime `#BFDE54`, all with arrows:

| slot | CZ | EN | target |
|---|---|---|---|
| 1 | „Kup si akreditaci" | "Buy your accreditation" | `/vstupenky/` · `/tickets` |
| 2 | „Naplánuj si festival" | "Plan your festival" | `/pruvodce-festivalem/` · `/festival-guide/` |
| 3 | „Dej vědět, až vyjde program" | "Tell me when the programme is out" | `#newsletter` |

Slot 3 used to announce the October programme and offer nothing to do about it. It now captures
the intent instead — the programme is the thing the audience is waiting for, so the signup feeds
a warm list to mail on the day it lands. **This replaced the dim**: the card went back to
full lime as part of the change, since it is no longer inert.

**Anchor:** footer #2444 column
`b97d2cb` (same id on both sites) now has `_element_id = newsletter`, a stable `#newsletter` target. Do not link to
`#mc4wp-form-1` — that id is generated by the plugin and is not stable.

**The card is clickable via the plugin, not an href.** `make-column-clickable-elementor` renders
`data-column-clickable="#newsletter"` plus `style="cursor:pointer"` on the column and wires it in
JS; the only real `href` in the card is the arrow button. So grepping rendered HTML for `href=`
undercounts the links in this row — check `data-column-clickable` too.

**EN divergence closed.** EN's slot-3 column had `column_link` → `/schedule/`, which serves the
**2025** programme; it is gone, replaced by `#newsletter`. Both sites now match.

Open: the EN string (33 chars) wraps to two lines and makes the EN row taller than CZ's, where
all three fit on one line. The single-line ceiling in a 33% column is roughly 25 characters —
"Get programme updates" (21) would match CZ if the height bothers anyone.

**Card voice (settled 2026-09-15).** All three headings are now imperative and informal (tykání),
matching the second card row („Sleduj festivalový Instagram", „Kup si náš merch"). Card 2 moved
from a noun label to a benefit — „Naplánuj si festival" / "Plan your festival" — because it sells
the outcome rather than the artifact, and reads as a sequence with the card beside it: buy, then
plan.

That heading (`b7200b1`) is wrapped in `<span style="font-weight: normal;">` while the other two
cards are plain text. The wrapper looks vestigial — all three render at the same weight — but it
is preserved on edit rather than stripped, so nothing shifts unexpectedly. Swap the words inside
it, do not replace the whole `title`.
