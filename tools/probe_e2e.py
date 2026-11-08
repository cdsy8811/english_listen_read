# -*- coding: utf-8 -*-
"""
P0 端到端联调：自造一张单词表图 → 讯飞 OCR → 解码 → Spark X2.6 结构化抽取。

非 App 功能代码，仅用于验证 docs/讯飞接口配置.md 里的链路假设：
  1) OCR 对中英混排 / IPA 音标的真实识别效果
  2) payload.result.text 是否真的 base64（是否需要 gzip 解压）
  3) result_format=json,markdown 的输出长什么样
  4) X2.6 能否把结果稳定抽成词条 JSON

运行：python tools/probe_e2e.py
输出不含任何密钥、签名串或完整鉴权 URL。
"""
import base64
import gzip
import io
import json
import os

from PIL import Image, ImageDraw, ImageFont

from probe_xfyun import (
    MAAS_URL, OCR_HOST, OCR_PATH, auth_query, brief, http_post, load_creds,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, "tools", "ocr_sample.png")
CACHE = os.path.join(ROOT, "tools", "ocr_last.json")
FONT_EN = "C:/Windows/Fonts/segoeui.ttf"
FONT_ZH = "C:/Windows/Fonts/msyh.ttc"

LINES = [
    "Word List   Unit 1",
    "abandon   /əˈbændən/   v.   放弃；抛弃",
    "benefit   /ˈbenɪfɪt/   n.   益处；好处",
    "camera   /ˈkæmərə/   n.   照相机",
]


def make_sample():
    img = Image.new("RGB", (1000, 320), "white")
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(FONT_EN, 30)
    f_row = ImageFont.truetype(FONT_ZH, 26)
    d.text((30, 20), LINES[0], font=f_title, fill="black")
    for i, line in enumerate(LINES[1:]):
        d.text((30, 80 + i * 72), line, font=f_row, fill="black")
    img.save(SAMPLE)
    with open(SAMPLE, "rb") as f:
        return base64.b64encode(f.read()).decode()


def call_ocr(c, image_b64, sign_host):
    q = auth_query(OCR_PATH, "POST", sign_host, c["key"], c["secret"])
    url = "https://{}{}?{}".format(OCR_HOST, OCR_PATH, q)
    body = {
        "header": {"app_id": c["appid"], "status": 0},
        "parameter": {"ocr": {
            "result_option": "normal", "result_format": "json,markdown",
            "output_type": "one_shot", "rotation_min_angle": 5,
            "result": {"encoding": "utf8", "compress": "raw", "format": "plain"},
        }},
        "payload": {"image": {"encoding": "png", "image": image_b64, "status": 0, "seq": 0}},
    }
    return http_post(url, body, {})


def decode_result(resp):
    obj = json.loads(resp.decode("utf-8", "replace"))
    header = obj.get("header", {})
    if header.get("code") != 0:
        return None, "OCR 失败: code={} message={}".format(header.get("code"), header.get("message"))
    result = obj["payload"]["result"]
    raw_text = result.get("text", "")
    note = "encoding={} compress={} format={}".format(
        result.get("encoding"), result.get("compress"), result.get("format"))
    try:
        raw = base64.b64decode(raw_text)
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
            note += "；已 gzip 解压"
        text = raw.decode("utf-8", "replace")
        note += "；base64 解码成功"
    except Exception:
        text = raw_text
        note += "；**text 不是 base64，直接当明文使用**"
    return text, note


def pick_document_text(text):
    """result_format=json,markdown 时解码后的 text 本身是一个 JSON 字符串：
    document[] 里是识别文本，image[] 里是版面坐标（体积大、对词条抽取无用）。
    工程上应只把 document 文本喂给大模型，别整包塞进去。
    """
    try:
        obj = json.loads(text)
        docs = [d for d in (obj.get("document") or []) if isinstance(d, dict)]
        parts = [(d.get("name", ""), d.get("value", "")) for d in docs]
        if parts:
            names = ", ".join(str(n) for n, _ in parts)
            md = [v for n, v in parts if n == "markdown" and v]
            chosen = "\n".join(md) if md else "\n".join(v for _, v in parts if v)
            return chosen, "取 document 文本（{} 段：{}）".format(len(parts), names)
    except Exception:
        pass
    return text, "未解析出 document 结构，原样使用"


def call_extract(c, text):
    prompt = (
        "下面是从单词表图片 OCR 出来的文本。请抽取每个词条，只输出 JSON，不要解释、不要代码块。\n"
        '格式：{"items":[{"word":"","phonetic":"","pos":"","translation":""}]}\n'
        "要求：OCR 会把 IPA 音标识别成方框/乱码，因此 phonetic 必须忽略原文里的音标，"
        "根据单词重新写出标准英式 IPA 音标并用 /.../ 包裹；pos 统一用词性缩写（v. / n. / adj. 等）；"
        "translation 只保留中文释义；不确定的字段留空字符串，不要编造，不要合并词条。\n\n"
        "OCR 文本：\n" + text[:3000]
    )
    body = {
        "model": "spark-x2.6",
        "messages": [{"role": "user", "content": prompt}],
        "stream": False, "max_tokens": 1024, "temperature": 0.1,
    }
    return http_post(MAAS_URL, body, {"Authorization": "Bearer " + c["maas"]}, timeout=90)


def main():
    c = load_creds()
    reuse = os.environ.get("REUSE_OCR") == "1" and os.path.exists(CACHE)
    if reuse:
        with open(CACHE, "r", encoding="utf-8") as f:
            doc_text = json.load(f)
        print("复用上次 OCR 结果（不重复调用 OCR）\n")
    else:
        img = make_sample()
        print("测试图：tools/ocr_sample.png（自造，无隐私内容）\n")
        print("=== 1. 通用文档识别 ===")
        code, resp = call_ocr(c, img, OCR_HOST)
        print("HTTP", code, "|", brief(resp, 200))
        if code != 200:
            return
        text, note = decode_result(resp)
        print("解码：", note)
        if text is None:
            return
        print("原始解码文本共 {} 字".format(len(text)))
        doc_text, pick_note = pick_document_text(text)
        print("结构化：", pick_note)
        with open(CACHE, "w", encoding="utf-8") as f:
            json.dump(doc_text, f, ensure_ascii=False)
    print("\n--- 实际送进大模型的识别文本 ---")
    print(doc_text[:900])
    print("--- 结束 ---\n")

    print("=== 2. Spark X2.6 结构化抽取 ===")
    code2, resp2 = call_extract(c, doc_text)
    print("HTTP", code2)
    if code2 == 200:
        try:
            obj = json.loads(resp2.decode("utf-8", "replace"))
            content = obj["choices"][0]["message"]["content"]
            print("--- 模型输出 ---")
            print(content[:1200])
        except Exception:
            print(brief(resp2, 600))
    else:
        print(brief(resp2, 400))


if __name__ == "__main__":
    main()
