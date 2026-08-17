(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    connectBtn: $("connectBtn"), demoBtn: $("demoBtn"), connectionDot: $("connectionDot"), connectionText: $("connectionText"), connectionMode: $("connectionMode"), serialPort: $("serialPortSelect"), wifiUrl: $("wifiUrlInput"), portText: $("portText"), stateBadge: $("stateBadge"),
    position: $("positionMetric"), speed: $("speedMetric"), force: $("forceMetric"), mu: $("muMetric"), muK: $("muKMetric"), muS: $("muSMetric"), calState: $("calState"),
    mass: $("massInput"), window: $("windowInput"), forceChart: $("forceChart"), motionChart: $("motionChart"), forceRange: $("forceRange"), sampleRate: $("sampleRate"),
    recordBtn: $("recordBtn"), recordState: $("recordState"), exportBtn: $("exportBtn"), clearBtn: $("clearBtn"), clearLogBtn: $("clearLogBtn"), logBox: $("logBox"),
    sampleCount: $("sampleCount"), steadyCount: $("steadyCount"), lineCount: $("lineCount"), runNote: $("runNote"), calBtn: $("calBtn"), homeBtn: $("homeBtn"),
    stepsPerMm: $("stepsPerMm"), rawCommand: $("rawCommand"), sendRawBtn: $("sendRawBtn"), distance: $("distanceInput"),
    directionPositive: $("directionPositive"), directionNegative: $("directionNegative"), directionJogBtn: $("directionJogBtn"), directionRunBtn: $("directionRunBtn"), motionCommandPreview: $("motionCommandPreview")
  };

  const state = {
    port: null, reader: null, writer: null, readBuffer: "", connected: false, transport: "serial", wifiBaseUrl: "http://192.168.4.1", wifiTimer: null, wifiSeq: 0, wifiErrorShown: false, demo: false, demoTimer: null,
    samples: [], recordRows: [], recording: false, steadyForces: [], peakForce: null, lastDeviceMs: null, rateTimes: [], currentState: "IDLE", lineCount: 0, motionDirection: 1
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
    if (values.distance_mm) { $("distanceInput").value = Number(values.distance_mm); updateDirectionControls(); }
    if (values.accel_mm_s2) $("accelInput").value = Number(values.accel_mm_s2);
    if (values.steps_per_mm) els.stepsPerMm.textContent = `${Number(values.steps_per_mm).toFixed(1)} step/mm`;
    if (values.cal === "1") { els.calState.textContent = "已标定"; els.calState.className = "badge running"; }
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
    if (status.calibrated) { els.calState.textContent = "已标定"; els.calState.className = "badge running"; }
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
        log(result.message || (response.ok ? "OK" : "请求失败"), response.ok ? "info" : "error");
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
  els.calBtn.addEventListener("click", () => { const grams = prompt("请输入已知标定质量（g），例如 200：", "200"); const value = Number(grams); if (Number.isFinite(value) && value > 0) sendCommand(`CAL ${value}`); });
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
  setConnection(false); setBadge("IDLE"); updateDirectionControls(); drawCharts(); log("控制台已就绪。请连接 ESP32，或开启模拟数据检查界面。");
})();
