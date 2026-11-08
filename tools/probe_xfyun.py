# -*- coding: utf-8 -*-
"""
P0 一次性联调探针（非 App 功能代码）。

用途：在开工前用最小请求验证讯飞各接口的连通性、鉴权与服务授权状态。
密钥从本地 docs/讯飞接口配置.md 解析，**不写入本文件、不打印到输出**。

运行：python tools/probe_xfyun.py
输出：仅状态码 / header.code / message 摘要；绝不输出完整 URL、签名串、密钥或图片 base64。
"""
import base64
import hashlib
import hmac
import json
import os
import re
import socket
import ssl
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import zlib
from email.utils import formatdate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(ROOT, "docs", "讯飞接口配置.md")

MAAS_URL = "https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions"
OCR_HOST = "cbm01.cn-huabei-1.xf-yun.com"
OCR_PATH = "/v1/private/se75ocrbm"
IAT_HOST, IAT_PATH = "iat.cn-huabei-1.xf-yun.com", "/v1"
TTS_HOST, TTS_PATH = "cbm01.cn-huabei-1.xf-yun.com", "/v1/private/mcd9m97e6"


def load_creds():
    with open(DOC, "r", encoding="utf-8") as f:
        text = f.read()

    def field(label):
        m = re.search(r"\|\s*" + re.escape(label) + r"\s*\|\s*`([^`]+)`", text)
        if not m:
            raise RuntimeError("文档中未找到字段: " + label)
        return m.group(1).strip()

    m = re.search(r"Authorization:\s*Bearer\s+(ak-[0-9a-zA-Z]+)", text)
    if not m:
        raise RuntimeError("文档中未找到 MaaS API Key")
    return {
        "maas": m.group(1),
        "appid": field("APPID"),
        "secret": field("APISecret"),
        "key": field("APIKey"),
    }


def auth_query(path, method, sign_host, api_key, api_secret):
    date = formatdate(usegmt=True)
    origin = "host: {}\ndate: {}\n{} {} HTTP/1.1".format(sign_host, date, method, path)
    sig = base64.b64encode(
        hmac.new(api_secret.encode(), origin.encode(), hashlib.sha256).digest()
    ).decode()
    auth_origin = (
        'api_key="{}", algorithm="hmac-sha256", '
        'headers="host date request-line", signature="{}"'
    ).format(api_key, sig)
    auth = base64.b64encode(auth_origin.encode()).decode()
    return urllib.parse.urlencode({"host": sign_host, "date": date, "authorization": auth})


def brief(body, limit=400):
    try:
        obj = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return body.decode("utf-8", "replace")[:limit].replace("\n", " ")
    out = {}
    if isinstance(obj, dict):
        if "header" in obj and isinstance(obj["header"], dict):
            h = obj["header"]
            out = {k: h.get(k) for k in ("code", "message", "sid") if k in h}
        for k in ("code", "message", "error", "choices"):
            if k in obj and k not in out:
                if k == "choices":
                    out[k] = "有返回" if obj[k] else "空"
                else:
                    out[k] = obj[k]
    return json.dumps(out, ensure_ascii=False)[:limit] if out else json.dumps(obj, ensure_ascii=False)[:limit]


def http_post(url, payload, headers, timeout=30):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return -1, str(type(e).__name__).encode()


def tiny_png():
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff")) + chunk(b"IEND", b"")


def probe_maas(c):
    body = {"model": "spark-x2.6", "messages": [{"role": "user", "content": "回复OK两个字"}], "stream": False, "max_tokens": 16}
    code, resp = http_post(MAAS_URL, body, {"Authorization": "Bearer " + c["maas"]})
    print("[MaaS Spark X2.6] HTTP {} | {}".format(code, brief(resp)))
    return code


def probe_ocr(c, sign_host, image_b64):
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
    code, resp = http_post(url, body, {})
    print("[OCR sign_host={}] HTTP {} | {}".format(sign_host, code, brief(resp)))
    return code, resp


def probe_wss(c, host, path, label):
    q = auth_query(path, "GET", host, c["key"], c["secret"])
    target = "{}?{}".format(path, q)
    ws_key = base64.b64encode(os.urandom(16)).decode()
    req = (
        "GET {} HTTP/1.1\r\nHost: {}\r\nUpgrade: websocket\r\n"
        "Connection: Upgrade\r\nSec-WebSocket-Key: {}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ).format(target, host, ws_key)
    try:
        raw = socket.create_connection((host, 443), timeout=15)
        s = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        s.settimeout(15)
        s.sendall(req.encode())
        head = s.recv(4096).decode("utf-8", "replace")
        line = head.split("\r\n", 1)[0]
        # 101 = 握手成功（签名通过）；4xx 会带原因，只取状态行
        print("[{}] {}".format(label, line))
        s.close()
        return line
    except Exception as e:
        print("[{}] 连接失败: {}".format(label, type(e).__name__))
        return ""


def main():
    c = load_creds()
    print("凭据读取：OK（不显示）\n")
    print("=== 1. MaaS 大模型 ===")
    probe_maas(c)
    print("\n=== 2. OCR 签名 host 二选一（发 1x1 白图，仅测鉴权）===")
    img = base64.b64encode(tiny_png()).decode()
    probe_ocr(c, "api.xf-yun.com", img)
    probe_ocr(c, OCR_HOST, img)
    print("\n=== 3. WebSocket 握手（仅看 HTTP 状态行，不发音频）===")
    probe_wss(c, IAT_HOST, IAT_PATH, "IAT 语音听写 V2.0")
    probe_wss(c, TTS_HOST, TTS_PATH, "TTS 超拟人合成")
    print("\n说明：101 Switching Protocols = 鉴权通过；401/403 = 签名或时钟问题；")
    print("      11200 = 该 APPID 下未添加此服务；10161/10222 = 已过鉴权、只是图片/参数问题。")


if __name__ == "__main__":
    sys.exit(main())
