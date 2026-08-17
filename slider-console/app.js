(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    connectBtn: $("connectBtn"), demoBtn: $("demoBtn"), connectionDot: $("connectionDot"), connectionText: $("connectionText"), connectionMode: $("connectionMode"), serialPort: $("serialPortSelect"), wifiUrl: $("wifiUrlInput"), portText: $("portText"), stateBadge: $("stateBadge"),
    position: $("positionMetric"), speed: $("speedMetric"), force: $("forceMetric"), mu: $("muMetric"), muK: $("muKMetric"), muS: $("muSMetric"), calState: $("calState"),
    mass: $("massInput"), window: $("windowInput"), forceChart: $("forceChart"), motionChart: $("motionChart"), forceRange: $("forceRange"), sampleRate: $("sampleRate"), forceUnitMetric: $("forceUnitMetric"), forceChartLabel: $("forceChartLabel"),
    recordBtn: $("recordBtn"), recordState: $("recordState"), exportBtn: $("exportBtn"), clearBtn: $("clearBtn"), clearLogBtn: $("clearLogBtn"), logBox: $("logBox"),
    sampleCount: $("sampleCount"), steadyCount: $("steadyCount"), lineCount: $("lineCount"), runNote: $("runNote"), calBtn: $("calBtn"), homeBtn: $("homeBtn"),
    stepsPerMm: $("stepsPerMm"), rawCommand: $("rawCommand"), sendRawBtn: $("sendRawBtn"), distance: $("distanceInput"),
    directionPositive: $("directionPositive"), directionNegative: $("directionNegative"), directionJogBtn: $("directionJogBtn"), directionRunBtn: $("directionRunBtn"), motionCommandPreview: $("motionCommandPreview"),
    sensorDataState: $("sensorDataState"), sensorStabilityState: $("sensorStabilityState"), calMass: $("calMassInput"), tareBtn: $("tareBtn"), calScale: $("calScaleValue"), calKnownForce: $("calKnownForce"),
    forceUnitSelect: $("forceUnitSelect"), filterModeSelect: $("filterModeSelect"), filterWindow: $("filterWindowInput"), statsWindow: $("statsWindowInput"), stabilityThreshold: $("stabilityThresholdInput"), overloadThreshold: $("overloadThresholdInput"), invertForce: $("invertForceInput"),
    sensorRawForce: $("sensorRawForce"), sensorProcessedForce: $("sensorProcessedForce"), sensorMeanForce: $("sensorMeanForce"), sensorStdForce: $("sensorStdForce"), sensorPeakToPeak: $("sensorPeakToPeak"), sensorMinMax: $("sensorMinMax"), sensorSampleRate: $("sensorSampleRate"), sensorLocalZero: $("sensorLocalZero"), sensorAlarmText: $("sensorAlarmText"),
    captureForceBtn: $("captureForceBtn"), freezeSensorBtn: $("freezeSensorBtn"), localZeroBtn: $("localZeroBtn"), clearLocalZeroBtn: $("clearLocalZeroBtn"), resetSensorStatsBtn: $("resetSensorStatsBtn"), clearSnapshotsBtn: $("clearSnapshotsBtn"), sensorSnapshotBody: $("sensorSnapshotBody")
  };

  const state = {
    port: null, reader: null, writer: null, readBuffer: "", connected: false, transport: "serial", wifiBaseUrl: "http://192.168.4.1", wifiTimer: null, wifiSeq: 0, wifiErrorShown: false, demo: false, demoTimer: null,
    samples: [], recordRows: [], recording: false, steadyForces: [], peakForce: null, lastDeviceMs: null, rateTimes: [], currentState: "IDLE", lineCount: 0, motionDirection: 1,
    sensor: { unit: "N", filterMode: "mean", filterWindow: 5, statsWindowSec: 2, stabilityThresholdN: 0.01, overloadThresholdN: 0, invert: false, localZeroN: 0, frozen: false, calibrated: false, scaleRawPerN: null, knownForceN: null, history: [], snapshots: [], latest: null, stats: null }
  };
  const encoder = new TextEncoder();

  function log(message, kind = "info") {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const prefix = kind === "tx" ? "> " : kind === "error" ? "! " : "  ";
    els.logBox.textContent += `${time}${prefix}${message}\n`;
    els.logBox.scrollTop = els.logBox.scrollHeight;
  }
  function setConnection(online, label = "未连接", port = "推荐 COM12 · 115200 8N1") {
    state.connected = online;
    els.connectionDot.className = `status-dot ${online ? "online" : "offline"}`;
    els.connectionText.textContent = label;
    els.portText.textContent = port;
    els.connectBtn.textContent = online ? "断开串口" : "连接串口";
  }
  function setBadge(value) {
    state.currentState = value || "IDLE";
    els.stateBadge.textContent = state.currentState;
    els.stateBadge.className = `badge ${state.currentState === "FAULT" ? "fault" : state.currentState === "RUNNING" || state.currentState === "HOMING" ? "running" : "idle"}`;
  }
  function numeric(value, digits = 3) { return Number.isFinite(value) ? value.toFixed(digits) : "--"; }
  function configuredDistance() {
    const value = Number(els.distance.value);
    return Number.isFinite(value) && value >= 0.1 && value <= 100 ? value : null;
  }
  function formatDistance(value) { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))); }
  function signedDistance(value) { return state.motionDirection * Math.abs(value); }
  function updateDirectionControls() {
    const reverse = state.motionDirection < 0;
    els.directionPositive.classList.toggle("active", !reverse);
    els.directionNegative.classList.toggle("active", reverse);
    els.directionPositive.setAttribute("aria-pressed", String(!reverse));
    els.directionNegative.setAttribute("aria-pressed", String(reverse));
    const directionText = reverse ? "反向" : "正向";
    const distance = configuredDistance();
    els.directionJogBtn.textContent = `${directionText}点动 2 mm`;
    els.directionRunBtn.textContent = distance === null ? `${directionText}运行` : `${directionText}运行 ${formatDistance(distance)} mm`;
    els.motionCommandPreview.textContent = distance === null ? "请输入 0.1–100 mm 的有效行程" : `即将执行：JOG ${formatDistance(signedDistance(distance))}`;
    els.motionCommandPreview.classList.toggle("reverse", reverse);
  }
  function setMotionDirection(direction) {
    state.motionDirection = Number(direction) < 0 ? -1 : 1;
    updateDirectionControls();
  }
  const GRAVITY = 9.80665;
  const SENSOR_SETTINGS_KEY = "iceFriction.sensorSettings.v1";
  function unitFactor(unit = state.sensor.unit) { return unit === "gf" ? 1000 / GRAVITY : unit === "kgf" ? 1 / GRAVITY : 1; }
  function unitDigits(unit = state.sensor.unit) { return unit === "gf" ? 2 : 4; }
  function displayForce(valueN) { return Number.isFinite(valueN) ? valueN * unitFactor() : null; }
  function forceText(valueN, digits = unitDigits()) { const value = displayForce(valueN); return Number.isFinite(value) ? value.toFixed(digits) : "--"; }
  function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
  function clamp(value, min, max, fallback) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; }
  function setCalibrationStatus(calibrated) {
    state.sensor.calibrated = Boolean(calibrated);
    els.calState.textContent = state.sensor.calibrated ? "已标定" : "未标定";
    els.calState.className = `badge ${state.sensor.calibrated ? "running" : "muted-badge"}`;
  }
  function updateForceUnits() {
    const unit = state.sensor.unit;
    els.forceUnitMetric.textContent = unit;
    els.forceChartLabel.textContent = `拉力 Ft / ${unit}`;
    ["sensorRawUnit", "sensorProcessedUnit", "sensorMeanUnit", "sensorStdUnit", "sensorPeakUnit", "sensorMinMaxUnit"].forEach((id) => { $(id).textContent = unit; });
  }
  function saveSensorSettings() {
    const settings = { unit: state.sensor.unit, filterMode: state.sensor.filterMode, filterWindow: state.sensor.filterWindow, statsWindowSec: state.sensor.statsWindowSec, stabilityThresholdN: state.sensor.stabilityThresholdN, overloadThresholdN: state.sensor.overloadThresholdN, invert: state.sensor.invert };
    try { localStorage.setItem(SENSOR_SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* storage may be unavailable */ }
  }
  function loadSensorSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SENSOR_SETTINGS_KEY) || "null");
      if (saved && typeof saved === "object") Object.assign(state.sensor, saved);
    } catch (_) { /* keep defaults */ }
    if (!["N", "gf", "kgf"].includes(state.sensor.unit)) state.sensor.unit = "N";
    if (!["raw", "mean", "median"].includes(state.sensor.filterMode)) state.sensor.filterMode = "mean";
    state.sensor.filterWindow = Math.round(clamp(Number(state.sensor.filterWindow), 1, 50, 5));
    state.sensor.statsWindowSec = clamp(Number(state.sensor.statsWindowSec), 0.5, 10, 2);
    state.sensor.stabilityThresholdN = clamp(Number(state.sensor.stabilityThresholdN), 0.001, 5, 0.01);
    state.sensor.overloadThresholdN = clamp(Number(state.sensor.overloadThresholdN), 0, 10000, 0);
    state.sensor.invert = Boolean(state.sensor.invert);
    els.forceUnitSelect.value = state.sensor.unit;
    els.filterModeSelect.value = state.sensor.filterMode;
    els.filterWindow.value = state.sensor.filterWindow;
    els.statsWindow.value = state.sensor.statsWindowSec;
    els.stabilityThreshold.value = state.sensor.stabilityThresholdN;
    els.overloadThreshold.value = state.sensor.overloadThresholdN;
    els.invertForce.checked = state.sensor.invert;
    updateForceUnits();
  }
  function syncSensorSettings() {
    const invertChanged = state.sensor.invert !== els.invertForce.checked;
    state.sensor.unit = els.forceUnitSelect.value;
    state.sensor.filterMode = els.filterModeSelect.value;
    state.sensor.filterWindow = Math.round(clamp(Number(els.filterWindow.value), 1, 50, 5));
    state.sensor.statsWindowSec = clamp(Number(els.statsWindow.value), 0.5, 10, 2);
    state.sensor.stabilityThresholdN = clamp(Number(els.stabilityThreshold.value), 0.001, 5, 0.01);
    state.sensor.overloadThresholdN = clamp(Number(els.overloadThreshold.value), 0, 10000, 0);
    state.sensor.invert = els.invertForce.checked;
    if (invertChanged) { state.sensor.localZeroN = 0; state.sensor.history = []; }
    saveSensorSettings();
    updateForceUnits();
    refreshSensorPresentation();
    renderSensorSnapshots();
    drawCharts();
  }
  function resetSensorHistory() {
    state.sensor.history = [];
    state.sensor.stats = null;
    state.sensor.latest = null;
    refreshSensorPresentation();
  }
  function processSensorForce(rawForceN, deviceMs) {
    const signedRawN = (state.sensor.invert ? -1 : 1) * rawForceN;
    const correctedN = signedRawN - state.sensor.localZeroN;
    const history = state.sensor.history;
    if (history.length && deviceMs < history[history.length - 1].deviceMs) history.length = 0;
    history.push({ deviceMs, rawForceN, correctedN });
    if (history.length > 1000) history.splice(0, history.length - 1000);

    const filterValues = history.slice(-state.sensor.filterWindow).map((entry) => entry.correctedN);
    let processedN = correctedN;
    if (state.sensor.filterMode === "mean") processedN = filterValues.reduce((sum, value) => sum + value, 0) / filterValues.length;
    else if (state.sensor.filterMode === "median") processedN = median(filterValues);

    const cutoff = deviceMs - state.sensor.statsWindowSec * 1000;
    const statsValues = history.filter((entry) => entry.deviceMs >= cutoff).map((entry) => entry.correctedN);
    const meanN = statsValues.reduce((sum, value) => sum + value, 0) / statsValues.length;
    const variance = statsValues.reduce((sum, value) => sum + (value - meanN) ** 2, 0) / statsValues.length;
    const stdN = Math.sqrt(variance);
    const minN = Math.min(...statsValues);
    const maxN = Math.max(...statsValues);
    const stable = statsValues.length >= 5 && stdN <= state.sensor.stabilityThresholdN;
    const overloaded = state.sensor.overloadThresholdN > 0 && Math.abs(processedN) >= state.sensor.overloadThresholdN;
    state.sensor.stats = { meanN, stdN, minN, maxN, peakToPeakN: maxN - minN, stable, overloaded, count: statsValues.length };
    state.sensor.latest = { rawForceN, signedRawN, correctedN, processedN, deviceMs };
    return { rawForceN, force: processedN, correctedForceN: correctedN, sensorStable: stable, sensorStdN: stdN };
  }
  function refreshSensorPresentation() {
    const latest = state.sensor.latest;
    const stats = state.sensor.stats;
    els.sensorLocalZero.textContent = `${state.sensor.localZeroN.toFixed(4)} N`;
    if (!latest || !stats) {
      [els.sensorRawForce, els.sensorProcessedForce, els.sensorMeanForce, els.sensorStdForce, els.sensorPeakToPeak, els.sensorMinMax].forEach((element) => { element.textContent = "--"; });
      els.sensorStabilityState.textContent = "待判断";
      els.sensorStabilityState.className = "badge muted-badge";
      els.sensorAlarmText.textContent = state.sensor.overloadThresholdN > 0 ? `阈值 ${state.sensor.overloadThresholdN.toFixed(2)} N` : "过载监测关闭";
      els.sensorAlarmText.className = "";
      return;
    }
    if (!state.sensor.frozen) {
      els.sensorRawForce.textContent = forceText(latest.rawForceN);
      els.sensorProcessedForce.textContent = forceText(latest.processedN);
      els.sensorMeanForce.textContent = forceText(stats.meanN);
      els.sensorStdForce.textContent = forceText(stats.stdN);
      els.sensorPeakToPeak.textContent = forceText(stats.peakToPeakN);
      els.sensorMinMax.textContent = `${forceText(stats.minN)} / ${forceText(stats.maxN)}`;
    }
    els.sensorStabilityState.textContent = state.sensor.frozen ? "显示冻结" : stats.stable ? "稳定" : "波动";
    els.sensorStabilityState.className = `badge ${state.sensor.frozen ? "muted-badge" : stats.stable ? "running" : "idle"}`;
    els.sensorAlarmText.textContent = stats.overloaded ? "超过设定阈值" : state.sensor.overloadThresholdN > 0 ? `阈值 ${state.sensor.overloadThresholdN.toFixed(2)} N` : "过载监测关闭";
    els.sensorAlarmText.className = stats.overloaded ? "alarm" : "";
  }
  function massKg() { return Math.max(0, Number(els.mass.value) || 0) / 1000; }
  function calculateMu(force) { const m = massKg(); return Number.isFinite(force) && m > 0 ? force / (m * GRAVITY) : null; }
  function updateMetrics(sample) {
    els.position.textContent = numeric(sample.position);
    els.speed.textContent = numeric(Math.abs(sample.speed));
    if (!state.sensor.frozen) els.force.textContent = forceText(sample.force);
    const mu = calculateMu(sample.force);
    if (!state.sensor.frozen) els.mu.textContent = numeric(mu, 4);
    if (sample.force !== null) {
      state.peakForce = state.peakForce === null ? sample.force : Math.max(state.peakForce, sample.force);
      if (sample.steady) state.steadyForces.push(sample.force);
    }
    const mean = state.steadyForces.length ? state.steadyForces.reduce((a, b) => a + b, 0) / state.steadyForces.length : null;
    els.muK.textContent = numeric(calculateMu(mean), 4);
    els.muS.textContent = numeric(calculateMu(state.peakForce), 4);
    refreshSensorPresentation();
  }
  function parseData(parts, raw) {
    if (parts.length < 7) return;
    const forceText = String(parts[4]);
    const rawForceN = forceText.toLowerCase() === "nan" ? null : Number(forceText);
    const processed = Number.isFinite(rawForceN) ? processSensorForce(rawForceN, Number(parts[1])) : { rawForceN: null, force: null, correctedForceN: null, sensorStable: false, sensorStdN: null };
    const sample = { deviceMs: Number(parts[1]), position: Number(parts[2]), speed: Number(parts[3]), ...processed, steady: String(parts[5]) === "1", state: String(parts[6] || "IDLE"), pcTime: new Date().toISOString(), raw };
    if (!Number.isFinite(sample.position) || !Number.isFinite(sample.speed)) return;
    els.sensorDataState.textContent = sample.force === null ? "无有效力值" : "数据有效";
    els.sensorDataState.className = `badge ${sample.force === null ? "muted-badge" : "running"}`;
    state.samples.push(sample);
    const windowMs = (Math.max(10, Number(els.window.value) || 60)) * 1000;
    const newest = sample.deviceMs;
    state.samples = state.samples.filter((item) => newest - item.deviceMs <= windowMs);
    if (state.recording) state.recordRows.push({ ...sample, massG: Number(els.mass.value) || 0, mu: calculateMu(sample.force), localZeroN: state.sensor.localZeroN, filterMode: state.sensor.filterMode, filterWindow: state.sensor.filterWindow, invertForce: state.sensor.invert, statsWindowSec: state.sensor.statsWindowSec, stabilityThresholdN: state.sensor.stabilityThresholdN, note: els.runNote.value });
    updateMetrics(sample);
    setBadge(sample.state);
    if (state.lastDeviceMs !== null && sample.deviceMs > state.lastDeviceMs) {
      state.rateTimes.push(performance.now());
      state.rateTimes = state.rateTimes.filter((t) => performance.now() - t < 2000);
      const rate = state.rateTimes.length / 2;
      els.sampleRate.textContent = `${rate.toFixed(1)} Hz`;
      els.sensorSampleRate.textContent = `${rate.toFixed(1)} Hz`;
    }
    state.lastDeviceMs = sample.deviceMs;
    refreshCounters();
    drawCharts();
  }
  function handleLine(raw) {
    const line = raw.trim();
    if (!line) return;
    state.lineCount += 1;
    els.lineCount.textContent = state.lineCount;
    if (line.startsWith("DATA,")) parseData(line.split(","), line);
    else if (line.startsWith("STATUS,")) parseStatus(line);
    else {
      log(line, line.startsWith("ERR,") || line.startsWith("FAULT,") ? "error" : "info");
      if (line.startsWith("FAULT,")) setBadge("FAULT");
      if (line.startsWith("OK,TARE")) {
        setCalibrationStatus(false); state.sensor.scaleRawPerN = null; state.sensor.knownForceN = null; els.calScale.textContent = "-- raw/N"; els.calKnownForce.textContent = "-- N"; resetSensorHistory();
      }
      if (line.startsWith("OK,CAL")) {
        const scaleMatch = line.match(/scale_raw_per_N=([-+\d.eE]+)/);
        const forceMatch = line.match(/known_N=([-+\d.eE]+)/);
        state.sensor.scaleRawPerN = scaleMatch ? Number(scaleMatch[1]) : null;
        state.sensor.knownForceN = forceMatch ? Number(forceMatch[1]) : null;
        els.calScale.textContent = Number.isFinite(state.sensor.scaleRawPerN) ? `${state.sensor.scaleRawPerN.toFixed(3)} raw/N` : "已由固件设置";
        els.calKnownForce.textContent = Number.isFinite(state.sensor.knownForceN) ? `${state.sensor.knownForceN.toFixed(4)} N` : "-- N";
        setCalibrationStatus(true);
      }
      if (line.includes("HX711_NOT_READY")) { els.sensorDataState.textContent = "HX711 未就绪"; els.sensorDataState.className = "badge fault"; }
    }
  }
  function parseStatus(line) {
    const values = {};
    line.slice(7).split(",").forEach((pair) => { const [key, ...rest] = pair.split("="); if (key) values[key] = rest.join("="); });
    if (values.state) setBadge(values.state);
    if (values.pos_mm) els.position.textContent = numeric(Number(values.pos_mm));
    if (values.speed_mm_s) els.speed.textContent = numeric(Math.abs(Number(values.speed_mm_s)));
    if (values.target_mm_s) $("speedInput").value = Number(values.target_mm_s);
    if (values.distance_mm) { $("distanceInput").value = Number(values.distance_mm); updateDirectionControls(); }
    if (values.accel_mm_s2) $("accelInput").value = Number(values.accel_mm_s2);
    if (values.steps_per_mm) els.stepsPerMm.textContent = `${Number(values.steps_per_mm).toFixed(1)} step/mm`;
    if (values.cal !== undefined) setCalibrationStatus(values.cal === "1");
    updateSafety(values.limits_installed === "1", values.home === "1", values.far === "1", values.estop_installed === "1", values.estop === "1");
    log(line);
  }
  function processSerialChunk(text) {
    state.readBuffer += text;
    const lines = state.readBuffer.split(/\r?\n/);
    state.readBuffer = lines.pop() || "";
    lines.forEach(handleLine);
  }
  function updateSafety(limitsInstalled, homeActive, farActive, estopInstalled, estopActive) {
    $("homeLimit").textContent = limitsInstalled ? (homeActive ? "触发" : "未触发") : "未安装";
    $("farLimit").textContent = limitsInstalled ? (farActive ? "触发" : "未触发") : "未安装";
    $("estopState").textContent = estopInstalled ? (estopActive ? "触发" : "未触发") : "未安装";
  }
  function applyWifiStatus(status) {
    if (status.state) setBadge(status.state);
    if (Number.isFinite(Number(status.pos_mm))) els.position.textContent = numeric(Number(status.pos_mm));
    if (Number.isFinite(Number(status.speed_mm_s))) els.speed.textContent = numeric(Math.abs(Number(status.speed_mm_s)));
    if (status.target_mm_s !== undefined) $("speedInput").value = Number(status.target_mm_s);
    if (status.distance_mm !== undefined) { $("distanceInput").value = Number(status.distance_mm); updateDirectionControls(); }
    if (status.accel_mm_s2 !== undefined) $("accelInput").value = Number(status.accel_mm_s2);
    if (status.steps_per_mm !== undefined) els.stepsPerMm.textContent = `${Number(status.steps_per_mm).toFixed(1)} step/mm`;
    if (status.calibrated !== undefined) setCalibrationStatus(Boolean(status.calibrated));
    updateSafety(Boolean(status.home_installed), Boolean(status.home_active), Boolean(status.far_active), Boolean(status.estop_installed), Boolean(status.estop_active));
  }
  async function pollWifi() {
    if (!state.connected || state.transport !== "wifi") return;
    try {
      const [statusResponse, samplesResponse] = await Promise.all([
        fetch(`${state.wifiBaseUrl}/api/status?ts=${Date.now()}`, { cache: "no-store" }),
        fetch(`${state.wifiBaseUrl}/api/samples?after=${state.wifiSeq}`, { cache: "no-store" })
      ]);
      if (!statusResponse.ok || !samplesResponse.ok) throw new Error("ESP32 Wi-Fi API 返回异常");
      applyWifiStatus(await statusResponse.json());
      const payload = await samplesResponse.json();
      (payload.samples || []).forEach((sample) => {
        state.wifiSeq = Math.max(state.wifiSeq, Number(sample.seq) || 0);
        const force = sample.force === null ? "nan" : sample.force;
        const raw = `DATA,${sample.t},${sample.position},${sample.speed},${force},${sample.steady ? 1 : 0},${sample.state}`;
        parseData(["DATA", sample.t, sample.position, sample.speed, force, sample.steady ? "1" : "0", sample.state], raw);
      });
      state.wifiErrorShown = false;
    } catch (error) {
      if (!state.wifiErrorShown) { log(`Wi-Fi 连接异常：${error.message}`, "error"); state.wifiErrorShown = true; }
    }
  }
  function startWifiPolling() { clearInterval(state.wifiTimer); state.wifiTimer = setInterval(() => { void pollWifi(); }, 200); void pollWifi(); }
  async function connectWifi() {
    const baseUrl = els.wifiUrl.value.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error("Wi-Fi 地址应以 http:// 开头，例如 http://192.168.4.1");
    const response = await fetch(`${baseUrl}/api/status?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`无法访问 ${baseUrl}`);
    state.transport = "wifi"; state.wifiBaseUrl = baseUrl; state.wifiSeq = 0; state.wifiErrorShown = false;
    setConnection(true, "Wi-Fi 已连接", baseUrl.replace(/^https?:\/\//i, ""));
    log(`已连接 ESP32 Wi-Fi：${baseUrl}`);
    applyWifiStatus(await response.json());
    startWifiPolling();
  }
  async function disconnectWifi() { clearInterval(state.wifiTimer); state.wifiTimer = null; state.wifiErrorShown = false; state.connected = false; setConnection(false); log("Wi-Fi 已断开"); }
  async function readLoop() {
    try {
      while (state.port && state.port.readable) {
        state.reader = state.port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await state.reader.read();
            if (done) break;
            processSerialChunk(new TextDecoder().decode(value));
          }
        } finally { state.reader.releaseLock(); state.reader = null; }
      }
    } catch (error) { log(`串口读取异常：${error.message}`, "error"); }
  }
  async function connectSerial() {
    if (state.connected) { await disconnectSerial(); return; }
    try {
      if (window.desktopSerial) {
        const path = els.serialPort.value || "COM12";
        const result = await window.desktopSerial.open({ path, baudRate: 115200 });
        state.transport = "serial";
        setConnection(true, "串口已连接", `${result.path} · 115200 8N1`);
        log(`已打开 ${result.path}，串口参数 115200/8N1`);
        await sendCommand("STATUS");
        return;
      }
      if (!("serial" in navigator)) { log("当前浏览器不支持 Web Serial，请使用最新版 Edge 或 Chrome。", "error"); return; }
      state.port = await navigator.serial.requestPort();
      await state.port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
      state.writer = state.port.writable.getWriter();
      state.transport = "serial";
      setConnection(true, "串口已连接", "115200 8N1");
      log("串口已打开");
      readLoop();
      await sendCommand("STATUS");
    } catch (error) { log(`连接失败：${error.message}`, "error"); state.port = null; setConnection(false); }
  }
  async function disconnectSerial() {
    if (window.desktopSerial) {
      try { await window.desktopSerial.close(); } catch (_) { /* already closed */ }
      state.port = null; state.connected = false; setConnection(false); log("串口已断开");
      return;
    }
    try { if (state.reader) await state.reader.cancel(); } catch (_) { /* reader may already be released */ }
    try { if (state.writer) { state.writer.releaseLock(); state.writer = null; } } catch (_) { /* no-op */ }
    try { if (state.port) await state.port.close(); } catch (_) { /* port may already be closed */ }
    state.port = null; setConnection(false); log("串口已断开");
  }
  async function sendCommand(command) {
    log(command, "tx");
    if (/^(RUN|JOG\b)/.test(command)) {
      state.steadyForces = [];
      state.peakForce = null;
    }
    if (state.demo) { log(`模拟响应：${command}`); return; }
    if (state.transport === "wifi") {
      try {
        const response = await fetch(`${state.wifiBaseUrl}/api/command`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `cmd=${encodeURIComponent(command.trim())}` });
        const result = await response.json();
        const message = result.message || (response.ok ? "OK" : "请求失败");
        if (/^(OK|ERR|FAULT|STATUS),/.test(message)) handleLine(message);
        else log(message, response.ok ? "info" : "error");
      } catch (error) { log(`Wi-Fi 命令失败：${error.message}`, "error"); }
      return;
    }
    if (window.desktopSerial) {
      try { await window.desktopSerial.write(`${command.trim()}\n`); }
      catch (error) { log(`发送失败：${error.message}`, "error"); }
      return;
    }
    if (!state.writer) { log("请先连接串口。", "error"); return; }
    try { await state.writer.write(encoder.encode(`${command.trim()}\n`)); }
    catch (error) { log(`发送失败：${error.message}`, "error"); }
  }
  function refreshCounters() {
    els.sampleCount.textContent = state.recordRows.length;
    els.steadyCount.textContent = state.recordRows.filter((row) => row.steady).length;
  }
  function clearData() {
    state.samples = []; state.recordRows = []; state.steadyForces = []; state.peakForce = null; state.lastDeviceMs = null; state.rateTimes = [];
    resetSensorHistory(); state.sensor.snapshots = []; renderSensorSnapshots();
    els.sensorDataState.textContent = "等待数据"; els.sensorDataState.className = "badge muted-badge"; els.sensorSampleRate.textContent = "0.0 Hz";
    refreshCounters(); updateMetrics({ position: 0, speed: 0, force: null, steady: false }); drawCharts();
  }
  function toggleRecording() {
    state.recording = !state.recording;
    els.recordBtn.textContent = state.recording ? "停止记录" : "开始记录";
    els.recordBtn.className = `button ${state.recording ? "stop" : "primary"}`;
    els.recordState.textContent = state.recording ? "记录中" : state.recordRows.length ? "已停止" : "未记录";
    els.recordState.className = `badge ${state.recording ? "running" : "muted-badge"}`;
    log(state.recording ? "开始记录数据" : `停止记录，共 ${state.recordRows.length} 条`);
    refreshCounters();
  }
  function exportCsv() {
    if (!state.recordRows.length) { log("没有可导出的记录数据。", "error"); return; }
    const header = ["pc_time_iso", "device_time_ms", "position_mm", "speed_mm_s", "force_N", "processed_force_N", "sensor_stable", "sensor_std_N", "local_zero_N", "invert_force", "filter_mode", "filter_window", "stats_window_s", "stability_threshold_N", "steady", "state", "mass_g", "mu", "note", "raw_line"];
    const csvRows = [header, ...state.recordRows.map((row) => [row.pcTime, row.deviceMs, row.position.toFixed(5), row.speed.toFixed(5), row.rawForceN === null ? "" : row.rawForceN.toFixed(6), row.force === null ? "" : row.force.toFixed(6), row.sensorStable ? 1 : 0, row.sensorStdN === null ? "" : row.sensorStdN.toFixed(6), row.localZeroN.toFixed(6), row.invertForce ? 1 : 0, row.filterMode, row.filterWindow, row.statsWindowSec, row.stabilityThresholdN, row.steady ? 1 : 0, row.state, row.massG, row.mu === null ? "" : row.mu.toFixed(6), row.note, row.raw])];
    const csv = "\ufeff" + csvRows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ice_friction_${new Date().toISOString().replaceAll(/[:.]/g, "-")}.csv`; a.click(); URL.revokeObjectURL(a.href);
    log(`已导出 ${state.recordRows.length} 条 CSV 数据`);
  }
  function renderSensorSnapshots() {
    if (!state.sensor.snapshots.length) { els.sensorSnapshotBody.innerHTML = '<tr class="empty-row"><td colspan="5">暂无抓取记录</td></tr>'; return; }
    els.sensorSnapshotBody.innerHTML = state.sensor.snapshots.map((snapshot) => `<tr><td>${snapshot.time}</td><td>${snapshot.rawForceN.toFixed(5)}</td><td>${forceText(snapshot.processedN)} ${state.sensor.unit}</td><td>${snapshot.stdN.toFixed(5)}</td><td>${snapshot.stable ? "稳定" : "波动"}</td></tr>`).join("");
  }
  function captureSensorSnapshot() {
    const latest = state.sensor.latest, stats = state.sensor.stats;
    if (!latest || !stats) { log("当前没有可抓取的有效力值。", "error"); return; }
    state.sensor.snapshots.unshift({ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), rawForceN: latest.rawForceN, processedN: latest.processedN, stdN: stats.stdN, stable: stats.stable });
    state.sensor.snapshots = state.sensor.snapshots.slice(0, 20);
    renderSensorSnapshots(); log(`已抓取力值 ${latest.processedN.toFixed(5)} N`);
  }
  function setLocalZeroFromLatest() {
    const latest = state.sensor.latest;
    if (!latest) { log("当前没有有效力值，无法本地置零。", "error"); return; }
    state.sensor.localZeroN = latest.signedRawN;
    state.sensor.history = []; state.sensor.stats = null; state.sensor.latest = null;
    refreshSensorPresentation(); log(`本地零点设置为 ${state.sensor.localZeroN.toFixed(5)} N；ESP32 标定参数未改变。`);
  }
  function clearLocalZero() { state.sensor.localZeroN = 0; resetSensorHistory(); log("已清除上位机本地零点；ESP32 标定参数未改变。"); }
  function toggleSensorFreeze() {
    state.sensor.frozen = !state.sensor.frozen;
    els.freezeSensorBtn.textContent = state.sensor.frozen ? "恢复读数" : "冻结读数";
    refreshSensorPresentation();
    log(state.sensor.frozen ? "传感器读数显示已冻结，后台采集和记录仍继续。" : "传感器读数显示已恢复。");
  }
  function drawAxes(ctx, width, height, left, top, right, bottom, minX, maxX, minY, maxY, yLabel) {
    ctx.strokeStyle = "#dbe3e8"; ctx.lineWidth = 1; ctx.fillStyle = "#71808c"; ctx.font = "11px Arial";
    for (let i = 0; i <= 4; i++) { const y = top + (height - top - bottom) * i / 4; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke(); const value = maxY - (maxY - minY) * i / 4; ctx.fillText(value.toFixed(2), 4, y + 4); }
    ctx.fillText(yLabel, 4, 12);
    const xText = `${(minX / 1000).toFixed(0)}s`; ctx.fillText(xText, left, height - 5); ctx.fillText(`${(maxX / 1000).toFixed(0)}s`, width - right - 24, height - 5);
  }
  function prepareCanvas(canvas) { const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr); const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, width: rect.width, height: rect.height }; }
  function drawSeries(canvas, seriesList, yLabel) {
    const { ctx, width, height } = prepareCanvas(canvas); ctx.clearRect(0, 0, width, height); const left = 42, top = 18, right = 10, bottom = 23;
    if (!state.samples.length) { ctx.fillStyle = "#9aa8ae"; ctx.font = "13px Microsoft YaHei"; ctx.fillText("等待串口 DATA 数据…", left, height / 2); return; }
    const maxX = state.samples[state.samples.length - 1].deviceMs; const minX = Math.min(state.samples[0].deviceMs, maxX - 1000); const allValues = seriesList.flatMap((s) => state.samples.map(s.get).filter(Number.isFinite));
    if (!allValues.length) { ctx.fillStyle = "#9aa8ae"; ctx.font = "13px Microsoft YaHei"; ctx.fillText("暂无有效力值，请先检查 HX711 并完成标定", left, height / 2); return; }
    let minY = Math.min(...allValues), maxY = Math.max(...allValues); if (minY === maxY) { minY -= 1; maxY += 1; } const pad = (maxY - minY) * .12; minY -= pad; maxY += pad;
    drawAxes(ctx, width, height, left, top, right, bottom, minX, maxX, minY, maxY, yLabel);
    const x = (value) => left + (value - minX) / Math.max(1, maxX - minX) * (width - left - right); const y = (value) => top + (maxY - value) / (maxY - minY) * (height - top - bottom);
    seriesList.forEach((series) => { ctx.strokeStyle = series.color; ctx.lineWidth = 2; ctx.beginPath(); let started = false; state.samples.forEach((sample) => { const value = series.get(sample); if (!Number.isFinite(value)) { started = false; return; } const px = x(sample.deviceMs), py = y(value); if (!started) ctx.moveTo(px, py); else ctx.lineTo(px, py); started = true; }); ctx.stroke(); });
    if (yLabel.startsWith("拉力")) { ctx.fillStyle = "#d87832"; ctx.font = "11px Microsoft YaHei"; ctx.fillText("steady", width - 55, 13); }
  }
  function drawCharts() {
    drawSeries(els.forceChart, [{ color: "#176b87", get: (s) => displayForce(s.force) }, { color: "#d87832", get: (s) => s.steady && s.force !== null ? displayForce(s.force) : NaN }], `拉力 / ${state.sensor.unit}`);
    drawSeries(els.motionChart, [{ color: "#1a8a83", get: (s) => s.position }, { color: "#d87832", get: (s) => s.speed }], "位置 / 速度");
    const forces = state.samples.map((s) => displayForce(s.force)).filter(Number.isFinite); els.forceRange.textContent = forces.length ? `${Math.min(...forces).toFixed(unitDigits())} – ${Math.max(...forces).toFixed(unitDigits())} ${state.sensor.unit}` : "--";
  }
  function startDemo() {
    if (state.connected) return;
    state.demo = !state.demo;
    els.demoBtn.textContent = state.demo ? "停止模拟" : "模拟数据";
    setConnection(state.demo, state.demo ? "模拟模式" : "未连接", state.demo ? "虚拟 115200 8N1" : "115200 8N1");
    if (state.demo) { setCalibrationStatus(true); els.calScale.textContent = "模拟数据"; log("模拟模式已开启，不会驱动真实滑台"); const started = performance.now(); state.demoTimer = setInterval(() => { const t = Math.round(performance.now() - started); const phase = (t % 6000) / 1000; const moving = phase > .6 && phase < 4.8; const speed = moving ? .2 : 0; const position = moving ? Math.min(20, (phase - .6) * .2) : phase >= 4.8 ? .84 : 0; const force = moving ? .55 + .025 * Math.sin(t / 170) + .004 * Math.sin(t / 23) : phase > .45 && phase < .7 ? .82 : .003 * Math.sin(t / 31); parseData(["DATA", t, position, speed, force, moving && phase > 1 ? "1" : "0", moving ? "RUNNING" : "IDLE"], `DATA,${t},${position.toFixed(4)},${speed.toFixed(4)},${force.toFixed(5)},${moving && phase > 1 ? 1 : 0},${moving ? "RUNNING" : "IDLE"}`); }, 20); }
    else { clearInterval(state.demoTimer); state.demoTimer = null; setCalibrationStatus(false); els.calScale.textContent = "-- raw/N"; log("模拟模式已停止"); }
  }
  document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.input) return;
    const command = button.dataset.command;
    if (command === "HOME" && !confirm("请确认 HOME 限位开关已经安装并接线正确。继续发送 HOME 吗？")) return;
    await sendCommand(command);
  }));
  document.querySelectorAll("[data-input]").forEach((button) => button.addEventListener("click", () => {
    const input = $(button.dataset.input);
    const value = Number(input.value);
    const min = input.min === "" ? -Infinity : Number(input.min);
    const max = input.max === "" ? Infinity : Number(input.max);
    if (!Number.isFinite(value) || value < min || value > max) {
      log(`${button.dataset.command} 参数必须在 ${min}–${max} 之间。`, "error");
      input.focus();
      return;
    }
    sendCommand(`${button.dataset.command} ${value}`);
  }));
  document.querySelectorAll("[data-motion-direction]").forEach((button) => button.addEventListener("click", () => setMotionDirection(button.dataset.motionDirection)));
  els.directionJogBtn.addEventListener("click", () => sendCommand(`JOG ${formatDistance(signedDistance(2))}`));
  els.directionRunBtn.addEventListener("click", () => {
    const distance = configuredDistance();
    if (distance === null) { log("运行行程必须在 0.1–100 mm 之间。", "error"); els.distance.focus(); return; }
    sendCommand(`JOG ${formatDistance(signedDistance(distance))}`);
  });
  els.distance.addEventListener("input", updateDirectionControls);
  els.tareBtn.addEventListener("click", () => {
    if (!confirm("确认传感器已经完全卸载且无外力？TARE 会清除当前 ESP32 标定状态，之后需要重新加载已知质量完成标定。")) return;
    if (state.demo) { setCalibrationStatus(false); state.sensor.history = []; state.sensor.latest = null; state.sensor.stats = null; els.calScale.textContent = "-- raw/N"; refreshSensorPresentation(); }
    sendCommand("TARE");
  });
  els.calBtn.addEventListener("click", () => {
    const grams = Number(els.calMass.value);
    if (!Number.isFinite(grams) || grams < 1 || grams > 50000) { log("标定质量必须在 1–50000 g 之间。", "error"); els.calMass.focus(); return; }
    if (state.demo) { const knownN = grams * GRAVITY / 1000; state.sensor.knownForceN = knownN; state.sensor.scaleRawPerN = 12345.678; els.calScale.textContent = "12345.678 raw/N"; els.calKnownForce.textContent = `${knownN.toFixed(4)} N`; setCalibrationStatus(true); }
    sendCommand(`CAL ${grams}`);
  });
  [els.forceUnitSelect, els.filterModeSelect, els.invertForce].forEach((control) => control.addEventListener("change", syncSensorSettings));
  [els.filterWindow, els.statsWindow, els.stabilityThreshold, els.overloadThreshold].forEach((control) => control.addEventListener("input", syncSensorSettings));
  els.captureForceBtn.addEventListener("click", captureSensorSnapshot);
  els.freezeSensorBtn.addEventListener("click", toggleSensorFreeze);
  els.localZeroBtn.addEventListener("click", setLocalZeroFromLatest);
  els.clearLocalZeroBtn.addEventListener("click", clearLocalZero);
  els.resetSensorStatsBtn.addEventListener("click", () => { resetSensorHistory(); log("已清空传感器统计窗口。"); });
  els.clearSnapshotsBtn.addEventListener("click", () => { state.sensor.snapshots = []; renderSensorSnapshots(); });
  async function connectTransport() { if (state.connected) { if (state.transport === "wifi") await disconnectWifi(); else await disconnectSerial(); return; } try { if (els.connectionMode.value === "wifi") await connectWifi(); else await connectSerial(); } catch (error) { log(`连接失败：${error.message}`, "error"); setConnection(false); } }
  async function refreshDesktopPorts() {
    if (!window.desktopSerial) return;
    try {
      const ports = await window.desktopSerial.list();
      els.serialPort.replaceChildren();
      const ordered = [...ports].sort((a, b) => {
        const score = (port) => /COM12|wch|CH343|CH340/i.test(`${port.path} ${port.manufacturer || ""}`) ? 0 : 1;
        return score(a) - score(b) || String(a.path).localeCompare(String(b.path));
      });
      ordered.forEach((port) => { const option = document.createElement("option"); option.value = port.path; option.textContent = `${port.path} · ${port.manufacturer || "未知设备"}`; els.serialPort.append(option); });
      const preferred = ordered.find((port) => /COM12|wch|CH343|CH340/i.test(`${port.path} ${port.manufacturer || ""}`));
      if (preferred) els.serialPort.value = preferred.path;
      els.portText.textContent = preferred ? `${preferred.path} · 115200 8N1` : "未发现串口 · 115200 8N1";
    } catch (error) { log(`读取串口列表失败：${error.message}`, "error"); }
  }
  if (window.desktopSerial) {
    window.desktopSerial.onData(processSerialChunk);
    window.desktopSerial.onError((message) => log(`串口异常：${message}`, "error"));
    void refreshDesktopPorts();
  }
  els.connectionMode.addEventListener("change", () => { const wifi = els.connectionMode.value === "wifi"; els.wifiUrl.hidden = !wifi; els.serialPort.hidden = wifi; els.portText.textContent = wifi ? "热点：IceFriction-ESP32" : "推荐 COM12 · 115200 8N1"; els.connectBtn.textContent = wifi ? "连接 Wi-Fi" : "连接串口"; });
  els.connectBtn.addEventListener("click", connectTransport); els.demoBtn.addEventListener("click", startDemo); els.recordBtn.addEventListener("click", toggleRecording); els.exportBtn.addEventListener("click", exportCsv); els.clearBtn.addEventListener("click", clearData); els.clearLogBtn.addEventListener("click", () => { els.logBox.textContent = ""; });
  els.sendRawBtn.addEventListener("click", () => { const command = els.rawCommand.value.trim(); if (command) { sendCommand(command); els.rawCommand.value = ""; } });
  els.rawCommand.addEventListener("keydown", (event) => { if (event.key === "Enter") els.sendRawBtn.click(); });
  window.addEventListener("resize", drawCharts); els.mass.addEventListener("input", () => { const latest = state.samples[state.samples.length - 1]; if (latest) updateMetrics(latest); });
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);
  loadSensorSettings(); setCalibrationStatus(false); renderSensorSnapshots(); refreshSensorPresentation(); setConnection(false); setBadge("IDLE"); updateDirectionControls(); drawCharts(); log("控制台已就绪。请连接 ESP32，或开启模拟数据检查界面。");
})();
