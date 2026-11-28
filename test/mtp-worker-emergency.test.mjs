import test from "node:test";
import assert from "node:assert/strict";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const { MtpModel, MTP_COMBINED_PERIODS } = load("model/mtp.js");
const { MtpEmergencyPreview, MTP_EMERGENCY_POINT_LIMIT, MTP_EMERGENCY_VERTEX_LIMIT } = load(
  "model/mtp-worker-emergency.js"
);

function fixture(length = 5425, periods = MTP_COMBINED_PERIODS) {
  const model = new MtpModel();
  model.reset(
    Array.from({ length }, (_, i) => ({
      timestamp: i * 3600000,
      close: 100 + Math.sin(i / 17) * 20 + i / 500
    })),
    MTP_COMBINED_PERIODS
  );
  model.periods = periods;
  model.styles = { mtpAll: { color: "#a1b2c3", width: 2.5, opacity: 0.37 } };
  model.styleKey = "mtpAll";
  const calls = { sma: 0, x: 0, y: 0, forbidden: 0 },
    lines = [];
  const forbidden = () => {
    calls.forbidden++;
    throw new Error("unbounded path forbidden");
  };
  model.draw = model.extrema = forbidden;
  model.prefix.every = model.prefix.subarray = model.prefix.slice = forbidden;
  const sma = model.sma.bind(model);
  model.sma = (...args) => {
    calls.sma++;
    return sma(...args);
  };
  const context = {
    lineCap: "round",
    lineJoin: "bevel",
    miterLimit: 7,
    shadowColor: "rgba(0,0,0,0)",
    globalCompositeOperation: "source-over",
    filter: "none",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() {},
    restore() {},
    setLineDash(value) {
      assert.deepEqual(value, []);
    },
    beginPath() {
      lines.push({
        color: this.strokeStyle,
        width: this.lineWidth,
        opacity: this.globalAlpha,
        cap: this.lineCap,
        join: this.lineJoin,
        points: []
      });
    },
    moveTo(x, y) {
      lines.at(-1).points.push(["move", x, y]);
    },
    lineTo(x, y) {
      lines.at(-1).points.push(["line", x, y]);
    },
    stroke() {}
  };
  const frame = {
    model,
    from: 2300,
    to: 2700,
    mode: 0,
    uniformX: "lightweight",
    scope: {
      context,
      bitmapSize: { width: 1000, height: 600 },
      horizontalPixelRatio: 1.25,
      verticalPixelRatio: 2.5
    },
    xFor(index) {
      calls.x++;
      return index * 0.5 + 7;
    },
    yFor(price) {
      calls.y++;
      return 300 - price * 2;
    },
    paint: forbidden
  };
  return { frame, model, calls, lines };
}

test("coarse preview has a history-independent total budget and uses real SMA/style/DPR coordinates", () => {
  for (const length of [5425, 100000]) {
    const f = fixture(length);
    if (length > 5425) {
      f.frame.from = 0;
      f.frame.to = length - 1;
    }
    let clock = 0;
    const preview = new MtpEmergencyPreview(() => ++clock);
    assert.equal(preview.draw(f.frame), true);
    assert.ok(f.calls.sma <= MTP_EMERGENCY_VERTEX_LIMIT);
    assert.ok(f.calls.x <= MTP_EMERGENCY_VERTEX_LIMIT);
    assert.equal(f.calls.y, 3);
    assert.equal(f.calls.forbidden, 0);
    assert.equal(f.lines.length, MTP_COMBINED_PERIODS.length);
    for (let line = 0; line < f.lines.length; line++) {
      const path = f.lines[line],
        period = MTP_COMBINED_PERIODS[line];
      assert.ok(path.points.length <= MTP_EMERGENCY_POINT_LIMIT);
      assert.deepEqual(
        [path.color, path.width, path.opacity, path.cap, path.join],
        ["#a1b2c3", 2.5, 0.37, "round", "bevel"]
      );
      for (const [, x, y] of path.points) {
        const index = (x - 7) * 2;
        assert.ok(Number.isInteger(index) && index >= period - 1 && index < length);
        const realMean =
          f.model.data
            .slice(index + 1 - period, index + 1)
            .reduce((sum, item) => sum + item.close, 0) / period;
        assert.ok(Math.abs(y - (300 - realMean * 2)) < 1e-7);
      }
    }
    const stats = preview.status();
    assert.equal(stats.attempts, 1);
    assert.equal(stats.paints, 1);
    assert.ok(stats.vertices <= MTP_EMERGENCY_VERTEX_LIMIT);
    assert.equal(stats.timeMs, 1);
    assert.equal(stats.maxMs, 1, "the diagnostic clock wraps preparation and painting");
  }
});

test("the total cap also bounds many periods, and excessive period counts reject before SMA work", () => {
  const f = fixture(
    5425,
    Array.from({ length: 2048 }, (_, i) => i + 1)
  );
  const preview = new MtpEmergencyPreview();
  assert.equal(preview.draw(f.frame), true);
  assert.equal(f.calls.sma, MTP_EMERGENCY_VERTEX_LIMIT);
  assert.equal(preview.status().lastVertices, MTP_EMERGENCY_VERTEX_LIMIT);
  f.model.periods = Array.from({ length: 2049 }, (_, i) => i + 1);
  const before = f.calls.sma;
  assert.equal(preview.draw(f.frame), false);
  assert.equal(f.calls.sma, before);
});

test("sampled null/nonfinite X and SMA gaps restart paths instead of joining across them", () => {
  const f = fixture();
  const count = Math.min(32, Math.floor(4096 / f.model.periods.length));
  const start = 2299,
    end = 2701;
  const gapX = start + Math.floor((5 * (end - start)) / (count - 1));
  const gapValue = start + Math.floor((10 * (end - start)) / (count - 1));
  f.frame.xFor = (index) => (index === gapX ? null : index * 0.5 + 7);
  const sma = f.model.sma;
  f.model.sma = (index, period) => (index === gapValue ? NaN : sma(index, period));
  const preview = new MtpEmergencyPreview();
  assert.equal(preview.draw(f.frame), true);
  for (const path of f.lines) {
    assert.equal(path.points.filter((point) => point[0] === "move").length, 3);
    assert.ok(
      path.points.every(
        ([, x, y]) => Number.isFinite(x) && Number.isFinite(y) && (x - 7) * 2 !== gapX
      )
    );
  }
});

test("unsafe modes, contexts, nonfinite or nonlinear Y never paint emergency geometry", () => {
  for (const change of [
    (frame) => {
      frame.mode = 1;
    },
    (frame) => {
      frame.mode = undefined;
    },
    (frame) => {
      delete frame.uniformX;
    },
    (frame) => {
      frame.scope.context.filter = "blur(1px)";
    },
    (frame) => {
      frame.scope.context.shadowOffsetX = 1;
    },
    (frame) => {
      frame.scope.verticalPixelRatio = 0;
    },
    (frame) => {
      frame.yFor = (price) => price * price;
    },
    (frame) => {
      frame.yFor = () => null;
    },
    (frame) => {
      frame.yFor = () => NaN;
    }
  ]) {
    const f = fixture();
    change(f.frame);
    const preview = new MtpEmergencyPreview();
    assert.equal(preview.draw(f.frame), false);
    assert.equal(f.lines.length, 0);
    assert.equal(preview.status().paints, 0);
    assert.equal(f.calls.forbidden, 0);
  }
});

test("updates, reset, in-place style changes, view changes and cancellation during preparation paint nothing stale", () => {
  for (const kind of ["update", "reset", "style", "view", "cancel", "owner"]) {
    const f = fixture(),
      preview = new MtpEmergencyPreview();
    const project = f.frame.yFor;
    let changed = false;
    f.frame.yFor = (price) => {
      if (!changed) {
        changed = true;
        if (kind === "update") f.model.revision++;
        if (kind === "reset") f.model.resetRevision++;
        if (kind === "style") f.model.styles.mtpAll.width = 8;
        if (kind === "view") f.frame.mode = 1;
        if (kind === "cancel") preview.cancel();
        if (kind === "owner") f.frame.model = new MtpModel();
      }
      return project(price);
    };
    assert.equal(preview.draw(f.frame), false, kind);
    assert.equal(f.lines.length, 0, kind);
    assert.equal(preview.status().paints, 0);
    assert.ok(f.calls.sma <= MTP_EMERGENCY_VERTEX_LIMIT);
    if (kind === "cancel") assert.equal(preview.status().cancelled, 1);
  }
});
