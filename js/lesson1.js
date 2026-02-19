(function () {
  const lightbox = document.getElementById("gifLightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const closeBtn = document.getElementById("closeLightbox");
  const gifButtons = document.querySelectorAll(".zoomable-gif .img-btn");
  const stepImages = document.querySelectorAll(".step-static-image img");
  const slots = document.querySelectorAll(".slot[data-step]");
  const doneButtons = document.querySelectorAll(".done-toggle");
  const doneCountEl = document.getElementById("doneCount");
  const totalCountEl = document.getElementById("totalCount");
  const progressFill = document.getElementById("progressFill");
  const progressKey = "lesson1-progress-v3";
  const doneSteps = new Set(JSON.parse(localStorage.getItem(progressKey) || "[]"));
  const kbdTypeButtons = document.querySelectorAll(".kbd-type-btn");
  const keyLabelMain = document.getElementById("keyLabelMain");
  const keyLabelAlt = document.getElementById("keyLabelAlt");
  const keyHintText = document.getElementById("keyHintText");
  const canUseHoverMagnifier = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const keyboardMap = {
    full: {
      main: "Del",
      alt: "Delete",
      hint: "בדרך כלל בפינה הימנית העליונה של המקלדת."
    },
    laptop: {
      main: "Delete",
      alt: "Del / Fn+Delete",
      hint: "בלפטופים הכפתור יכול להיות קטן או משולב עם Fn."
    },
    mac: {
      main: "delete",
      alt: "fn + delete",
      hint: "ב-MacBook למחיקה קדימה משתמשים לרוב ב-fn + delete."
    }
  };

  function updateProgressUI() {
    let doneCount = 0;
    if (totalCountEl) totalCountEl.textContent = String(slots.length);
    slots.forEach(function (slot) {
      const step = slot.getAttribute("data-step");
      const btn = slot.querySelector(".done-toggle");
      const isDone = doneSteps.has(step);
      slot.classList.toggle("is-done", isDone);
      if (btn) btn.setAttribute("aria-pressed", isDone ? "true" : "false");
      if (isDone) doneCount += 1;
    });
    doneCountEl.textContent = String(doneCount);
    progressFill.style.width = (doneCount / slots.length) * 100 + "%";
  }

  function openLightbox(src, alt) {
    lightboxImg.src = src;
    lightboxImg.alt = alt || "GIF מוגדל";
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }

  function closeLightbox() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    lightboxImg.src = "";
    document.body.classList.remove("no-scroll");
  }

  function setKeyboardType(type) {
    const data = keyboardMap[type];
    if (!data) return;
    keyLabelMain.textContent = data.main;
    keyLabelAlt.textContent = data.alt;
    keyHintText.textContent = data.hint;
    kbdTypeButtons.forEach(function (btn) {
      const active = btn.dataset.kbdType === type;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function setupMagnifier() {
    if (!canUseHoverMagnifier) return;

    const targets = document.querySelectorAll(".zoomable-gif img, .key-photo img, .step-static-image img, #lightboxImg");
    if (!targets.length) return;

    const lens = document.createElement("div");
    lens.className = "magnifier-lens";
    document.body.appendChild(lens);

    const lensSize = 255;
    const zoom = 2.6;
    let activeImg = null;

    function hideLens() {
      lens.style.display = "none";
      activeImg = null;
    }

    function moveLens(event) {
      if (!activeImg) return;
      const rect = activeImg.getBoundingClientRect();
      const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
      const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));

      lens.style.left = event.clientX - lensSize / 2 + "px";
      lens.style.top = event.clientY - lensSize / 2 + "px";
      lens.style.backgroundSize = rect.width * zoom + "px " + rect.height * zoom + "px";
      lens.style.backgroundPosition = -(x * zoom - lensSize / 2) + "px " + (-(y * zoom - lensSize / 2)) + "px";
    }

    targets.forEach(function (img) {
      img.addEventListener("mouseenter", function () {
        if (!img.src) return;
        activeImg = img;
        lens.style.display = "block";
        lens.style.backgroundImage = 'url("' + img.src + '")';
      });
      img.addEventListener("mousemove", moveLens);
      img.addEventListener("mouseleave", hideLens);
    });

    document.addEventListener("scroll", hideLens, true);
  }

  gifButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const img = btn.querySelector("img");
      if (!img) return;
      openLightbox(img.src, img.alt);
    });
  });

  stepImages.forEach(function (img) {
    img.addEventListener("click", function () {
      if (!img.src) return;
      openLightbox(img.src, img.alt);
    });
  });

  doneButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const slot = btn.closest(".slot");
      if (!slot) return;
      const step = slot.getAttribute("data-step");
      if (!step) return;
      if (doneSteps.has(step)) {
        doneSteps.delete(step);
      } else {
        doneSteps.add(step);
      }
      localStorage.setItem(progressKey, JSON.stringify(Array.from(doneSteps)));
      updateProgressUI();
    });
  });

  kbdTypeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setKeyboardType(btn.dataset.kbdType);
    });
  });

  closeBtn.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", function (event) {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && lightbox.classList.contains("is-open")) {
      closeLightbox();
    }
  });

  updateProgressUI();
  setKeyboardType("full");
  setupMagnifier();
})();
