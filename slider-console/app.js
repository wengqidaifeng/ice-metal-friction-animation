(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    connectBtn: $("connectBtn"), demoBtn: $("demoBtn"), connectionDot: $("connectionDot"), connectionText: $("connectionText"), portText: $("portText"), stateBadge: $("stateBadge"),
    position: $("positionMetric"), speed: $("speedMetric"), force: $("forceMetric"), mu: $("muMetric"), muK: $("muKMetric"), muS: $("muSMetric"), calState: $("calState"),
    mass: $("massInput"), window: $("windowInput"), forceChart: $("forceChart"), motionChart: $("motionChart"), forceRange: $("forceRange"), sampleRate: $("sampleRate"),
    recordBtn: $("recordBtn"), recordState: $("recordState"), exportBtn: $("exportBtn"), clearBtn: $("clearBtn"), clearLogBtn: $("clearLogBtn"), logBox: $("logBox"),
    sampleCount: $("sampleCount"), steadyCount: $("steadyCount"), lineCount: $("lineCount"), runNote: $("runNote"), calBtn: $("calBtn"), homeBtn: $("homeBtn"),
    stepsPerMm: $("stepsPerMm"), rawCommand: $("rawCommand"), sendRawBtn: $("sendRawBtn")
  };

  const state = {
    port: null, reader: null, writer: null, readBuffer: "", connected: false, demo: false, demoTimer: null,
    samples: [], recordRows: [], recording: false, steadyForces: [], peakForce: null, lastDeviceMs: null, rateTimes: [], currentState: "IDLE", lineCount: 0
  };
  const encoder = new TextEncoder();

  function log(message, kind = "info") {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const prefix = kind === "tx" ? "> " : kind === "error" ? "! " : "  ";
    els.logBox.textContent += `${time}${prefix}${message}\n`;
    els.logBox.scrollTop = els.logBox.scrollHeight;
  }
  function setConnection(online, label = "未连接", port = "115200 8N1") {
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
  function massKg() { return Math.max(0, Number(els.mass.value) || 0) / 1000; }
  function calculateMu(force) { const m = massKg(); return Number.isFinite(force) && m > 0 ? force / (m * 9.80665) : null; }
  function updateMetrics(sample) {
    els.position.textContent = numeric(sample.position);
    els.speed.textContent = numeric(Math.abs(sample.speed));
    els.force.textContent = numeric(sample.force, 4);
    const mu = calculateMu(sample.force);
    els.mu.textContent = numeric(mu, 4);
    if (sample.force !== null) {
      state.peakForce = state.peakForce === null ? sample.force : Math.max(state.peakForce, sample.force);
      if (sample.steady) state.steadyForces.push(sample.force);
    }
    const mean = state.steadyForces.length ? state.steadyForces.reduce((a, b) => a + b, 0) / state.steadyForces.length : null;
    els.muK.textContent = numeric(calculateMu(mean), 4);
    els.muS.textContent = numeric(calculateMu(state.peakForce), 4);
    els.calState.textContent = sample.force !== null ? "有力值" : "未标定";
    els.calState.className = `badge ${sample.force !== null ? "running" : "muted-badge"}`;
  }
  function parseData(parts, raw) {
    if (parts.length < 7) return;
    const forceText = String(parts[4]);
    const sample = { deviceMs: Number(parts[1]), position: Number(parts[2]), speed: Number(parts[3]), force: forceText.toLowerCase() === "nan" ? null : Number(forceText), steady: String(parts[5]) === "1", state: String(parts[6] || "IDLE"), pcTime: new Date().toISOString(), raw };
    if (!Number.isFinite(sample.position) || !Number.isFinite(sample.speed)) return;
    state.samples.push(sample);
    const windowMs = (Math.max(10, Number(els.window.value) || 60)) * 1000;
    const newest = sample.deviceMs;
    state.samples = state.samples.filter((item) => newest - item.deviceMs <= windowMs);
    if (state.recording) state.recordRows.push({ ...sample, massG: Number(els.mass.value) || 0, mu: calculateMu(sample.force), note: els.runNote.value });
    updateMetrics(sample);
    setBadge(sample.state);
    if (state.lastDeviceMs !== null && sample.deviceMs > state.lastDeviceMs) {
      state.rateTimes.push(performance.now());
      state.rateTimes = state.rateTimes.filter((t) => performance.now() - t < 2000);
      els.sampleRate.textContent = `${(state.rateTimes.length / 2).toFixed(1)} Hz`;
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
      if (line.includes("OK,CAL")) { els.calState.textContent = "已标定"; els.calState.className = "badge running"; }
    }
  }
  function parseStatus(line) {
    const values = {};
    line.slice(7).split(",").forEach((pair) => { const [key, ...rest] = pair.split("="); if (key) values[key] = rest.join("="); });
    if (values.state) setBadge(values.state);
    if (values.pos_mm) els.position.textContent = numeric(Number(values.pos_mm));
    if (values.speed_mm_s) els.speed.textContent = numeric(Math.abs(Number(values.speed_mm_s)));
    if (values.target_mm_s) $("speedInput").value = Number(values.target_mm_s);
    if (values.distance_mm) $("distanceInput").value = Number(values.distance_mm);
    if (values.accel_mm_s2) $("accelInput").value = Number(values.accel_mm_s2);
    if (values.steps_per_mm) els.stepsPerMm.textContent = `${Number(values.steps_per_mm).toFixed(1)} step/mm`;
    if (values.cal === "1") { els.calState.textContent = "已标定"; els.calState.className = "badge running"; }
    log(line);
  }
  async function readLoop() {
    try {
      while (state.port && state.port.readable) {
        state.reader = state.port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await state.reader.read();
            if (done) break;
            state.readBuffer += new TextDecoder().decode(value);
            const lines = state.readBuffer.split(/\r?\n/);
            state.readBuffer = lines.pop() || "";
            lines.forEach(handleLine);
          }
        } finally { state.reader.releaseLock(); state.reader = null; }
      }
    } catch (error) { log(`串口读取异常：${error.message}`, "error"); }
  }
  async function connectSerial() {
    if (!("serial" in navigator)) { log("当前浏览器不支持 Web Serial，请使用最新版 Edge 或 Chrome。", "error"); return; }
    if (state.connected) { await disconnectSerial(); return; }
    try {
      state.port = await navigator.serial.requestPort();
      await state.port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
      state.writer = state.port.writable.getWriter();
      setConnection(true, "已连接", "115200 8N1");
      log("串口已打开");
      readLoop();
      await sendCommand("STATUS");
    } catch (error) { log(`连接失败：${error.message}`, "error"); state.port = null; setConnection(false); }
  }
  async function disconnectSerial() {
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
    if (!state.writer) { log("请先连接串口。", "error"); return; }
    try { await state.writer.write(encoder.encode(`${command.trim()}\n`)); }
    catch (error) { log(`发送失败：${error.message}`, "error"); }
  }
  function refreshCounters() {
    els.sampleCount.textContent = state.recordRows.length;
    els.steadyCount.textContent = state.recordRows.filter((row) => row.steady).length;
  }
  function clearData() { state.samples = []; state.recordRows = []; state.steadyForces = []; state.peakForce = null; state.lastDeviceMs = null; state.rateTimes = []; refreshCounters(); updateMetrics({ position: 0, speed: 0, force: null, steady: false }); drawCharts(); }
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
    const header = ["pc_time_iso", "device_time_ms", "position_mm", "speed_mm_s", "force_N", "steady", "state", "mass_g", "mu", "note", "raw_line"];
    const csvRows = [header, ...state.recordRows.map((row) => [row.pcTime, row.deviceMs, row.position.toFixed(5), row.speed.toFixed(5), row.force === null ? "" : row.force.toFixed(6), row.steady ? 1 : 0, row.state, row.massG, row.mu === null ? "" : row.mu.toFixed(6), row.note, row.raw])];
    const csv = "\ufeff" + csvRows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ice_friction_${new Date().toISOString().replaceAll(/[:.]/g, "-")}.csv`; a.click(); URL.revokeObjectURL(a.href);
    log(`已导出 ${state.recordRows.length} 条 CSV 数据`);
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
    drawSeries(els.forceChart, [{ color: "#176b87", get: (s) => s.force }, { color: "#d87832", get: (s) => s.steady && s.force !== null ? s.force : NaN }], "拉力 / N");
    drawSeries(els.motionChart, [{ color: "#1a8a83", get: (s) => s.position }, { color: "#d87832", get: (s) => s.speed }], "位置 / 速度");
    const forces = state.samples.map((s) => s.force).filter(Number.isFinite); els.forceRange.textContent = forces.length ? `${Math.min(...forces).toFixed(3)} – ${Math.max(...forces).toFixed(3)} N` : "--";
  }
  function startDemo() {
    if (state.connected) return;
    state.demo = !state.demo;
    els.demoBtn.textContent = state.demo ? "停止模拟" : "模拟数据";
    setConnection(state.demo, state.demo ? "模拟模式" : "未连接", state.demo ? "虚拟 115200 8N1" : "115200 8N1");
    if (state.demo) { log("模拟模式已开启，不会驱动真实滑台"); const started = performance.now(); state.demoTimer = setInterval(() => { const t = Math.round(performance.now() - started); const phase = (t % 6000) / 1000; const moving = phase > .6 && phase < 4.8; const speed = moving ? .2 : 0; const position = moving ? Math.min(20, (phase - .6) * .2) : phase >= 4.8 ? .84 : 0; const force = moving ? .55 + .025 * Math.sin(t / 170) : phase > .45 && phase < .7 ? .82 : null; parseData(["DATA", t, position, speed, force ?? "nan", moving && phase > 1 ? "1" : "0", moving ? "RUNNING" : "IDLE"], `DATA,${t},${position.toFixed(4)},${speed.toFixed(4)},${force === null ? "nan" : force.toFixed(5)},${moving && phase > 1 ? 1 : 0},${moving ? "RUNNING" : "IDLE"}`); }, 20); }
    else { clearInterval(state.demoTimer); state.demoTimer = null; log("模拟模式已停止"); }
  }
  document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.input) return;
    const command = button.dataset.command;
    if (command === "HOME" && !confirm("请确认 HOME 限位开关已经安装并接线正确。继续发送 HOME 吗？")) return;
    await sendCommand(command);
  }));
  document.querySelectorAll("[data-input]").forEach((button) => button.addEventListener("click", () => { const value = Number($(button.dataset.input).value); if (!Number.isFinite(value)) return; sendCommand(`${button.dataset.command} ${value}`); }));
  els.calBtn.addEventListener("click", () => { const grams = prompt("请输入已知标定质量（g），例如 200：", "200"); const value = Number(grams); if (Number.isFinite(value) && value > 0) sendCommand(`CAL ${value}`); });
  els.connectBtn.addEventListener("click", connectSerial); els.demoBtn.addEventListener("click", startDemo); els.recordBtn.addEventListener("click", toggleRecording); els.exportBtn.addEventListener("click", exportCsv); els.clearBtn.addEventListener("click", clearData); els.clearLogBtn.addEventListener("click", () => { els.logBox.textContent = ""; });
  els.sendRawBtn.addEventListener("click", () => { const command = els.rawCommand.value.trim(); if (command) { sendCommand(command); els.rawCommand.value = ""; } });
  els.rawCommand.addEventListener("keydown", (event) => { if (event.key === "Enter") els.sendRawBtn.click(); });
  window.addEventListener("resize", drawCharts); els.mass.addEventListener("input", () => { const latest = state.samples[state.samples.length - 1]; if (latest) updateMetrics(latest); });
  setConnection(false); setBadge("IDLE"); drawCharts(); log("控制台已就绪。请连接 ESP32，或开启模拟数据检查界面。");
})();
