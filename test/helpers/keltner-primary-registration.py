"""Anonymous primary capture; stores metadata facts only, never the Pine source."""
import hashlib
import json
import pathlib
import re
import ssl
import urllib.request

url = "https://pine-facade.tradingview.com/pine-facade/get/STD%3BKeltner_Channels/last"
context = ssl.create_default_context()
assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context)
)
with opener.open(url, timeout=25) as response:
    payload = json.load(response)
    status, date = response.status, response.headers.get("Date")
source = payload["source"]
plots, fills, inputs = [], [], []
for raw in source.splitlines():
    line = raw.strip()
    if re.match(r"(?:\w+\s*=\s*)?plot\(", line):
        title = re.search(r'title\s*=\s*"([^"]+)"', line)
        plots.append({"title": title.group(1) if title else None,
                      "colorTokens": re.findall(r"#[0-9a-fA-F]{6,8}|color\.[A-Za-z]+", line)})
    if line.startswith("fill("):
        title = re.search(r'title\s*=\s*"([^"]+)"', line)
        rgb = re.search(r"color\.rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)", line)
        fills.append({"title": title.group(1) if title else None,
                      "colorTokens": re.findall(r"#[0-9a-fA-F]{6,8}|color\.[A-Za-z]+", line),
                      "rgbaPine": [float(v) for v in rgb.groups()] if rgb else None})
    if re.match(r"\w+\s*=\s*input", line):
        title = re.search(r'title\s*=\s*"([^"]+)"', line)
        first = re.search(r'input(?:\.\w+)?\(\s*([^,)]+)', line).group(1).strip()
        default = json.loads(first) if first.startswith('"') or first in ("true", "false") or re.fullmatch(r'-?\d+(?:\.\d+)?', first) else first
        inputs.append({"variable": line.split("=", 1)[0].strip(),
                       "default": default,
                       "title": title.group(1) if title else None,
                       "strings": re.findall(r'"([^"]*)"', line),
                       "numbers": re.findall(r"(?<![\w#])\d+(?:\.\d+)?", line),
                       "trueToken": bool(re.search(r"\btrue\b", line))})
result = {"id": "STD;Keltner_Channels", "url": url, "version": payload.get("version"),
          "sha256": hashlib.sha256(source.encode()).hexdigest(), "status": status,
          "httpDate": date, "plots": plots, "fills": fills, "inputs": inputs,
          "tls": "Python default CERT_REQUIRED/check_hostname, no proxy, no insecure flags",
          "fullSourceSaved": False}
destination = pathlib.Path(__file__).resolve().parents[2] / "docs/KELTNER_PRIMARY_CAPTURE.json"
destination.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
