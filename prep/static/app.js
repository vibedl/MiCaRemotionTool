const state = {
  sessionId: null,
  items: [],
  presets: [],
  templates: [],
  cameraPreset: "kenburns",
  matted: false,
  previewShapeId: null,
};

const $ = (id) => document.getElementById(id);

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    const msg = Array.isArray(d)
      ? d.map((x) => x.msg || JSON.stringify(x)).join("; ")
      : typeof d === "string"
        ? d
        : data.error || res.statusText;
    throw new Error(msg);
  }
  return data;
}

function setStatus(el, msg, kind) {
  el.textContent = msg || "";
  el.classList.toggle("error", kind === "error");
  el.classList.toggle("ok", kind === "ok");
}

function hide(id) {
  $(id).classList.add("is-hidden");
}

function startNewJob() {
  const hasWork =
    state.sessionId ||
    state.items.length > 0 ||
    state.matted ||
    !$("buildResult").classList.contains("is-hidden");
  if (hasWork && !window.confirm("Aktuellen Prep-Job verwerfen und neu beginnen?")) {
    return;
  }

  state.sessionId = null;
  state.items = [];
  state.matted = false;
  state.previewShapeId = null;
  state.cameraPreset = "kenburns";

  $("fileInput").value = "";
  $("jobName").value = "prep-job";
  $("edgeGrow").value = "3";
  $("edgeGrowVal").textContent = "3";
  $("wallSize").value = "0.85";
  $("wallSizeVal").textContent = "0.85";
  $("itemGrid").innerHTML = "";
  $("previewThumbs").innerHTML = "";
  $("previewRoom").removeAttribute("src");
  $("previewShape").removeAttribute("src");
  $("btnBuild").disabled = true;
  $("buildResult").classList.add("is-hidden");
  $("buildResult").innerHTML = "";
  hide("step-classify");
  hide("step-build");
  hide("previewBox");
  setStatus($("uploadStatus"), "Bereit für neue Dateien.", "ok");
  setStatus($("matteStatus"), "");
  setStatus($("buildStatus"), "");
  loadPresets().catch(() => {});
}

function show(id) {
  $(id).classList.remove("is-hidden");
}

function wallSize() {
  return Number($("wallSize").value);
}

function computePreviewScale(item) {
  const size = wallSize();
  const meta = item?.meta;
  let cw = 1;
  let ch = 1;
  if (meta?.croppedSize?.length >= 2) {
    cw = Math.max(1, meta.croppedSize[0]);
    ch = Math.max(1, meta.croppedSize[1]);
  } else if (meta?.width && meta?.height) {
    cw = meta.width;
    ch = meta.height;
  }
  const aspect = cw / ch;
  if (aspect >= 1) return { scaleX: size, scaleY: size / aspect };
  return { scaleX: size * aspect, scaleY: size };
}

function updatePreview() {
  const rooms = state.items.filter((i) => i.kind === "room");
  const shapes = state.items.filter((i) => i.kind === "shape" && i.mattedUrl);
  const box = $("previewBox");
  if (!rooms.length || !shapes.length) {
    box.classList.add("is-hidden");
    return;
  }
  box.classList.remove("is-hidden");

  const room = rooms[0];
  $("previewRoom").src = room.url;

  if (!state.previewShapeId || !shapes.some((s) => s.id === state.previewShapeId)) {
    state.previewShapeId = shapes[0].id;
  }
  const shape = shapes.find((s) => s.id === state.previewShapeId) || shapes[0];
  $("previewShape").src = shape.mattedUrl;

  // Shared wallSize = longer edge equal for all shapes (gallery proportions).
  const { scaleX, scaleY } = computePreviewScale(shape);
  const shapeEl = $("previewShape");
  shapeEl.style.width = `${scaleX * 42}%`;
  shapeEl.style.height = `${scaleY * 42}%`;

  const thumbs = $("previewThumbs");
  thumbs.innerHTML = "";
  for (const s of shapes) {
    const img = document.createElement("img");
    img.className = `preview__thumb${s.id === shape.id ? " is-active" : ""}`;
    img.src = s.mattedUrl;
    img.title = s.label;
    img.addEventListener("click", () => {
      state.previewShapeId = s.id;
      updatePreview();
    });
    thumbs.appendChild(img);
  }
}

async function loadPresets() {
  const data = await api("/api/presets");
  state.presets = data.presets;
  const box = $("presetList");
  box.innerHTML = "";
  for (const p of state.presets) {
    const div = document.createElement("label");
    div.className = `preset${p.id === state.cameraPreset ? " is-active" : ""}`;
    div.innerHTML = `
      <input type="radio" name="preset" value="${p.id}" ${p.id === state.cameraPreset ? "checked" : ""} />
      <div>
        <strong>${p.label}</strong>
        <span>${p.description} · ${p.durationInFrames} Frames</span>
      </div>`;
    div.querySelector("input").addEventListener("change", () => {
      state.cameraPreset = p.id;
      box.querySelectorAll(".preset").forEach((n) => n.classList.remove("is-active"));
      div.classList.add("is-active");
    });
    box.appendChild(div);
  }
}

async function loadTemplates() {
  const data = await api("/api/templates");
  state.templates = data.templates || [];
}

function templateOptionsHtml(selectedId) {
  if (!state.templates.length) {
    return `<option value="">Keine Vorlagen</option>`;
  }
  const sel = selectedId || state.templates[0].id;
  return state.templates
    .map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${t.label}</option>`)
    .join("");
}

function syncCutoutVisibility(tile, item) {
  const modeField = tile.querySelector("[data-role=cutoutMode]");
  const tmplField = tile.querySelector("[data-role=templateWrap]");
  const isShape = item.kind === "shape";
  modeField.classList.toggle("is-hidden", !isShape);
  tmplField.classList.toggle("is-hidden", !isShape || item.cutoutMode !== "template");
}

function renderItems() {
  const grid = $("itemGrid");
  grid.innerHTML = "";
  for (const item of state.items) {
    if (!item.cutoutMode) item.cutoutMode = "matte";
    if (!item.templateId && state.templates[0]) item.templateId = state.templates[0].id;

    const tile = document.createElement("div");
    tile.className = "tile";
    const preview = item.mattedUrl || item.url;
    tile.innerHTML = `
      <img src="${preview}" alt="" />
      <div class="tile__body">
        <div class="tile__name" title="${item.filename}">${item.label}</div>
        <label class="tile__field">
          <span>Typ</span>
          <select data-role="kind">
            <option value="room" ${item.kind === "room" ? "selected" : ""}>Raum / Hintergrund</option>
            <option value="shape" ${item.kind === "shape" ? "selected" : ""}>Shape / Bild</option>
            <option value="ignore" ${item.kind === "ignore" ? "selected" : ""}>Ignorieren</option>
          </select>
        </label>
        <label class="tile__field" data-role="cutoutMode">
          <span>Cutout</span>
          <select data-role="cutout">
            <option value="preserve" ${item.cutoutMode === "preserve" ? "selected" : ""}>Form behalten</option>
            <option value="matte" ${item.cutoutMode === "matte" ? "selected" : ""}>Motiv freistellen</option>
            <option value="template" ${item.cutoutMode === "template" ? "selected" : ""}>Form-Vorlage</option>
          </select>
        </label>
        <label class="tile__field" data-role="templateWrap">
          <span>Vorlage</span>
          <select data-role="template">${templateOptionsHtml(item.templateId)}</select>
        </label>
      </div>`;

    tile.querySelector("[data-role=kind]").addEventListener("change", (e) => {
      item.kind = e.target.value;
      syncCutoutVisibility(tile, item);
      updatePreview();
    });
    tile.querySelector("[data-role=cutout]").addEventListener("change", (e) => {
      item.cutoutMode = e.target.value;
      syncCutoutVisibility(tile, item);
    });
    tile.querySelector("[data-role=template]").addEventListener("change", (e) => {
      item.templateId = e.target.value;
    });
    syncCutoutVisibility(tile, item);
    grid.appendChild(tile);
  }
  updatePreview();
}

function classifyPayload() {
  return {
    sessionId: state.sessionId,
    items: state.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      cutoutMode: i.cutoutMode || "matte",
      templateId: i.templateId || null,
    })),
  };
}

async function uploadFiles(files) {
  if (!files?.length) return;
  setStatus($("uploadStatus"), "Upload…");
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  try {
    if (!state.templates.length) await loadTemplates();
    const data = await api("/api/session", { method: "POST", body: fd });
    state.sessionId = data.sessionId;
    state.items = data.items;
    state.matted = false;
    state.previewShapeId = null;
    $("btnBuild").disabled = true;
    setStatus($("uploadStatus"), `${data.items.length} Datei(en) geladen.`, "ok");
    show("step-classify");
    show("step-build");
    renderItems();
  } catch (e) {
    setStatus($("uploadStatus"), e.message, "error");
  }
}

async function saveKinds() {
  try {
    const data = await api(`/api/session/${state.sessionId}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(classifyPayload()),
    });
    state.items = data.items;
    setStatus($("matteStatus"), "Typen gespeichert.", "ok");
  } catch (e) {
    setStatus($("matteStatus"), e.message, "error");
  }
}

async function runMatte() {
  setStatus($("matteStatus"), "Freistellen läuft (je nach Modus)…");
  $("btnMatte").disabled = true;
  try {
    await saveKinds();
    const data = await api(`/api/session/${state.sessionId}/matte`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edgeGrow: Number($("edgeGrow").value),
        wallSize: wallSize(),
      }),
    });
    state.items = data.items;
    state.matted = true;
    $("btnBuild").disabled = false;
    renderItems();
    setStatus($("matteStatus"), `${data.matted.length} Shape(s) verarbeitet.`, "ok");
  } catch (e) {
    setStatus($("matteStatus"), typeof e.message === "string" ? e.message : JSON.stringify(e), "error");
  } finally {
    $("btnMatte").disabled = false;
  }
}

async function buildJob() {
  setStatus($("buildStatus"), "Job wird erzeugt…");
  $("buildResult").classList.add("is-hidden");
  $("btnBuild").disabled = true;
  try {
    await saveKinds();
    const studioBase = "http://127.0.0.1:5183";
    const data = await api(`/api/session/${state.sessionId}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        jobName: $("jobName").value.trim() || "prep-job",
        cameraPreset: state.cameraPreset,
        wallSize: wallSize(),
        studioUrl: studioBase,
      }),
    });
    state.items = data.items;
    renderItems();
    const studioOpen = `${studioBase}/?job=${encodeURIComponent(data.jobName)}`;
    setStatus($("buildStatus"), "Fertig — Studio wird geöffnet…", "ok");
    const box = $("buildResult");
    box.classList.remove("is-hidden");
    box.innerHTML = `
      <p><strong>${data.jobName}</strong> — ${data.rooms} Raum/Räume, ${data.pictures} Shape(s), ${data.durationInFrames} Frames</p>
      <p>Gespeichert und an Studio übergeben (Wandbild-Größe ${wallSize().toFixed(2)}).</p>
      <p><a href="${studioOpen}" target="_blank" rel="noopener">Studio erneut öffnen</a></p>
      <p style="margin-top:10px"><button type="button" class="btn btn-primary" id="btnNewJobAfter">Neuen Job beginnen</button></p>`;
    $("btnNewJobAfter")?.addEventListener("click", startNewJob);
    const opened = window.open(studioOpen, "room-flythrough-studio");
    if (!opened) {
      window.location.href = studioOpen;
    }
  } catch (e) {
    setStatus($("buildStatus"), e.message, "error");
  } finally {
    $("btnBuild").disabled = !state.matted;
  }
}

function wireDrop() {
  const zone = $("dropzone");
  const input = $("fileInput");
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => uploadFiles(input.files));
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-drag");
    uploadFiles(e.dataTransfer.files);
  });
}

$("edgeGrow").addEventListener("input", () => {
  $("edgeGrowVal").textContent = $("edgeGrow").value;
});
$("wallSize").addEventListener("input", () => {
  $("wallSizeVal").textContent = Number($("wallSize").value).toFixed(2);
  updatePreview();
});
$("btnSaveKinds").addEventListener("click", saveKinds);
$("btnMatte").addEventListener("click", runMatte);
$("btnBuild").addEventListener("click", buildJob);
$("btnNewJob").addEventListener("click", startNewJob);

wireDrop();
Promise.all([loadPresets(), loadTemplates()]).catch((e) =>
  setStatus($("uploadStatus"), e.message, "error"),
);
