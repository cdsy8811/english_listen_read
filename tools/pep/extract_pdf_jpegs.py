"""从 FreePEP 生成的图片型 PDF 中直接抽出内嵌 JPEG（无需第三方库）。
Pillow 合成 PDF 时每页是一张 DCTDecode JPEG，字节流以 FFD8 开头、FFD9 结尾。

用法: python extract_pdf_jpegs.py <pdf路径> <输出目录>
"""
import os
import re
import sys

src = sys.argv[1]
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
data = open(src, "rb").read()
print(f"PDF {os.path.basename(src)}: {len(data)//1024//1024} MB")

# 定位每个 stream ... endstream，抽出 JPEG
images = []
pos = 0
while True:
    s = data.find(b"stream", pos)
    if s < 0:
        break
    # 跳过 stream 关键字后的 EOL
    i = s + 6
    if data[i:i + 2] == b"\r\n":
        i += 2
    elif data[i:i + 1] in (b"\n", b"\r"):
        i += 1
    e = data.find(b"endstream", i)
    if e < 0:
        break
    chunk = data[i:e].rstrip(b"\r\n")
    if chunk.startswith(b"\xff\xd8"):
        # 截到最后一个 JPEG EOI
        end = chunk.rfind(b"\xff\xd9")
        if end > 0:
            images.append(chunk[:end + 2])
    pos = e + 9

for n, img in enumerate(images, 1):
    with open(os.path.join(out, f"{n:03d}.jpg"), "wb") as f:
        f.write(img)

print(f"抽出 {len(images)} 页 JPEG -> {out}")
if images:
    print(f"首页 {len(images[0])//1024}KB，末页 {len(images[-1])//1024}KB")
