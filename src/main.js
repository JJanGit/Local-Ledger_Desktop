const portfolios = [];
let currentPortfolioIndex = null;
let hasData = false;
let currentChartMode = "combined";
let currentSettingsIndex = null;

/* Timeline range slider state: the full dataset plus the currently selected
window expressed as fractions (0..1) of the full date span */
let fullChartData = {
  labels: [],
  worthData: [],
  investData: []
};
let rangeStart = 0;
let rangeEnd = 1;
let timelineDragging = null; // "start" | "end" | null

// Central number formatting (de-DE, e.g. 1.235,40 €).
const eurFmt = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eurFmtSigned = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
const pctFmtSigned = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
// Axis ticks stay decimal-free to avoid clutter
const eurFmtAxis = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

function formatEur(value) {
  return eurFmt.format(value) + " €";
}
function formatEurSigned(value) {
  return eurFmtSigned.format(value) + " €";
}
function formatPctSigned(value) {
  return pctFmtSigned.format(value) + " %";
}

const DATA_DIR = "data";
const DATA_FILE = "data/ledger.json";
const DATA_TMP = "data/ledger.json.tmp";

// True when an existing file could not be loaded; blocks saving so a corrupt file is not overwritten.
let loadFailed = false;

// Writes the current portfolios to disk. Fire-and-forget: callers do not await it.
async function saveState() {
  // Refuse to save while the on-disk file is unreadable/invalid, so we don't overwrite recoverable data
  if (loadFailed) {
    return;
  }
  try {
    const { writeTextFile, mkdir, rename, BaseDirectory } = window.__TAURI__.fs;
    // Ensure the target folder exists; recursive is idempotent so no error if it already exists
    await mkdir(DATA_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    // Write to a temp file first, then rename over the real file. A rename is atomic, so a crash mid-write can't leave a half-written ledger.json
    await writeTextFile(DATA_TMP, JSON.stringify(portfolios), { baseDir: BaseDirectory.AppData });
    await rename(DATA_TMP, DATA_FILE, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
  }
  catch (e) {
    console.log("Could not save ledger: " + e);
    showAlert("globalAlert", "Could not save your data. Your latest changes may be lost.");
  }
}

// Loads persisted portfolios on startup. If an existing file can't be read or validated, it warns and blocks saving.
async function loadState() {
  const { readTextFile, exists, BaseDirectory } = window.__TAURI__.fs;
  let raw;
  try {
    // First run: the file does not exist yet, so start with an empty ledger
    if (!(await exists(DATA_FILE, { baseDir: BaseDirectory.AppData }))) {
      return;
    }
    raw = await readTextFile(DATA_FILE, { baseDir: BaseDirectory.AppData });
  }
  catch (e) {
    console.log("Could not read ledger: " + e);
    loadFailed = true;
    showAlert("globalAlert", "Could not read your saved data. Saving is disabled to protect the file.");
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  }
  catch (e) {
    loadFailed = true;
    showAlert("globalAlert", "Your saved data file is invalid and was not loaded. Saving is disabled to protect it.");
    return;
  }
  if (validateImportData(data) !== null) {
    loadFailed = true;
    showAlert("globalAlert", "Your saved data file is invalid and was not loaded. Saving is disabled to protect it.");
    return;
  }
  for (let i = 0; i < data.length; i++) {
    portfolios.push(data[i]);
    addPortfolioToUI(data[i], i);
  }
  hasData = portfolios.length > 0;
}

function showAlert(containerId, message, type = "danger") {
  $("#" + containerId).html(`<div class="alert alert-${type} alert-dismissible fade show" role="alert">${message}<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button></div>`);
}

// Runs onConfirm, cancelling just clears the alert.
function showConfirmAlert(containerId, message, onConfirm, opts) {
  opts = opts || {};
  const confirmLabel = opts.confirmLabel || "Confirm";
  const confirmClass = opts.confirmClass || "btn-warning";
  const type = opts.type || "warning";
  const $alert = $(
    '<div class="alert alert-' + type + ' confirm-alert" role="alert">' +
      '<span class="confirm-alert-message"></span>' +
      '<span class="confirm-alert-actions">' +
        '<button type="button" class="btn btn-secondary confirm-alert-cancel">Cancel</button>' +
        '<button type="button" class="btn ' + confirmClass + ' confirm-alert-ok">' + confirmLabel + '</button>' +
      '</span>' +
    '</div>'
  );
  // Set the message via text() so user-provided strings (e.g. portfolio names) can't inject markup
  $alert.find(".confirm-alert-message").text(message);
  const $container = $("#" + containerId);
  $container.empty().append($alert);
  $alert.find(".confirm-alert-cancel").on("click", function () {
    $container.empty();
  });
  $alert.find(".confirm-alert-ok").on("click", function () {
    $container.empty();
    onConfirm();
  });
}

$(document).ready(async function () {
  registerEvents();
  await loadState();
  switchPage("pageOverview");
  setOverviewPage();
});

function registerEvents() {
  // Navigation events
  $("#btnNavAbout").click(function () {
    switchPage("pageAbout");
  });
  $("#btnNavOverview").click(function () {
    switchPage("pageOverview");
    setOverviewPage();
  });
  $("#btnNavPortfolios").click(function () {
    switchPage("pagePortfolios");
  });

  // Overview startpage events
  $("#btnStart").click(function () {
    switchPage("pagePortfolios");
  });
  $("#btnImport").click(function () {});
  $("#btnConfirmImport").click(function () {
    const json = $("#txtImportJson").val().trim();
    if (!json) {
      showAlert("importAlert", "Please paste JSON first.");
      return;
    }
    let data;
    try {
      data = JSON.parse(json);
    }
    catch (e) {
      showAlert("importAlert", "Invalid JSON: " + e.message);
      return;
    }
    const validationError = validateImportData(data);
    if (validationError) {
      showAlert("importAlert", validationError);
      return;
    }
    if (portfolios.length > 0) {
      showConfirmAlert("importAlert", "This will overwrite all existing portfolios. Continue?", function () {
        performImport(data);
      }, { confirmLabel: "Overwrite" });
    }
    else {
      performImport(data);
    }
  });

  // Import drop zone
  $("#importDropZone").on("dragover", function(e) {
    e.preventDefault();
    $(this).addClass("drag-over");
  });
  $("#importDropZone").on("dragleave drop", function() {
    $(this).removeClass("drag-over");
  });
  $("#importDropZone").on("drop", function(e) {
    e.preventDefault();
    const file = e.originalEvent.dataTransfer.files[0];
    if (!file) {
      return;
    }
    readImportFile(file);
  });
  $("#importDropZone").on("click", function() {
    $("#importFileInput").click();
  });
  $("#importFileInput").on("change", function() {
    const file = this.files[0];
    if (!file) {
      return;
    }
    readImportFile(file);
    this.value = "";
  });

  $("#btnExport").click(function () {
    if (portfolios.length === 0) {
      return;
    }
    const json = JSON.stringify(portfolios, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "local-ledger-export.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  // Block non-numeric input on number fields
  const allowedKeys = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", ".", "Home", "End"];
  $(document).on("keydown", ".entry-invest, .entry-value, #pAmount", function (event) {
    // If key is not in "allowedKeys" && if key is not a digit (nobody can read REGEX :D)
    if (!allowedKeys.includes(event.key) && !/^\d$/.test(event.key)) {
      event.preventDefault();
    }
  });

  // Portfolio creation
  $("#btnCreatePortfolio").click(function () {
    createPortfolio();
  });

  // Settings modal
  $(document).on("click", ".btn-portfolio-settings", function () {
    const index = parseInt($(this).data("index"));
    if (index === undefined || !portfolios[index]) {
      return;
    }
    currentSettingsIndex = index;
    $("#settingsName").val(portfolios[index].name);
    $("#settingsModalAlert").empty();
    $("#settingsModal").modal("show");
  });
  $("#btnSaveSettings").click(function () {
    const newName = $("#settingsName").val().trim();
    if (!newName) {
      showAlert("settingsModalAlert", "Name cannot be empty.");
      return;
    }
    for (let i = 0; i < portfolios.length; i++) {
      if (i !== currentSettingsIndex && portfolios[i].name === newName) {
        showAlert("settingsModalAlert", "Portfolio name already exists.");
        return;
      }
    }
    portfolios[currentSettingsIndex].name = newName;
    // [data-index='x'] is a CSS attribute selector which targets the button with exactly that index
    $(".btn-portfolio-entries[data-index='" + currentSettingsIndex + "']").closest(".portfolio-card").find("input").val(newName);
    $(".btn-chart-view[data-mode='" + currentSettingsIndex + "']").text(newName);
    saveState();
    $("#settingsModal").modal("hide");
  });
  $("#btnDeletePortfolio").click(function () {
    if (currentSettingsIndex === null || !portfolios[currentSettingsIndex]) {
      return;
    }
    // Capture the index now so a later state change can't shift which portfolio gets deleted
    const indexToDelete = currentSettingsIndex;
    const name = portfolios[indexToDelete].name;
    showConfirmAlert("settingsModalAlert", 'Delete portfolio "' + name + '"? This cannot be undone.', function () {
      /* Invalidate the index and close the modal first so its hide isn't racing
      the chart/page re-render in deletePortfolio */
      currentSettingsIndex = null;
      $("#settingsModal").modal("hide");
      deletePortfolio(indexToDelete);
    }, { confirmLabel: "Delete" });
  });

  // Chart view switcher
  $(document).on("click", ".btn-chart-view", function () {
    $(".btn-chart-view").removeClass("active");
    $(this).addClass("active");
    const mode = $(this).data("mode");
    if (mode === "combined") {
      updateChart("combined");
    }
    else {
      updateChart(parseInt(mode));
    }
  });

  // Modal and entry events
  $(document).on("click", ".btn-portfolio-entries", function () {
    const index = $(this).data("index");
    // Error handling
    if (index === undefined || index < 0 || index >= portfolios.length) {
      console.log("Error: Couldnt find the portfolio because of a wrong index " + index);
      showAlert("portfolioAlert", "Error: Couldn't find the portfolio.");
      return;
    }

    currentPortfolioIndex = parseInt(index);
    renderModalEntries();
    $("#entriesModal").modal("show");
  });
  $("#portfolioAddEntry").click(function () {
    // Error handling
    if (currentPortfolioIndex === null || currentPortfolioIndex < 0 || !portfolios[currentPortfolioIndex]) {
      console.log("Error: Couldnt find the portfolio: " + currentPortfolioIndex);
      showAlert("entriesModalAlert", "Error: Couldn't find the portfolio.");
      return;
    }

    syncModalEntriesToArray();

    // Create current date
    let today = new Date();
    let year = today.getFullYear();
    let month = today.getMonth() + 1; // month 0 based for whatever reason
    let date = today.getDate();
    if (date < 10) {
      date = "0" + date;
    }
    if (month < 10) {
      month = "0" + month;
    }
    const formatedToday = year + "-" + month + "-" + date;

    // Create new entry with 0 as invest and value - then refresh
    createPortfolioEntry(currentPortfolioIndex, formatedToday, 0, 0);
    renderModalEntries();
  });

  $("#btnConfirmEntries").click(function () {
    if (currentPortfolioIndex === null || !portfolios[currentPortfolioIndex]) {
      console.log("Error while saving: Couldnt find the selected portfolio " + currentPortfolioIndex);
      showAlert("entriesModalAlert", "Error while saving: Couldn't find the selected portfolio.");
      return;
    }
    syncModalEntriesToArray();
    saveState();
    console.log("Saved new data to: " + portfolios[currentPortfolioIndex].name);
    $("#entriesModal").modal("hide");
    setOverviewPage();
  });

  /* If a handle is dragged, then track movement on the whole
  document so the drag keeps working even when the cursor leaves the handle */
  $("#timelineHandleStart").on("pointerdown", function (e) {
    e.preventDefault();
    timelineDragging = "start";
  });
  $("#timelineHandleEnd").on("pointerdown", function (e) {
    e.preventDefault();
    timelineDragging = "end";
  });
  $(document).on("pointermove", function (e) {
    if (timelineDragging === null) {
      return;
    }
    onTimelineDrag(e.originalEvent);
  });
  $(document).on("pointerup", function () {
    timelineDragging = null;
  });

  // Date-range presets
  $(document).on("click", ".btn-preset", function () {
    applyPreset($(this).data("preset"));
  });
}

/* Reads current input values back into the array before any re-render,
prevents user edits from being lost when adding or deleting an entry */
function syncModalEntriesToArray() {
  const entries = portfolios[currentPortfolioIndex].entries;
  $("#entriesListContainer .portfolioEntry").each(function(index) {
    const $row = $(this);
    if (entries[index]) {
      entries[index].date = $row.find(".entry-date").val();
      entries[index].invest = parseFloat($row.find(".entry-invest").val()) || 0;
      entries[index].value = parseFloat($row.find(".entry-value").val()) || 0;
    }
  });
}

// ---------- MODAL LOGIC ----------

$("#entriesModal").on("hidden.bs.modal", function () {
  $("#entriesModalAlert").empty();
});

$("#entriesModal").on("show.bs.modal", function () {
  if (currentPortfolioIndex !== null && portfolios[currentPortfolioIndex]) {
    renderModalEntries();
  }
  else {
    // Fallback error handling
    console.log("Error: Couldnt find the selected portfolio: " + currentPortfolioIndex);
    showAlert("entriesModalAlert", "Error: Couldn't find the selected portfolio.");
  }
});

const ENTRIES_PAGE_SIZE = 8;

function renderModalEntries(showAll) {
  const listContainer = $("#entriesListContainer");
  listContainer.empty();

  // Error handling
  if (currentPortfolioIndex === null || !portfolios[currentPortfolioIndex]) {
    console.log("Error: Couldnt find the selected portfolio: " + currentPortfolioIndex);
    showAlert("entriesModalAlert", "Error: Couldn't find the selected portfolio.");
    return;
  }

  const portfolio = portfolios[currentPortfolioIndex];

  if (!portfolio.entries || portfolio.entries.length === 0) {
    listContainer.html('<p style="text-align:center;">No entries yet.</p>');
    return;
  }

  // Sort entries descending by date (newest first) before rendering so indices stay valid for deletion
  portfolio.entries.sort(function(a, b) {
    if (a.date > b.date) {
      return -1;
    }
    else if (a.date < b.date) {
      return 1;
    }
    else {
      return 0;
    }
  });

  // Column header row
  const headerHtml = `
  <div class="flex-container-row portfolioEntryRow" style="gap: 1rem; padding: 0 10px; margin-top: 1rem; margin-bottom: -2.5rem;">
    <span class="entry-date entry-header">Date</span>
    <span class="entry-invest entry-header">Invested (€)</span>
    <span class="entry-value entry-header">Value (€)</span>
    <span style="min-width: 5rem;"></span>
  </div>
  `;
  listContainer.append(headerHtml);

  const truncated = !showAll && portfolio.entries.length > ENTRIES_PAGE_SIZE;
  const entriesToRender = truncated ? portfolio.entries.slice(0, ENTRIES_PAGE_SIZE) : portfolio.entries;

  entriesToRender.forEach(function(entry, index) {
    const entryHtml = `
    <div class="portfolioEntry flex-container-column" style="gap: 1rem; padding: 10px; border: 1px solid var(--c-box-border); border-radius: 4px;">
      <div class="flex-container-row portfolioEntryRow" style="gap: 1rem">
        <input value="${entry.date}" class="form-control entry-date" type="date" style="margin-bottom: 0px;"/>
        <input value="${entry.invest}" class="form-control entry-invest" style="margin-bottom: 0px;" placeholder="0.00"/>
        <input value="${entry.value}" class="form-control entry-value" style="margin-bottom: 0px;" placeholder="0.00"/>
        <button class="btn btn-warning delete-entry-btn" data-entry-index="${index}">Delete</button>
      </div>
    </div>
    `;
    listContainer.append(entryHtml);
  });

  if (truncated) {
    const remaining = portfolio.entries.length - ENTRIES_PAGE_SIZE;
    listContainer.append(`<button id="btnShowAllEntries" class="btn btn-secondary btn-sm w-100">Show all (${remaining} more entries)</button>`);
  }
}

// Delete Entry Event
$(document).on("click", ".delete-entry-btn", function () {
  const entryIndex = $(this).data("entry-index");
  showConfirmAlert("entriesModalAlert", "Delete this entry?", function () {
    portfolios[currentPortfolioIndex].entries.splice(entryIndex, 1);
    saveState();
    renderModalEntries(); // Refresh UI
  }, { confirmLabel: "Delete" });
});

$(document).on("click", "#btnShowAllEntries", function () {
  syncModalEntriesToArray();
  renderModalEntries(true);
});

// ---------- PAGE NAVIGATION/SWITCHING ----------

function switchPage(pageSection) {
  // Hide all pages
  $("#btnNavAbout, #btnNavOverview, #btnNavPortfolios").removeClass("active");

  // Switch to pageSection
  $(".page-section").fadeOut(150, function () {
    $(".page-section").hide();
    $("#" + pageSection).fadeIn(150);
  });
  switch (pageSection) {
    case "pageAbout":
      $("#btnNavAbout").addClass("active");
      break;
    case "pageOverview":
      $("#btnNavOverview").addClass("active");
      break;
    case "pagePortfolios":
      $("#btnNavPortfolios").addClass("active");
      break;
  }
}

function setOverviewPage() {
  if (portfolios.length > 0) {
    $("#emptyOverview").hide();
    $("#dataOverview").fadeIn(200);
    updateChart(currentChartMode);
  }
  else {
    $("#dataOverview").hide();
    $("#emptyOverview").fadeIn(200);
  }
}

// ---------- PORTFOLIO ACTION ----------

// Check for valid dates (YYYY-MM-DD)
function isValidDateStr(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }
  const parts = s.split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const dt = new Date(s + "T00:00:00");
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

// Used to normalize imported invest/value fields
function toNumber(v) {
  if (typeof v === "number" && isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function validateImportData(data) {
  if (!Array.isArray(data)) {
    return "JSON must be an array of portfolios.";
  }
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    if (!p || typeof p.name !== "string" || !p.name.trim()) {
      return "Invalid portfolio at index " + i + ": missing a valid name.";
    }
    if (!Array.isArray(p.entries)) {
      return 'Invalid portfolio "' + p.name + '": entries must be an array.';
    }
    for (let k = 0; k < p.entries.length; k++) {
      const e = p.entries[k];
      const where = '"' + p.name + '" entry ' + (k + 1);
      if (!e || typeof e !== "object") {
        return "Invalid " + where + ": not an object.";
      }
      if (!isValidDateStr(e.date)) {
        return "Invalid " + where + ": date must be a valid YYYY-MM-DD date.";
      }
      const invest = toNumber(e.invest);
      if (invest === null) {
        return "Invalid " + where + ": invested must be a number.";
      }
      const value = toNumber(e.value);
      if (value === null) {
        return "Invalid " + where + ": value must be a number.";
      }
      // Normalize so the rest of the app always works with real numbers
      e.invest = invest;
      e.value = value;
    }
  }
  return null;
}

function readImportFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    $("#txtImportJson").val(e.target.result);
    $("#importDropZone").text("✓ " + file.name);
    $("#importAlert").empty();
  };
  reader.readAsText(file);
}

// Replaces all current state with the (already validated) imported portfolios
function performImport(data) {
  portfolios.length = 0;
  $("#portfolioContainer").empty();
  $(".btn-chart-view:not([data-mode='combined'])").remove();
  for (let j = 0; j < data.length; j++) {
    portfolios.push(data[j]);
    addPortfolioToUI(data[j], j);
  }
  hasData = true;
  saveState();
  $("#txtImportJson").val("");
  $("#importAlert").empty();
  setOverviewPage();
  $("#importModal").modal("hide");
}

/* After splicing, all portfolios above the deleted index shift down by one,
update data-index on cards and data-mode on switcher buttons to match */
function deletePortfolio(index) {
  portfolios.splice(index, 1);
  $("#portfolioContainer .portfolio-card").eq(index).remove();
  $(".btn-chart-view[data-mode='" + index + "']").remove();

  $(".btn-portfolio-entries, .btn-portfolio-settings").each(function() {
    const i = parseInt($(this).data("index"));
    if (i > index) {
      $(this).attr("data-index", i - 1);
    }
  });
  $(".btn-chart-view").each(function() {
    const mode = $(this).data("mode");
    if (mode !== "combined" && parseInt(mode) > index) {
      $(this).attr("data-mode", parseInt(mode) - 1);
    }
  });

  if (currentChartMode === index) {
    currentChartMode = "combined";
    $(".btn-chart-view").removeClass("active");
    $(".btn-chart-view[data-mode='combined']").addClass("active");
  }
  else if (typeof currentChartMode === "number" && currentChartMode > index) {
    currentChartMode = currentChartMode - 1;
  }

  saveState();
  if (portfolios.length === 0) {
    hasData = false;
    setOverviewPage();
  }
  else {
    updateChart(currentChartMode);
  }
}

function addPortfolioToUI(portfolio, index) {
  const portfolioHtml = `
    <div id="portfolio${index + 1}" class="box flex-container-row portfolio-card">
        <div class="flex-container-column">
            <label class="form-label">Name</label>
            <input value="${portfolio.name}" disabled class="form-control" style="width: 10rem;"/>
        </div>
        <div class="flex-container-column">
            <button data-index="${index}" class="btn-portfolio-entries btn btn-primary" style="margin-top: 2rem; width: 8rem">Entries</button>
        </div>
        <div class="flex-container-column">
            <button data-index="${index}" class="btn-portfolio-settings btn btn-primary" style="margin-top: 2rem; width: 8rem">Settings</button>
        </div>
    </div>
  `;
  $("#portfolioContainer").append(portfolioHtml);
  $("#chartViewSwitcher").append('<button class="btn btn-primary btn-chart-view" data-mode="' + index + '">' + portfolio.name + '</button>');
}

function createPortfolio() {
  const portfolioName = $("#pName").val();
  const portfolioAmount = $("#pAmount").val();
  const portfolioDate = $("#pDate").val();

  // Error handling
  // If something is missing
  if (!portfolioName || !portfolioAmount || !portfolioDate) {
    showAlert("portfolioAlert", "You need to fill out all fields.");
    return;
  }
  // If portfolio name already exists
  let alreadyExists = false;
  for (let i = 0; i < portfolios.length; i++) {
    if (portfolios[i].name === portfolioName) {
      alreadyExists = true;
      break;
    }
    else {
      alreadyExists = false;
    }
  }
  if (alreadyExists) {
    showAlert("portfolioAlert", "Portfolio name already exists.");
    return;
  }
  $("#portfolioAlert").empty();

  // .val() returns a string and should be converted to a number
  const portfolioAmountNum = parseFloat(portfolioAmount);
  const newPortfolio = createPortfolioObj(
    portfolioName,
    portfolioAmountNum,
    portfolioAmountNum,
    portfolioDate,
  );
  portfolios.push(newPortfolio);
  const currentIndex = portfolios.length - 1;

  addPortfolioToUI(newPortfolio, currentIndex);
  saveState();

  // Empty Inputs
  $("#pName, #pAmount, #pDate").val("");
}

function createPortfolioObj(name, initialInvest, initialValue, initialDate) {
  return {
    name: name,
    entries: [
      {
        invest: initialInvest,
        value: initialValue,
        date: initialDate,
      },
    ],
  };
}

function createEntryObj(invest, value, date) {
  return {
    invest: invest,
    value: value,
    date: date,
  };
}

function createPortfolioEntry(index, date, invest, value) {
  if (index < 0 || index > portfolios.length) {
    return;
  }
  portfolios[index].entries.push(createEntryObj(invest, value, date));
}

// ---------- CHART ----------

// Returns the last known portfolio entry on or before the given date (carry-forward)
function getLatestEntryUpTo(portfolio, date) {
  let latest = null;
  portfolio.entries.forEach(function(event) {
    if (event.date <= date && (latest === null || event.date >= latest.date)) {
      latest = event;
    }
  });
  return latest;
}

function buildChartData(mode) {
  if (mode === "combined") {
    /* Collect all unique dates across all portfolios, then sum up
       the carry-forward value of each portfolio per date */
    const dateSet = new Set();
    portfolios.forEach(function(portfolio) {
      portfolio.entries.forEach(function(event) {
        dateSet.add(event.date);
      });
    });
    const labels = Array.from(dateSet).sort();

    const worthData = labels.map(function(date) {
      let total = 0;
      portfolios.forEach(function(portfolio) {
        const latest = getLatestEntryUpTo(portfolio, date);
        if (latest !== null) {
          total += latest.value;
        }
      });
      return total;
    });
    const investData = labels.map(function(date) {
      let total = 0;
      portfolios.forEach(function(portfolio) {
        const latest = getLatestEntryUpTo(portfolio, date);
        if (latest !== null) {
          total += latest.invest;
        }
      });
      return total;
    });
    return { labels: labels, worthData: worthData, investData: investData };
  }
  else {
    const portfolio = portfolios[mode];
    const sorted = portfolio.entries.slice().sort(function(a, b) {
      return a.date.localeCompare(b.date);
    });
    const labels = sorted.map(function(e) { return e.date; });
    const worthData = sorted.map(function(e) { return e.value; });
    const investData = sorted.map(function(e) { return e.invest; });
    return { labels: labels, worthData: worthData, investData: investData };
  }
}

/* All KPI metrics are derived from the last data point of the currently
visible chart view (the slice selected by the timeline range slider) */
function updateKPI(data) {
  const empty = "—";
  if (data.labels.length === 0) {
    $("#kpiCurrentWorth, #kpiInvested, #kpiPnl, #kpiPnlPct, #kpiAth, #kpiDrawdown").text(empty);
    $("#kpiBestPeriod, #kpiBestChange, #kpiWorstPeriod, #kpiWorstChange").text(empty);
    return;
  }

  const last = data.labels.length - 1;
  const value = data.worthData[last];
  const invested = data.investData[last];
  const pnl = value - invested;
  let pnlPct;
  if (invested !== 0) {
    pnlPct = (pnl / invested) * 100;
  }
  else {
    pnlPct = 0;
  }
  let pnlClass;
  if (pnl >= 0) {
    pnlClass = "kpi-positive";
  }
  else {
    pnlClass = "kpi-negative";
  }
  const ath = Math.max.apply(null, data.worthData);
  let maxDrawdown = 0;
  let maxDrawdownEur = 0;
  let peak = data.worthData[0];
  for (let i = 0; i < data.worthData.length; i++) {
    if (data.worthData[i] > peak) {
      peak = data.worthData[i];
    }
    let dd;
    if (peak !== 0) {
      dd = (data.worthData[i] - peak) / peak * 100;
    }
    else {
      dd = 0;
    }
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownEur = data.worthData[i] - peak;
    }
  }
  let drawdownClass;
  if (maxDrawdown >= 0) {
    drawdownClass = "kpi-positive";
  }
  else {
    drawdownClass = "kpi-negative";
  }

  $("#kpiCurrentWorth").text(formatEur(value));
  $("#kpiInvested").text(formatEur(invested));
  $("#kpiPnl").text(formatEurSigned(pnl)).removeClass("kpi-positive kpi-negative").addClass(pnlClass);
  $("#kpiPnlPct").text(formatPctSigned(pnlPct)).removeClass("kpi-positive kpi-negative").addClass(pnlClass);
  $("#kpiAth").text(formatEur(ath));
  $("#kpiDrawdown").text(formatPctSigned(maxDrawdown)).removeClass("kpi-positive kpi-negative").addClass(drawdownClass);
  $("#kpiDrawdownEur").text(formatEurSigned(maxDrawdownEur)).removeClass("kpi-positive kpi-negative").addClass(drawdownClass);

  if (data.labels.length < 2) {
    $("#kpiBestPeriod, #kpiBestChange, #kpiBestEur, #kpiWorstPeriod, #kpiWorstChange, #kpiWorstEur").text(empty);
    return;
  }

  let best = null;
  let worst = null;
  for (let i = 1; i < data.labels.length; i++) {
    /* Time-weighted-like return: (End - Start - FreshCapital) / (Start + FreshCapital) * 100
       Fresh capital = additional deposits this period; if zero the formula reduces to simple % return */
    const freshCapital = data.investData[i] - data.investData[i - 1];
    const denominator = data.worthData[i - 1] + freshCapital;
    let rendite;
    if (denominator !== 0) {
      rendite = (data.worthData[i] - data.worthData[i - 1] - freshCapital) / denominator * 100;
    }
    else {
      rendite = 0;
    }
    const netGain = data.worthData[i] - data.worthData[i - 1] - freshCapital;
    const period = data.labels[i - 1].substring(0, 7) + " → " + data.labels[i].substring(0, 7);
    if (best === null || rendite > best.change) {
      best = { period: period, change: rendite, eur: netGain };
    }
    if (worst === null || rendite < worst.change) {
      worst = { period: period, change: rendite, eur: netGain };
    }
  }

  $("#kpiBestPeriod").text(best.period);
  $("#kpiBestChange").text(formatPctSigned(best.change));
  $("#kpiBestEur").text(formatEurSigned(best.eur));
  $("#kpiWorstPeriod").text(worst.period);
  $("#kpiWorstChange").text(formatPctSigned(worst.change));
  $("#kpiWorstEur").text(formatEurSigned(worst.eur));
}

function updateChart(mode) {
  currentChartMode = mode;
  fullChartData = buildChartData(mode);
  // Reloading data resets the timeline to the full range
  rangeStart = 0;
  rangeEnd = 1;
  markPresetActive("all");
  applyChartRange(true);
}

// Zero-pads a month/day to two digits for building "YYYY-MM-DD" cutoff strings
function pad2(x) {
  return x < 10 ? "0" + x : "" + x;
}

// Highlights the matching preset button
function markPresetActive(preset) {
  $(".btn-preset").removeClass("active");
  if (preset !== null) {
    $(".btn-preset[data-preset='" + preset + "']").addClass("active");
  }
}

/* Builds the cutoff date (inclusive lower bound) for a preset relative to the
   latest data point. "all" is handled separately in applyPreset. */
function presetCutoff(preset, lastLabel) {
  const parts = lastLabel.split("-");
  const y = parseInt(parts[0]);
  const mo = parseInt(parts[1]);
  const day = parseInt(parts[2]);
  if (preset === "ytd") {
    return y + "-01-01";
  }
  let delta;
  if (preset === "1m") {
    delta = -1;
  }
  else if (preset === "3m") {
    delta = -3;
  }
  else if (preset === "1y") {
    delta = -12;
  }
  else {
    delta = -36; // "3y"
  }
  // Shift months while carrying over year boundaries
  const total = y * 12 + (mo - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ny + "-" + pad2(nm) + "-" + pad2(day);
}

/* Applies a date-range preset by moving the timeline start to the first data
point on or after the cutoff date... the end always stays at the latest point */
function applyPreset(preset) {
  const n = fullChartData.labels.length;
  markPresetActive(preset);
  if (n <= 1 || preset === "all") {
    rangeStart = 0;
    rangeEnd = 1;
    applyChartRange(true);
    return;
  }
  const cutoff = presetCutoff(preset, fullChartData.labels[n - 1]);
  let startIdx = 0;
  while (startIdx < n - 1 && fullChartData.labels[startIdx] < cutoff) {
    startIdx++;
  }
  rangeStart = startIdx / (n - 1);
  rangeEnd = 1;
  applyChartRange(true);
}

/* Slices the full dataset down to the window selected by the timeline range
   slider and pushes it into the chart + KPIs. "animate" is only used for the
   initial render, range dragging skips the animation so it stays smooth */
function applyChartRange(animate) {
  const n = fullChartData.labels.length;
  let data;
  if (n === 0) {
    data = { labels: [], worthData: [], investData: [] };
  }
  else {
    let startIdx = Math.round(rangeStart * (n - 1));
    let endIdx = Math.round(rangeEnd * (n - 1));
    if (startIdx < 0) {
      startIdx = 0;
    }
    if (endIdx > n - 1) {
      endIdx = n - 1;
    }
    if (endIdx < startIdx) {
      endIdx = startIdx;
    }
    data = {
      labels: fullChartData.labels.slice(startIdx, endIdx + 1),
      worthData: fullChartData.worthData.slice(startIdx, endIdx + 1),
      investData: fullChartData.investData.slice(startIdx, endIdx + 1),
    };
  }

  combinedChart.data.labels = data.labels;
  combinedChart.data.datasets[0].data = data.worthData;
  combinedChart.data.datasets[1].data = data.investData;
  if (animate) {
    combinedChart.update();
  }
  else {
    combinedChart.update("none");
  }
  updateKPI(data);
  updateTimelineUI();
}

// Positions the handles + selection band and refreshes the start/end date labels
function updateTimelineUI() {
  const startPct = rangeStart * 100;
  const endPct = rangeEnd * 100;
  $("#timelineHandleStart").css("left", startPct + "%");
  $("#timelineHandleEnd").css("left", endPct + "%");
  $("#timelineSelection").css("left", startPct + "%");
  $("#timelineSelection").css("width", (endPct - startPct) + "%");

  const n = fullChartData.labels.length;
  if (n === 0) {
    $("#timelineStartLabel").text("—");
    $("#timelineEndLabel").text("—");
    return;
  }
  const startIdx = Math.round(rangeStart * (n - 1));
  const endIdx = Math.round(rangeEnd * (n - 1));
  $("#timelineStartLabel").text(fullChartData.labels[startIdx]);
  $("#timelineEndLabel").text(fullChartData.labels[endIdx]);
}

/* Maps the pointer X position to a 0..1 fraction of the slider width and moves
   the dragged handle there, keeping a minimum gap of one data point between the
   two handles so at least two points stay visible */
function onTimelineDrag(e) {
  const slider = document.getElementById("timelineSlider");
  const rect = slider.getBoundingClientRect();
  let fraction = (e.clientX - rect.left) / rect.width;
  if (fraction < 0) {
    fraction = 0;
  }
  if (fraction > 1) {
    fraction = 1;
  }

  const n = fullChartData.labels.length;
  let step;
  if (n > 1) {
    step = 1 / (n - 1);
  }
  else {
    step = 1;
  }

  // Manual dragging means we no longer match any preset
  markPresetActive(null);

  if (timelineDragging === "start") {
    if (fraction > rangeEnd - step) {
      fraction = rangeEnd - step;
    }
    if (fraction < 0) {
      fraction = 0;
    }
    rangeStart = fraction;
  }
  else {
    if (fraction < rangeStart + step) {
      fraction = rangeStart + step;
    }
    if (fraction > 1) {
      fraction = 1;
    }
    rangeEnd = fraction;
  }

  applyChartRange(false);
}

const ctx = document.getElementById("chart");
let combinedChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "worth",
        data: [],
        fill: true,
        backgroundColor: "rgba(16, 185, 129, 0.33)",
        borderColor: "rgba(16, 185, 129, 0.66)",
        borderWidth: 3,
        tension: 0.2,
      },
      {
        label: "invested",
        data: [],
        fill: true,
        backgroundColor: "rgba(239, 68, 68, 0.33)",
        borderColor: "rgba(239, 68, 68, 0.66)",
        borderWidth: 3,
        tension: 0.2,
      },
    ],
  },
  options: {
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function (value) {
            return eurFmtAxis.format(value) + " €";
          },
        },
      },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: function (context) {
            return " " + context.dataset.label + ": " + formatEur(context.parsed.y);
          },
          footer: function (items) {
            // Show profit/loss based on worth and invested values at this data point
            const worthItem = items.find(function (i) { return i.dataset.label === "worth"; });
            const investItem = items.find(function (i) { return i.dataset.label === "invested"; });
            if (!worthItem || !investItem) {
              return;
            }
            const diff = worthItem.parsed.y - investItem.parsed.y;
            let pct;
            if (investItem.parsed.y !== 0) {
              pct = diff / investItem.parsed.y * 100;
            }
            else {
              pct = 0;
            }
            return formatEurSigned(diff) + " (" + formatPctSigned(pct) + ")";
          },
        },
      },
    },
  },
});
