"""生成底部导航「词典」图标（81×81，与现有 tabBar 图标尺寸一致）。

图形：打开的书 + 右下角放大镜（放大镜周围留透明间隙，避免线条糊成一团）。
用法：python tools/make-dict-tabbar-icon.py
输出：english-listen-read/src/static/tabbar/dict.png / dict-active.png
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

    # 书：圆角矩形外壳 + 中缝 + 两页各一条短横线
    d.rounded_rectangle([px(7), px(22), px(60), px(63)], radius=px(7),
                        outline=color, width=round(px(5.5)))
    d.line([px(33.5), px(24), px(33.5), px(61)], fill=color, width=round(px(4.5)))
    d.line([px(13), px(34), px(27), px(34)], fill=color, width=round(px(3.4)))
    d.line([px(40), px(34), px(54), px(34)], fill=color, width=round(px(3.4)))

    # 放大镜周围挖一圈透明间隙（先擦书，再画放大镜）
    halo = Image.new("L", img.size, 0)
    ImageDraw.Draw(halo).ellipse([px(45), px(43), px(78), px(76)], fill=255)
    alpha = img.getchannel("A")
    blank = Image.new("L", img.size, 0)
    img.putalpha(Image.composite(blank, alpha, halo))

    d = ImageDraw.Draw(img)
    d.ellipse([px(50), px(48), px(74), px(72)], outline=color, width=round(px(5.5)))
    d.line([px(70.5), px(68.5), px(78), px(76)], fill=color, width=round(px(5.5)))

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(GRAY).save(OUT / "dict.png")
    draw_icon(ACCENT).save(OUT / "dict-active.png")
    print("written:", OUT / "dict.png", OUT / "dict-active.png")


if __name__ == "__main__":
    main()
