# -*- coding: utf-8 -*-
"""
P0 联调用的签名参考实现（本机代理），**正式 APK 不使用**。

用户已选方案 C：密钥随 APK 打包、App 端自行签名直连讯飞，不依赖电脑/服务器/云账号。
本文件保留的价值是：其中的 auth_query() 已用真实接口验证过，是
src/api/xfyun-sign.ts 的等价参考实现；也可在排查签名问题时本地跑起来对照。
方案 C 的落地细则见 docs/开发方案.md 第 11 节。

运行：
    python tools/proxy.py                 # 监听 0.0.0.0:8787
    python tools/proxy.py --port 8788
    python tools/proxy.py --selftest     # 本机自测后退出

接口（客户端只连这里）：
    GET  /health                  健康检查
    POST /ocr        {image: "<base64>", ...}        → 转发 OCR，返回原样响应
    POST /maas       {OpenAI 兼容请求体}              → 转发 Spark X2.6
    GET  /wss-url?service=iat|tts                   → 返回短时效的带签名 WSS URL

安全：密钥从 docs/讯飞接口配置.md 读取，不写入本文件；日志不打印查询串、
签名、Authorization 或请求体。
"""
import argparse
import json
import os
import socket
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from probe_xfyun import (
    IAT_HOST, IAT_PATH, MAAS_URL, OCR_HOST, OCR_PATH, TTS_HOST, TTS_PATH,
    auth_query, load_creds,
)

CREDS = None
OCR_SIGN_HOST = OCR_HOST  # 实测 api.xf-yun.com 与 cbm01 均可，默认与实际请求域名一致


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def forward(url, payload, headers, timeout=120):
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
        return 502, json.dumps({"error": type(e).__name__}).encode()


class Handler(BaseHTTPRequestHandler):
    server_version = "XfProxy/0.1"

    def log_message(self, fmt, *args):
        # 默认实现会打印含查询参数的完整 URL，这里只保留方法 + 路径
        try:
            path = str(args[0]).split(" ", 2)[1].split("?", 1)[0]
            sys.stderr.write("  {} {}\n".format(self.command, path))
        except Exception:
            sys.stderr.write("  request\n")

    def _send(self, status, body, content_type="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            return self._send(200, {"ok": True, "scope": "dev-only"})
        if parsed.path == "/wss-url":
            service = urllib.parse.parse_qs(parsed.query).get("service", [""])[0]
            table = {"iat": (IAT_HOST, IAT_PATH), "tts": (TTS_HOST, TTS_PATH)}
            if service not in table:
                return self._send(400, {"error": "service 需为 iat 或 tts"})
            host, path = table[service]
            q = auth_query(path, "GET", host, CREDS["key"], CREDS["secret"])
            # 短时效签名 URL 交给客户端直连讯飞 WSS；APISecret 本身不出本机
            return self._send(200, {"url": "wss://{}{}?{}".format(host, path, q)})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._send(400, {"error": "invalid JSON"})

        if parsed.path == "/ocr":
            image = body.pop("image", "")
            if not image:
                return self._send(400, {"error": "缺少 image(base64)"})
            q = auth_query(OCR_PATH, "POST", OCR_SIGN_HOST, CREDS["key"], CREDS["secret"])
            url = "https://{}{}?{}".format(OCR_HOST, OCR_PATH, q)
            payload = {
                "header": {"app_id": CREDS["appid"], "status": 0},
                "parameter": {"ocr": {
                    "result_option": "normal",
                    "result_format": "json,markdown",
                    "output_type": "one_shot",
                    "rotation_min_angle": 5,
                    "result": {"encoding": "utf8", "compress": "raw", "format": "plain"},
                    **body.pop("ocr_options", {}),
                }},
                "payload": {"image": {
                    "encoding": body.pop("encoding", "jpg"),
                    "image": image, "status": 0, "seq": 0,
                }},
            }
            status, resp = forward(url, payload, {})
            return self._send(status, resp)

        if parsed.path == "/maas":
            body.setdefault("model", "spark-x2.6")
            body.setdefault("stream", False)
            status, resp = forward(
                MAAS_URL, body, {"Authorization": "Bearer " + CREDS["maas"]}
            )
            return self._send(status, resp)

        return self._send(404, {"error": "not found"})


def selftest(port):
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    base = "http://127.0.0.1:{}".format(port)
    try:
        for path in ("/health", "/wss-url?service=iat", "/wss-url?service=tts"):
            with urllib.request.urlopen(base + path, timeout=10) as r:
                out = json.loads(r.read())
                # 签名 URL 属敏感信息，自测只显示是否拿到，不打印内容
                shown = out if "url" not in out else {"url": "<已生成，长度 {}>".format(len(out["url"]))}
                print("GET  {} -> {} {}".format(path.split("?")[0], r.status, shown))
        req = urllib.request.Request(
            base + "/maas",
            data=json.dumps({"messages": [{"role": "user", "content": "回复OK"}], "max_tokens": 8}).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            obj = json.loads(r.read())
            ok = bool(obj.get("choices"))
            print("POST /maas -> {} 转发{}".format(r.status, "成功" if ok else "异常"))
        print("\n自测通过。正式启动：python tools/proxy.py")
    finally:
        srv.shutdown()
        srv.server_close()


def main():
    global CREDS
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    CREDS = load_creds()
    if args.selftest:
        return selftest(args.port)
    print("凭据读取：OK（不显示）")
    print("开发期签名代理监听 0.0.0.0:{}".format(args.port))
    print("手机与电脑同一 WiFi 时，PROXY_BASE_URL=http://{}:{}".format(lan_ip(), args.port))
    print("仅用于开发调试；Ctrl+C 停止。\n")
    try:
        ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
