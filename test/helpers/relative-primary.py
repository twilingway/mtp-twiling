"""Verified anonymous capture of metadata facts, never source text."""
import hashlib
import json
import pathlib
import re
import ssl
import urllib.parse
import urllib.request

ids = ["STD;Stochastic_RSI", "STD;Relative_Vigor_Index", "STD;Relative_Volatility_Index",
       "STD;Coppock%1Curve", "STD;Bull%Bear%Power"]
context = ssl.create_default_context()
assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
rows = []
for public_id in ids:
    url = "https://pine-facade.tradingview.com/pine-facade/get/" + urllib.parse.quote(public_id, safe="") + "/last"
    with opener.open(url, timeout=25) as response:
        payload, status, date = json.load(response), response.status, response.headers.get("Date")
    source = payload["source"]
    inputs, plots, levels, calculations = [], [], [], []
    for raw in source.splitlines():
        line = raw.strip()
        if line.startswith("//") or not line:
            continue
        strings = re.findall(r'"([^"]*)"', line)
        if re.match(r"\w+\s*=\s*input", line):
            named = re.search(r'defval\s*=\s*("[^"]*"|[^,)]+)', line)
            first = (named.group(1) if named else re.search(r'input(?:\.\w+)?\(\s*([^,)]+)', line).group(1)).strip()
            default = json.loads(first) if first.startswith('"') or first in ("true", "false") or re.fullmatch(r'-?\d+(?:\.\d+)?', first) else first
            inputs.append({"variable": line.split("=", 1)[0].strip(), "default": default, "strings": strings,
                           "min": re.findall(r"minval\s*=\s*([-\d.]+)", line), "max": re.findall(r"maxval\s*=\s*([-\d.]+)", line)})
        if re.match(r"(?:\w+\s*=\s*)?plot\(", line):
            title = re.search(r'title\s*=\s*"([^"]+)"', line)
            first = re.search(r"plot\(([^,]+)", line).group(1)
            plots.append({"title": title.group(1) if title else strings[0] if strings else None,
                          "seriesNames": re.findall(r"\b[A-Za-z_][\w]*\b", first),
                          "masked": "?" in first, "offset": re.findall(r"offset\s*=\s*([-\w.]+)", line),
                          "colorTokens": re.findall(r"#[0-9a-fA-F]{6,8}|color\.[A-Za-z]+", line),
                          "colorComparison": re.findall(r"color\s*=\s*(\w+)\s*(>=|<=|>|<|==)\s*(-?[\d.]+)", line),
                          "style": re.findall(r"plot\.style_\w+", line)})
        if "hline(" in line:
            levels.extend(re.findall(r"hline\(\s*(-?[\d.]+)", line))
        target = re.match(r"([\w]+)\s*=\s*(.*)", line)
        if target and not any(word in target.group(2) for word in ["input", "plot(", "hline("]):
            rhs = re.sub(r'"[^\"]*"', '""', target.group(2))
            calculations.append({"target": target.group(1), "calls": re.findall(r"(?:ta|math)\.\w+", rhs),
                                 "references": re.findall(r"\b[A-Za-z_][\w]*\b", rhs),
                                 "operators": re.findall(r">=|<=|==|!=|[+*/?:><-]", rhs),
                                 "numbers": re.findall(r"(?<![\w#])\d+(?:\.\d+)?", rhs),
                                 "colors": re.findall(r"#[0-9a-fA-F]{6,8}", line)})
    header = re.search(r'\bindicator\((.*?)\)\s*\n', source, re.S)
    declaration = header.group(1) if header else ""
    row = {"id": public_id, "url": url, "version": payload.get("version"),
           "pineVersion": re.findall(r'//@version=(\d+)', source),
           "headerFacts": {"strings": re.findall(r'"([^"]*)"', declaration),
                           "format": re.findall(r'format\s*=\s*format\.(\w+)', declaration),
                           "precision": re.findall(r'precision\s*=\s*(\d+)', declaration),
                           "overlay": re.findall(r'overlay\s*=\s*(true|false)', declaration),
                           "timeframeGaps": re.findall(r'timeframe_gaps\s*=\s*(true|false)', declaration)},
           "sha256": hashlib.sha256(source.encode()).hexdigest(), "status": status, "httpDate": date,
           "inputs": inputs, "plots": plots, "levels": levels,
           "tls": "Python default CERT_REQUIRED/check_hostname; no proxy/insecure flags", "fullSourceSaved": False}
    rows.append(row)
    print(json.dumps({**row, "calculationFacts": calculations}))
destination = pathlib.Path(__file__).resolve().parents[2] / "docs/RELATIVE_OSCILLATORS_PRIMARY_CAPTURE.json"
destination.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
