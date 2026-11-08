"""从 FreePEP 目录里给出的人教社官方 book_id，抓取教材页面图片（仅本地学习用）。
用法: python download_pages.py <book_id> <out_dir> [起始页] [结束页]
"""
import sys, os, urllib.request, concurrent.futures

BOOK = sys.argv[1]
OUT = sys.argv[2]
START = int(sys.argv[3]) if len(sys.argv) > 3 else 100
END = int(sys.argv[4]) if len(sys.argv) > 4 else 140
os.makedirs(OUT, exist_ok=True)
BASE = f"https://book.pep.com.cn/{BOOK}/files/mobile/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
    "Referer": "https://jc.pep.com.cn/",
}


def one(n: int):
    path = os.path.join(OUT, f"{n:03d}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        return n, "cached"
    try:
        req = urllib.request.Request(BASE + f"{n}.jpg", headers=HEADERS)
        with urllib.request.urlopen(req, timeout=40) as r:
            data = r.read()
        if not data.startswith(b"\xff\xd8"):
            return n, f"skip({len(data)})"
        with open(path, "wb") as f:
            f.write(data)
        return n, f"{len(data)//1024}KB"
    except Exception as e:
        return n, f"ERR {e}"


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
    results = list(ex.map(one, range(START, END + 1)))
ok = [n for n, s in results if not s.startswith(("ERR", "skip"))]
print(f"book={BOOK} pages {START}-{END}: ok={len(ok)} range={min(ok) if ok else '-'}..{max(ok) if ok else '-'}")
bad = [(n, s) for n, s in results if s.startswith(("ERR", "skip"))]
if bad:
    print("未取到:", bad[:12])
