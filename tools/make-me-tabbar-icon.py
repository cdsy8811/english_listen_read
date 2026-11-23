"""生成底部导航「我的」图标（81×81，与现有 tabBar 图标尺寸一致）。

图形：圆头 + 肩部轮廓（人物剪影），抗锯齿缩放到 81px。
用法：python tools/make-me-tabbar-icon.py
输出：english-listen-read/src/static/tabbar/me.png / me-active.png
"""
from pathlib import Path

from PIL import Image, ImageDraw

S = 4  # 超采样倍数
SIZE = 81
GRAY = (138, 147, 166, 255)
ACCENT = (249, 115, 22, 255)
OUT = Path(__file__).resolve().parents[1] / "english-listen-read" / "src" / "static" / "tabbar"


def draw_icon(color) -> Image.Image:
    img = Image.new("RGBA", (SIZE * S, SIZE * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def px(v: float) -> float:
        return v * S

    # 头
    d.ellipse([px(27), px(12), px(54), px(39)], outline=color, width=round(px(6)))
    # 肩 / 上身：上半圆 + 平底
    d.arc([px(13), px(42), px(68), px(92)], start=180, end=360, fill=color, width=round(px(6)))
    d.line([px(13), px(67), px(13), px(69)], fill=color, width=round(px(6)))
    d.line([px(68), px(67), px(68), px(69)], fill=color, width=round(px(6)))

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(GRAY).save(OUT / "me.png")
    draw_icon(ACCENT).save(OUT / "me-active.png")
    print("written:", OUT / "me.png", OUT / "me-active.png")


if __name__ == "__main__":
    main()
