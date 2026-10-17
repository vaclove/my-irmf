#!/bin/sh
# Set up the Xprinter XP-58IIN for IRMF box-office tickets on macOS:
# - padding filter around Xprinter's rastertozj (the printer drops the bytes
#   right after the job's ESC @ reset, which printed the first image strip as text)
# - 58 x 210 mm as the default paper in the PPD itself (the ticket page size;
#   browsers read the default from the PPD and shrink pages that don't fit it)
# Usage: sudo sh install.sh [printer-queue-name]   (safe to run again)
# See README.md in this folder.
set -e
PRINTER="${1:-Xprinter_XP58}"
DIR=/Library/Printers/Xprinter/Filter
install -o root -g wheel -m 755 "$(dirname "$0")/rastertozj-pad" "$DIR/rastertozj-pad"
PPD="$(mktemp -t xprinter-ppd)"
trap 'rm -f "$PPD"' EXIT
sed -e "s#$DIR/rastertozj\"#$DIR/rastertozj-pad\"#" \
    -e 's#^\*DefaultPageSize: .*#*DefaultPageSize: X48MMY210MM#' \
    -e 's#^\*DefaultPageRegion: .*#*DefaultPageRegion: X48MMY210MM#' \
    -e 's#^\*DefaultImageableArea: .*#*DefaultImageableArea: X48MMY210MM#' \
    -e 's#^\*DefaultPaperDimension: .*#*DefaultPaperDimension: X48MMY210MM#' \
    "/etc/cups/ppd/$PRINTER.ppd" > "$PPD"
lpadmin -p "$PRINTER" -P "$PPD" -o PageSize-default=X48MMY210MM -o PageRegion-default=X48MMY210MM
grep -E "cupsFilter|^\*Default(PageSize|PageRegion|ImageableArea|PaperDimension)" "/etc/cups/ppd/$PRINTER.ppd"
