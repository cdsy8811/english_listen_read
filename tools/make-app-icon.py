"""生成「橙子英语」App 图标（含自适应图标、圆形图标与页面内品牌标记）。

用法：
    python tools/make-app-icon.py

输出：
    english-listen-read/src/static/icons/
        icon-1024.png               主图（全幅方形）
        48x48.png ... 192x192.png   安卓各密度直角图标
        round/                      圆形图标（小一号，避免被圆形裁掉叶片）
        adaptive/                   安卓自适应图标前景 / 背景（432px）
    english-listen-read/src/static/brand/mark.png   透明底奶白标记，页面内可直接放
    english-listen-read/unpackage/res/icons/        HBuilderX 云打包读取的全部尺寸

设计：橙色渐变底（#FFC24D → #F9841A → #E2540B）+ 奶白色「O」环 + 一片叶子。
O 既是橙子，也是英文单词的字母，小尺寸下仍能一眼看出「橙子」。
依赖：Pillow、numpy；用 4 倍超采样后缩小，边缘干净。
"""

from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(BASE_DIR, "english-listen-read")
OUT = os.path.join(ROOT, "src", "static", "icons")
BRAND_OUT = os.path.join(ROOT, "src", "static", "brand")
ICON_OUT = os.path.join(ROOT, "unpackage", "res", "icons")

SIZE = 1024
SS = 4  # 超采样倍数
W = SIZE * SS

# 与 App 主题色一致
C_TOP = (255, 194, 77)     # #FFC24D
C_MID = (249, 132, 26)     # #F9841A
C_BOTTOM = (226, 84, 11)   # #E2540B
CREAM = (255, 250, 242)    # #FFFAF2


def _gradient_rows(t: np.ndarray) -> np.ndarray:
    """三段线性渐变，t 形状 (N,)。"""
    out = np.empty(t.shape + (3,), dtype=np.float32)
    m1 = t <= 0.5
    a = (t[m1] / 0.5)[:, None]
    out[m1] = np.array(C_TOP) * (1 - a) + np.array(C_MID) * a
    b = ((t[~m1] - 0.5) / 0.5)[:, None]
    out[~m1] = np.array(C_MID) * (1 - b) + np.array(C_BOTTOM) * b
    return out


def gradient(size: int) -> Image.Image:
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    xx /= size - 1
    yy /= size - 1
    t = np.clip(0.42 * xx + 0.58 * yy, 0, 1)
    rgb = _gradient_rows(t)
    # 左上角柔光，避免纯色平板
    d = np.sqrt((xx - 0.24) ** 2 + (yy - 0.18) ** 2) / 0.62
    glow = np.clip(1 - d, 0, 1) ** 2 * 0.14
    rgb = rgb * (1 - glow[..., None]) + 255 * glow[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def _bezier(p0, p1, p2, n=90):
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def almond(base, angle_deg, length, half_width):
    """两端尖的叶片轮廓。"""
    ang = math.radians(angle_deg)
    tip = (base[0] + length * math.cos(ang), base[1] + length * math.sin(ang))
    px, py = -math.sin(ang), math.cos(ang)
    mid = ((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2)
    c1 = (mid[0] + px * half_width * 2, mid[1] + py * half_width * 2)
    c2 = (mid[0] - px * half_width * 2, mid[1] - py * half_width * 2)
    return _bezier(base, c1, tip) + _bezier(base, c2, tip)


def mark_mask(size: int, scale: float = 1.0) -> Image.Image:
    """奶白色标记的 alpha 蒙版：O 环 + 叶子。"""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    cx = cy = size / 2
    r_out = 0.292 * size * scale
    r_out_y = r_out * 0.960  # 橙子略扁
    stroke = 0.098 * size * scale
    d.ellipse([cx - r_out, cy - r_out_y, cx + r_out, cy + r_out_y], fill=255)
    d.ellipse(
        [cx - r_out + stroke, cy - r_out_y + stroke,
         cx + r_out - stroke, cy + r_out_y - stroke],
        fill=0,
    )
    # 叶子：柄尖落在 O 环外缘，两点相接，缝隙最干净
    ang = math.radians(-50)
    edge = (cx + r_out * math.cos(ang), cy + r_out_y * math.sin(ang))
    d.polygon(almond(edge, -46, 0.248 * size * scale, 0.062 * size * scale), fill=255)
    return m


def compose(size: int, mark_scale: float = 1.0, circle: bool = False,
            bg: bool = True, pad: float = 0.0) -> Image.Image:
    canvas = gradient(W).convert("RGBA") if bg else Image.new("RGBA", (W, W), (0, 0, 0, 0))
    mask = mark_mask(W, scale=mark_scale * (1 - pad * 2))
    canvas.paste(Image.new("RGBA", (W, W), CREAM + (255,)), (0, 0), mask)
    if circle:
        ring = Image.new("L", (W, W), 0)
        ImageDraw.Draw(ring).ellipse([0, 0, W - 1, W - 1], fill=255)
        canvas.putalpha(ring)
    return canvas.resize((size, size), Image.LANCZOS)


def brand_mark(size: int = 512) -> Image.Image:
    """页面内用的透明底品牌标记，裁到内容边界并留 6% 边距。"""
    m = mark_mask(W)
    cream = Image.new("RGBA", (W, W), CREAM + (255,))
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    img.paste(cream, (0, 0), m)
    img = img.crop(m.getbbox())
    side = max(img.size)
    pad = int(side * 0.06)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2 + pad, (side - img.height) // 2 + pad))
    return canvas.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    print("wrote", os.path.relpath(path, BASE_DIR), img.size)


def main() -> None:
    save(compose(SIZE), os.path.join(OUT, "icon-1024.png"))

    for s in (192, 144, 96, 72, 48):
        save(compose(s), os.path.join(OUT, f"{s}x{s}.png"))

    # 圆形图标整体小一号，避免叶片被圆裁掉
    for s in (192, 144, 96, 72, 48):
        save(compose(s, mark_scale=0.88, circle=True), os.path.join(OUT, "round", f"{s}x{s}.png"))

    # Android 自适应图标：前景在 66/108 安全区内
    save(compose(432, mark_scale=0.86, bg=False, pad=0.02), os.path.join(OUT, "adaptive", "foreground-432.png"))
    save(gradient(432), os.path.join(OUT, "adaptive", "background-432.png"))

    sizes = (20, 29, 40, 48, 58, 60, 72, 76, 80, 87, 96, 120, 144, 152, 167, 180, 192, 1024)
    for s in sizes:
        save(compose(s), os.path.join(ICON_OUT, f"{s}x{s}.png"))

    save(brand_mark(), os.path.join(BRAND_OUT, "mark.png"))


if __name__ == "__main__":
    main()
