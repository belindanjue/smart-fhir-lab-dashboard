/* script.js
 * SMART-on-FHIR Cholesterol Lab Dashboard
 * - Uses SMART launch via fhirclient.js when available
 * - Falls back to dev mode with a fixed patient on the public R3 server
 * - Reads Patient + Total Cholesterol Observations (LOINC 2093-3)
 * - Displays as table + Highcharts line chart
 */

function $(id) {
  return document.getElementById(id);
}

// ---------- Config for dev fallback ----------
const DEV_SERVER_URL = "https://r3.smarthealthit.org";
// You can change this to another patient ID that has cholesterol labs
const DEV_PATIENT_ID = "smart-1288992";

// ---------- Entry point ----------
FHIR.oauth2
  .ready()
  .then(function (client) {
    $("status").textContent =
      "Connected to FHIR server (SMART): " + client.state.serverUrl;

    const patientId = client.patient && client.patient.id
      ? client.patient.id
      : null;

    loadPatient(client, patientId);
    loadCholesterolLabs(client, patientId);
  })
  .catch(function (error) {
    console.error("SMART launch error:", error);

    // If there is no SMART 'state' parameter, run in standalone dev mode
    if (String(error).includes("No 'state' parameter")) {
      $("status").textContent =
        "No SMART launch detected – using sandbox dev mode with a test patient.";

      const client = FHIR.client(DEV_SERVER_URL);
      const patientId = DEV_PATIENT_ID;

      loadPatient(client, patientId);
      loadCholesterolLabs(client, patientId);
    } else {
      $("status").textContent = "Launch error: " + (error.message || error);
    }
  });

/**
 * Load and display basic patient info.
 * If patientId is provided, fetch via plain FHIR `Patient/{id}`.
 * If not, try to use `client.patient.read()` (SMART context).
 */
function loadPatient(client, patientId) {
  let patientPromise;

  if (patientId) {
    // Standalone or explicit patient ID
    patientPromise = client.request("Patient/" + encodeURIComponent(patientId));
  } else if (client.patient && typeof client.patient.read === "function") {
    // SMART app with patient context
    patientPromise = client.patient.read();
  } else {
    $("patient-info").innerHTML =
      "<p class='error'>No patient context available.</p>";
    return;
  }

  patientPromise
    .then(function (patient) {
      const name = formatHumanName(patient.name && patient.name[0]);
      const gender = patient.gender || "unknown";
      const dob = patient.birthDate || "unknown";
      const id = patient.id || "(no id)";

      $("patient-info").innerHTML = `
        <dl class="patient-grid">
          <div>
            <dt>Name</dt><dd>${name}</dd>
          </div>
          <div>
            <dt>Gender</dt><dd>${capitalize(gender)}</dd>
          </div>
          <div>
            <dt>Date of Birth</dt><dd>${dob}</dd>
          </div>
          <div>
            <dt>Patient ID</dt><dd>${id}</dd>
          </div>
        </dl>
      `;
    })
    .catch(function (err) {
      console.error("Error loading patient:", err);
      $("patient-info").innerHTML =
        "<p class='error'>Could not load patient details.</p>";
    });
}

/**
 * Load Total Cholesterol Observations for the current patient
 * LOINC: 2093-3 (Total Cholesterol)
 */
function loadCholesterolLabs(client, patientId) {
  const pid =
    patientId ||
    (client.patient && client.patient.id ? client.patient.id : null);

  if (!pid) {
    $("status").textContent +=
      " • No patient ID available for cholesterol query.";
    $("lab-table-body").innerHTML =
      "<tr><td colspan='4'>No patient ID available.</td></tr>";
    renderChart([], []);
    return;
  }

  const code = "http://loinc.org|2093-3"; // Total cholesterol

  client
    .request(
      "Observation?patient=" +
        encodeURIComponent(pid) +
        "&code=" +
        encodeURIComponent(code) +
        "&_sort=date",
      {
        pageLimit: 3, // up to 3 pages
        flat: true,
      }
    )
    .then(function (observations) {
      if (!observations || observations.length === 0) {
        $("status").textContent +=
          " • No cholesterol results found for this patient.";
        $("lab-table-body").innerHTML =
          "<tr><td colspan='4'>No cholesterol results.</td></tr>";
        renderChart([], []);
        return;
      }

      const dates = [];
      const values = [];

      const tbody = $("lab-table-body");
      tbody.innerHTML = "";

      observations.forEach(function (obs) {
        const date = getObservationDate(obs);
        const valueQuantity = obs.valueQuantity || {};
        const value = valueQuantity.value;
        const unit = valueQuantity.unit || valueQuantity.code || "";
        const status = obs.status || "";

        if (date && typeof value === "number") {
          dates.push(date);
          values.push(value);
        }

        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${date || ""}</td>
          <td>${value != null ? value : ""}</td>
          <td>${unit}</td>
          <td>${status}</td>
        `;
        tbody.appendChild(row);
      });

      renderChart(dates, values);
    })
    .catch(function (err) {
      console.error("Error loading cholesterol labs:", err);
      $("status").textContent +=
        " • Error loading cholesterol labs: " + (err.message || err);
      $("lab-table-body").innerHTML =
        "<tr><td colspan='4'>Error loading labs.</td></tr>";
      renderChart([], []);
    });
}

/**
 * Render a line chart using Highcharts
 */
function renderChart(dates, values) {
  if (!dates || dates.length === 0 || !values || values.length === 0) {
    Highcharts.chart("lab-chart", {
      title: { text: "No data to display" },
      xAxis: { categories: [] },
      series: [],
      credits: { enabled: false },
    });
    return;
  }

  Highcharts.chart("lab-chart", {
    chart: {
      type: "line",
    },
    title: {
      text: "Total Cholesterol Over Time",
    },
    xAxis: {
      categories: dates,
      title: { text: "Date" },
    },
    yAxis: {
      title: { text: "Cholesterol (e.g., mg/dL)" },
    },
    tooltip: {
      shared: true,
      valueDecimals: 2,
    },
    series: [
      {
        name: "Total Cholesterol",
        data: values,
      },
    ],
    credits: {
      enabled: false,
    },
  });
}

/* ---------- Small helpers ---------- */

function formatHumanName(name) {
  if (!name) return "(no name)";
  const given = (name.given || []).join(" ");
  const family = name.family || "";
  const full = (given + " " + family).trim();
  return full || "(no name)";
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getObservationDate(obs) {
  if (obs.effectiveDateTime) {
    return obs.effectiveDateTime.substring(0, 10);
  }
  if (obs.issued) {
    return obs.issued.substring(0, 10);
  }
  return "";
}
