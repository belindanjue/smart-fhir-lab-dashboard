/* script.js
 * SMART-on-FHIR Patient Lab Dashboard
 * - Uses SMART launch via fhirclient.js
 * - Reads Patient + Potassium Observations (LOINC 2823-3)
 * - Displays as table + Highcharts line chart
 */

// Utility: simple DOM helper
function $(id) {
  return document.getElementById(id);
}

// Entry point: wait for SMART launch
// Entry point: try SMART launch; if no state param, fall back to dev mode
FHIR.oauth2
  .ready()
  .then(function (client) {
    $("status").textContent =
      "Connected to FHIR server (SMART): " + client.state.serverUrl;

    loadPatient(client);
    loadPotassiumLabs(client);
  })
  .catch(function (error) {
    console.error(error);

    // If there is no SMART 'state' parameter, run in standalone dev mode
    if (String(error).includes("No 'state' parameter")) {
      $("status").textContent =
        "No SMART launch detected – using sandbox dev mode with a test patient.";

      // Public SMART R3 sandbox
      const serverUrl = "https://r3.smarthealthit.org";

      // Hard-coded test patient ID from the sandbox
      // (you can swap this for any valid patient id on r3.smarthealthit.org)
      const patientId = "smart-1288992";

      const client = FHIR.client(serverUrl);
      client.patient = { id: patientId };

      loadPatient(client);
      loadPotassiumLabs(client);
    } else {
      $("status").textContent = "Launch error: " + (error.message || error);
    }
  });

/**
 * Load and display basic patient info
 */
function loadPatient(client) {
  client.patient
    .read()
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
      console.error(err);
      $("patient-info").innerHTML =
        "<p class='error'>Could not load patient details.</p>";
    });
}

/**
 * Load potassium Observations for the current patient
 * LOINC: 2823-3 (Potassium [Moles/volume] in Serum or Plasma)
 */
function loadPotassiumLabs(client) {
  const code = "http://loinc.org|2823-3";

  // Use flat paging to get a simple array of Observation resources
  client
    .request(
      "Observation?patient=" +
        encodeURIComponent(client.patient.id) +
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
          " • No potassium results found for this patient.";
        $("lab-table-body").innerHTML =
          "<tr><td colspan='4'>No potassium results.</td></tr>";
        renderChart([], []);
        return;
      }

      // Parse observations into dates + values
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
      console.error(err);
      $("status").textContent +=
        " • Error loading potassium labs: " + (err.message || err);
      $("lab-table-body").innerHTML =
        "<tr><td colspan='4'>Error loading labs.</td></tr>";
      renderChart([], []);
    });
}

/**
 * Render a simple line chart using Highcharts
 */
function renderChart(dates, values) {
  if (dates.length === 0 || values.length === 0) {
    // Show an empty chart placeholder
    Highcharts.chart("lab-chart", {
      title: { text: "No data to display" },
      xAxis: { categories: [] },
      series: [],
    });
    return;
  }

  Highcharts.chart("lab-chart", {
    chart: {
      type: "line",
    },
    title: {
      text: "Serum Potassium Over Time",
    },
    xAxis: {
      categories: dates,
      title: { text: "Date" },
    },
    yAxis: {
      title: { text: "Potassium (mmol/L)" },
    },
    tooltip: {
      shared: true,
      valueDecimals: 2,
    },
    series: [
      {
        name: "Potassium",
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
  // Prefer effectiveDateTime, fall back to issued
  if (obs.effectiveDateTime) {
    return obs.effectiveDateTime.substring(0, 10);
  }
  if (obs.issued) {
    return obs.issued.substring(0, 10);
  }
  return "";
}
