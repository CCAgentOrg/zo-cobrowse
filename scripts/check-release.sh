#!/usr/bin/env bash
# Release quality checks for Zo Co-browse
# Used by: bun run check-icons, bun run check-prereqs

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

fail=0

check_file() {
  if [ -f "$1" ]; then
    echo -e "  ${GREEN}✓${NC} $1"
  else
    echo -e "  ${RED}✗${NC} $1"
    fail=1
  fi
}

echo ""
echo -e "${BOLD}Icon files${NC}"
for s in 16 48 128; do
  check_file "extension/icons/icon${s}.png"
done
check_file "extension/icons/icon.svg"

echo ""
echo -e "${BOLD}Source files${NC}"
for f in extension/manifest.json extension/background.js extension/sidepanel.html extension/sidepanel.js extension/content.js extension/styles.css extension/options.html extension/options.js; do
  check_file "$f"
done

echo ""
echo -e "${BOLD}TODO/FIXME sweep${NC}"
found=$(grep -rn 'TODO\|FIXME\|HACK' extension/ --include='*.js' --include='*.html' --include='*.css' --include='*.json' 2>/dev/null | grep -v '/icons/' | grep -v '/lib/' || true)
if [ -n "$found" ]; then
  echo -e "  ${YELLOW}⚠ Found:${NC}"
  echo "$found" | sed 's/^/    /'
else
  echo -e "  ${GREEN}✓ None found${NC}"
fi

echo ""
echo -e "${BOLD}console.log in prod${NC}"
produced=$(grep -rn 'console\.log' extension/ --include='*.js' 2>/dev/null | grep -v '/icons/' | grep -v '/lib/' || true)
if [ -n "$produced" ]; then
  echo -e "  ${YELLOW}⚠ Found $(echo "$produced" | wc -l) occurrences${NC}"
  echo "$produced" | sed 's/^/    /'
else
  echo -e "  ${GREEN}✓ None found${NC}"
fi

echo ""
echo -e "${BOLD}Line endings${NC}"
crlf=$(file extension/*.js extension/*.html extension/*.css extension/*.json 2>/dev/null | grep -i "CRLF" || true)
if [ -n "$crlf" ]; then
  echo -e "  ${YELLOW}⚠ CRLF found:${NC}"
  echo "$crlf" | sed 's/^/    /'
else
  echo -e "  ${GREEN}✓ All LF${NC}"
fi

echo ""
if [ "$fail" -eq 1 ]; then
  echo -e "${RED}❌ Some checks failed${NC}"
else
  echo -e "${GREEN}✓ All checks passed${NC}"
fi
exit $fail
