"""Verified metadata-only probe of pinned official reference payloads; no source is saved."""
import hashlib
import json
import pathlib
import ssl
import urllib.request

context = ssl.create_default_context()
assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
filenames = ["11967.f052e1615089996eccf6.js", "en.66605.a376644de8252d21909b.js", "en.41280.e2a0384c9e88f1dd1d95.js"]
payloads, witnesses = [], []
for filename in filenames:
    url = "https://www.tradingview.com/static/bundles/" + filename
    with opener.open(url, timeout=30) as response:
        payload = response.read()
    payloads.append(payload.decode())
    witnesses.append({"url": url, "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload),
                      "tls": "Python default CERT_REQUIRED/check_hostname; no proxy/insecure flags", "fullPayloadSaved": False})
function, english_a, english_b = payloads
facts = {
    "stochFormulaTranslationId": 91823,
    "stochHighestLowestIgnoreNaTranslationId": 221157,
    "swmaFixed4WeightsTranslationId": 98752,
    "swmaNaPropagationTranslationId": 472349,
    "stdevDefaultBiasedTrueTranslationId": 413143,
    "stdevPopulationTranslationId": 322213,
    "stdevSumEmaRmaKnownObservationNaTranslationId": 309834,
    "emaFirstSourceSeedExamplePresent": 'na(sum[1]) ? src' in function,
    "rmaSmaSeedExamplePresent": 'na(sum[1]) ? ta.sma(src, length)' in function,
    "stdevPopulationDivisorExamplePresent": 'sumOfSquareDeviations / length' in function,
    "highestStartupExplicitlyResolved": False,
    "pineExecutionPerformed": False
}
for key in [221157, 472349, 413143, 322213, 309834]:
    assert str(key) + "(" in english_a
for key in [91823, 98752]:
    assert str(key) + "(" in english_b
for key in ["emaFirstSourceSeedExamplePresent", "rmaSmaSeedExamplePresent", "stdevPopulationDivisorExamplePresent"]:
    assert facts[key]
destination = pathlib.Path(__file__).resolve().parents[2] / "docs/RELATIVE_OSCILLATORS_REFERENCE_CAPTURE.json"
destination.write_text(json.dumps({"payloads": witnesses, "facts": facts}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"payloads": witnesses, "facts": facts}))
