# Xprinter XP-58IIN on macOS (box-office tickets)

Box-office tickets (Tickets → Box office) are printed from the browser on the
58 mm Xprinter. With Xprinter's macOS driver (`zj58.ppd`, filter `rastertozj`)
two things need fixing once per Mac:

1. **Garbage at the top of every ticket.** The driver starts each job with an
   `ESC @` reset; the printer ignores the bytes that arrive right after it, misses
   the first image command and prints that image strip as text. `rastertozj-pad`
   wraps the driver and inserts 256 NUL bytes after the reset.
2. **Tickets shrunk.** Browsers print on the printer's default paper and scale the
   page to fit it. The ticket page is 58 × 210 mm, so that has to be the default
   paper. The driver drops the blank rest of the page, so a ticket only uses as
   much paper as its content.

## Install

Install Xprinter's driver and add the printer first (queue name `Xprinter_XP58`), then:

```
sudo sh docs/box-office/xprinter-macos/install.sh            # or: install.sh <queue name>
```

Quit and restart Chrome (it caches the printer's paper sizes). In the print dialog,
under More settings, check: paper 58mm x 210mm, scale Default, margins None.

## Windows

Use the official Xprinter driver (not "Generic / Text Only", which can't print
images or QR codes), model XP-58. In the printer's Printing Preferences set the
default paper to 58 × 210 mm (create the form under Print Server Properties →
Forms if it's missing). Whether the Windows driver needs the padding fix too
hasn't been tested yet.
