"""生成底部导航「跟读」图标（81×81，与现有 tabBar 图标尺寸一致）。

图形：对话气泡 + 播放三角，表示「听一句、读一句」。
用法：python tools/make-read-tabbar-icon.py
输出：english-listen-read/src/static/tabbar/read.png / read-active.png
"""
from pathlib import Path

from PIL import Image, ImageDraw

S = 4  # 超采样倍数，缩到 81px 时自带抗锯齿
SIZE = 81
GRAY = (138, 147, 166, 255)
ACCENT = (249, 115, 22, 255)
OUT = Path(__file__).resolve().parents[1] / "english-listen-read" / "src" / "static" / "tabbar"


def draw_icon(color) -> Image.Image:
    img = Image.new("RGBA", (SIZE * S, SIZE * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def px(v: float) -> float:
        return v * S

    # 气泡：圆角矩形 + 左下角小尾巴
    d.rounded_rectangle([px(8), px(12), px(73), px(58)], radius=px(15),
                        outline=color, width=round(px(5.5)))
    d.polygon([(px(22), px(55)), (px(22), px(73)), (px(39), px(55))], fill=color)

    # 播放三角
    d.polygon([(px(33), px(24)), (px(33), px(46)), (px(52), px(35))], fill=color)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(GRAY).save(OUT / "read.png")
    draw_icon(ACCENT).save(OUT / "read-active.png")
    print("written:", OUT / "read.png", OUT / "read-active.png")


if __name__ == "__main__":
    main()
