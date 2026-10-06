# Copies the employee study app (drill, review, schedule, stats, mock exams) from the
# takken-drill.com source into public/study/, adapted for companies:
#   - no ads, affiliate links, membership plans, login or column section (the company pays)
#   - every member feature is on
#   - past exam questions and mock exams 2-5 are NOT copied: the page loads them from
#     takken-drill.com when it opens (only original questions live in this repository)
#   - each answer is reported to the surrounding app (public/study/bridge.js), which records it
#
#   python3 scripts/import-study-app.py ../宅建サイト/prototype
import re
import shutil
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "../宅建サイト/prototype").resolve()
OUT = Path(__file__).resolve().parent.parent / "public" / "study"
REMOTE = "https://takken-drill.com/"

OUT.mkdir(parents=True, exist_ok=True)


def sub(text: str, pattern: str, repl: str, *, flags: int = re.S, count: int = 0, must: bool = True) -> str:
    new, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if must and n == 0:
        raise SystemExit(f"pattern not found: {pattern[:80]}")
    return new


# ---------- app.js ----------
app = (SRC / "app.js").read_text(encoding="utf-8")
# One study record per employee in a shared browser
app = sub(app, r'const STORE_KEY = "takken-drill-v1";', 'const STORE_KEY = window.TAKKEN_STORE_KEY || "takken-drill-v1";')
# Detailed explanations are loaded from takken-drill.com
app = sub(app, r"el\.src = `data/exp/", "el.src = `${window.TAKKEN_DATA_BASE || \"\"}data/exp/")
# Column covers live on takken-drill.com (the column section is hidden, but keep links valid)
app = sub(app, r'<img src="/articles/', f'<img src="{REMOTE}articles/', must=False)
(OUT / "app.js").write_text(app, encoding="utf-8")

# ---------- files copied as they are ----------
# questions.js: 12 original questions / mock_questions.js: mock exam 1 (original) / mocks.js: exam layouts
for name in ["questions.js", "mock_questions.js", "mocks.js", "pages.js", "cloud.js", "icon.svg"]:
    shutil.copyfile(SRC / name, OUT / name)

# ---------- index.html ----------
html = (SRC / "index.html").read_text(encoding="utf-8")
head_end = html.index("<style>")
html = (
    '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    "<title>宅建過去問ドリル for Business</title>\n"
    '<link rel="icon" href="icon.svg" type="image/svg+xml">\n'
    + html[head_end:]
)
# Company version: one column (no side ads), no sign-in button, no "member" badges or upsells
html = html.replace("</head>", """<style>
.layout { grid-template-columns: minmax(0, 1fr) !important; max-width: 860px; }
@media (max-width: 767px) { nav { grid-template-columns: repeat(5, 1fr) !important; } }
nav button { white-space: nowrap; }
@media (min-width: 768px) and (max-width: 1000px) { nav button { padding-left: 8px; padding-right: 8px; } }
.biz-tag { margin-left: 6px; padding: 1px 6px; border: 1px solid currentColor; border-radius: 5px; font-size: 10px; font-weight: 600; letter-spacing: .02em; color: var(--muted); vertical-align: middle; white-space: nowrap; }
.account-btn, .member-badge, .lock-bar, .ml-bar, .own-mock-price, .save-pill { display: none !important; }
</style>
</head>""", 1)
# Side column: no member promotion or advertising
html = sub(html, r'(<button class="logo" data-go="home">.*?</button>)', r'\1<span class="biz-tag">for Business</span>', count=1)
html = sub(html, r"<aside>.*?</aside>", "")
html = sub(html, r'<section class="columns".*?</section>', "")
html = sub(html, r'<div class="sponsor-wrap">.*?</div>\s*</div>', "")
# Footer: keep only the required past-question source notice (RETIO)
html = sub(html, r'<div class="foot-links".*?</div>', "")
html = sub(html, r'<p class="foot-copy">.*?</p>', "")
# Scripts
scripts = f"""<script src="bridge-before.js"></script>
<script src="questions.js"></script>
<script src="{REMOTE}data/all.js"></script>
<script src="mock_questions.js"></script>
<script src="{REMOTE}mock_questions_m2.js"></script>
<script src="{REMOTE}mock_questions_m3.js"></script>
<script src="{REMOTE}mock_questions_m4.js"></script>
<script src="{REMOTE}mock_questions_m5.js"></script>
<script src="mocks.js"></script>
<script>window.AFFILIATES = []; window.COLUMNS = [];</script>
<script src="pages.js"></script>
<script src="cloud.js"></script>
<script src="app.js"></script>
<script src="bridge.js"></script>
"""
html = sub(html, r'<script src="questions\.js.*?</script>\s*</body>', scripts + "</body>")
(OUT / "index.html").write_text(html, encoding="utf-8")
print(f"wrote {OUT}")
