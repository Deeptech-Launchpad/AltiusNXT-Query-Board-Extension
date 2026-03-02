document.addEventListener("DOMContentLoaded", function () {
  // ======================================================
  // 1. INITIALIZATION & CONFIG
  // ======================================================
  const API_URL = "https://qb.altiusnxt.com/api";
  let currentUserEmail = "";
  let currentUserRole = "";
  let currentUserIsAdmin = false;

  // GLOBAL DATA LISTS
  let allProjects = [];
  let allBatches = []; // Added for new field
  let allCategories = [];
  let allAttributes = [];
  let selectedAttributes = [];


  const today = new Date().toISOString().split('T')[0];

    // Disable future dates for History Search
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    if (startInput) startInput.setAttribute('max', today);
    if (endInput) endInput.setAttribute('max', today);

    // Disable future dates for Export Logs
    const expStart = document.getElementById('exportStartDate');
    const expEnd = document.getElementById('exportEndDate');
    if (expStart) expStart.setAttribute('max', today);
    if (expEnd) expEnd.setAttribute('max', today);

  // --- DOM ELEMENTS ---
  chrome.runtime.sendMessage({ action: "clear_badge" });
  const validateBtn = document.getElementById("validateBtn");
  const checkDecisionBtn = document.getElementById("checkDecisionBtn");
  const checkFeedbackBtn = document.getElementById("checkFeedbackBtn");

  // Inputs & Dropdowns
  const projectInput = document.getElementById("projectInput");
  const customProjectList = document.getElementById("customProjectList");

  // New Batch Elements
  const batchInput = document.getElementById("batchInput");
  const customBatchList = document.getElementById("customBatchList");

  const categoryInput = document.getElementById("categoryInput");
  const customList = document.getElementById("customCategoryList");
  const attributeInput = document.getElementById("attributeInput");
  const customAttributeList = document.getElementById("customAttributeList");
  const attributeTagsContainer = document.getElementById("attributeTagsContainer",);

  // Overlays & Containers
  const resultsOverlay = document.getElementById("dbResults");
  const resultsContainer = document.getElementById("resultsContainer");
  const resultsTitle = document.getElementById("resultsTitle");
  const searchContext = document.getElementById("searchContext");

  // Header Actions
  const closeOverlayBtn = document.getElementById("closeOverlayBtn");
  const askNewQueryBtn = document.getElementById("askNewQueryBtn");
  const closeWindowBtn = document.getElementById("closeWindowBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const exportBtn = document.getElementById("exportBtn");
  const adminStatusBtn = document.getElementById("adminStatusBtn");
  const userStatusBtn = document.getElementById("userStatusBtn");

  // Final Query Form
  const finalStep = document.getElementById("finalStep");
  const urlField = document.getElementById("urlField");
  const submitBtn = document.getElementById("submitBtn");

  function initApp() {
    loadProjects();
    batchInput.disabled = true;
    categoryInput.disabled = true;
    attributeInput.disabled = true;

    chrome.action.setBadgeText({ text: "" });

    chrome.identity.getProfileUserInfo(
      { accountStatus: "ANY" },
      function (info) {
        // Only proceed if a valid email is found
        if (info && info.email && info.email.trim() !== "") {
          currentUserEmail = info.email;
          checkRolesAndInitButtons(currentUserEmail);
          logUserAction("Just Opened");
        } else {
          // Block access for Guest users
          currentUserEmail = "";
          document.body.innerHTML = `
                    <div style="padding: 20px; text-align: center; font-family: sans-serif;">
                        <i class="fas fa-exclamation-circle" style="font-size: 40px; color: #e74c3c; margin-bottom: 15px;"></i>
                        <h2 style="font-size: 16px;">Access Denied</h2>
                        <p style="font-size: 13px; color: #666;">Please sign in to Chrome with your official email to use the Query Board.</p>
                    </div>`;
        }
      },
    );
  }

  initApp();

  // ======================================================
  // 2. HELPER FUNCTIONS
  // ======================================================

    if (expStart && expEnd) {
        // Step A: Disable future dates globally
        expStart.setAttribute('max', today);
        expEnd.setAttribute('max', today);

        // Step B: Real-time validation for "From" Date
        expStart.addEventListener('change', () => {
            if (expEnd.value && new Date(expStart.value) > new Date(expEnd.value)) {
                alert("The 'From' date cannot be later than the 'To' date. Resetting selection.");
                expStart.value = ""; // Clear the invalid input immediately
            }
        });

        // Step C: Real-time validation for "To" Date
        expEnd.addEventListener('change', () => {
            if (expStart.value && new Date(expEnd.value) < new Date(expStart.value)) {
                alert("The 'To' date cannot be earlier than the 'From' date. Resetting selection.");
                expEnd.value = ""; // Clear the invalid input immediately
            }
        });
    }

  function updateMainButton() {
    if (!categoryInput) return;
    const catVal = categoryInput.value.toLowerCase().trim();
    const hasSelection =
      projectInput.value && catVal && selectedAttributes.length > 0;

    // Update Check Query Button
    validateBtn.innerHTML = '<i class="fas fa-search"></i> Check Posted Query';
    validateBtn.classList.add("btn-primary");
    validateBtn.classList.remove("btn-general-active");

    // Update Check Decision & Feedback Buttons
    if (hasSelection) {
      checkDecisionBtn.disabled = false;
      checkDecisionBtn.classList.remove("btn-disabled");
      checkDecisionBtn.classList.add("btn-primary");

      checkFeedbackBtn.disabled = false;
      checkFeedbackBtn.classList.remove("btn-disabled");
      checkFeedbackBtn.classList.add("btn-primary");
    } else {
      checkDecisionBtn.disabled = true;
      checkDecisionBtn.classList.add("btn-disabled");
      checkDecisionBtn.classList.remove("btn-primary");

      checkFeedbackBtn.disabled = true;
      checkFeedbackBtn.classList.add("btn-disabled");
      checkFeedbackBtn.classList.remove("btn-primary");
    }
  }

  function autoResize(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  // ======================================================
  // 3. GLOBAL HEADER LISTENERS
  // ======================================================

  if (exportBtn) {
    exportBtn.addEventListener("click", function () {
      const selectedProject = projectInput.value.trim();
      const selectedBatch = batchInput.value.trim(); // Get current batch context

      if (!selectedProject) {
        alert("Please select a specific Project first.");
        return;
      }

      // Build URL with optional batch parameter
      let exportUrl = `${API_URL}/export_logs?project=${encodeURIComponent(selectedProject)}`;
      if (selectedBatch) {
        exportUrl += `&batch=${encodeURIComponent(selectedBatch)}`;
      }

      window.open(exportUrl, "_blank");
    });
  }

  refreshBtn.addEventListener("click", function () {
    const icon = this.querySelector("i");
    icon.classList.add("fa-spin");

    loadProjects();
    if (currentUserEmail) checkRolesAndInitButtons(currentUserEmail);

    // Reset Form
    projectInput.value = "";
    batchInput.value = ""; // Added
    batchInput.disabled = true; // Added
    categoryInput.value = "";
    categoryInput.disabled = true;
    attributeInput.value = "";
    attributeInput.disabled = true;
    selectedAttributes = [];
    renderAttributeTags();
    updateMainButton();

    setTimeout(() => icon.classList.remove("fa-spin"), 1000);
  });

  // Inside DOMContentLoaded
  const adminIcon = document.getElementById("adminIcon");
  const adminOverlay = document.getElementById("adminOverlay");
  const schemaFileInput = document.getElementById("schemaFileInput");
  const processUploadBtn = document.getElementById("processUploadBtn");

  // 1. Show icon only for Admins/PLs
  if (currentUserRole === "PL" || currentUserIsAdmin) {
    adminIcon.style.display = "block";
  }

  // 2. Open/Close Overlay
  adminIcon.addEventListener(
    "click",
    () => (adminOverlay.style.display = "block"),
  );
  document
    .getElementById("closeAdmin")
    .addEventListener("click", () => (adminOverlay.style.display = "none"));

  // 3. File Selection
  document
    .getElementById("triggerUpload")
    .addEventListener("click", () => schemaFileInput.click());
  schemaFileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      document.getElementById("fileNameDisplay").innerText =
        e.target.files[0].name;
      processUploadBtn.disabled = false;
    }
  });

  // 4. Send File to Server
  processUploadBtn.addEventListener("click", async () => {
    const file = schemaFileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", "append_schema");

    processUploadBtn.innerText = "Processing...";
    processUploadBtn.disabled = true;

    try {
      const response = await fetch(`${API_URL}/admin/upload_schema`, {
        method: "POST",
        body: formData, // Fetch handles Content-Type for FormData
      });
      const result = await response.json();
      alert(result.message);
      adminOverlay.style.display = "none";
    } catch (err) {
      console.error(err);
      alert("Upload failed.");
    } finally {
      processUploadBtn.innerText = "Upload & Sync DB";
      processUploadBtn.disabled = false;
    }
  });

  if (closeWindowBtn) {
    closeWindowBtn.addEventListener("click", () =>
      window.parent.postMessage({ action: "close_sidebar" }, "*"),
    );
  }

  // ======================================================
  // 4. PROJECT LOGIC
  // ======================================================

  function loadProjects() {
    fetch(`${API_URL}/projects`)
      .then((res) => res.json())
      .then((data) => {
        allProjects = data;
      })
      .catch((err) => console.error("Project Load Error", err));
  }

  function renderProjectList(items) {
    customProjectList.innerHTML = "";
    if (!items || items.length === 0) {
      customProjectList.style.display = "none";
      return;
    }
    customProjectList.style.display = "block";

    items.forEach((proj) => {
      let item = document.createElement("div");
      item.className = "dropdown-item";
      item.textContent = proj;

      if (
        projectInput.value &&
        proj.toLowerCase() === projectInput.value.toLowerCase()
      ) {
        item.style.fontWeight = "bold";
        item.style.backgroundColor = "#eef2ff";
      }

      item.addEventListener("click", function () {
        selectProject(proj);
      });
      customProjectList.appendChild(item);
    });
  }

  function selectProject(projName) {
    projectInput.value = projName;
    autoResize(projectInput);
    customProjectList.style.display = "none";

    // Enable Batch and Category inputs
    batchInput.disabled = false;
    batchInput.value = "";
    categoryInput.disabled = false;
    categoryInput.value = "";

    // 1. Fetch available batches for the dropdown
    fetchBatches(projName);

    // 2. CRITICAL FIX: Fetch ALL categories for the project immediately
    // We pass an empty string for batch so the filter is not applied
    fetchCategories(projName, "");

    updateMainButton();
  }
  projectInput.addEventListener("input", function () {
    autoResize(this);
    const searchText = this.value.toLowerCase();
    if (searchText === "") {
      batchInput.disabled = true; // Added
      batchInput.value = "";
      categoryInput.disabled = true;
      categoryInput.value = "";
      attributeInput.disabled = true;
      attributeInput.value = "";
      selectedAttributes = [];
      renderAttributeTags();
    }
    let filtered = allProjects.filter((p) =>
      p.toLowerCase().includes(searchText),
    );
    renderProjectList(filtered);
  });

  projectInput.addEventListener("focus", function () {
    if (allProjects.length > 0) {
      if (!this.value) renderProjectList(allProjects);
      else this.dispatchEvent(new Event("input"));
      customProjectList.style.display = "block";
    }
  });

  // ======================================================
  // 5. BATCH LOGIC (NEW FIELD)
  // ======================================================

  function fetchBatches(project) {
    allBatches = [];
    fetch(`${API_URL}/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: project }),
    })
      .then((res) => res.json())
      .then((data) => {
        allBatches = data;
      });
  }

  function renderBatchList(items) {
    customBatchList.innerHTML = "";
    if (!items || items.length === 0) {
      customBatchList.style.display = "none";
      return;
    }
    // Final JS Sort for absolute accuracy
    items.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );

    customBatchList.style.display = "block";
    items.forEach((batch) => {
      let item = document.createElement("div");
      item.className = "dropdown-item";
      item.textContent = batch;
      item.addEventListener("click", () => selectBatch(batch));
      customBatchList.appendChild(item);
    });
  }

  function selectBatch(batchName) {
    batchInput.value = batchName;
    autoResize(batchInput);
    customBatchList.style.display = "none";

    // REMOVED: fetchCategories(projectInput.value, batchName);
    // We no longer re-fetch categories here because we want to see
    // all categories for the project at all times.

    updateMainButton();
  }

  batchInput.addEventListener("input", function () {
    autoResize(this);
    const searchText = this.value.toLowerCase();
    let filtered = allBatches.filter((b) =>
      b.toLowerCase().includes(searchText),
    );
    renderBatchList(filtered);
  });

  batchInput.addEventListener("focus", function () {
    if (!this.disabled && allBatches.length > 0) {
      if (!this.value) renderBatchList(allBatches);
      else this.dispatchEvent(new Event("input"));
      customBatchList.style.display = "block";
    }
  });

  // ======================================================
  // 6. CATEGORY LOGIC
  // ======================================================

  function fetchCategories(project, batch = "") {
    allCategories = [];
    customList.innerHTML = "";
    fetch(`${API_URL}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: project,
        // You can keep passing batch if the server handles it,
        // but for total decoupling, you can pass ""
        batch: "",
      }),
    })
      .then((res) => res.json())
      .then((categories) => {
        allCategories = categories;
      });
  }

  function renderCustomList(items) {
    customList.innerHTML = "";
    if (!items || items.length === 0) {
      customList.style.display = "none";
      return;
    }
    customList.style.display = "block";

    items.forEach((cat) => {
      let item = document.createElement("div");
      item.className = "dropdown-item";
      item.textContent = cat;
      if (
        categoryInput.value &&
        cat.toLowerCase() === categoryInput.value.toLowerCase()
      ) {
        item.style.fontWeight = "bold";
        item.style.backgroundColor = "#eef2ff";
      }
      item.addEventListener("click", function () {
        selectCategory(cat);
      });
      customList.appendChild(item);
    });
  }

  function selectCategory(catName) {
    categoryInput.value = catName;
    autoResize(categoryInput);
    customList.style.display = "none";
    attributeInput.disabled = false;

    // Updated logic to include General-Classification
    const isGeneral = catName.toLowerCase().startsWith("general");

    if (isGeneral) {
      attributeInput.placeholder = "Select or Type Custom Attribute...";
    } else {
      attributeInput.placeholder = "Type or Select (Multi)...";
    }

    attributeInput.value = "";
    selectedAttributes = [];
    renderAttributeTags();

    if (projectInput.value) {
      fetchAttributes(projectInput.value, catName);
    }
    updateMainButton();
  }

  categoryInput.addEventListener("input", function () {
    autoResize(this);
    const searchText = this.value.toLowerCase();
    if (searchText === "") {
      attributeInput.disabled = true;
      attributeInput.value = "";
      selectedAttributes = [];
      renderAttributeTags();
    }
    let filtered = allCategories.filter((cat) =>
      cat.toLowerCase().includes(searchText),
    );
    filtered.sort((a, b) => {
      if (a.toLowerCase() === searchText) return -1;
      if (b.toLowerCase() === searchText) return 1;
      return 0;
    });
    renderCustomList(filtered);
    updateMainButton();
  });

  categoryInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = this.value.toLowerCase();
      const exactMatch = allCategories.find((c) => c.toLowerCase() === val);
      if (exactMatch) selectCategory(exactMatch);
      else if (customList.firstChild) customList.firstChild.click();
    }
  });

  categoryInput.addEventListener("focus", function () {
    // This condition now only checks if the field is enabled and has data.
    // It NO LONGER checks for batchInput.value
    if (!this.disabled && allCategories.length > 0) {
      if (this.value) {
        this.dispatchEvent(new Event("input"));
      } else {
        renderCustomList(allCategories);
      }
    }
  });

  // ======================================================
  // 7. ATTRIBUTE LOGIC
  // ======================================================

  function fetchAttributes(project, category) {
    allAttributes = [];
    customAttributeList.innerHTML = "";
    fetch(`${API_URL}/attributes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: project, // This must be the Project Name (e.g. Grainger)
        category: category,
      }),
    })
      .then((res) => res.json())
      .then((attributes) => {
        let uniqueAttrs = [...new Set(attributes)];
        uniqueAttrs = uniqueAttrs.filter(
          (item) => item.toLowerCase() !== "general",
        );
        uniqueAttrs.sort((a, b) => a.localeCompare(b));
        allAttributes = uniqueAttrs;
      });
  }

  function renderAttributeTags() {
    attributeTagsContainer.innerHTML = "";
    selectedAttributes.forEach((attr, index) => {
      const tag = document.createElement("span");
      tag.style.cssText =
        "background: #eef2ff; color: #667eea; padding: 2px 8px; border-radius: 12px; font-size: 11px; border: 1px solid #667eea; display: inline-flex; align-items: center; gap: 5px;";
      tag.innerHTML = `${attr} <i class="fas fa-times" style="cursor:pointer;"></i>`;

      tag.querySelector("i").addEventListener("click", (e) => {
        e.stopPropagation();
        selectedAttributes.splice(index, 1);
        renderAttributeTags();
        updateMainButton();
      });

      attributeTagsContainer.appendChild(tag);
    });
    autoResize(attributeInput);
  }

  function renderAttributeList(items) {
    customAttributeList.innerHTML = "";
    if (!items || items.length === 0) {
      customAttributeList.style.display = "none";
      return;
    }
    customAttributeList.style.display = "block";

    items.forEach((attr) => {
      let item = document.createElement("div");
      item.className = "dropdown-item";
      item.textContent = attr;

      if (selectedAttributes.includes(attr)) {
        item.style.fontWeight = "bold";
        item.style.backgroundColor = "#eef2ff";
        item.innerHTML +=
          ' <i class="fas fa-check" style="font-size:10px; color:#667eea; margin-left:5px;"></i>';
      }

      item.addEventListener("click", function () {
        selectAttribute(attr);
      });
      customAttributeList.appendChild(item);
    });
  }

  function selectAttribute(attrName) {
    if (!attrName) return;

    // 1. Check if the attribute name contains a pipe separator
    const attributesToAdd = attrName.includes("|")
      ? attrName.split("|").map((a) => a.trim())
      : [attrName.trim()];

    // 2. Loop through each individual attribute
    attributesToAdd.forEach((individualAttr) => {
      if (!individualAttr) return;

      // Check if this specific attribute is already in our selected list
      const exists = selectedAttributes.some(
        (a) => a.toLowerCase() === individualAttr.toLowerCase(),
      );

      if (!exists) {
        selectedAttributes.push(individualAttr);
      }
    });

    // 3. Refresh UI and reset input
    renderAttributeTags();
    attributeInput.value = "";
    attributeInput.focus();
    customAttributeList.style.display = "none";
    updateMainButton();
  }

  attributeInput.addEventListener("input", function () {
    autoResize(this);
    const searchText = this.value.toLowerCase();
    let filtered = allAttributes.filter((attr) =>
      attr.toLowerCase().includes(searchText),
    );

    filtered.sort((a, b) => {
      if (a.toLowerCase() === searchText) return -1;
      if (b.toLowerCase() === searchText) return 1;
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    renderAttributeList(filtered);
  });

  attributeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = this.value.trim();
      const lowerVal = val.toLowerCase();

      if (!val) return;

      // 1. Check for pipe (Split logic)
      if (val.includes("|")) {
        const parts = val
          .split("|")
          .map((s) => s.trim())
          .filter((s) => s);
        parts.forEach((part) => {
          selectAttribute(part);
          if (categoryInput.value.toLowerCase().startsWith("general")) {
            saveCustomAttribute(part);
          }
        });
        return;
      }

      // 2. Existing Match
      const exactMatch = allAttributes.find(
        (a) => a.toLowerCase() === lowerVal,
      );

      if (exactMatch) {
        selectAttribute(exactMatch);
      } else {
        // 3. Custom Attribute Logic
        const currentCategory = categoryInput.value.toLowerCase();
        if (currentCategory.startsWith("general")) {
          saveCustomAttribute(val);
        } else {
          if (customAttributeList.firstChild) {
            customAttributeList.firstChild.click();
          }
        }
      }
    }
  });

  function saveCustomAttribute(val) {
    attributeInput.disabled = true;
    attributeInput.placeholder = "Saving...";

    fetch(`${API_URL}/save_attribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: projectInput.value,
        category: categoryInput.value,
        attribute: val,
        userEmail: currentUserEmail,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        attributeInput.disabled = false;
        attributeInput.placeholder = "Select or Type Custom Attribute...";
        attributeInput.focus();

        if (data.status === "success") {
          selectAttribute(val);
          if (!allAttributes.includes(val)) {
            allAttributes.push(val);
            allAttributes.sort();
          }
        } else {
          alert("Error saving attribute: " + data.message);
        }
      });
  }

  attributeInput.addEventListener("focus", function () {
    if (!this.disabled && allAttributes.length > 0) {
      if (!this.value) renderAttributeList(allAttributes);
      else this.dispatchEvent(new Event("input"));
      customAttributeList.style.display = "block";
    }
  });

  // ======================================================
  // 8. GLOBAL DOCUMENT CLICK HANDLER (DROPDOWNS)
  // ======================================================
  document.addEventListener("click", function (e) {
    if (
      !projectInput.contains(e.target) &&
      !customProjectList.contains(e.target)
    ) {
      customProjectList.style.display = "none";
    }
    if (!batchInput.contains(e.target) && !customBatchList.contains(e.target)) {
      customBatchList.style.display = "none"; // Added
    }
    if (!categoryInput.contains(e.target) && !customList.contains(e.target)) {
      customList.style.display = "none";
    }
    if (
      !attributeInput.contains(e.target) &&
      !customAttributeList.contains(e.target)
    ) {
      customAttributeList.style.display = "none";
    }
  });

  // ======================================================
  // 9. ROLE & DASHBOARD MANAGEMENT
  // ======================================================

  function checkRolesAndInitButtons(email) {
    const uBtn = document.getElementById("userStatusBtn");
    const aBtn = document.getElementById("adminStatusBtn");
    const expBtn = document.getElementById("exportBtn");
    const adminIcon = document.getElementById("adminIcon");

    if (uBtn) uBtn.style.display = "none";
    if (aBtn) aBtn.style.display = "none";
    if (expBtn) expBtn.style.display = "none";
    if (adminIcon) adminIcon.style.display = "none";

    fetch(`${API_URL}/check_role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: email }),
    })
      .then((res) => res.json())
      .then((data) => {
        currentUserRole = data.role;
        currentUserIsAdmin = data.is_admin;

        // Show Up Arrow for all 4 admin roles
        const adminRoles = ["TL", "PL", "PM", "SME"];
        if (adminRoles.includes(data.role) || data.is_admin) {
          if (adminIcon) adminIcon.style.display = "block";
        }

        // UPDATED LOGIC: Allow all admin roles to see the dashboard and export features
        if (data.is_admin || adminRoles.includes(data.role)) {
          initAdminButton();
          const adminExportContainer = document.getElementById(
            "admin-export-container",
          );
          if (adminExportContainer)
            adminExportContainer.style.display = "block";
          setupExportListeners();
        } else {
          initUserButton();
        }
      })
      .catch((err) => {
        console.error("Role Check Error:", err);
        initUserButton();
      });
  }

  // 2. Overlay & Icon Event Listeners
  const adminIconEl = document.getElementById("adminIcon");
  const adminOverlayEl = document.getElementById("adminOverlay");
  const closeAdminEl = document.getElementById("closeAdmin");

  if (adminIconEl) {
    adminIconEl.addEventListener("click", () => {
      adminOverlayEl.style.display = "block";
    });
  }

  if (closeAdminEl) {
    closeAdminEl.addEventListener("click", () => {
      adminOverlayEl.style.display = "none";
    });
  }

  document.getElementById("downloadTemplateBtn")
    .addEventListener("click", function () {
      // Direct link to your AWS server API
      const downloadUrl = `${API_URL}/download_schema_template`;
      
      // Trigger the download via the browser
      window.open(downloadUrl, '_blank');
      
      // Log the activity
      logUserAction("KB Log", {
          query_id: "Downloaded Schema Template"
      });
    });

  function initUserButton() {
    const btn = document.getElementById("userStatusBtn");
    if (!btn) return;

    btn.style.display = "flex";
    const newBtn = btn.cloneNode(true); // Remove old listeners
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener("click", () => fetchUserHistory());
    updateUserButtonState();
  }

  function updateUserButtonState() {
    const btn = document.getElementById("userStatusBtn");
    if (!btn) return;

    fetch(`${API_URL}/my_history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: currentUserEmail }),
    })
      .then((res) => res.json())
      .then((data) => {
        const seenIds = JSON.parse(
          localStorage.getItem("seen_query_ids") || "[]",
        );

        const hasPendingQueries = data.filter(
          (q) => q.status && q.status.toLowerCase() === "pending",
        );
        const hasProposedDecisions = data.filter(
          (q) => q.status && q.status.toLowerCase() === "proposed",
        );

        const newResponses = data.filter(
          (q) =>
            q.status &&
            q.status.toLowerCase() === "closed" &&
            !seenIds.includes(q.id),
        );
        // FIXED: Include Rejected status so users are notified of rejections too
        const newApprovedDecisions = data.filter(
          (q) =>
            (q.status === "Active" || q.status === "Rejected") &&
            !seenIds.includes(q.id),
        );

        btn.classList.remove("status-green", "status-orange", "status-yellow");
        btn.innerHTML = "";

        if (newResponses.length > 0 || newApprovedDecisions.length > 0) {
          btn.classList.add("status-yellow");
          btn.innerHTML = '<i class="fas fa-envelope-open-text"></i>';
          btn.title = "New Response Received";
        } else if (
          hasPendingQueries.length > 0 ||
          hasProposedDecisions.length > 0
        ) {
          btn.classList.add("status-orange");
          btn.innerHTML = '<i class="fas fa-hourglass-half"></i>';
          btn.title = "Waiting for Admin Approval";
        } else {
          btn.classList.add("status-green");
          btn.innerHTML = '<i class="fas fa-check"></i>';
          btn.title = "All Clear";
        }
      })
      .catch(() => {
        btn.classList.add("status-green");
        btn.innerHTML = '<i class="fas fa-check"></i>';
      });
  }

  function fetchUserHistory() {
    resultsContainer.innerHTML =
      '<p style="text-align:center;">Loading your history...</p>';
    resultsOverlay.style.display = "flex";
    resultsTitle.innerText = "My Query History";
    if (searchContext) searchContext.innerText = currentUserEmail;

    fetch(`${API_URL}/my_history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: currentUserEmail }),
    })
      .then((res) => res.json())
      .then((data) => {
        renderResults(data, "user_history");

        // MARK AS SEEN: Add all responded IDs to seen list
        const seenIds = JSON.parse(
          localStorage.getItem("seen_query_ids") || "[]",
        );
        data.forEach((q) => {
          const status = q.status.toLowerCase();
          // FIXED: Include Active and Rejected so the badge clears for Decisions too
          if (
            ["closed", "active", "rejected"].includes(status) &&
            !seenIds.includes(q.id)
          ) {
            seenIds.push(q.id);
          }
        });
        localStorage.setItem("seen_query_ids", JSON.stringify(seenIds));

        updateUserButtonState();
      });
  }

  function initAdminButton() {
    const btn = document.getElementById("adminStatusBtn");
    if (!btn) return;
    btn.style.display = "flex";
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener("click", () => fetchPendingQueries());
    updateAdminButtonState();
  }

  function updateAdminButtonState() {
    const btn = document.getElementById("adminStatusBtn");
    if (!btn) return;

    const inboxPromise = fetch(`${API_URL}/pending_queries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: currentUserEmail }),
    }).then((res) => res.json());

    const askedPromise = fetch(`${API_URL}/my_history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: currentUserEmail }),
    }).then((res) => res.json());

    Promise.all([inboxPromise, askedPromise])
      .then(([inboxData, askedData]) => {
        const seenInboxIds = JSON.parse(
          localStorage.getItem("seen_inbox_ids") || "[]",
        );
        const seenResponseIds = JSON.parse(
          localStorage.getItem("seen_query_ids") || "[]",
        );

        // 1. Logic for Queries Asked (Admin as User)
        const askedPending = askedData.filter(
          (q) => q.status.toLowerCase() === "pending",
        );
        const askedNewResponse = askedData.filter(
          (q) =>
            q.status.toLowerCase() === "closed" &&
            !seenResponseIds.includes(q.id),
        );

        // 2. Logic for Queries Received (Admin as Responder)
        const inboxNew = inboxData.filter((q) => !seenInboxIds.includes(q.id));
        const inboxSeenButPending = inboxData.filter((q) =>
          seenInboxIds.includes(q.id),
        );

        btn.classList.remove("status-green", "status-orange", "status-yellow");
        btn.innerHTML = "";

        if (inboxNew.length > 0 || askedPending.length > 0) {
          // ORANGE: New query received OR asked query is still waiting
          btn.classList.add("status-orange");
          btn.innerHTML = `${inboxData.length + askedPending.length}`;
          btn.title = "New Task or Pending Query";
        } else if (
          inboxSeenButPending.length > 0 ||
          askedNewResponse.length > 0
        ) {
          // YELLOW: Inbox query seen but not responded OR asked query has new unseen response
          btn.classList.add("status-yellow");
          btn.innerHTML = `${inboxData.length + askedNewResponse.length}`;
          btn.title = "Pending Action or Unseen Response";
        } else {
          // GREEN: All responded and all responses seen
          btn.classList.add("status-green");
          btn.innerHTML = '<i class="fas fa-check"></i>';
          btn.title = "Everything Responded & Seen";
        }
      })
      .catch(() => {
        btn.classList.add("status-green");
      });
  }

  function fetchPendingQueries() {
    resultsContainer.innerHTML =
      '<p style="text-align:center;">Loading dashboard...</p>';
    resultsOverlay.style.display = "flex";
    resultsTitle.innerText = `${currentUserRole} Dashboard`;

    const pendingPromise = fetch(`${API_URL}/pending_queries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: currentUserEmail }),
    }).then((res) => res.json());

    const myHistoryPromise = fetch(`${API_URL}/my_history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: currentUserEmail }),
    }).then((res) => res.json());

    Promise.all([pendingPromise, myHistoryPromise]).then(
      ([pendingData, historyData]) => {
        resultsContainer.innerHTML = "";

        // 1. Mark Received Queries (Inbox) as "Seen" (Yellow state)
        const seenInboxIds = JSON.parse(
          localStorage.getItem("seen_inbox_ids") || "[]",
        );
        pendingData.forEach((q) => {
          if (!seenInboxIds.includes(q.id)) seenInboxIds.push(q.id);
        });
        localStorage.setItem("seen_inbox_ids", JSON.stringify(seenInboxIds));

        // 2. Mark Asked Query Responses as "Seen" (Return to Green state)
        const seenResponseIds = JSON.parse(
          localStorage.getItem("seen_query_ids") || "[]",
        );
        historyData.forEach((q) => {
          if (
            q.status.toLowerCase() === "closed" &&
            !seenResponseIds.includes(q.id)
          ) {
            seenResponseIds.push(q.id);
          }
        });
        localStorage.setItem("seen_query_ids", JSON.stringify(seenResponseIds));

        // Render logic...
        const historyHeader = document.createElement("h4");
        historyHeader.style.cssText =
          "margin: 10px 0; color: #2980b9; border-bottom: 2px solid #3498db; padding-bottom: 5px; font-size: 13px;";
        historyHeader.innerHTML =
          '<i class="fas fa-user-edit"></i> My Asked Queries';
        resultsContainer.appendChild(historyHeader);

        if (historyData.length > 0) renderResults(historyData, "user_history");

        const pendingHeader = document.createElement("h4");
        pendingHeader.style.cssText =
          "margin: 20px 0 10px 0; color: #e74c3c; border-bottom: 2px solid #e74c3c; padding-bottom: 5px; font-size: 13px;";
        pendingHeader.innerHTML =
          '<i class="fas fa-inbox"></i> Inbox: Queries to Answer';
        resultsContainer.appendChild(pendingHeader);

        if (pendingData.length > 0)
          renderResults(pendingData, "admin_dashboard");

        updateAdminButtonState();
      },
    );
  }

  // ======================================================
  // 10. MAIN ACTION HANDLERS
  // ======================================================

  // --- KNOWLEDGE BASE FULL UPDATED LOGIC ---
  const kbBtn = document.getElementById('kbBtn');
  const kbOverlay = document.getElementById('kbOverlay');
  const kbProjectInput = document.getElementById('kbProjectInput');
  const kbProjectList = document.getElementById('kbProjectList');
  const kbCategoryInput = document.getElementById('kbCategoryInput');
  const kbCategoryList = document.getElementById('kbCategoryList');
  const kbAttributesContainer = document.getElementById('kbAttributesContainer');
  const kbActionButtons = document.getElementById('kbActionButtons');

  let kbCategories = []; 

  // 1. Initialize & Open
  if (kbBtn) {
      kbBtn.addEventListener('click', () => {
          if (kbOverlay) kbOverlay.style.display = 'flex';
          if (kbProjectInput) kbProjectInput.value = "";
          logUserAction("KB Log");
          if (kbCategoryInput) {
              kbCategoryInput.value = "";
              kbCategoryInput.disabled = true;
          }
          if (kbAttributesContainer) {
              kbAttributesContainer.innerHTML = '<p style="text-align: center; color: #999; font-size: 12px; margin-top: 50px;">Select a category to view attributes</p>';
          }
          if (kbActionButtons) kbActionButtons.innerHTML = "";
      });
  }

  // Close Button Fix
  const closeKbOverlay = document.getElementById('closeKbOverlay');
  if (closeKbOverlay) {
      closeKbOverlay.addEventListener('click', () => {
          if (kbOverlay) kbOverlay.style.display = 'none';
      });
  }

  // 2. Project Search Logic
  if (kbProjectInput) {
    // 1. Trigger list when clicking or focusing on the box
    kbProjectInput.addEventListener('focus', function() {
        this.dispatchEvent(new Event('input'));
    });

    kbProjectInput.addEventListener('input', function() {
        autoResize(this);
        const searchText = this.value.toLowerCase();
        
        // Show all projects if search is empty, otherwise filter
        const filtered = searchText === "" 
            ? allProjects 
            : allProjects.filter(p => p.toLowerCase().includes(searchText));
        
        if (kbProjectList) {
            kbProjectList.innerHTML = "";
            
            if (filtered.length > 0) {
                kbProjectList.style.display = 'block';
                
                // Set a high z-index and ensure visibility
                kbProjectList.style.zIndex = "10002"; 

                filtered.forEach(proj => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item';
                    item.textContent = proj;
                    
                    // Style matching your existing dropdowns
                    item.style.padding = "10px";
                    item.style.cursor = "pointer";

                    item.onclick = () => {
                        kbProjectInput.value = proj;
                        kbProjectList.style.display = 'none';
                        autoResize(kbProjectInput);
                        
                        // Proceed to fetch categories
                        kbFetchCategories(proj); 
                    };
                    kbProjectList.appendChild(item);
                });
            } else {
                kbProjectList.style.display = 'none';
            }
        }
      });
  }

  // 3. Category Fetching
  async function kbFetchCategories(projectName) {
      if (!kbCategoryInput) return;
      kbCategoryInput.disabled = false;
      kbCategoryInput.value = "";
      kbCategoryInput.placeholder = "Loading categories...";
      try {
          const res = await fetch(`${API_URL}/categories`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ project: projectName })
          });
          kbCategories = await res.json();
          kbCategoryInput.placeholder = "Type or Select Category...";
      } catch (err) { console.error("KB Category Fetch Error:", err); }
  }

  // 4. Category Search Logic
  if (kbCategoryInput) {
    // 1. Trigger the dropdown immediately when clicking/focusing
    kbCategoryInput.addEventListener('focus', function() {
        if (kbCategories.length > 0) {
            this.dispatchEvent(new Event('input'));
        }
    });

    kbCategoryInput.addEventListener('input', function() {
        autoResize(this);
        const searchText = this.value.toLowerCase();
        
        // Show all fetched categories if search is empty, otherwise filter
        const filtered = searchText === "" 
            ? kbCategories 
            : kbCategories.filter(c => c.toLowerCase().includes(searchText));
        
        if (kbCategoryList) {
            kbCategoryList.innerHTML = "";
            
            if (filtered.length > 0) {
                kbCategoryList.style.display = 'block';
                // Higher z-index to ensure it sits above the attribute container
                kbCategoryList.style.zIndex = "10005"; 

                filtered.forEach(cat => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item';
                    item.textContent = cat;
                    item.style.padding = "10px";
                    item.style.cursor = "pointer";

                    item.onclick = () => {
                        kbCategoryInput.value = cat;
                        kbCategoryList.style.display = 'none';
                        autoResize(kbCategoryInput);
                        
                        // Proceed to fetch the attributes for this specific category
                        kbFetchAttributes(kbProjectInput.value, cat); 
                    };
                    kbCategoryList.appendChild(item);
                });
            } else {
                kbCategoryList.style.display = 'none';
            }
        }
    });
  }

  // 5. Attribute Fetching & Rendering
  async function kbFetchAttributes(proj, cat) {
    if (!kbAttributesContainer) return;
    kbAttributesContainer.innerHTML = '<p style="text-align:center; padding: 20px;">Fetching Attributes...</p>';
    
    try {
        const res = await fetch(`${API_URL}/kb/attribute_info`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ project: proj, category: cat })
        });
        const attributes = await res.json();
        
        if (attributes.length === 0) {
            kbAttributesContainer.innerHTML = '<p style="text-align:center; margin-top:50px; color:#999;">No attributes found.</p>';
        } else {
            // We use data-attributes instead of onclick to avoid CSP errors
            kbAttributesContainer.innerHTML = attributes.map((attr) => `
              <div class="kb-attribute-row" style="display:flex; justify-content:space-between; align-items:center; padding: 12px 15px; border-bottom: 1px solid #f0f0f0; width: 100%; box-sizing: border-box;">
                  <span style="font-size:12px; color:#333; font-weight: 500; word-break: break-word; padding-right: 10px; line-height: 1.2;">
                      ${attr.attribute_name}
                  </span>
                  <i class="fas fa-info-circle kb-info-icon" 
                    style="color:#764ba2; cursor:pointer; font-size: 16px; flex-shrink: 0;"
                    data-name="${encodeURIComponent(attr.attribute_name)}"
                    data-def="${encodeURIComponent(attr.definition || 'N/A')}"
                    data-sample="${encodeURIComponent(attr.sample_lov || 'N/A')}"
                    data-allowed="${encodeURIComponent(attr.allowed_lov || 'N/A')}"
                    data-type="${encodeURIComponent(attr.data_type || 'N/A')}"
                    data-uom="${encodeURIComponent(attr.units_of_measure || 'N/A')}"> 
                  </i>
              </div>
            `).join('');
          }
        renderKbActionButtons(proj, cat);
    } catch (err) {
        kbAttributesContainer.innerHTML = '<p style="text-align:center; color: red;">Error loading data</p>';
    }
  }

  if (kbAttributesContainer) {
    // Changed to async to allow fetching the PDF URL
    kbAttributesContainer.addEventListener('click', async (e) => {
        const icon = e.target.closest('.kb-info-icon');
        if (icon) {
            const attrName = decodeURIComponent(icon.dataset.name);     
            
            // Log the action with specific attribute details
            logUserAction("KB Log", {
                project_name: kbProjectInput.value,
                category: kbCategoryInput.value,
                attribute_name: attrName
            });

            const modal = document.getElementById('attrInfoModal');
            const content = document.getElementById('infoContent');
            const nameEl = document.getElementById('infoAttrName');

            if (modal && content && nameEl) {
                nameEl.innerText = attrName;

                // --- NEW UPDATE: Check for existing Knowledge Base PDF ---
                let kbButtonHtml = '';
                try {
                    const res = await fetch(`${API_URL}/kb/get_pdf`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            project: kbProjectInput.value.trim(), 
                            category: kbCategoryInput.value.trim() 
                        })
                    });
                    const data = await res.json();

                    // Only prepare the button if a valid PDF URL exists
                    if (data.url) {
                        kbButtonHtml = `
                            <div style="margin-top: 15px; padding-top: 12px; border-top: 2px solid #f0f0f0;">
                                <button id="modalViewKbBtn" class="submit-btn" style="width: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                                    <i class="fas fa-file-pdf"></i> View Full KB
                                </button>
                            </div>
                        `;
                        
                        // Store the URL globally or in the button context to use after innerHTML injection
                        window.currentModalKbUrl = data.url;
                    }
                } catch (err) {
                    console.error("Error fetching KB for modal:", err);
                }

                // Updated innerHTML including the conditional View KB button
                content.innerHTML = `
                    <div style="margin-bottom:12px; border-bottom: 1px solid #f0f0f0; padding-bottom:8px;">
                        <strong style="color:#764ba2;">Definition:</strong><br>
                        ${decodeURIComponent(icon.dataset.def)}
                    </div>
                    <div style="margin-bottom:12px; border-bottom: 1px solid #f0f0f0; padding-bottom:8px;">
                        <strong style="color:#764ba2;">Sample LOV:</strong><br>
                        ${decodeURIComponent(icon.dataset.sample)}
                    </div>
                    <div style="margin-bottom:12px; border-bottom: 1px solid #f0f0f0; padding-bottom:8px;">
                        <strong style="color:#764ba2;">Allowed LOV:</strong><br>
                        ${decodeURIComponent(icon.dataset.allowed)}
                    </div>
                    <div style="margin-bottom:12px; border-bottom: 1px solid #f0f0f0; padding-bottom:8px;">
                        <strong style="color:#764ba2;">Units of Measure:</strong><br>
                        ${decodeURIComponent(icon.dataset.uom)}
                    </div>
                    <div>
                        <strong style="color:#764ba2;">Data Type:</strong><br>
                        ${decodeURIComponent(icon.dataset.type)}
                    </div>
                    ${kbButtonHtml}
                `;

                // Attach click event to the newly created button if it exists
                const modalViewBtn = document.getElementById('modalViewKbBtn');
                if (modalViewBtn && window.currentModalKbUrl) {
                    modalViewBtn.onclick = () => {
                        logUserAction("KB Log", {
                            project_name: kbProjectInput.value,
                            category: kbCategoryInput.value,
                            kb_id: "PDF View from Modal"
                        });
                        window.open(window.currentModalKbUrl, '_blank');
                    };
                }

                modal.style.display = 'block';
            }
        }
    });
  }

  // 6. Action Buttons
  async function renderKbActionButtons(proj, cat) {
      if (!kbActionButtons) return;
      kbActionButtons.innerHTML = '';
      
      try {
          // Check if PDF exists before rendering the button
          const res = await fetch(`${API_URL}/kb/get_pdf`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ 
                  project: proj.trim(), 
                  category: cat.trim() 
              })
          });
          const data = await res.json();

          // ONLY render the View KB button if a URL actually exists in the DB
          if (data.url) {
              const viewBtn = document.createElement('button');
              viewBtn.className = 'submit-btn';
              viewBtn.innerHTML = '<i class="fas fa-file-pdf"></i> View KB';
              viewBtn.onclick = () => {
                // ADD THIS LOG: Captures when the PDF is opened
                logUserAction("KB Log", {
                    project_name: proj,
                    category: cat,
                    kb_id: "PDF View"
                });
                window.open(data.url, '_blank');
              };
              kbActionButtons.appendChild(viewBtn);
          }
      } catch (err) {
          console.error("Error checking KB existence:", err);
      }

      // SME Logic (Always show Upload/AI buttons for SMEs so they can add missing data)
      if (currentUserRole === 'SME') {
          const upBtn = document.createElement('button');
          upBtn.className = 'submit-btn';
          upBtn.style.background = 'linear-gradient(135deg, #2ed573 0%, #26af61 100%)';
          upBtn.innerHTML = '<i class="fas fa-upload"></i> Upload KB';
          upBtn.onclick = () => {
              const fileInput = document.createElement('input');
              fileInput.type = 'file'; 
              fileInput.accept = 'application/pdf';
              fileInput.onchange = async () => {
                  if(!fileInput.files[0]) return;
                  const fd = new FormData();
                  fd.append('file', fileInput.files[0]); 
                  fd.append('project', proj);
                  fd.append('category', cat); 
                  fd.append('userEmail', currentUserEmail);
                  upBtn.innerText = "Uploading...";
                  
                  try {
                      await fetch(`${API_URL}/kb/upload_pdf`, { method: 'POST', body: fd });
                      alert("Knowledge Base Updated!");
                      // Refresh buttons to show the "View KB" button now that it exists
                      renderKbActionButtons(proj, cat);
                  } catch (err) {
                      alert("Upload failed.");
                  } finally {
                      upBtn.innerHTML = '<i class="fas fa-upload"></i> Upload KB';
                  }
              };
              fileInput.click();
          };
          kbActionButtons.appendChild(upBtn);

          const aiBtn = document.createElement('button');
          aiBtn.className = 'submit-btn';
          aiBtn.style.background = 'linear-gradient(135deg, #a29bfe 0%, #6c5ce7 100%)';
          aiBtn.innerHTML = '<i class="fas fa-robot"></i> Explore KB on AI';
          
          aiBtn.onclick = async () => {
              logUserAction("KB Log", {
                project_name: proj,
                category: cat,
                kb_id: "AI Exploration"
              });

              const originalContent = aiBtn.innerHTML;
              aiBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';

              try {
                  const res = await fetch(`${API_URL}/kb/ai_generate_guide`, {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ project: proj, category: cat })
                  });
                  const data = await res.json();

                  if (data.error) {
                      alert("Error: " + data.error);
                      return;
                  }

                  // --- FIX START: UI LAYERING ---
                  
                  // 1. Bring the results overlay to the absolute front
                  resultsOverlay.style.zIndex = "20000"; 
                  resultsOverlay.style.display = "flex";
                  
                  resultsContainer.innerHTML = "";
                  resultsTitle.innerHTML = `<i class="fas fa-robot"></i> AI Master Technical Guide`;
                  
                  if (searchContext) {
                      searchContext.innerHTML = `<strong>Category:</strong> ${cat}`;
                  }

                  // Inject AI Content (The AI now generates the full table)
                  resultsContainer.innerHTML = `
                    <div id="tech-guide-content" style="padding: 15px; font-size: 13px; line-height: 1.6; color: #333; background: white; text-align: left; width: 100%; box-sizing: border-box;">
                        <div style="border-bottom: 2px solid #6c5ce7; margin-bottom: 15px; padding-bottom: 10px;">
                            <h2 style="color: #6c5ce7; margin: 0; font-size: 18px;">Engineering SOP: ${cat}</h2>
                            <p style="font-size: 11px; color: #666; margin: 5px 0 0 0;">AI-Synthesized Technical Specifications</p>
                        </div>

                        <!-- This contains the Category Overview, Table with AI definitions, and Pro-Tips -->
                        <div class="ai-rendered-text">${data.html_content}</div>

                        <div style="margin-top: 20px; padding: 10px; background: #fff9db; border: 1px solid #ffeeba; border-radius: 6px; font-size: 11px;">
                            <strong>Note to Engineers:</strong> Definitions and Visual Guides were synthesized by AI where database values were missing (N/A).
                        </div>
                    </div>

                    <div style="width: 100%; margin-top: 20px; text-align: center; padding-bottom: 20px;">
                        <button id="downloadAiGuide" class="submit-btn" style="background: #27ae60; width: 80%; padding: 12px; font-weight: bold;">
                            <i class="fas fa-file-word"></i> Download Master Guide (.doc)
                        </button>
                    </div>
                  `;

                  // 3. Word Download Logic (Remains the same, packages the full AI HTML)
                  document.getElementById('downloadAiGuide').onclick = () => {
                      const content = document.getElementById('tech-guide-content').innerHTML;
                      const blob = new Blob(['\ufeff', `
                        <html><head><meta charset='utf-8'><style>
                            body { font-family: Arial, sans-serif; }
                            table { border-collapse: collapse; width: 100%; }
                            th, td { border: 1px solid #333; padding: 8px; text-align: left; font-size: 10pt; }
                            h2, h3 { color: #6c5ce7; }
                        </style></head>
                        <body>${content}</body></html>
                      `], { type: 'application/msword' });

                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `${cat.replace(/[^a-z0-9]/gi, '_')}_Master_Guide.doc`;
                      link.click();
                  };

                  // --- FIX END ---

              } catch (err) {
                  console.error("AI Generation Error:", err);
                  alert("Failed to connect to AI server.");
              } finally {
                  aiBtn.innerHTML = originalContent;
              }
          };
          
          kbActionButtons.appendChild(aiBtn);
      }
  }

  // Modal Detail Handler
  window.showAttributeInfo = (name, def, sample, allowed, type) => {
      const modal = document.getElementById('attrInfoModal');
      const content = document.getElementById('infoContent');
      const nameEl = document.getElementById('infoAttrName');
      if (modal && content && nameEl) {
          nameEl.innerText = name;
          content.innerHTML = `
              <div style="margin-bottom:10px;"><strong>Definition:</strong><br>${def}</div>
              <div style="margin-bottom:10px;"><strong>Sample LOV:</strong><br>${sample}</div>
              <div style="margin-bottom:10px;"><strong>Allowed LOV:</strong><br>${allowed}</div>
              <div><strong>Data Type:</strong><br>${type}</div>
          `;
          modal.style.display = 'block';
      }
  };

  const closeAttrInfoBtn = document.getElementById('closeAttrInfoModal');
  if (closeAttrInfoBtn) {
      closeAttrInfoBtn.addEventListener('click', () => {
          const modal = document.getElementById('attrInfoModal');
          if (modal) {
              modal.style.display = 'none';
          }
      });
  }

  // Optional: Close modal if user clicks outside of it
  window.addEventListener('click', (event) => {
      const modal = document.getElementById('attrInfoModal');
      if (event.target === modal) {
          modal.style.display = "none";
      }
  });

  // Global click listener to close KB dropdowns
  document.addEventListener('click', (e) => {
    if (kbProjectInput && !kbProjectInput.contains(e.target) && !kbProjectList.contains(e.target)) {
        if (kbProjectList) kbProjectList.style.display = 'none';
    }
    if (kbCategoryInput && !kbCategoryInput.contains(e.target) && !kbCategoryList.contains(e.target)) {
        if (kbCategoryList) kbCategoryList.style.display = 'none';
    }
  });

  function getDropdownValue(possibleIds) {
    for (let id of possibleIds) {
      const el = document.getElementById(id);
      if (el) return el.value;
    }
    return null;
  }

  function triggerLogDownload(logType) {
    const project = document.getElementById("projectInput").value.trim();
    const batch = document.getElementById("batchInput").value.trim();
    const startDate = document.getElementById("exportStartDate").value;
    const endDate = document.getElementById("exportEndDate").value;

    // Final safety check (should already be handled by the listeners above)
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        return; // Silent return because the user was already alerted by the 'change' listener
    }

    if (logType !== "usage") {
        if (!project || project === "" || project.toLowerCase().includes("select")) {
            alert("❌ Error: Please select a Project name first!");
            return;
        }
    }

    let url = `${API_URL}/export_logs?project=${encodeURIComponent(project)}&batch=${encodeURIComponent(batch)}&type=${logType}`;
    
    if (startDate) url += `&start_date=${startDate}`;
    if (endDate) url += `&end_date=${endDate}`;

    window.open(url, "_blank");
  }


  function setupExportListeners() {
    const mainBtn = document.getElementById("btn-show-downloads");
    const optionsContainer = document.getElementById("download-options-container");
    const usageBtn = document.getElementById("download-usage-report");
    const usageDateContainer = document.getElementById("usage-date-container");
    const confirmUsageBtn = document.getElementById("btn-confirm-usage");

    // 1. Click Excel Icon -> Show Query, Decision, and Usage icons
    if (mainBtn) {
        mainBtn.addEventListener("click", (e) => {
            e.preventDefault();
            mainBtn.style.display = "none";
            optionsContainer.style.display = "flex";
        });
    }

    // 2. Query Log & Decision Log (Direct Download)
    document.getElementById("download-query-log").onclick = () => triggerLogDownload("query");
    document.getElementById("download-decision-log").onclick = () => triggerLogDownload("decision");

    // 3. Click Purple User Icon -> ONLY show the Date inputs and Tick button
    if (usageBtn) {
        usageBtn.onclick = (e) => {
            e.preventDefault();
            // Toggle visibility of the date container
            usageDateContainer.style.display = (usageDateContainer.style.display === "none") ? "block" : "none";
        };
    }

    // 4. Click Green Tick Button -> Execute the actual download with dates
    if (confirmUsageBtn) {
        confirmUsageBtn.onclick = () => {
            triggerLogDownload("usage");
            // Optional: Hide dates again after clicking tick
            usageDateContainer.style.display = "none";
        };
    }
  }

  validateBtn.addEventListener("click", function () {
    if (
      !projectInput.value ||
      !categoryInput.value ||
      selectedAttributes.length === 0
    ) {
      alert("Please fill Project, Category and at least one Attribute.");
      return;
    }
    performValidation("query");
  });

  checkDecisionBtn.addEventListener("click", function () {
    if (
      !projectInput.value ||
      !categoryInput.value ||
      selectedAttributes.length === 0
    ) {
      alert("Please fill Project, Category and at least one Attribute.");
      return;
    }
    performValidation("decision");
  });

  checkFeedbackBtn.addEventListener("click", function () {
    if (
      !projectInput.value ||
      !categoryInput.value ||
      selectedAttributes.length === 0
    ) {
      alert("Please fill Project, Category and at least one Attribute.");
      return;
    }
    performValidation("feedback");
  });

  function performValidation(type) {

    let actionLabel = "Checked Query";
    if (type === "decision") actionLabel = "Checked Decision"; // Optional: Map to your sheet name
    if (type === "feedback") actionLabel = "Checked Feedback";

    logUserAction("Checked Query", {
        query_id: `Validation: ${type}`
    });

    resultsContainer.innerHTML =
      '<p style="text-align:center;">Searching Database...</p>';
    resultsOverlay.style.display = "flex";

    if (searchContext) {
      // REMOVED the dynamicBatchLine from this block
      searchContext.innerHTML = `
                <div style="text-align: left; margin: 10px 15px; font-size: 12px; color: #444; line-height: 1.6;">
                    <div><strong>Project:</strong> ${projectInput.value}</div>
                    <div><strong>Category:</strong> ${categoryInput.value}</div>
                    <div><strong>Attributes:</strong> ${selectedAttributes.join(", ")}</div>
                </div>
            `;
    }

    // Step 2: Global search (We do NOT send the 'batch' filter here)
    fetch(`${API_URL}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: projectInput.value,
        category: categoryInput.value,
        attributes: selectedAttributes,
        userEmail: currentUserEmail,
        request_type: type,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        const queries = data.queries || [];
        const decisions = data.decisions || [];
        const userTypedBatch = batchInput.value.trim(); //

        // 1. Extract all unique batch names from both queries and decisions
        const allItems = [...queries, ...decisions];
        const detectedBatches = [
          ...new Set(
            allItems.map(
              (item) => item.batch_name || item.batch || item["Batch Name"],
            ),
          ),
        ].filter((b) => b && b !== "nan" && b !== "");

        logUserAction("Checked Query", {
            query_id: type === "query" ? "Validation Search" : "Decision Search"
        });

        // 2. Update the search context UI
        const batchLine = document.getElementById("dynamicBatchLine");
        if (batchLine) {
          if (userTypedBatch) {
            // Priority 1: User selection
            batchLine.innerHTML = `<strong>Batch:</strong> ${userTypedBatch}`;
          } else if (detectedBatches.length > 0) {
            // Priority 2: Auto-detection from DB records
            batchLine.innerHTML = `<strong>Batch (Auto-Detected):</strong> <span style="color: #667eea; font-weight: bold;">${detectedBatches.join(", ")}</span>`;
          } else {
            // Priority 3: Default fallback
            batchLine.innerHTML = `<strong>Batch:</strong>`;
          }
        }
        renderResults(data, type);
      });
  }

  // ======================================================
  // 11. RENDER RESULTS (CORE UI LOGIC)
  // ======================================================
  function renderResults(data, type) {
    resultsContainer.innerHTML = "";
    let queries = Array.isArray(data) ? data : data.queries || [];
    let decisions = Array.isArray(data) ? [] : data.decisions || [];
    let feedbacks = Array.isArray(data) ? [] : data.feedbacks || [];

    let hasData = false;

    // --- DECISION BUTTON LOGIC ---
    if (type === "decision") {
      const createContainer = document.createElement("div");
      createContainer.style.cssText =
        "width: 90%; margin-bottom: 15px; text-align: right; margin-left: auto; margin-right: auto;";
      const createBtn = document.createElement("button");
      createBtn.className = "action-btn";
      createBtn.style.cssText =
        "background: #2c3e50; padding: 8px 12px; font-size: 11px; width: auto; color: white; border: none; border-radius: 4px; cursor: pointer;";
      createBtn.innerHTML = currentUserIsAdmin
        ? '<i class="fas fa-plus-circle"></i> Create New Decision'
        : '<i class="fas fa-pen-fancy"></i> Propose New Decision';
      createBtn.addEventListener("click", () => {
        showCreateDecisionForm();
      });
      createContainer.appendChild(createBtn);
      resultsContainer.appendChild(createContainer);
    }

    // Process Decisions from DB search results - ONLY when type is 'decision'
    if (type === "decision" && decisions.length > 0) {
      hasData = true;
      const decisionHeader = document.createElement("h4");
      decisionHeader.style.cssText =
        "margin: 0 0 10px 0; color: #d35400; font-size: 13px; border-bottom: 2px solid #e67e22; padding-bottom: 5px;";
      decisionHeader.innerHTML =
        '<i class="fas fa-lightbulb"></i> Standardization Rules';
      resultsContainer.appendChild(decisionHeader);

      decisions.forEach((item) => {
        const card = document.createElement("div");
        card.className = "result-item";

        const status = (item.status || "").toLowerCase();
        const isProposed = status === "proposed";
        const isRejected = status === "rejected";
        const isActive = status === "active";

        let headerLabel = "OFFICIAL DECISION";
        let headerColor = "#e67e22";
        let borderColor = "4px solid #e67e22";
        let bgCol = "#fffbf0";

        if (isActive) {
          headerLabel = "OFFICIAL DECISION";
          headerColor = "#27ae60";
          borderColor = "4px solid #2ecc71";
          bgCol = "#eafaf1";
        } else if (isProposed) {
          headerLabel = "PROPOSED BY USER";
          headerColor = "#f39c12";
          borderColor = "4px solid #f1c40f";
          bgCol = "#fffdf0";
        } else if (isRejected) {
          headerLabel = "REJECTED PROPOSAL";
          headerColor = "#e74c3c";
          borderColor = "4px solid #e74c3c";
          bgCol = "#fdf2f2";
        }

        card.style.borderLeft = borderColor;
        card.style.backgroundColor = bgCol;

        let adminTools = "";
        if (isProposed && currentUserIsAdmin) {
          adminTools = `
                    <div style="margin-top:10px; border-top:1px solid #ddd; padding-top:10px;">
                        <div style="font-size:10px; color:#7f8c8d; margin-bottom:5px; font-weight:bold;">ADMIN REVIEW (Editable)</div>
                        <input type="text" id="edit-iss-${item.id}" class="modern-input" value="${item.issue || ""}" placeholder="Edit Issue" style="margin-bottom:5px;">
                        <textarea id="edit-dec-${item.id}" class="modern-input" rows="2" placeholder="Edit Decision" style="margin-bottom:5px;">${item.decision || ""}</textarea>
                        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:5px; margin-bottom:8px;">
                            <input type="text" id="edit-sku-${item.id}" class="modern-input" value="${item.sku_id || ""}" placeholder="SKU" style="margin:0;">
                            <input type="text" id="edit-mpn-${item.id}" class="modern-input" value="${item.mfr_part_number || ""}" placeholder="MPN" style="margin:0;">
                            <input type="text" id="edit-mfr-${item.id}" class="modern-input" value="${item.manufacturer || ""}" placeholder="Mfr" style="margin:0;">
                        </div>
                        <div style="display:flex; gap:5px;">
                            <button class="action-btn approve-dec-btn" data-dbid="${item.id}" style="background:#27ae60; flex:1; padding:6px; font-size:10px;">Approve & ID</button>
                            <button class="action-btn reject-dec-btn" data-dbid="${item.id}" style="background:#e74c3c; flex:1; padding:6px; font-size:10px;">Reject</button>
                        </div>
                    </div>`;
        }

        card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <div style="font-size:10px; color:${headerColor}; font-weight:bold;">${headerLabel}</div>
                    ${isActive ? `<div style="font-size:10px; color:#2980b9; font-weight:bold; background: #e1f5fe; padding: 2px 6px; border-radius: 4px;">ID: ${item.custom_decision_id || "N/A"}</div>` : `<div style="font-size:10px; color:#777; font-weight:bold;">ID: N/A</div>`}
                </div>
                <div class="result-query" style="color:#444;">Issue: ${item.issue || item.issue_description}</div>
                <div class="result-response" style="background:#fff; border:1px solid ${isActive ? "#c2e9d1" : isRejected ? "#ffcccb" : "#ffe0b2"};"><strong>Decision:</strong> ${item.decision || item.decision_text}</div>
                ${adminTools}
            `;
        resultsContainer.appendChild(card);
      });
    }

    // Process Queries (Dashboard, History, and Search Results)
    queries.forEach((item) => {
      hasData = true;
      const card = document.createElement("div");
      card.className = "result-item";

      const dbBatch = item.batch_name || item.batch || item["Batch Name"] || "";
      const userTyped = batchInput.value.trim();
      let batchHTML = "";
      if (dbBatch) {
        const batchList = dbBatch.toString().split(",").map((b) => b.trim());
        batchHTML = `<div style="display:flex; gap:4px; flex-wrap:wrap; justify-content:flex-end;">`;
        batchList.forEach((b) => {
          const isMatch = userTyped && b.toLowerCase() === userTyped.toLowerCase();
          batchHTML += `<span style="font-size:10px; color:${isMatch ? "#fff" : "#777"}; background:${isMatch ? "#667eea" : "#f1f2f6"}; padding:2px 6px; border-radius:4px; font-weight:700; border:1px solid ${isMatch ? "#667eea" : "#ddd"};"><i class="fas fa-layer-group"></i> ${b}</span>`;
        });
        batchHTML += `</div>`;
      }

      let attrDisplayHTML = "";
      const itemAttr = item.attribute || item.attribute_name || "";
      if (itemAttr) {
        const attrs = itemAttr.split("|");
        attrDisplayHTML = `<div style="margin-bottom:6px; display:flex; flex-wrap:wrap; gap:4px;">${attrs.map((a) => `<span style="background:#eef2ff; color:#667eea; padding:2px 6px; border-radius:4px; border:1px solid #c3dafe; font-size:10px; font-weight:600;">${a.trim()}</span>`).join("")}</div>`;
      }

      if (item.is_decision_log && item.is_user_view) {
        let statusColor = "#f39c12"; 
        let statusBg = "#fffdf0";
        let statusLabel = (item.status || "PROPOSED").toUpperCase();
        if (item.status === "Active" || item.status === "active") { statusColor = "#2ecc71"; statusBg = "#eafaf1"; statusLabel = "OFFICIAL"; }
        if (item.status === "Rejected") { statusColor = "#e74c3c"; statusBg = "#fdf2f2"; }

        card.style.borderLeft = `4px solid ${statusColor}`;
        card.style.backgroundColor = statusBg;
        card.innerHTML = `
            <div style="background: #f8f9fa; padding: 6px 10px; border-bottom: 1px solid #eee; margin: -15px -15px 10px -15px; border-radius: 8px 8px 0 0; font-size: 11px; color: #555;">
                <i class="fas fa-lightbulb" style="color: ${statusColor};"></i> <strong>DECISION LOG</strong>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin: 10px 0 8px 0;">
                <span style="background-color:${statusColor}20; color:${statusColor}; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:700;">${statusLabel}</span>
                <div style="text-align: right;">
                    <div style="font-size:10px; color:#777;">Proj: ${item.project_name || item.project}</div>
                    <div style="font-size:10px; color:#777;">Cat: ${item.category || "N/A"}</div>
                </div>
            </div>
            ${attrDisplayHTML}
            <div class="result-query" style="font-size: 13px; color: #222;"><strong>Issue:</strong> ${item.query || item.issue}</div>
            <div class="result-response" style="margin-top:8px; background: #fff; border: 1px solid #eee;">
                <strong>Decision:</strong> ${item.response || item.decision}
                <div style="margin-top:8px; padding:8px; background:#f9f9f9; border-radius:4px; font-size:10px; color:#666;">
                    SKU: ${item.sku_id || "N/A"} | MPN: ${item.mfr_part_number || "N/A"} | Mfr: ${item.manufacturer || "N/A"}
                </div>
            </div>`;
        resultsContainer.appendChild(card);
        return;
      }

      if (item.is_decision_log) {
        card.style.borderLeft = "4px solid #f1c40f";
        card.style.backgroundColor = "#fffdf0";
        card.innerHTML = `<div style="background: #f8f9fa; padding: 5px 8px; border-bottom: 1px solid #eee; margin: -15px -15px 10px -15px; font-size: 11px; color: #2c3e50; border-radius: 8px 8px 0 0;"><i class="fas fa-lightbulb"></i> <strong>PROPOSED DECISION</strong><span style="float:right; color:#7f8c8d;">From: ${item.asker_email}</span></div><div style="font-size:11px; margin-bottom:5px; margin-top:10px;"><strong>Proj:</strong> ${item.project} | <strong>Cat:</strong> ${item.category}</div>${attrDisplayHTML}<div style="margin-top:10px;"><label style="font-size:10px; font-weight:bold; color:#555;">Review & Edit Issue:</label><input type="text" id="edit-iss-${item.id}" class="modern-input" value="${item.issue || ""}"><label style="font-size:10px; font-weight:bold; color:#555;">Review & Edit Decision:</label><textarea id="edit-dec-${item.id}" class="modern-input" rows="2">${item.decision || ""}</textarea><div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:5px; margin-bottom:8px;"><input type="text" id="edit-sku-${item.id}" class="modern-input" value="${item.sku_id || ""}" placeholder="SKU"><input type="text" id="edit-mpn-${item.id}" class="modern-input" value="${item.mfr_part_number || ""}" placeholder="MPN"><input type="text" id="edit-mfr-${item.id}" class="modern-input" value="${item.manufacturer || ""}" placeholder="Mfr"></div><div style="display:flex; gap:5px;"><button class="action-btn approve-dec-btn" data-dbid="${item.id}" style="background:#27ae60; flex:1;">Approve & ID</button><button class="action-btn reject-dec-btn" data-dbid="${item.id}" style="background:#e74c3c; flex:1;">Reject</button></div></div>`;
        resultsContainer.appendChild(card);
        return;
      }

      if (item.is_admin_view) {
        card.style.borderLeft = "4px solid #e74c3c";
        let badgeColor = "#c62828";
        let badgeText = item.current_stage || "PENDING";
        if (item.current_stage === "FORWARDED BY SME" || item.current_stage === "Client_PL") { 
            badgeColor = "#8e44ad"; 
            badgeText = "FORWARDED BY SME"; 
        }
        const roles = ["TL", "PL", "PM", "SME"];
        let options = roles.filter((r) => r !== currentUserRole);
        if (currentUserRole === "SME") options.push("Client_PL");
        let selectOptions = options.map((r) => `<option value="${r}">${r === "Client_PL" ? "Forward to PL (Client)" : r}</option>`).join("");

        card.innerHTML = `
            <div style="background: #f8f9fa; padding: 5px 8px; border-bottom: 1px solid #eee; margin-bottom: 8px; font-size: 11px; color: #2c3e50; display: flex; align-items: center; gap: 10px;">
                <span style="display:flex; align-items:center; gap:4px;"><i class="fas fa-folder"></i> <strong>Project:</strong> ${item.project}</span>
                <span style="color: #ccc;">|</span>
                <span style="display:flex; align-items:center; gap:4px; overflow:hidden; text-overflow:ellipsis;"><i class="fas fa-sitemap"></i> <strong>Category:</strong> ${item.category}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; padding-bottom:5px;">
                <div><span style="background-color:${badgeColor}20; color:${badgeColor}; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700;">${badgeText}</span></div>
                ${batchHTML}
            </div>
            ${attrDisplayHTML}
            <div class="result-query">Q: ${item.query}</div>
            <!-- ADD THIS BLOCK BELOW TO SHOW THE CAPTURED URL TO THE ADMIN -->
            ${item.url && item.url !== 'nan' ? `
              <div style="margin: 5px 0; padding: 5px; background: #e1f5fe; border-radius: 4px;">
                  <a href="${item.url}" target="_blank" style="color: #0288d1; font-size: 11px; text-decoration: none; font-weight: bold;">
                      <i class="fas fa-external-link-alt"></i> View User's Reference Link
                  </a>
              </div>
          ` : ''}
            <div class="admin-response-area">
                <label style="font-size:10px; font-weight:bold; color:#555;">Your Response:</label>
                <textarea id="reply-${item.id}" class="modern-input" placeholder="Type answer..."></textarea>
                <label style="font-size:10px; font-weight:bold; color:#555;">Reference Link (Optional):</label>
                <input type="text" id="link-${item.id}" class="modern-input" placeholder="https://...">
                <div class="file-input-wrapper">
                    <label class="file-label-btn" for="file-${item.id}"><i class="fas fa-paperclip"></i> Attach File</label>
                    <input type="file" id="file-${item.id}" style="display:none;" onchange="this.previousElementSibling.innerText = this.files[0].name">
                </div>
                
                <!-- UPDATED BUTTON: Carrying metadata via data-attributes -->
                <button class="send-response-btn action-btn" 
                    data-id="${item.id}" 
                    data-customid="${item.custom_query_id || item.id}" 
                    data-proj="${item.project || ''}"
                    data-batch="${item.batch || ''}"
                    data-cat="${item.category || ''}"
                    data-attr="${item.attribute || ''}"
                    data-asker="${item.asker_email || ''}"
                    style="width:100%;">
                    <i class="fas fa-paper-plane"></i> Send Response
                </button>

                <div style="display:flex; align-items:center; gap:5px; margin-top:8px;">
                    <select class="escalate-select modern-input" id="escalate-select-${item.id}" style="flex:1;">${selectOptions}</select>
                    <button class="escalate-btn action-btn" data-id="${item.id}" style="background: #f39c12;">Assign</button>
                </div>
            </div>`;
        resultsContainer.appendChild(card);
      }
      else if (item.is_user_view) {
        const isPending = item.status && item.status.toLowerCase() === "pending";
        const statusColor = isPending ? "#e67e22" : "#2ecc71";
        const statusBg = isPending ? "#fef5e7" : "#eafaf1";
        const borderColor = isPending ? "#f39c12" : "#2ecc71";
        let stageInfo = isPending ? (item.recipient_type || "TL") : "Resolved";

        card.style.borderLeft = `4px solid ${borderColor}`;
        const projectDisplay = item.project_name || item.project || (projectInput.value ? projectInput.value : "N/A");
        const categoryDisplay = item.category || (categoryInput.value ? categoryInput.value : "General");
        const contextHeader = `<div style="background: #f8f9fa; padding: 6px 10px; border-bottom: 1px solid #eee; margin: -15px -15px 10px -15px; border-radius: 8px 8px 0 0; font-size: 11px; color: #555; display: flex; align-items: center; gap: 10px;"><span style="display:flex; align-items:center; gap:4px; white-space:nowrap;"><i class="fas fa-folder" style="color: #764ba2;"></i> <strong>Proj:</strong> ${projectDisplay}</span><span style="color: #ccc;">|</span><span style="display:flex; align-items:center; gap:4px; overflow:hidden; text-overflow:ellipsis;"><i class="fas fa-sitemap" style="color: #764ba2;"></i> <strong>Cat:</strong> ${categoryDisplay}</span></div>`;

        let attachmentHTML = "";
        if (item.attachment_url) {
          let safeUrl = item.attachment_url.includes("localhost:5000") ? `${API_URL}/attachment/${item.id}` : item.attachment_url;
          attachmentHTML = `<div style="margin-top:8px;"><a href="${safeUrl}" target="_blank" download class="file-label-btn" style="text-decoration:none;"><i class="fas fa-file-download"></i> Download Attachment</a></div>`;
        }

        // --- NEW REQUIREMENT: INTERNAL SMALL DECISION BOX ---
        let decisionRefBox = "";
        if (decisions.length > 0) {
            const activeDecIds = decisions
                .filter(d => d.status && d.status.toLowerCase() === 'active' && d.custom_decision_id && d.custom_decision_id !== 'nan' && d.custom_decision_id !== 'null')
                .map(d => d.custom_decision_id);
            if (activeDecIds.length > 0) {
                decisionRefBox = `
                    <div style="margin-top:10px; background:#fff3cd; border:1px solid #ffeeba; color:#856404; padding:8px; border-radius:6px; font-size:10px; border-left:3px solid #ffc107; line-height:1.4; text-align: center;">
                        <i class="fas fa-exclamation-circle"></i> For this project, category and attribute, a decision exists too. Check for reference. 
                        <br><strong style="font-size: 11px; color: #d35400;">Decision ID: ${activeDecIds.join(", ")}</strong>
                    </div>`;
            }
        }

        let answerHTML = "";
        if (isPending) {
          answerHTML = `<div style="font-size:12px; color:#e67e22; font-style:italic; margin-top:6px; display:flex; align-items:center; gap:6px;"><i class="fas fa-spinner fa-spin"></i> Waiting for Response</div>`;
        } else {
          const responderEmailDisplay = item.answered_by ? `<div style="margin-top:8px; padding-top:6px; border-top:1px dashed #cce5ff; font-size:10px; color:#555; text-align:right;"><i class="fas fa-user-check" style="color:#27ae60;"></i> Res: <strong>${item.answered_by}</strong></div>` : "";
          let productInfoHTML = ((item.sku_id && item.sku_id !== "nan") || (item.mfr_part_number && item.mfr_part_number !== "nan")) ? `<div style="margin-top:8px; padding:10px; background:#f8f9fa; border-radius:6px; border:1px solid #e1e4e8; font-size:11px; line-height: 1.6;">${item.manufacturer ? `<div><strong>Mfr:</strong> ${item.manufacturer}</div>` : ""}${item.mfr_part_number ? `<div><strong>MPN:</strong> ${item.mfr_part_number}</div>` : ""}${item.sku_id ? `<div><strong>SKU ID:</strong> ${item.sku_id}</div>` : ""}</div>` : "";
          let refLinkHTML = (item.url && item.url.trim() !== "" && item.url !== "nan") ? `${productInfoHTML}<div style="margin-top:8px; padding-top:6px; border-top:1px dashed #3498db; font-size:11px;"><a href="${item.url}" target="_blank" style="color:#2980b9; text-decoration:none; font-weight:600;"><i class="fas fa-external-link-alt"></i> View Reference Link</a></div>` : productInfoHTML;
          
          // INJECTING BOX BELOW REFERENCE LINK
          answerHTML = `<div class="result-response" style="margin-top:8px; position:relative;"><strong>A:</strong> ${item.response}${refLinkHTML}${decisionRefBox}${attachmentHTML}${responderEmailDisplay}</div>`;
        }

        card.innerHTML = `${contextHeader}<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;"><div style="display:flex; align-items:center; gap:8px;"><span style="background-color:${statusBg}; color:${statusColor}; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:700;">${item.status.toUpperCase()}</span></div>${batchHTML}</div>${attrDisplayHTML}<div class="result-query" style="font-size: 14px; color: #222;">Q: ${item.query}</div>${answerHTML}`;
        resultsContainer.appendChild(card);
      } else {
        card.innerHTML = `<div class="result-query">Q: ${item.query}</div><div class="result-response"><strong>A:</strong> ${item.response}</div>`;
        resultsContainer.appendChild(card);
      }
    });

    if (!hasData) {
      let msg = "No results found.";
      if (type === "feedback") msg = "No Feedback Data Found";
      else if (type === "decision") msg = "No Standardization Rules";
      else if (type === "query") msg = "No Past Queries";
      resultsContainer.innerHTML = `<div style="text-align:center; padding:30px 20px; color:#777;"><i class="fas fa-folder-open" style="font-size:24px; color:#ddd; margin-bottom:10px;"></i><div style="font-weight:600; color:#555;">${msg}</div></div>`;
    }

    // --- RE-ATTACH LISTENERS ---
    resultsContainer.querySelectorAll(".approve-dec-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const dbId = this.dataset.dbid;
        const payload = { dbId: dbId, userEmail: currentUserEmail, issue: document.getElementById(`edit-iss-${dbId}`).value, decision: document.getElementById(`edit-dec-${dbId}`).value, sku: document.getElementById(`edit-sku-${dbId}`).value, mfr_part: document.getElementById(`edit-mpn-${dbId}`).value, mfr_name: document.getElementById(`edit-mfr-${dbId}`).value };
        fetch(`${API_URL}/approve_decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((res) => res.json()).then((data) => { alert(data.message); performValidation("decision"); });
      });
    });
    resultsContainer.querySelectorAll(".reject-dec-btn").forEach((btn) => {
      btn.addEventListener("click", function () { if (!confirm("Reject this proposal?")) return; fetch(`${API_URL}/reject_decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dbId: this.dataset.dbid, userEmail: currentUserEmail }) }).then((res) => res.json()).then((data) => { alert(data.message); performValidation("decision"); }); });
    });
    resultsContainer.querySelectorAll(".send-response-btn").forEach((btn) => {
      btn.addEventListener("click", function () { submitResponse(this.getAttribute("data-id")); });
    });
    resultsContainer.querySelectorAll(".escalate-btn").forEach((btn) => {
      btn.addEventListener("click", function () { const qId = this.getAttribute("data-id"); const select = document.getElementById(`escalate-select-${qId}`); escalateQuery(qId, select.value); });
    });
}

  // --- CREATE DECISION FORM ---
  function showCreateDecisionForm() {
    resultsTitle.innerText = currentUserIsAdmin
      ? "Create New Decision"
      : "Propose New Decision";
    resultsContainer.innerHTML = "";

    const form = document.createElement("div");
    form.style.cssText =
      "width: 90%; display: flex; flex-direction: column; gap: 10px; padding-bottom: 20px;";

    let attrOptions = "";
    selectedAttributes.forEach((attr) => {
      attrOptions += `<option value="${attr}">${attr}</option>`;
    });

    form.innerHTML = `
            <div style="background: #f8f9fa; padding: 10px; border-radius: 8px; font-size: 12px; color: #555; border: 1px solid #eee;">
                <strong>Context:</strong> ${projectInput.value} <br> <strong>Category:</strong> ${categoryInput.value}
            </div>
            <div class="input-group"><label>Attribute Name</label><select id="newDecisionAttr" class="modern-input" style="background:white;">${attrOptions}</select></div>
            
            <!-- SKU Table Section -->
            <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ddd; margin-bottom: 10px;">
                <thead style="background: #f1f1f1;">
                    <tr>
                        <th style="padding: 5px; font-size: 10px; border: 1px solid #ddd;">SKU ID</th>
                        <th style="padding: 5px; font-size: 10px; border: 1px solid #ddd;">Mfr Part #</th>
                        <th style="padding: 5px; font-size: 10px; border: 1px solid #ddd;">Mfr Name</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><input type="text" id="newDecSku" class="modern-input" style="margin:0; border:none; border-radius:0;"></td>
                        <td><input type="text" id="newDecMfrPart" class="modern-input" style="margin:0; border:none; border-radius:0;"></td>
                        <td><input type="text" id="newDecMfrName" class="modern-input" style="margin:0; border:none; border-radius:0;"></td>
                    </tr>
                </tbody>
            </table>

            <div class="input-group"><label>Issue / Description</label><input type="text" id="newDecisionIssue" class="modern-input" placeholder="e.g. Naming Convention"></div>
            <div class="input-group"><label>Decision / Rule</label><textarea id="newDecisionText" class="modern-input" rows="3" placeholder="e.g. Use Sentence case"></textarea></div>
            <div class="input-group"><label>Example Value (Optional)</label><input type="text" id="newDecisionExample" class="modern-input"></div>
            <div style="display:flex; gap: 10px; margin-top: 10px;">
                <button id="cancelDecisionBtn" class="action-btn" style="background: #95a5a6;">Cancel</button>
                <button id="saveDecisionBtn" class="action-btn" style="background: #27ae60;">${currentUserIsAdmin ? "Save Decision" : "Submit Proposal"}</button>
            </div>
        `;
    resultsContainer.appendChild(form);

    document
      .getElementById("cancelDecisionBtn")
      .addEventListener("click", () => performValidation("decision"));
    document.getElementById("saveDecisionBtn").addEventListener("click", () => {
      const payload = {
        // Use fallbacks to ensure null is never sent to the server
        userEmail: currentUserEmail || "Unknown User", 
        project: projectInput.value || "General",
        category: categoryInput.value || "N/A",
        attribute: document.getElementById("newDecisionAttr").value,
        issue: document.getElementById("newDecisionIssue").value,
        decision: document.getElementById("newDecisionText").value,
        example: document.getElementById("newDecisionExample").value,
        sku: document.getElementById("newDecSku").value,
        mfr_part: document.getElementById("newDecMfrPart").value,
        mfr_name: document.getElementById("newDecMfrName").value,
      };

      if (!payload.issue || !payload.decision)
        return alert("Fill required fields");

      fetch(`${API_URL}/create_decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((res) => res.json())
        .then((data) => {
          alert(data.message);

          logUserAction("Posted Query", {
            query_id: "New Decision Proposal",
            category: categoryInput.value, 
            attribute_name: document.getElementById("newDecisionAttr").value
          });
          performValidation("decision");
        });
    });
  }

  // --- 12. API HELPERS ---
  function updateQueryText(id, text) {
    fetch(`${API_URL}/edit_query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queryId: id,
        newQueryText: text,
        userEmail: currentUserEmail,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "success") {
          document.getElementById(`q-text-${id}`).innerText = text;
          document.getElementById(`query-display-${id}`).style.display = "flex";
          document.getElementById(`query-edit-${id}`).style.display = "none";
        } else alert(data.message);
      });
  }

  function submitResponse(id) {
    const btn = document.querySelector(`.send-response-btn[data-id="${id}"]`);
    
    const formData = new FormData();
    formData.append("queryId", id);
    formData.append("response", document.getElementById(`reply-${id}`).value);
    formData.append("responderEmail", currentUserEmail);
    formData.append("link", document.getElementById(`link-${id}`).value);
    const fileInput = document.getElementById(`file-${id}`);
    if (fileInput.files.length > 0) formData.append("file", fileInput.files[0]);

    fetch(`${API_URL}/respond`, { method: "POST", body: formData }).then(() => {
        alert("Sent!");

        logUserAction("Admin Responded", {
            project_name: btn.dataset.proj,
            batch_name: btn.dataset.batch,
            category: btn.dataset.cat,
            attribute_name: btn.dataset.attr,
            query_id: btn.dataset.customid, // This will now correctly be "ABC_022026003"
            query_sent_to: currentUserEmail,
            duration: new Date().toLocaleString(),
            turnaround_time: btn.dataset.asker,
            kb_id: document.getElementById(`reply-${id}`).value
        });

        fetchPendingQueries();
    });
  }

  function escalateQuery(id, role) {
    if (!confirm(`Assign to ${role}?`)) return;
    fetch(`${API_URL}/escalate_query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queryId: id,
        nextRole: role,
        userEmail: currentUserEmail,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        alert(data.message);

        // ADD THIS LOG: Records that a query was assigned to a different role
        logUserAction("Checked Query", {
            query_id: `Escalated ${id} to ${role}`
        });

        fetchPendingQueries();
      });
  }

  // --- 13. UI OVERLAY HANDLERS ---
  closeOverlayBtn.addEventListener("click", () => {
    resultsOverlay.style.display = "none";
    finalStep.classList.remove("active");
    updateUserButtonState();
    updateAdminButtonState();
  });

  askNewQueryBtn.addEventListener("click", () => {
    resultsOverlay.style.display = "none";
    finalStep.classList.add("active");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) urlField.value = tabs[0].url;
    });
  });

  async function logUserAction(action, metadata = {}) {
    if (!currentUserEmail) return;
    
    // Logic: Use metadata if provided (for KB), otherwise fallback to main screen inputs
    const payload = {
        user_email: currentUserEmail,
        user_role: currentUserRole || (currentUserIsAdmin ? "Admin" : "User"),
        action_type: action,
        project_name: metadata.project_name || projectInput.value || "",
        batch_name: metadata.batch_name || batchInput.value || "",
        category: metadata.category || categoryInput.value || "",
        attribute_name: metadata.attribute_name || selectedAttributes.join(" | ") || "",
        query_id: metadata.query_id || "",
        query_sent_to: metadata.query_sent_to || "",
        kb_id: metadata.kb_id || "",
        duration: metadata.duration || "",
        turnaround_time: metadata.turnaround_time || ""
    };

    try {
        fetch(`${API_URL}/log_activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Activity logging failed:", err);
    }
  }

  submitBtn.addEventListener("click", () => {
    const queryEl = document.getElementById("queryText");
    const skuEl = document.getElementById("skuInput");
    const mfrPartEl = document.getElementById("mfrPartInput");
    const mfrNameEl = document.getElementById("mfrNameInput");

    // Validation
    if (!queryEl.value.trim()) return alert("Please describe your query");
    if (!projectInput.value) return alert("Please select a project");

    // Fetch call with integrated fields
    fetch(`${API_URL}/submit_query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: projectInput.value,
        batch: batchInput.value,
        category: categoryInput.value,
        attributes: selectedAttributes,
        query: queryEl.value,
        url: urlField.value,
        userEmail: currentUserEmail,
        sku: skuEl ? skuEl.value.trim() : "",
        mfr_part: mfrPartEl ? mfrPartEl.value.trim() : "",
        mfr_name: mfrNameEl ? mfrNameEl.value.trim() : "",
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.status === "success") {
          alert(`Query Posted! ID: ${data.custom_id}`);
          
          logUserAction("Posted Query", {
            project_name: projectInput.value.trim(),
            batch_name: batchInput.value.trim(),
            category: categoryInput.value.trim(),
            attribute_name: selectedAttributes.join(" | "),
            query_id: queryEl.value.trim(), // The actual text asked by the user
            query_sent_to: data.assigned_to // Role (TL/PL/SME) query was sent to
          });
          // UI State Reset
          resultsOverlay.style.display = "none";
          finalStep.classList.remove("active");

          // Clear all fields
          queryEl.value = "";
          if (skuEl) skuEl.value = "";
          if (mfrPartEl) mfrPartEl.value = "";
          if (mfrNameEl) mfrNameEl.value = "";
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch((err) => {
        console.error("Submit Error:", err);
        alert("Failed to submit query. Check console for details.");
      });
  });

// ======================================================
  // 14. AI POWERED GRAMMAR & TECHNICAL SPELLCHECK
  // ======================================================

  const queryInput = document.getElementById('queryText');
  const aiIcon = document.getElementById('aiAssistantIcon');
  const aiErrorCount = document.getElementById('aiErrorCount');
  const aiBox = document.getElementById('aiSuggestionBox');
  const aiList = document.getElementById('aiSuggestionList');
  
  let aiTimer;

  if (queryInput) {
    // Disable native browser spellcheck so it doesn't clash with AI
    queryInput.setAttribute('spellcheck', 'false');

    queryInput.addEventListener('input', function() {
        clearTimeout(aiTimer);
        const text = this.value.trim();

        if (text.length < 3) {
            aiIcon.style.display = 'none';
            aiBox.style.display = 'none';
            return;
        }

        aiTimer = setTimeout(() => {
            runAiCheck(text);
        }, 800); 
    });

    aiIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        aiBox.style.display = aiBox.style.display === 'none' ? 'block' : 'none';
    });
  }

  async function runAiCheck(text) {
    try {
        // Build technical whitelist safely
        const masterTechVocab = [
            ...(allProjects || []), 
            ...(allCategories || []), 
            ...(allAttributes || [])
        ].map(v => String(v).toLowerCase());

        const response = await fetch('https://api.languagetool.org/v2/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                'text': text,
                'language': 'en-US'
            })
        });

        if (!response.ok) return;
        const data = await response.json();
        
        // Filter out errors that match our technical database
        const filteredMatches = data.matches.filter(match => {
            const errorWord = text.substring(match.offset, match.offset + match.length).toLowerCase();
            return !masterTechVocab.includes(errorWord);
        });

        if (filteredMatches.length > 0) {
            updateAiUI(filteredMatches, text);
        } else {
            aiIcon.style.display = 'none';
            aiBox.style.display = 'none';
        }

    } catch (err) {
        console.warn("AI Check temporarily unavailable (Check Manifest permissions)");
    }
  }

  function updateAiUI(matches, originalText) {
    aiIcon.style.display = 'flex'; // Use flex to center the icon and count
    aiErrorCount.innerText = matches.length;
    aiList.innerHTML = '';

    matches.forEach(match => {
        const wrongWord = originalText.substring(match.offset, match.offset + match.length);
        const suggestion = (match.replacements && match.replacements.length > 0) 
                           ? match.replacements[0].value 
                           : "Check spelling";

        const item = document.createElement('div');
        item.style.cssText = "padding: 8px; border-bottom: 1px solid #f0f0f0; cursor: pointer; font-size: 12px; transition: background 0.2s;";
        item.innerHTML = `<span style="text-decoration: line-through; color: #ff4757;">${wrongWord}</span> <i class="fas fa-arrow-right" style="font-size:10px; margin: 0 5px;"></i> <span style="color: #2ed573; font-weight: bold;">${suggestion}</span>`;
        
        item.onmouseover = () => item.style.backgroundColor = "#f8f9fa";
        item.onmouseout = () => item.style.backgroundColor = "transparent";

        item.onclick = (e) => {
            e.stopPropagation();
            const newText = originalText.substring(0, match.offset) + suggestion + originalText.substring(match.offset + match.length);
            queryInput.value = newText;
            aiBox.style.display = 'none';
            runAiCheck(newText); 
        };
        aiList.appendChild(item);
    });
  }

  // Close AI box if clicking elsewhere
  document.addEventListener('click', () => {
    if (aiBox) aiBox.style.display = 'none';
  });
});